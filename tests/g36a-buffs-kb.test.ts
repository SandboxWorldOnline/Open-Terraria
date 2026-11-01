// ★G36-A（2026-10-31，BJ738/739/740 登记债清偿）判别锁 A：Buff/KB 域。
// 覆盖：BJ739 D-②（再生手环数据通道——销案锁）、D-⑥（狂卷之舌共享账迁移）、
//       D-⑦（闪亮石静止 DoT 减半）、D-④（近战弹武器 KB 链 kbGlove×2+Titan×1.5）、
//       D-⑤（潜行远程 KB）。
// 标杆：Terarria1457（Player.cs:53984-54007/:19058-19227/:19434-19506;
//       Item.cs:1971-1979;GrantArmorBenefits :13221）。
// 变异恰红（withMutation）在同文件 M 组。
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withMutation } from './mutation-guard';
import { BuffState, BuffType } from '../src/stats/Buffs';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';

const _iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

const fakeHooks = (w: World, p: Player) => ({
  world: w,
  player: p,
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
});

afterEach(() => { vi.restoreAllMocks(); });

const DT = 1 / 60;

// ============ D-②：再生手环 49 lifeRegen=2 数据通道（销案锁） ============

describe('G36-A D-②：再生手环族 hpPerSec=1（itemstats Item.lifeRegen 通道）', () => {
  it.each([49, 860, 982, 6188, 6189])('vid %i 装备 → hpPerSec 1（原版 lifeRegen=2 = 1HP/s）', (vid) => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(vid), stack: 1 };
    expect(p.equipStats.hpPerSec).toBeCloseTo(1, 6);
  });
  it('双件叠加 = 2（:13221 lifeRegen += 逐件加算）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(49), stack: 1 };
    p.inv.armor[4] = { id: _iid(982), stack: 1 };
    expect(p.equipStats.hpPerSec).toBeCloseTo(2, 6);
  });
  it('结构锁：vanilla-accfx.json 五件无 life 键（补 life 键 = itemLife 双计回潮）', () => {
    // 860/982 等行存在（pStone/mana 等他键合法）——双计面只看 life 键
    const fx = JSON.parse(readFileSync(join(process.cwd(), 'src', 'data', 'vanilla-accfx.json'), 'utf8')) as Record<string, { life?: number }>;
    for (const vid of [49, 860, 982, 6188, 6189]) {
      expect(fx[String(vid)]?.life, `accfx '${vid}' 出现 life 键 = itemLife 双计`).toBeUndefined();
    }
  });
});

// ============ D-⑦：闪亮石静止档 DoT 减半（:19224-19227） ============

describe('G36-A D-⑦：闪亮石静止 DoT 减半', () => {
  const runOnFire = (gate: boolean, ticks: number): number => {
    const b = new BuffState();
    b.shinyStillGate = gate;
    b.apply(BuffType.OnFire, 3600);
    let dot = 0;
    for (let k = 0; k < ticks; k++) { b.tick(DT); dot += b.consumeDotChunk(); }
    return dot;
  };
  it('OnFire 60t：无门 4HP / 静止门 2HP（flow ÷2）', () => {
    expect(runOnFire(false, 60)).toBe(4);    // 4HP/s × 1s（-120 块 1HP/块）
    expect(runOnFire(true, 60)).toBe(2);     // ★:19226 lifeRegen /= 2
  });
  it('蜂蜜对冲先加后折半（:19212→:19224 序）', () => {
    // OnFire -8 + honey +4 = -4/t → 折半 -2/t → 60t=-120 → 1 块（无门 -4/t→-240→2 块）
    const run = (gate: boolean): number => {
      const b = new BuffState();
      b.shinyStillGate = gate;
      b.apply(BuffType.OnFire, 3600);
      b.apply(BuffType.Honey, 3600);
      let dot = 0;
      for (let k = 0; k < 60; k++) { b.tick(DT); dot += b.consumeDotChunk(); }
      return dot;
    };
    expect(run(false)).toBe(2);
    expect(run(true)).toBe(1);
  });
});

// ============ D-⑥：狂卷之舌共享账迁移（:19203-19211 + :19434 -600 块） ============

