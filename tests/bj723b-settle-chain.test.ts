// BJ723-B（issue #24）共用结算链六件·判别锁+行为面（2026-10-26）
// 六件：S02 暴击先翻倍再减防 / W01 近战弹幕共享命中漏 DV / W02 电锯幸运取反 /
//       W03 日耀喷发+爆焰漏旗+DV / R02 火箭榴弹接触链漏暴击/旗/DV /
//       R03 刺炮246/南瓜312/钉弹514 死亡爆炸不暴击无 DV。
// 原版锚（1457 亲读）：
//   · NPC.cs:82067（StrikeNPC_Inner）
//     `int num = (int)Math.Max(1.0, Main.CalculateDamageNPCsTake(Damage, defense)
//       * (double)((!crit) ? 1 : 2));`
//   · Main.cs CalculateDamageNPCsTake（:67126-33 域）= max(1.0, Damage−defense×0.5)
//     ——保底门在 ×2 之前、double 域（防后 0.5 时原版 crit=2 非中点截 1）。
//   · Projectile.cs Damage_PVE_Inner 逐 victim：crit 掷(:12915-27)→TimerCrit(:12928)
//     →tag(:12946-62)→golem(:12962-65)→DamageVar(:12970,owner luck 正向)
//     →banner(:13388-90)→snap(:13439-46)→parry/nano→StrikeNPC(:13702,防后 ×2)。
//   · 246/312/514 Kill 重跑 Damage()：Projectile.cs:78644-78678/:78583-78643/
//     :77985-78020（Resize+penetrate=-1+Damage()）;三型 SetDefaults 全 ranged
//     （:3291/:4048/:5843 亲读）→逐靶 crit 掷+DV+旗照跑。
//   · luck 符号四族：玩家弹→NPC +luck（:12970）/PvP 弹→玩家 +owner（:14718）/
//     敌弹→玩家 −luck（:14904）/自伤 −localPlayer（:15118,Player.cs:31625 同族）。
// 判别值（issue 复现逐组）：
//   S02: 基伤 100 防 40 crit 实扣应 160（旧预倍形 180）;10/40 应 2（旧 1）。
//   W01: -15/0/+15 档 85/100/115（旧恒 100）。
//   W02: 幸运 +1 高带重掷 100→115（旧取反 85）。
//   W03: 旗 1/1.5/2 基伤 100 应 100/150/200（旧恒 100）。
//   R02: 暴击+旗 1.5 基伤 100 应 300（旧 100）。
//   R03: 爆炸逐靶掷 crit/DV（旧固定 trunc+crit=false）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { Enemy } from '../src/entities/Enemy';
import { Game } from '../src/core/Game';
import { hitEnemies, HitCooldown, GrenadeProj } from '../src/entities/WeaponProj';
import { SolarFlare, SolarEruptionWhip } from '../src/entities/SolarEruption';
import { damageVarRoll } from '../src/stats/DamageVar';
import { damageVar } from '../src/stats/ScaleStats';
import type { GameHooks } from '../src/entities/types';

const PX = 1024, PY = 1448;
const src = (p: string): string => readFileSync(p, 'utf-8');
const ENEMY_TS = 'src/entities/Enemy.ts';

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number;
  dead: boolean; cx: number; cy: number; vanillaId?: number;
  hurt: (d: number, kx: number, ky: number, g: unknown, pen?: number,
    crit?: boolean, pierce?: number, fromPlayer?: boolean) => boolean;
  hits: Array<{ d: number; crit?: boolean }>;
}
const mkEnemy = (id: number, cx: number, cy: number, vanillaId?: number): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - 12, y: cy - 20, w: 24, h: 40, dead: false, cx, cy, vanillaId,
    hurt: (d: number, _kx: number, _ky: number, _g: unknown, _pen?: number,
      crit?: boolean) => { e.hits.push({ d, crit }); return true; },
    hits: [],
  };
  return e;
};

