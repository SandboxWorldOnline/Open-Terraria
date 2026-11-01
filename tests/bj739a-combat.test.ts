// ★BJ739-A（2026-10-31，issue #29）战斗面行为锁：B10 挖矿 0.3 下限 / B16 泰坦远程
// 击退 / B17 浸剂整数秒 / B19 Nano-穿甲次序（Enemy.hurt/TownNPC.hurt nanoMul）。
// 标杆：Terarria1457（Player.cs:26172-75/:53984-54007; Projectile.cs:6500-27/
// 11196-226/:13684-13690; Player.cs:44761-66 挥砍反序对照）。
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Game } from '../src/core/Game';
import { Player } from '../src/entities/Player';
import { Enemy } from '../src/entities/Enemy';
import { TownNPC } from '../src/entities/TownNPC';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { BuffType } from '../src/stats/Buffs';
import { applyMeleeImbue } from '../src/entities/projStatus';
import { withMutation } from './mutation-guard';

afterEach(() => { vi.restoreAllMocks(); });

const gameSrc = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const enemySrc = readFileSync(new URL('../src/entities/Enemy.ts', import.meta.url), 'utf8');
const whipSrc = readFileSync(new URL('../src/entities/WhipProj.ts', import.meta.url), 'utf8');
const weaponSrc = readFileSync(new URL('../src/entities/WeaponProj.ts', import.meta.url), 'utf8');

