// ★BJ488（2026-10-04）掷率族四小件判别测试（BJ486 新登记 ①-④;⑤ def-3 家族另刀）：
//   ① critter 面 crit 掷 + TimerCrit 消费（projTargets.settleCritterHit）——定谳=
//      Damage_PVE_Inner :12911-12928 critter 【无特支】同链（victim 循环对 critter 与
//      普通敌同链,三类掷 :12915-27 与 TryConsumingTimerCrit :12928 照达）;差异门全在
//      既有位：CanNPCBeHitByPlayerOrPlayerProjectile 拒收（:12622-25,minion/sentry/
//      dontHurtCritters → 掷/消费全不可达;黑化复权体 :20680-88 复权照达）+ 免疫窗门
//      :12635-37 在 crit 段【前】（门拒不掷不消费）+ ownedBySomeone=!trap
//      （Projectile.cs:580-589,trap 弹整 crit 块跳过=1091 同判例零掷零消费）。
//      critter 一击即死使 crit 伤面不可观测,但 TimerCrit 蓄能节拍可观测=消费实证。
//   ② SolarFlare(612) 幻影 4% 掷摘除 + TimerCrit 到达性——SetDefaults :6586-6596 对
//      612 不写类旗 → 三类掷不达（1091 零掷判例族）;:12928 TryConsumingTimerCrit 在
//      ownedBySomeone 块内、三类掷臂【外】=无条件消费照达（无类旗只关三类掷）。
//   ③ WeaponProj hitEnemies autoCritPct 兜底支补 :25712-25714 持械折入（BJ486③ 定谳
//      口径:meleeCrit/magicCrit/rangedCrit 每帧 += inventory[selectedItem].crit → 弹面
//      掷阈值含持械 item.crit+词缀 crt,命中拍动态）。me.critChance 显式注入支不受影响。
//   ④ Game.netProjBroadcast ownerMeleeCritBits 载体携 prefix——heldDefNow（def 载体无
//      prefix 位）→ heldCritNow {vid,prefix} 双源载体,词缀 crt 段折入（ownerMeleeCritBits
//      本体自 ε#3 已支持 prefix 消费,病灶=调用侧载体缺位）。
//  判别力（旧码必红项）：§1a 消费位收到靶盒+crit 翻转（旧零消费必红）;§1b 掷率面
//    阈值 0.04+agg（旧无掷必红）;§1c trap 零掷零消费+零 RNG（旧无掷恰同绿=语义保留锚）;
//    §1d 免疫窗门前置（旧无消费恰同绿）;§1e minion 拒收位（同前）;§1f 黑化复权体照达
//    （旧无消费必红）;§1g 持械折入链入 critter 掷（旧无掷必红）;§2a/2b 612 零掷+TimerCrit
//    照消费（旧 4% 幻影掷必红）;§3a/3b 兜底阈值抬至 0.04+item.crit(+crt)（旧 0.04 档必红）;
//    §3d 注入支不双计（回归面）;§4b 载体结构锁（旧 heldDefNow 必红）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { GameHooks } from '../src/entities/types';
import { hitCritters, hitCrittersAll } from '../src/entities/projTargets';
import { hitEnemies, HitCooldown } from '../src/entities/WeaponProj';
import { SolarFlare } from '../src/entities/SolarEruption';
import { ownerMeleeCritBits } from '../src/core/Game';
import { ITEM_DEFS } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { prefixStat } from '../src/data/vanillaPrefixes';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');

interface HurtCall { dmg: number; crit: boolean }

const PX = 80, PY = 90;
const T = 16;   // TILE px（夹具局部,避免整表 import）

function makeHooks(opts: {
  enemies?: unknown[];
  critters?: unknown[];
  player?: Record<string, unknown>;
} = {}): GameHooks {
  const player = {
    equipStats: {}, cx: PX * T, cy: PY * T, x: PX * T - 10, y: PY * T - 21,
    w: 20, h: 42, dead: false, facing: 1, vx: 0, vy: 0,
    buffs: { has: () => false },
    ...opts.player,
  };
  return {
    world: { store: null } as never,
    player,
    enemies: () => opts.enemies ?? [],
    critters: () => opts.critters ?? [],
    npcs: () => [],
    projectiles: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    cutTilesBox: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {}, playSfxAt: () => {},
    showPickupLabel: () => {},
    addLightAt: () => {},
    spawnDust: () => null,
    startLoopSfx: () => ({ stop: () => {}, setVolume: () => {}, playing: true, dead: false }),
    stack: { anyTagged: () => false, hasActiveEffect: () => false },
  } as unknown as GameHooks;
}