function mkHooks(enemies: MockEnemy[], opts?: { bannerKey?: number }): GameHooks {
  const store = new TileStore(400, 220);
  const player = new Player(PX, PY, new Inventory());
  const hooks: Record<string, unknown> = {
    world: { store, difficulty: 0, seedFlags: {}, clock: { isDay: false } },
    player,
    enemies: () => enemies,
    critters: () => [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    spawnDust: () => null,
    notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    applyLifeSteal: () => 0,
    noteNpcPlayerImmune: () => {},
    spawnFriendlyProj: () => {},
  };
  // 旗乘区（W03/R02/R03 判别面）：bannerNpcActive 对指定键放行（普通旗 → 经典 1.5×）
  if (opts?.bannerKey !== undefined) hooks.bannerNpcActive = (k: number) => k === opts.bannerKey;
  hooks.entities = { add: () => {} };
  return hooks as unknown as GameHooks;
}

// ============================================================
// S02 拱顶石：Enemy.hurt 暴击防后翻倍（真实 Enemy 全管线）
// ============================================================
describe('BJ723-B S02 Enemy.hurt crit ×2 防后（NPC.cs:82067 两步式）', () => {
  afterEach(() => vi.restoreAllMocks());

  const mkNpc = (defense: number): Enemy => {
    const e = Enemy.fromVanilla(4, 35 * 16, 60 * 16)!;   // EoC（bj395 同款真实管线）
    e.def.defense = defense;
    e.maxHp = 100000;
    e.hp = 100000;
    e.iframes = 0;
    return e;
  };
  const settle = (e: Enemy, dmg: number, crit: boolean, pen = 0): number => {
    const hp0 = e.hp;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // hurt 内零 RNG 面（防尘掷）
    e.hurt(dmg, 1, 0, mkHooks([]), pen, crit, 0, false);
    return hp0 - e.hp;
  };

  it('S02-1 基伤 100 防 40 crit 实扣 160（issue 复现值;旧预倍形 180）', () => {
    expect(settle(mkNpc(40), 100, true)).toBe(160);
  });
  it('S02-2 基伤 10 防 40 crit 实扣 2（保底门在 ×2 前;旧形 1）', () => {
    expect(settle(mkNpc(40), 10, true)).toBe(2);
  });
  it('S02-3 非暴击 100/40=80 零漂移（回归面）', () => {
    expect(settle(mkNpc(40), 100, false)).toBe(80);
  });
  it('S02-4 防后 0.5 边界（8-7.5=0.5）：crit=2 非 1——保底门 double 域先于 ×2', () => {
    expect(settle(mkNpc(15), 8, true)).toBe(2);
  });
  it('S02-5 穿甲池并入基数后统一翻倍（pen20/def40：100+10-20=90→crit 180）', () => {
    expect(settle(mkNpc(40), 100, true, 20)).toBe(180);
  });
  it('S02-6 takenDamageMultiplier 作用在 ×2 之后（100/def0 crit ×tdm3=600）', () => {
    const e = mkNpc(0);
    (e as unknown as { takenDamageMultiplier: number }).takenDamageMultiplier = 3;
    const hp0 = e.hp;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    e.hurt(100, 1, 0, mkHooks([]), 0, true, 0, false);
    expect(hp0 - e.hp).toBe(600);
  });
  it('S02-7 结构锁：Enemy.hurt 两步式（保底门+防后 ×2）与旧偏差登记销账注', () => {
    const t = src(ENEMY_TS);
    expect(t).toContain('let calcNpc = dmg + penAdd - def * 0.5;');
    expect(t).toContain('if (calcNpc < 1) calcNpc = 1;');
    expect(t).toContain('dmg = Math.trunc(calcNpc * (crit ? 2 : 1));');
    expect(t).toContain('★S02 BJ723-B 2026-10-26 销账');
  });
  it('S02-8 全仓 census 判别锁：调用侧预翻倍面零残留（白名单=Enemy/TownNPC 防后本体+MagicProj 死面豁免）', () => {
    const files = [
      'src/core/Game.ts', 'src/entities/Arrow.ts', 'src/entities/MinionProj.ts',
      'src/entities/WeaponProj.ts', 'src/entities/WhipTag.ts', 'src/entities/WhipProj.ts',
      'src/entities/proj1457.ts', 'src/entities/Player.ts', 'src/entities/MountCombat.ts',
      'src/entities/SwingArc.ts', 'src/entities/MissileProj.ts', 'src/entities/PrismProj.ts',
      'src/entities/RainbowProj.ts', 'src/entities/MedusaHeadProj.ts', 'src/entities/LunarNebula.ts',
      'src/entities/SolarEruption.ts', 'src/entities/ChainsawProj.ts', 'src/entities/TideSlash.ts',
      'src/entities/VolcanoBlastProj.ts', 'src/entities/meleeOnHitProjs.ts',
      'src/entities/SkyDragonFury.ts', 'src/entities/MonkStaffFury.ts', 'src/entities/Celeb2.ts',
      'src/entities/DeadCellsFlint.ts', 'src/entities/DeadCellsMushroom.ts',
      'src/entities/FirstFractal.ts', 'src/entities/ForbiddenSignProj.ts',
      'src/entities/SolutionProj.ts', 'src/entities/ElectroSphereProj.ts',
      'src/entities/PhoenixBowProj.ts', 'src/entities/ClusterFragmentProj.ts',
      'src/entities/InsanityShadowFriendly.ts', 'src/entities/SparkleGuitarProj.ts',
    ];
    // 预翻倍三形态：三元 ×2 / `if (crit) dmg *= 2` / snap 加伤随暴击预倍
    const rePre = /\* ?\(crit\w* \? 2 ?: ?1\)|crit\w* \? [a-zA-Z0-9_.()]+ \* 2 ?:|if \(crit\w*\) (dmg|damage|dN) \*= 2|snapBonus\w* \* \(crit\w* \? 2 ?: ?1\)/;
    for (const f of files) {
      const offenders = src(f).split('\n')
        .map((l, i) => ({ l: l.trim(), n: i + 1 }))
        .filter(x => rePre.test(x.l) && !x.l.startsWith('//') && !x.l.includes('BJ723'));
      expect(offenders, `${f}: ${JSON.stringify(offenders)}`).toEqual([]);
    }
    // 嵌入式 tag 翻倍与城镇摘半档退役
    expect(src('src/entities/WhipTag.ts')).not.toContain('if (crit) dmg *= 2;');
    expect(src('src/entities/MinionProj.ts')).not.toContain('res.dmg / 2');
  });
});

// ============================================================
// W01：hitEnemies（回旋镖/长矛/链锤/悠悠球共享）DamageVar 首掷
// ============================================================
describe('BJ723-B W01 hitEnemies DamageVar ±15%（:12970 逐靶掷）', () => {
  afterEach(() => vi.restoreAllMocks());

  const runOnce = (rnd: number, enemies: MockEnemy[], bannerKey?: number): MockEnemy => {
    vi.spyOn(Math, 'random').mockReturnValue(rnd);
    const self = {
      x: enemies[0].x, y: enemies[0].y, w: 24, h: 24, vx: 1,
      damage: 100, knockback: 2, critChance: 0,
    };
    hitEnemies(self as never, mkHooks(enemies, bannerKey ? { bannerKey } : undefined),
      new HitCooldown(), 10, 1);
    return enemies[0];
  };

  it('W01-1 档位 -15/0/+15 → hurt 收 85/100/115（旧恒 100）', () => {
    expect(runOnce(0.0, [mkEnemy(1, PX, PY)]).hits[0].d).toBe(85);
    expect(runOnce(0.5, [mkEnemy(2, PX, PY)]).hits[0].d).toBe(100);
    expect(runOnce(0.999, [mkEnemy(3, PX, PY)]).hits[0].d).toBe(115);
  });
  it('W01-2 crit 旗透传（TimerCrit 强制位）且调用侧不预倍——hurt 首/六参=(DV 值,true)', () => {
    const e = mkEnemy(4, PX, PY);
    const hooks = mkHooks([e]);
    const player = hooks.player as unknown as { tryConsumingTimerCrit: () => boolean };
    vi.spyOn(player, 'tryConsumingTimerCrit').mockReturnValue(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    hitEnemies({ x: e.x, y: e.y, w: 24, h: 24, vx: 1, damage: 100, knockback: 2, critChance: 0 } as never,
      hooks, new HitCooldown(), 10, 1);
    expect(e.hits[0]).toEqual({ d: 100, crit: true });
  });
  it('W01-3 攻端旗乘区在 DV 后（:13388）：僵尸旗经典 1.5× → 100→150', () => {
    // 僵尸 vanillaId=3 → bannerNpcKeyOf=3（普通旗,经典档 1.5）
    expect(runOnce(0.5, [mkEnemy(5, PX, PY, 3)], 3).hits[0].d).toBe(150);
  });
  it('W01-4 结构锁：hitEnemies 含 DV 首掷+dmgBase 无预倍;四消费族全经 hitEnemies', () => {
    const t = src('src/entities/WeaponProj.ts');
    expect(t).toContain('const dmgVarW01 = damageVarRoll(self.damage,');
    expect(t).toContain('const dmgBase = Math.trunc(dmgVarW01 * mul);');
    expect(t).not.toContain('(crit ? self.damage * 2 : self.damage)');
    const w = src('src/entities/WeaponProj.ts');
    expect(w.match(/hitEnemies\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);   // 回旋镖/长矛/链锤/悠悠球消费族
  });
});

// ============================================================
// W02：电锯幸运取反勘误（攻端 :12970 luck 正向）
// ============================================================
describe('BJ723-B W02 链锯 luck 符号（Projectile.cs:12970 正向 vs :14904 负向）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('W02-1 幸运 +1 高带重掷取 max：序列[中性,重掷门,+15 档] → 115（旧取反 85）', () => {
    const seq = [0.5, 0.5, 0.999];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++]);
    expect(damageVar(100, 1)).toBe(115);
  });
  it('W02-2 负幸运（敌弹打玩家族域）取 min 对照定谳——受端语义未被误改', () => {
    const seq = [0.5, 0.5, 0.999];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++]);
    expect(damageVar(100, -1)).toBe(100);   // 低带 min(100,115)=100（重掷取低带）
  });
  it('W02-3 结构锁：ChainsawProj 攻端正 luck（:12970）,负号族（:14904/:15118）不入本站', () => {
    const t = src('src/entities/ChainsawProj.ts');
    expect(t).toContain('damageVar(this.damage, owner.player?.luck ?? 0)');
    expect(t).not.toContain('-(owner.player?.luck');
    expect(t).toContain('W02');
  });
});