describe('G36-A D-⑥：专家舌 DoT 入 ENV_DOTS 共享账', () => {
  const runTongue = (opts: { expert: boolean; burned?: boolean; shiny?: boolean }, ticks: number)
    : { total: number; chunks: number[] } => {
    const b = new BuffState();
    b.expertMode = opts.expert;
    b.shinyStillGate = !!opts.shiny;
    b.apply(BuffType.TheTongue, 3600);
    if (opts.burned) b.apply(BuffType.Burning, 3600);
    const chunks: number[] = [];
    let total = 0;
    for (let k = 0; k < ticks; k++) {
      b.tick(DT);
      const c = b.consumeDotChunk();
      if (c > 0) { chunks.push(c); total += c; }
    }
    return { total, chunks };
  };
  it('专家舌 60t = 50HP（50HP/s,-600 块 5HP/块,节拍 6t——原独立账同相）', () => {
    const r = runTongue({ expert: true }, 60);
    expect(r.total).toBe(50);
    expect(r.chunks.every((c) => c === 5)).toBe(true);   // -600 块 Hur tLifeRegen(5)
    expect(r.chunks.length).toBe(10);                    // 600/100 = 6t 一块
  });
  it('经典（非专家）舌零 DoT（:19203 expertMode 门）', () => {
    expect(runTongue({ expert: false }, 120).total).toBe(0);
  });
  it('专家舌+灼烧 = 合并 -600 块（:19434 三源门,80HP/s 全 5HP 块）', () => {
    const r = runTongue({ expert: true, burned: true }, 60);
    expect(r.total).toBe(80);                            // 50+30 HP/s
    expect(r.chunks.every((c) => c === 5)).toBe(true);   // 合并块=灼烧单独也走 -600（旧舌独立账不可观察此合并）
  });
  it('专家舌+闪亮石静止 = 25HP（D-⑦ 折半入舌流）', () => {
    expect(runTongue({ expert: true, shiny: true }, 60).total).toBe(25);
  });
  it('蜂蜜对冲入舌流（:19212 合并流量 -96/t → 60t 45HP）', () => {
    const b = new BuffState();
    b.expertMode = true;
    b.apply(BuffType.TheTongue, 3600);
    b.apply(BuffType.Honey, 3600);
    let dot = 0;
    for (let k = 0; k < 60; k++) { b.tick(DT); dot += b.consumeDotChunk(); }
    expect(dot).toBe(45);                                // (50-2)HP/s × 1s = 9 块×5
  });
  it('致死文案 tongued（-600 块 :19446 优先序,经典舌+灼烧同挂也走 WasLicked quirk）', () => {
    const w = new World(200, 96, 38, 'g36a-tongue-death');
    w.difficulty = 1;                                    // 专家 ⇒ mainExpertMode 真
    const p = new Player(100 * 16, 56 * 16, new Inventory());
    p.baseMaxHp = 400;
    p.hp = 12;
    p.buffs.apply(BuffType.TheTongue, 3600);
    // 假墙（wofTongue 无墙分支会剥 TheTongue——墙在场才保 buff;3000px 内防 ③ 距离 KillMe）
    const wall = {
      vanillaId: 113, dead: false, x: p.x + 456, y: p.y - 20, w: 100, h: 100,
      cx: p.x + 506, cy: p.y, facing: 1, difficulty: 1, vx: 0, vy: 0,
      def: { damage: 50, name: 'Wall of Flesh' },
    };
    const hooks = { ...fakeHooks(w, p), enemies: () => [wall] };
    for (let k = 0; k < 120 && !p.dead; k++) p.fixedUpdate(DT, hooks as never);
    expect(p.dead).toBe(true);
    expect(p.lastDamageCause).toEqual({ kind: 'tongued' });
  });
  it('装备回复清零单源化：专家舌期 equipRegen=0（dotActiveTick 承载,B08 不回归）', () => {
    const w = new World(200, 96, 38, 'g36a-tongue-eq');
    w.difficulty = 1;
    const p = new Player(100 * 16, 56 * 16, new Inventory());
    p.inv.armor[0] = { id: _iid(2763), stack: 1 };       // lifeRegen+2
    p.baseMaxHp = 400;
    p.hp = 300;
    p.buffs.apply(BuffType.TheTongue, 3600);
    const wall = {
      vanillaId: 113, dead: false, x: p.x + 456, y: p.y - 20, w: 100, h: 100,
      cx: p.x + 506, cy: p.y, facing: 1, difficulty: 1, vx: 0, vy: 0,
      def: { damage: 50, name: 'Wall of Flesh' },
    };
    const hooks = { ...fakeHooks(w, p), enemies: () => [wall] };
    for (let k = 0; k < 300; k++) p.fixedUpdate(DT, hooks as never);
    expect(300 - p.hp).toBeGreaterThanOrEqual(249);      // 50HP/s 主导,装备 +1HP/s 不抵消
    expect(300 - p.hp).toBeLessThanOrEqual(251);
  });
});