/** critter 桩（Enemy.hurt 免疫窗门同相:iframes>0 返假不落账） */
function mkCritter(id: number, x: number, y: number, w = 24, h = 24,
  opts: { iframes?: number; vanillaId?: number | null; blackened?: boolean } = {}) {
  const calls: HurtCall[] = [];
  const c: Record<string, unknown> = {
    id, x, y, w, h, dead: false,
    iframes: opts.iframes ?? 0, dontTakeDamage: false,
    vanillaId: opts.vanillaId ?? null, blackenedCritter: opts.blackened === true,
    hurt(d: number, _kx: number, _ky: number, _g: unknown, _pen: number, crit: boolean): boolean {
      if ((c.iframes as number) > 0) return false;   // :14533 免疫窗门同相
      calls.push({ dmg: d, crit: !!crit });
      return true;
    },
  };
  return { c, calls };
}

/** 敌怪桩（§2/§3 用:hurt 全参记录） */
function mkEnemy(id: number, x: number, y: number, w = 24, h = 24) {
  const calls: HurtCall[] = [];
  const e = {
    id, x, y, w, h, dead: false, vanillaId: 15 as number | null, maxHp: 100, hp: 100,
    iframes: 0, dontTakeDamage: false, lastStrikeDealt: 0, attempts: 0,
    get cx() { return this.x + this.w / 2; },
    get cy() { return this.y + this.h / 2; },
    hurt(this: { attempts: number; lastStrikeDealt: number }, dmg: number,
      _kx: number, _ky: number, _g: unknown, _pen: number, crit: boolean): boolean {
      this.attempts++;
      this.lastStrikeDealt = dmg;
      calls.push({ dmg, crit: !!crit });
      return true;
    },
  };
  return { e, calls };
}

/** TimerCrit 消费侦听桩（记录靶盒,返值可配） */
function timerSpy(ret = true): { box: Array<[number, number, number, number]>;
  fn: (g: unknown, x: number, y: number, w: number, h: number) => boolean } {
  const box: Array<[number, number, number, number]> = [];
  return { box, fn: (_g, x, y, w, h) => { box.push([x, y, w, h]); return ret; } };
}

afterEach(() => { vi.restoreAllMocks(); });

// ================= ① critter 面 crit 掷 + TimerCrit 消费 =================