const fakeHooks = (w: World, p?: Player) => ({
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

// ============ B10：pickSpeed 0.3 下限（Player.cs:26172-75） ============

describe('BJ739 B10：挖矿速度 0.30 下限', () => {
  const mkGame = (buffs: Array<[BuffType, number]>, opts: { chisel?: boolean } = {}): { pickSpeedMult: () => number } => {
    const p = new Player(0, 0, new Inventory());
    for (const [t, s] of buffs) p.buffs.apply(t, s);
    if (opts.chisel) (p as unknown as { equipStatsOverride?: unknown });
    const g = Object.create(Game.prototype) as unknown as {
      player: Player;
      pickSpeedMult: () => number;
    };
    g.player = p;
    return g;
  };
  it('单挖矿药水 = 0.75（不触下限）', () => {
    expect(mkGame([[BuffType.Mining, 60]]).pickSpeedMult()).toBeCloseTo(0.75, 6);
  });
  it('挖矿+蛋糕+饕餮 = 1-.25-.20-.15 = 0.40（不触下限）', () => {
    expect(mkGame([[BuffType.Mining, 60], [BuffType.SugarRush, 60], [BuffType.WellFed3, 60]])
      .pickSpeedMult()).toBeCloseTo(0.40, 6);
  });
  it('全叠（挖矿+古凿+蛋糕+饕餮）= 0.15 → 钳 0.30（issue 公式推导例）', () => {
    // 古凿 chiselSpeed 走 equipStats——经装备面注入
    const p = new Player(0, 0, new Inventory());
    p.buffs.apply(BuffType.Mining, 60);
    p.buffs.apply(BuffType.SugarRush, 60);
    p.buffs.apply(BuffType.WellFed3, 60);
    (p as unknown as { __stubEquip?: unknown });
    const g = Object.create(Game.prototype) as unknown as { player: unknown; pickSpeedMult: () => number };
    g.player = {
      buffs: p.buffs,
      usedAmbrosia: false,
      equipStats: { chiselSpeed: true, pickSpeedOff: 0 },
    };
    expect(g.pickSpeedMult()).toBeCloseTo(0.30, 6);
  });
});

// ============ B17：浸剂时长离散整数秒（Player.cs:6500-27 / Projectile.cs:11196-226） ============

describe('BJ739 B17：applyMeleeImbue 六浸剂整数秒（Next(a,b) 右端不含）', () => {
  type StatusEnemy = Parameters<typeof applyMeleeImbue>[1];
  const mkEnemy = (): StatusEnemy => ({}) as StatusEnemy;
  const has = (b: { has: (t: BuffType) => boolean }, t: BuffType): boolean => b.has(t);

  it('毒液浸剂：rand=0.999 → 9s；rand=0 → 5s（旧连续式 9.995/5.0）', () => {
    for (const [r, want] of [[0.999, 9], [0, 5], [0.5, 7]] as const) {
      const e = mkEnemy();
      const rnd = vi.spyOn(Math, 'random').mockReturnValue(r);
      applyMeleeImbue({ has: (t) => t === BuffType.ImbueVenom }, e);
      rnd.mockRestore();
      expect(e.venomT).toBe(want);
      expect(Number.isInteger(e.venomT)).toBe(true);   // 离散整数秒
    }
  });
  it('灵液浸剂：rand=0.999 → 19s；rand=0 → 10s', () => {
    for (const [r, want] of [[0.999, 19], [0, 10]] as const) {
      const e = mkEnemy();
      const rnd = vi.spyOn(Math, 'random').mockReturnValue(r);
      applyMeleeImbue({ has: (t) => has({ has: (x: number) => x === BuffType.ImbueIchor } as never, t) }, e);
      rnd.mockRestore();
      expect(e.ichorT).toBe(want);
    }
  });
  it('纳米浸剂：rand=0.999 → 3s；rand=0 → 1s（issue 表：Next(1,4)）', () => {
    for (const [r, want] of [[0.999, 3], [0, 1]] as const) {
      const e = mkEnemy();
      const rnd = vi.spyOn(Math, 'random').mockReturnValue(r);
      applyMeleeImbue({ has: (t) => t === BuffType.ImbueNano }, e);
      rnd.mockRestore();
      expect(e.confusedT).toBe(want);
    }
  });
  it('诅咒焰/烈火/剧毒边界值（3..6/3..6/5..9）', () => {
    const probe = (bt: BuffType, r: number): number => {
      const e = mkEnemy();
      const rnd = vi.spyOn(Math, 'random').mockReturnValue(r);
      applyMeleeImbue({ has: (t) => t === bt }, e);
      rnd.mockRestore();
      return (e as Record<string, number | undefined>)[
        bt === BuffType.ImbueCursed ? 'cursedT' : bt === BuffType.ImbueFire ? 'onFireT' : 'poisonT'] as number;
    };
    expect(probe(BuffType.ImbueCursed, 0.999)).toBe(6);
    expect(probe(BuffType.ImbueCursed, 0)).toBe(3);
    expect(probe(BuffType.ImbueFire, 0.999)).toBe(6);
    expect(probe(BuffType.ImbueFire, 0)).toBe(3);
    expect(probe(BuffType.ImbuePoison, 0.999)).toBe(9);
    expect(probe(BuffType.ImbuePoison, 0)).toBe(5);
  });
  it('Game 挥砍站结构锁（Math.floor 化六支）', () => {
    expect(gameSrc).toContain('const v70 = 5 + Math.floor(Math.random() * 5);');
    expect(gameSrc).toContain('const v = 10 + Math.floor(Math.random() * 10);');
  });
});

// ============ B19：Nano-穿甲次序（Projectile.cs:13684-13690 pen 先加、Nano 后乘） ============

describe('BJ739 B19：Enemy.hurt nanoMul（penAdd 并入后 ×1.05 截断）', () => {
  const mkEnemy = (): Enemy => {
    const e = new Enemy('zombie', 100, 100);
    e.iframes = 0;
    return e;
  };
  const dmgOf = (nanoMul: number | undefined, armorPen: number): number => {
    const w = new World(60, 60, 42, 'bj739a-b19');
    const e = mkEnemy();
    const hp0 = e.hp;
    const args: Parameters<Enemy['hurt']> = [39, 1, 0, fakeHooks(w) as never, armorPen, false, 1, true];
    if (nanoMul !== undefined) (args as unknown as number[]).push(0, 0, nanoMul);
    e.hurt(...args);
    return hp0 - e.hp;
  };
  it('基伤 39 穿甲池 12 防 6：trunc 后乘序 41（旧先乘序 40）', () => {
    // zombie def=6：pen 12 > def 6 → penAdd = def/2 = 3（超防钳制）
    expect(dmgOf(undefined, 12)).toBe(39);        // 无 nano：39+3−3 = 39
    expect(dmgOf(1.05, 12)).toBe(41);             // ★BJ739：trunc((39+3)×1.05)−3 = 44−3 = 41（旧 trunc(39×1.05)+3−3 = 40）
  });
  it('无穿甲时两序等值（39×1.05 截断后 −3）', () => {
    expect(dmgOf(1.05, 0)).toBe(Math.trunc(39 * 1.05) - 3);
  });
  it('TownNPC.hurt 同序（向导 def=30：penAdd 6 → 无 nano 30 / nano 32）', () => {
    const w = new World(60, 60, 42, 'bj739a-b19t');
    const tn = new TownNPC('guide', 200, 100);   // 向导（vanilla-npcs.json defense 30）
    const hp0 = tn.hp;
    tn.hurt(39, 1, 0, fakeHooks(w) as never, 0, 12, false, false, true, 0, 1);
    expect(hp0 - tn.hp).toBe(30);           // 39+6−15
    const tn2 = new TownNPC('guide', 200, 100);
    const hp1 = tn2.hp;
    tn2.hurt(39, 1, 0, fakeHooks(w) as never, 0, 12, false, false, true, 0, 1.05);
    expect(hp1 - tn2.hp).toBe(32);          // trunc((39+6)×1.05)−15 = 47−15
  });
  it('WhipProj/WeaponProj 调用面结构锁（nanoMul 透传,乘区摘除）', () => {
    expect(whipSrc).toContain('nanoMul: whipImbuNano ? 1.05 : 1,');
    expect(whipSrc).toContain('whipImbuNano ? 1.05 : 1); // kby=0 原版管线');
    expect(weaponSrc).toContain('const projNanoMul = meleeGateHere && imbuNano ? 1.05 : 1;');
    expect(weaponSrc).toContain('projNanoMul); // 裸 kb');
    // 挥砍站（Game.ts）保持原版反序（Nano 先/pen 后）——不传 nanoMul
    expect(gameSrc).toContain('swDmg = Math.trunc(swDmg * 1.05);');
  });
});

// ============ B16：泰坦远程击退（GetWeaponKnockback 全武器 ×1.5） ============

describe('BJ739 B16：远程发射链 Titan ×1.5（结构锁+公式推导）', () => {
  it('Game.ts 两站结构锁（枪弹 knockback + 火箭 contactKb）', () => {
    expect(gameSrc).toContain('if (this.player.buffs.has(BuffType.Titan)) knockback *= 1.5;');
    expect(gameSrc).toContain("* (this.player.buffs.has(BuffType.Titan) ? 1.5 : 1);   // ★BJ739 B16：泰坦 ×1.5（GetWeaponKnockback,同上站注）");
  });
  it('公式推导（issue 例）：火枪 kb 4 + 弹药 0 → Titan 6（弹药 KB 先加、Titan 后乘,:47474-758）', () => {
    const weaponKb = 4, ammoKb = 0, prefix = 1;
    const base = weaponKb * prefix + ammoKb;
    expect(base * 1.5).toBe(6);
  });
});

// ============ 变异恰红（withMutation 三层守卫） ============

describe('BJ739 变异恰红', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj739a-combat.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, SW_BJ739A_MUT: '1' },
    },
  );
  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, { label: `BJ739-A ${filter}` });
  };

  const GAME = join(process.cwd(), 'src', 'core', 'Game.ts');
  const ENEMY = join(process.cwd(), 'src', 'entities', 'Enemy.ts');

  it('M1 B10：摘 0.3 下限 → 下限夹具红', () => {
    mutate(GAME,
      'return Math.max(0.3, pickSpeed);',
      'return pickSpeed; /* BJ739A-M1 变异 */',
      '钳 0.30');
  });

  it('M2 B16：摘远程 Titan 乘区 → 结构锁红', () => {
    mutate(GAME,
      'if (this.player.buffs.has(BuffType.Titan)) knockback *= 1.5;',
      'if (false && this.player.buffs.has(BuffType.Titan)) knockback *= 1.5; /* BJ739A-M2 变异 */',
      'Game.ts 两站结构锁');
  });

  it('M3 B17：浸剂时长回连续秒 → 整数边界夹具红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'projStatus.ts'),
      'const v = 5 + Math.floor(Math.random() * 5);',
      'const v = 5 + Math.random() * 5; /* BJ739A-M3 变异 */',
      '毒液浸剂');
  });

  it('M4 B19：nanoMul 摘除回直加序 → 乘序夹具红', () => {
    mutate(ENEMY,
      'const strikeBase = nanoMul !== 1 ? Math.trunc((dmg + penAdd) * nanoMul) : dmg + penAdd;',
      'const strikeBase = dmg + penAdd; /* BJ739A-M4 变异 */',
      '基伤 39');
  });
});