// ============================================================
// W03：日耀喷发 611 + 爆焰 612 补旗乘区+DV（原版 Projectile.cs:13388/:12970）
// ============================================================
describe('BJ723-B W03 SolarEruption/SolarFlare 旗+DV', () => {
  afterEach(() => vi.restoreAllMocks());

  it('W03-1 爆焰 612 命中吃 DV（0.5 中性档 → 100）+crit 参透传（TimerCrit）', () => {
    const e = mkEnemy(6, PX, PY);
    const hooks = mkHooks([e]);
    const player = hooks.player as unknown as { tryConsumingTimerCrit: () => boolean };
    vi.spyOn(player, 'tryConsumingTimerCrit').mockReturnValue(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const f = new SolarFlare(e.cx, e.cy, 100, 1);
    f.fixedUpdate(1, hooks);
    expect(e.hits[0]).toEqual({ d: 100, crit: true });
  });
  it('W03-2 爆焰 612 旗 1.5×（僵尸旗经典档）：100 → hurt 首参 150（issue:旗 1/1.5/2 应 100/150/200）', () => {
    const e = mkEnemy(7, PX, PY, 3);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const f = new SolarFlare(e.cx, e.cy, 100, 1);
    f.fixedUpdate(1, mkHooks([e], { bannerKey: 3 }));
    expect(e.hits[0].d).toBe(150);
  });
  it('W03-3 结构锁：两站 hurt 均过 applyBannerDamageDealt+damageVarRoll,无预倍', () => {
    const t = src('src/entities/SolarEruption.ts');
    expect(t).toContain('const dmg = damageVarRoll(this.damage,');
    expect((t.match(/applyBannerDamageDealt\(game, e, dmg\)/g) ?? []).length).toBe(2);
    expect(t).not.toContain('crit ? this.damage * 2');
  });
});

// ============================================================
// R02：火箭/榴弹接触链（发射支+投掷支）crit/DV/旗
// ============================================================
describe('BJ723-B R02 GrenadeProj 接触链（Damage_PVE 全管线）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('R02-1 发射支接触：DV 中性档 100 + crit 旗透传（掷率关断钉 0=零掷）;旗 1.5× → 150', () => {
    const e = mkEnemy(8, PX, PY, 3);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const g = new GrenadeProj(e.x + 4, e.y + 4, 0, 0, 100, 180, 30, () => {});
    g.fired = true;
    g.fixedUpdate(1, mkHooks([e], { bannerKey: 3 }));
    expect(e.hits.length).toBeGreaterThan(0);
    expect(e.hits[0].d).toBe(150);   // 100(DV0.5) × 1.5(banner)
    expect(e.hits[0].crit).toBe(false);
    expect(g.fuse).toBe(3);          // 接触钳引信（:12330-12340）
  });
  it('R02-2 暴击×旗复合（issue 复现:暴击+旗 1.5 基伤 100 应 300——×2 由 hurt 防后承载）', () => {
    const e = mkEnemy(9, PX, PY, 3);
    const hooks = mkHooks([e], { bannerKey: 3 });
    // GrenadeProj.critChance 关断钉>0 → rollVanillaHitCrit(30,ranged) 0.0 掷中 → DV 0.5
    const seq = [0.0, 0.5];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++] ?? 0.5);
    const g = new GrenadeProj(e.x + 4, e.y + 4, 0, 0, 100, 180, 30, () => {});
    g.fired = true;
    (g as unknown as { critChance: number }).critChance = 0.04;
    g.fixedUpdate(1, hooks);
    // 传入 hurt 的首参=150（100×1.5,crit 不预倍）——×2 在 Enemy.hurt 防后（S02-1 已证）
    expect(e.hits[0]).toEqual({ d: 150, crit: true });
  });
  it('R02-3 结构锁：两支（发射 6342/投掷 6791 域）均 applyBannerDamageDealt+damageVarRoll', () => {
    const t = src('src/entities/WeaponProj.ts');
    expect(t).toContain('const dmgVGrenade = damageVarRoll(this.damage,');
    expect(t).toContain('const dmgVGrenadeThrow = damageVarRoll(this.damage,');
    expect(t).toContain('e.hurt?.(applyBannerDamageDealt(game, e, dmgVGrenade)');
    expect(t).toContain('e.hurt?.(applyBannerDamageDealt(game, e, dmgVGrenadeThrow)');
  });
});