describe('BJ488-①：critter 受理位 crit 掷 + TimerCrit :12928 消费（Damage_PVE 无特支同链）', () => {
  it('1a 978 melee 弹命中 critter：TimerCrit 消费位收到 critter 盒 + ref crit 翻转 hurt crit 位 + 三类掷照掷（1 次 RNG）', () => {
    const t = timerSpy(true);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.9);   // 三类掷不中（0.9>0.04）
    const { c, calls } = mkCritter(11, PX * T, PY * T);
    const g = makeHooks({
      critters: [c],
      player: { critChance: () => 0, tryConsumingTimerCrit: t.fn },
    });
    const n = hitCrittersAll({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 978 }, g);
    expect(n).toBe(1);
    expect(t.box.length).toBe(1);                  // ★消费位恰一次（旧码零消费必红）
    expect(t.box[0]).toEqual([c.x, c.y, c.w, c.h] as unknown as [number, number, number, number]);
    expect(rnd.mock.calls.length).toBe(1);         // 三类掷照掷（978 melee 旗）
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(true);              // TimerCrit ref crit 强制翻转
    expect(calls[0].dmg).toBe(5);                  // 定伤 shim 不预倍（RB10d-D1 面）
  });

  it('1b 掷率面阈值=0.04+agg（TimerCrit 假）：agg50 → 0.5<0.54 crit 真;agg0 → 假（旧码恒假必红）', () => {
    const t = timerSpy(false);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const critter = mkCritter(12, PX * T, PY * T);
    const gHi = makeHooks({
      critters: [critter.c],
      player: { critChance: () => 50, tryConsumingTimerCrit: t.fn },
    });
    hitCrittersAll({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 978 }, gHi);
    expect(critter.calls[0].crit).toBe(true);      // ★掷率面接线（旧码无掷必红）
    const critter2 = mkCritter(13, PX * T, PY * T);
    const gLo = makeHooks({
      critters: [critter2.c],
      player: { critChance: () => 0, tryConsumingTimerCrit: t.fn },
    });
    hitCrittersAll({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 978 }, gLo);
    expect(critter2.calls[0].crit).toBe(false);    // 0.5<0.04 假（阈值下界）
  });

  it('1c trap 弹 → ownedBySomeone=false 整 crit 块跳过：零掷（0 RNG）+零消费+crit 位假（1091 同判例）', () => {
    const t = timerSpy(true);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);   // 若误掷必中
    const { c, calls } = mkCritter(14, PX * T, PY * T);
    const g = makeHooks({
      critters: [c],
      player: { critChance: () => 50, tryConsumingTimerCrit: t.fn },
    });
    const n = hitCrittersAll({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 978 }, g,
      { trap: true });
    expect(n).toBe(1);                             // 受理照常（trap 照杀小动物）
    expect(rnd.mock.calls.length).toBe(0);         // ★零 RNG（:580-589 整块跳过）
    expect(t.box.length).toBe(0);                  // ★零消费
    expect(calls[0].crit).toBe(false);
  });

  it('1d 免疫窗门（:12635-37）在 crit 段前：门拒拍零掷零消费（iframes 残窗 critter）', () => {
    const t = timerSpy(true);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const { c, calls } = mkCritter(15, PX * T, PY * T, 24, 24, { iframes: 6 });
    const g = makeHooks({
      critters: [c],
      player: { critChance: () => 50, tryConsumingTimerCrit: t.fn },
    });
    const n = hitCrittersAll({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 978 }, g);
    expect(n).toBe(0);                             // 门拒=整体跳过
    expect(rnd.mock.calls.length).toBe(0);         // 零掷（crit 段在 :12635 门后）
    expect(t.box.length).toBe(0);                  // 零消费
    expect(calls.length).toBe(0);                  // hurt 早退不落账
  });

  it('1e minion 弹拒收位（:12622-25）在掷/消费前：普通 critter 整段不可达', () => {
    const t = timerSpy(true);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const { c, calls } = mkCritter(16, PX * T, PY * T);
    const g = makeHooks({
      critters: [c],
      player: { critChance: () => 50, tryConsumingTimerCrit: t.fn },
    });
    const n = hitCrittersAll({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 978 }, g,
      { minion: true });
    expect(n).toBe(0);
    expect(rnd.mock.calls.length).toBe(0);
    expect(t.box.length).toBe(0);
    expect(calls.length).toBe(0);
  });

  it('1f 黑化复权体（:20680-88）连 minion 弹照达：掷+消费照发（拒收位判别面）', () => {
    const t = timerSpy(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { c, calls } = mkCritter(17, PX * T, PY * T, 24, 24, { vanillaId: 645, blackened: true });
    const g = makeHooks({
      critters: [c],
      player: { critChance: () => 0, tryConsumingTimerCrit: t.fn },
    });
    const n = hitCrittersAll({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 978 }, g,
      { minion: true });
    expect(n).toBe(1);                             // 复权体放行
    expect(t.box.length).toBe(1);                  // ★消费照达（旧码零消费必红）
    expect(calls[0].crit).toBe(true);
  });

  it('1g critter 三类掷含 :25712 持械折入（rollVanillaHitCrit 同链）：held 键匙刃 671（crit16）阈值抬至 0.20', () => {
    const t = timerSpy(false);
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    expect(itemCombat(671)?.crit).toBe(16);
    vi.spyOn(Math, 'random').mockReturnValue(0.10);              // 0.04 档假 / 0.20 档真
    const bare = mkCritter(18, PX * T, PY * T);
    const g0 = makeHooks({
      critters: [bare.c],
      player: { critChance: () => 0, inv: { heldItem: () => null }, tryConsumingTimerCrit: t.fn },
    });
    hitCrittersAll({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 978 }, g0);
    expect(bare.calls[0].crit).toBe(false);
    const held = mkCritter(19, PX * T, PY * T);
    const g1 = makeHooks({
      critters: [held.c],
      player: {
        critChance: () => 0,
        inv: { heldItem: () => ({ id: id671, prefix: 0 }) },
        tryConsumingTimerCrit: t.fn,
      },
    });
    hitCrittersAll({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 978 }, g1);
    expect(held.calls[0].crit).toBe(true);         // ★折入链贯通（阈值 0.04+0.16）
  });

  it('1h 敌对弹（465 hostile-only）恒不达 critter 面：零掷零消费（既有门回归锚）', () => {
    const t = timerSpy(true);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const { c } = mkCritter(20, PX * T, PY * T);
    const g = makeHooks({
      critters: [c],
      player: { critChance: () => 50, tryConsumingTimerCrit: t.fn },
    });
    expect(hitCrittersAll({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 465 }, g)).toBe(0);
    expect(rnd.mock.calls.length).toBe(0);
    expect(t.box.length).toBe(0);
  });

  it('1i 布尔出口 hitCritters 单靶面同链（978+TimerCrit 满蓄 → crit 翻转）', () => {
    const t = timerSpy(true);
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { c, calls } = mkCritter(21, PX * T, PY * T);
    const g = makeHooks({
      critters: [c],
      player: { critChance: () => 0, tryConsumingTimerCrit: t.fn },
    });
    expect(hitCritters({ x: PX * T - 20, y: PY * T - 20, w: 40, h: 40, projId: 978 }, g)).toBe(true);
    expect(t.box.length).toBe(1);
    expect(calls[0].crit).toBe(true);
  });
});