// ============ D-④/D-⑤：GetWeaponKnockback（:53984-54007） ============

type KbOpts = {
  kbGlove?: boolean; titan?: boolean; minionKB?: number;
  shroomiteSet?: boolean; vortexSet?: boolean; vortexOn?: boolean; stealth?: number;
};
const gwkb = (kb: number, kind: 'melee' | 'ranged' | 'magic', summon: boolean, o: KbOpts = {}): number => {
  const fake = {
    player: {
      equipStats: { kbGlove: !!o.kbGlove, minionKB: o.minionKB ?? 0, shroomiteSet: !!o.shroomiteSet, vortexSet: !!o.vortexSet },
      buffs: { has: (t: BuffType) => t === BuffType.Titan && !!o.titan },
      stealth: o.stealth ?? 1,
      vortexStealthActive: !!o.vortexOn,
    },
  };
  return (Game.prototype as unknown as {
    getWeaponKnockback(k: number, kd: 'melee' | 'ranged' | 'magic', s: boolean): number;
  }).getWeaponKnockback.call(fake, kb, kind, summon);
};

describe('G36-A D-④：近战弹武器 KB 链（悠悠球/回旋镖发射面）', () => {
  it('裸 KB 直通（kb 4 → 4）', () => {
    expect(gwkb(4, 'melee', false)).toBe(4);
  });
  it('kbGlove ×2（:53990-53993）', () => {
    expect(gwkb(4, 'melee', false, { kbGlove: true })).toBe(8);
  });
  it('泰坦 ×1.5 全武器无职业门（:53994-53997）', () => {
    expect(gwkb(4, 'melee', false, { titan: true })).toBe(6);
    expect(gwkb(4, 'ranged', false, { titan: true })).toBe(6);
    expect(gwkb(4, 'magic', false, { titan: true })).toBe(6);
  });
  it('kbGlove+泰坦 = ×3（序：×2 后 ×1.5）', () => {
    expect(gwkb(4, 'melee', false, { kbGlove: true, titan: true })).toBe(12);
  });
  it('kbGlove 不及远程/魔法（:53990 sItem.melee 门）', () => {
    expect(gwkb(4, 'ranged', false, { kbGlove: true })).toBe(4);
    expect(gwkb(4, 'magic', false, { kbGlove: true })).toBe(4);
  });
  it('鞭 summon 面：+minionKB 后 Titan（:53988→:53994 序;armlet+1 在 ctor 其后）', () => {
    expect(gwkb(4, 'ranged', true, { minionKB: 2 })).toBe(6);
    expect(gwkb(4, 'ranged', true, { minionKB: 2, titan: true })).toBe(9);   // (4+2)×1.5
  });
});

describe('G36-A D-⑤：潜行远程 KB（:53998-54005 裸 stealth 轴）', () => {
  it('蘑菇矿满潜行 ×1.5（stealth 0）', () => {
    expect(gwkb(4, 'ranged', false, { shroomiteSet: true, stealth: 0 })).toBe(6);
  });
  it('半潜行 ×1.25（stealth 0.5）', () => {
    expect(gwkb(4, 'ranged', false, { shroomiteSet: true, stealth: 0.5 })).toBe(5);
  });
  it('星璇带开关门（vortexStealthActive 关 = 无乘区）', () => {
    expect(gwkb(4, 'ranged', false, { vortexSet: true, vortexOn: false, stealth: 0 })).toBe(4);
    expect(gwkb(4, 'ranged', false, { vortexSet: true, vortexOn: true, stealth: 0 })).toBe(6);
  });
  it('潜行乘区不及近战/魔法（:53998 sItem.ranged 门）', () => {
    expect(gwkb(4, 'melee', false, { shroomiteSet: true, stealth: 0 })).toBe(4);
    expect(gwkb(4, 'magic', false, { shroomiteSet: true, stealth: 0 })).toBe(4);
  });
  it('与 Titan 叠（:53994 先 :53998 后）', () => {
    expect(gwkb(4, 'ranged', false, { shroomiteSet: true, stealth: 0, titan: true })).toBe(9);
  });
});