// ============================================================
// R03：settleKillExplosion（246/312/514）逐靶 crit 掷+DV
// ============================================================
describe('BJ723-B R03 settleKillExplosion 逐靶掷（Kill 重跑 Damage()）', () => {
  afterEach(() => vi.restoreAllMocks());

  const runExplode = (rndSeq: number[], vanillaId?: number, bannerKey?: number): MockEnemy => {
    const e = mkEnemy(10, PX, PY, vanillaId);
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => rndSeq[i++] ?? 0.5);
    const fakeThis = {
      entities: { enemies: [e], critters: [] as MockEnemy[] },
      player: { luck: 0 },
      world: { difficulty: 0, seedFlags: {} },
      ...(bannerKey !== undefined ? { bannerNpcActive: (k: number) => k === bannerKey } : {}),
    };
    (Game.prototype as unknown as {
      settleKillExplosion: (cx: number, cy: number, half: number, dmg: number,
        projId: number, flags?: { hostile?: boolean; arpen?: number }) => void;
    }).settleKillExplosion.call(fakeThis, PX, PY, 75, 100, 246);
    return e;
  };

  it('R03-1 逐靶 crit 掷（246 ranged 旗）+DV：掷中拍 hurt=(DV 值,true)', () => {
    const e = runExplode([0.0, 0.5]);   // crit 掷 0.0 命中(基 4%) → DV 0.5 中性
    expect(e.hits[0]).toEqual({ d: 100, crit: true });
  });
  it('R03-2 未掷中拍（0.999）crit=false + DV 照掷（旧=固定 trunc+恒 false）', () => {
    const e = runExplode([0.999, 0.5]);
    expect(e.hits[0]).toEqual({ d: 100, crit: false });
  });
  it('R03-3 旗乘区（僵尸旗 1.5×）：100→150（246/312/514 Kill 爆炸旗面）', () => {
    const e = runExplode([0.999, 0.5], 3, 3);
    expect(e.hits[0].d).toBe(150);
  });
  it('R03-4 结构锁：settleKillExplosion 逐靶 rollVanillaHitCrit+damageVarRoll;41 狱炎箭邻位债登记注', () => {
    const t = src('src/core/Game.ts');
    expect(t).toContain('const critX = rollVanillaHitCrit(projId, this);');
    expect(t).toContain('const dmgVX = damageVarRoll(dmg, this.player.luck ?? 0);');
    expect(t).toContain('const critC = rollVanillaHitCrit(projId, this);');
    expect(t).toContain('★R03（BJ723-B 2026-10-26）');
  });
});