// ================= ② SolarFlare(612) 幻影 4% 掷摘除 + TimerCrit 到达 =================

describe('BJ488-②：612 无类旗零掷（1091 判例族）+ :12928 TimerCrit 无条件消费照达', () => {
  it('2a TimerCrit 满蓄 → 612 照强制 crit（dmg×2）+ 消费位收到敌盒 + 零 RNG（旧 4% 幻影掷必红）', () => {
    const t = timerSpy(true);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { e, calls } = mkEnemy(31, PX * T - 12, PY * T - 12);
    const g = makeHooks({
      enemies: [e],
      player: { tryConsumingTimerCrit: t.fn },
    });
    const flare = new SolarFlare(PX * T, PY * T, 60, 0.85);
    flare.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(true);              // ★消费返值单源 crit（旧码零消费必红）
    expect(calls[0].dmg).toBe(60);                 // ★S02(BJ723-B)改判:×2=Enemy.hurt 防后——未翻倍基伤(旧 120=预倍形)
    expect(t.box.length).toBe(1);
    expect(t.box[0]).toEqual([e.x, e.y, e.w, e.h] as unknown as [number, number, number, number]);
    expect(rnd.mock.calls.length).toBe(1);         // ★W03(BJ723-B)改判:612 补 DV(:12970)——唯一掷=DamageVar 首掷;无类旗=crit 掷仍零(旧幻影掷必红)
  });

  it('2b 无 6170（消费假）→ crit 恒假（dmg 原值）：random=0 若幻影掷尚在必暴（旧码必红钉）', () => {
    const t = timerSpy(false);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);   // 0<0.04=旧幻影掷必中
    const { e, calls } = mkEnemy(32, PX * T - 12, PY * T - 12);
    const g = makeHooks({
      enemies: [e],
      player: { tryConsumingTimerCrit: t.fn },
    });
    const flare = new SolarFlare(PX * T, PY * T, 60, 0.85);
    flare.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(false);
    expect(calls[0].dmg).toBe(51);                 // ★W03 改判:DV(60,0.0 掷 −15 档)=51(旧 60=无 DV 平值)
    expect(rnd.mock.calls.length).toBe(1);        // crit 掷面已不存在（DV 掷=W03 新增唯一掷,与上注同口径）
  });

  it('2c 结构锁：SolarFlare 类域零 critChance 载体+611 掷面保持 BJ486 3e 锚', () => {
    const src = SRC('entities/SolarEruption.ts');
    const flareDomain = src.slice(src.indexOf('export class SolarFlare'),
      src.indexOf('export class SolarEruptionWhip'));
    const flareCode = flareDomain.replace(/^\s*\/\/[^\n]*/gm, '');   // 剥注释行防锚注自噬
    expect(flareCode).not.toMatch(/critChance/);              // 载体+掷面全数摘除
    expect(flareCode).toContain('tryConsumingTimerCrit');     // 消费位在 612 命中面
    const srcCode = src.replace(/^\s*\/\/[^\n]*/gm, '');
    expect(srcCode).not.toContain('flare.critChance');        // 出生拍写位摘除
    expect(srcCode).not.toContain('Math.random() < this.critChance');
    expect(srcCode.split('rollVanillaHitCrit(this.projId, game)').length - 1).toBe(2);   // 611 敌怪面+BJ729-A 城镇 settle 面（D1 B19,2026-10-27,1→2;与 BJ486 3e 锚同步）
  });
});