// ============ 结构锁：wrapper 接线（Game.ts 只读——并行热文件禁变异窗） ============

describe('G36-A D-④/⑤ 结构锁（发射链接线）', () => {
  it('useCombatWeapon wrapper knockback 走 getWeaponKnockback（whip+summon 杖面——★G39-A D-⑧ 清偿改判:杖面从排除表移入,原版 :53986-89 summon 分支无 kind 门）', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'core', 'Game.ts'), 'utf8');
    expect(src).toContain('knockback: this.getWeaponKnockback(cwIn.knockback * (ps?.kb ?? 1), dmgKind,');
    expect(src).toContain("cwIn.kind === 'whip' || cwIn.kind === 'summon'),");
  });
  it('远程弹药链 stealth 乘区（Titan 站后）', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'core', 'Game.ts'), 'utf8');
    const iTitan = src.indexOf('if (this.player.buffs.has(BuffType.Titan)) knockback *= 1.5;');
    const iStealth = src.indexOf('knockback *= 1 + (1 - this.player.stealth) * 0.5;');
    expect(iTitan).toBeGreaterThan(0);
    expect(iStealth).toBeGreaterThan(iTitan);
  });
});

// ============ 变异恰红 ============

const spawnVitest = (filter: string) => spawnSync(
  'npx', ['vitest', 'run', 'tests/g36a-buffs-kb.test.ts', '--no-file-parallelism', '-t', filter], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, SW_G36A_MUT: '1' },
  },
);
const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
  withMutation(file, trigger, replacement, () => {
    const r = spawnVitest(filter);
    expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
    expect(r.stdout).toContain(filter);
  }, { label: `G36-A buffs-kb ${filter}` });
};

describe('G36-A 变异恰红（buffs/KB 面）', () => {
  it('M1 D-⑦：摘闪亮石折半门 → 静止夹具红', () => {
    mutate(join(process.cwd(), 'src', 'stats', 'Buffs.ts'),
      'if (flow < 0 && this.shinyStillGate) flow /= 2;',
      'if (flow < 0 && false) flow /= 2;',
      'D-⑦：闪亮石静止 DoT 减半');
  });
  it('M2 D-⑥：摘 -600 块舌源 → 舌块粒度红（5HP 块散成 1HP）', () => {
    mutate(join(process.cwd(), 'src', 'stats', 'Buffs.ts'),
      '|| (this.active.has(BuffType.TheTongue) && this.expertMode);',
      ';',
      'D-⑥：专家舌 DoT 入 ENV_DOTS 共享账');
  });
  it('M3 D-④：摘 kbGlove ×2 → 手套夹具红', () => {
    mutate(join(process.cwd(), 'src', 'core', 'Game.ts'),
      "if (kind === 'melee' && eq.kbGlove) kb *= 2;                      // :53990-53993",
      "if (kind === 'melee' && eq.kbGlove) kb *= 1;                      // :53990-53993",
      'D-④：近战弹武器 KB 链');
  });
  it('M4 D-⑤：摘潜行乘区 → 满潜行夹具红', () => {
    mutate(join(process.cwd(), 'src', 'core', 'Game.ts'),
      'kb *= 1 + (1 - this.player.stealth) * 0.5;                      // :53998-54005',
      'kb *= 1;                      // :53998-54005',
      'D-⑤：潜行远程 KB');
  });
  it('M5 D-②：摘 itemLife 通道 → 手环 hpPerSec 红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      'if (grantArmorBenefits && itemLife) life += itemLife;',
      'if (grantArmorBenefits && itemLife) life += 0 * itemLife;',
      'D-②：再生手环族 hpPerSec');
  });
});