// ============================================================
// 门序统一定谳锁：S02 与其余五件的耦合面（勿双重翻倍/双重浮动）
// ============================================================
describe('BJ723-B 门序统一（S02 拱顶石与其余五件耦合）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('G1 whip tag 链：res.crit 嵌入翻倍已摘（DV 掷未翻倍基数）——resolveWhipTagHit 返回不含 ×2', async () => {
    const { resolveWhipTagHit } = await import('../src/entities/WhipTag');
    // 无 tag 栈（stack.activeCount===0）早退形：纯基数+crit=false（基数不翻倍）
    const r = resolveWhipTagHit({ id: 1, x: 0, y: 0, w: 16, h: 16 } as never,
      100, mkHooks([]), () => {}, 1, 0, 0, null);
    expect(r).toEqual({ dmg: 100, crit: false });
  });
  it('G2 tag-crit + DV 序（BJ716-A 登记债①清偿面）：MinionProj 八面无「!res.crit 补倍」残留', () => {
    const t = src('src/entities/MinionProj.ts');
    expect(t).not.toContain('&& !res.crit ? dmgV');
    expect(t).not.toContain('&& !resBoom.crit ? dmgV');
  });
  it('G3 hurt 公式判别（变异恰红锚）：单步式（trunc 后 ×2 或 ×2 先于保底）必与本组断言互斥', () => {
    // S02-1/S02-2/S02-4 三值 (160/2/2) 恰锁定两步式——
    //   单步 trunc(max(1,x*2))：S02-4 给 1（非 2）;
    //   旧预倍形（2x−def/2）：S02-1 给 180（非 160）。
    // 本断言钉互斥关系（值域互斥=变异恰红的判别面）,防后人「优化」回单步式。
    const cases = [
      { dmg: 100, def: 40, crit: true, twoStep: 160, legacy: 180 },
      { dmg: 10, def: 40, crit: true, twoStep: 2, legacy: 1 },
      { dmg: 8, def: 15, crit: true, twoStep: 2, legacy: 8 /* 旧预倍:16-7.5=8.5→trunc 8 */ },
    ];
    for (const c of cases) {
      const calc = Math.max(1, c.dmg - c.def * 0.5);
      const twoStep = Math.trunc(Math.max(1, calc * (c.crit ? 2 : 1)));
      const legacy = Math.trunc(Math.max(1, c.dmg * 2 - c.def * 0.5));
      expect(twoStep).toBe(c.twoStep);
      expect(legacy).toBe(c.legacy);
      expect(twoStep).not.toBe(legacy);   // 判别面:两形在此组上互斥
    }
  });
});