// ================= ③ autoCritPct 兜底支 :25712 持械折入 =================

describe('BJ488-③：hitEnemies autoCritPct 兜底支补持械折入（itemCombat.crit+词缀 crt,命中拍动态）', () => {
  const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
  const proj978 = { x: PX * T - 10, y: PY * T - 10, w: 20, h: 20, vx: 1,
    damage: 10, knockback: 1, projId: 978 };       // 978 melee 旗 → cls='melee';无 critChance 注入=兜底支

  it('3a held 键匙刃 671（crit16）→ 阈值 0.04+0.16：random 0.10 旧档假/新档真', () => {
    expect(id671).toBeGreaterThanOrEqual(0);
    const { e, calls } = mkEnemy(41, PX * T - 12, PY * T - 12);
    vi.spyOn(Math, 'random').mockReturnValue(0.10);
    const g = makeHooks({
      enemies: [e],
      player: {
        critChance: () => 0,
        inv: { heldItem: () => ({ id: id671, prefix: 0 }) },
      },
    });
    hitEnemies({ ...proj978 }, g, new HitCooldown(), 10, 1, 0);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(true);              // ★折入（旧 0.04 档必红）
    expect(calls[0].dmg).toBe(9);                  // ★S02 改判:DV(10,0.10 掷 −12 档)=9 未翻倍(旧 20=预倍形)
  });

  it('3b 词缀 crt 段（prefix 61 crt+5）→ 阈值 0.25：random 0.22 无词缀假/有词缀真', () => {
    expect(prefixStat(61).crt).toBe(5);
    const { e, calls } = mkEnemy(42, PX * T - 12, PY * T - 12);
    vi.spyOn(Math, 'random').mockReturnValue(0.22);
    const g = makeHooks({
      enemies: [e],
      player: {
        critChance: () => 0,
        inv: { heldItem: () => ({ id: id671, prefix: 61 }) },
      },
    });
    hitEnemies({ ...proj978 }, g, new HitCooldown(), 10, 1, 0);
    expect(calls[0].crit).toBe(true);              // ★crt 段（0.22>0.20 旧无 crt 必红）
  });

  it('3c 空持对照：阈值保持 0.04 档（0.10 假,折入不无中生有）', () => {
    const { e, calls } = mkEnemy(43, PX * T - 12, PY * T - 12);
    vi.spyOn(Math, 'random').mockReturnValue(0.10);
    const g = makeHooks({
      enemies: [e],
      player: { critChance: () => 0, inv: { heldItem: () => null } },
    });
    hitEnemies({ ...proj978 }, g, new HitCooldown(), 10, 1, 0);
    expect(calls[0].crit).toBe(false);
  });

  it('3d 注入支 BJ489 迁移后契约：显式注入 >0 → rollVanillaHitCrit 命中拍动态掷（注入值不作阈值）', () => {
    const { e, calls } = mkEnemy(44, PX * T - 12, PY * T - 12);
    vi.spyOn(Math, 'random').mockReturnValue(0.10);
    const g = makeHooks({
      enemies: [e],
      player: {
        critChance: () => 0,
        inv: { heldItem: () => ({ id: id671, prefix: 61 }) },
      },
    });
    const injected = { ...proj978, critChance: 0.05 } as typeof proj978;
    hitEnemies(injected, g, new HitCooldown(), 10, 1, 0);
    expect(calls[0].crit).toBe(true);              // 注入>0=门开,掷率走 rollVanillaHitCrit（0.10<0.04+0.21）
    // 注入 0 = 关断钉（BJ489 形态,旧掷式 ≤0 恒假同相）
    const calls2: HurtCall[] = [];
    const e2 = { ...mkEnemy(45, PX * T - 12, PY * T - 12).e };
    e2.hurt = (_d: number, _kx: number, _ky: number, _g: unknown, _p: number, crit: boolean): boolean => {
      calls2.push({ dmg: _d, crit: !!crit });
      return true;
    };
    vi.spyOn(Math, 'random').mockReturnValue(0.0);   // 旧路径若未关门必暴（0<0.04）
    const g2 = makeHooks({ enemies: [e2], player: { critChance: () => 50 } });
    const pinned = { ...proj978, critChance: 0 } as typeof proj978;
    hitEnemies(pinned, g2, new HitCooldown(), 10, 1, 0);
    expect(calls2[0].crit).toBe(false);            // ★关断钉=掷面整门关（聚合 50 也不掷）
  });

  it('3e 结构锁：兜底支三系全携 heldBonus（单源 heldItemCritBonus）', () => {
    const src = SRC('entities/WeaponProj.ts');
    // ★BJ489 def-3 同源扩名（rollVanillaHitCrit 并入同一导入）
    expect(src).toContain("import { heldItemCritBonus, rollVanillaHitCrit } from './proj1457'");
    expect(src).toContain('const heldBonus = heldItemCritBonus(');
    for (const k of ['melee', 'ranged', 'magic'] as const) {
      expect(src).toContain(`(4 + playerPct('${k}') + heldBonus) / 100`);
    }
  });
});

// ================= ④ ownerMeleeCritBits 载体携 prefix（词缀 crt 段折入） =================

describe('BJ488-④：netProjBroadcast crit 快照载体 heldCritNow {vid,prefix}（heldDefNow 词缀漏折摘除）', () => {
  const fakePlayer = (cc: number) => ({ critChance: (_k: 'melee' | 'ranged' | 'magic') => cc });

  it('4a ownerMeleeCritBits 消费面回归锚：{vid:671,prefix:61} → 4+16+5=25（位段压缩前钉值）', () => {
    expect(itemCombat(671)?.crit).toBe(16);
    expect(prefixStat(61).crt).toBe(5);
    expect(ownerMeleeCritBits(fakePlayer(0), { vid: 671, prefix: 61 }) >> 4).toBe(25);
    expect(ownerMeleeCritBits(fakePlayer(0), { vid: 671 }) >> 4).toBe(20);   // 无词缀段
  });

  it('4b 结构锁：广播位载体=heldCritNow（携 prefix 现值）,heldDefNow 死载体零残留', () => {
    const codeOnly = SRC('core/Game.ts').replace(/^\s*\/\/[^\n]*/gm, '');
    expect(/heldDefNow/.test(codeOnly)).toBe(false);          // 旧 def 载体摘除
    expect(/const heldCritNow = heldNow/.test(codeOnly)).toBe(true);
    expect(codeOnly).toContain('vid: ITEM_DEFS[heldNow.id]?.vid');
    expect(codeOnly).toContain('prefix: heldNow.prefix');     // ★词缀 crt 段载体位
    expect(codeOnly.split('ownerMeleeCritBits(this.player, heldCritNow)').length - 1).toBe(2);   // Arrow+kind1 双位
  });

  it('4c 单源等价：快照端算式与命中端 heldItemCritBonus 同值（BJ486③ 同款算式）', async () => {
    const { heldItemCritBonus } = await import('../src/entities/proj1457');
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    const held = { id: id671, prefix: 61 };
    expect(heldItemCritBonus(held)).toBe(16 + 5);   // 命中端
    expect(ownerMeleeCritBits(fakePlayer(0), { vid: 671, prefix: 61 }) >> 4)
      .toBe(4 + heldItemCritBonus(held));           // 快照端=基4+同源折入
  });
});
