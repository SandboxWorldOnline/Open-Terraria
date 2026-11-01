// G37-A 清偿刀判别锁（BJ729-A 登记债 D5/D6/D7）：
//  · D5 爆面族 TimerCrit :12928 消费（原版 Damage_PVE_Inner crit 段对 ownedBySomeone
//    玩家弹无条件消费——Kill 重跑 Resize+Damage() 与接触逐拍共用同段;仓内爆面旧只
//    rollVanillaHitCrit 类掷=六刀惯例漏消费,BJ729-A D5 登记债）——单源
//    rollVanillaHitCritConsumeTimer（类掷+TimerCrit 各自独立求值后 ||:懒惰链双病
//    判例,已掷中 crit 也照消费置 −15）。flagless 弹类掷零 RNG 但消费照达。
//  · D6 接触面敌臂 DV/crit 缺失族（443/706/451/弧族/Solution/Celeb2/MountShot/1045/
//    930/162·166+MagnetSphere[census 外同形面]）——:12970 DV 无条件逐靶;crit 类旗门;
//    TimerCrit 同段。Dart 直击环 per-kind trap 域（TRAP_TYPE_KINDS=vanilla SetDefaults
//    trap=true 全集∩本表:整 crit 块跳过+DV 无 luck;非 trap 162/166/281/601 照跑）。
//  · D7 接触面 critter 臂（706/611/弧族 6 站/Solution/Celeb2/MountShot/1045/451——
//    CanNPCBeHit :20675 对非 minion/sentry friendly 弹放行,victim 循环同链）。
// 判别力（旧码必红项）：
//   §D5 满蓄爆面强制 crit+charge −15（旧类掷-only 恒 false）;已掷中 crit 照消费
//      （||短路旧形 charge 留 1000 必红）;KILL_BURST/settleKillExplosion 敌+城同位;
//      41 critter 环消费。
//   §D6 443 DV 判别档（0.9999→×1.15）;1045 melee 掷+DV;Dart 166 掷/98 trap 零掷零消费
//      +luck=0;162 flagless TimerCrit 照消费;MagnetSphere DV 判别档。
//   §D7 弧锥 critter 命中+锥外负控;Solution/Celeb2/MountShot critter 受理即消亡;
//      1045 critter 链式补发。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Arrow } from '../src/entities/Arrow';
import { Game } from '../src/core/Game';
import { MagicMissileProj } from '../src/entities/MissileProj';
import { SwingArc } from '../src/entities/SwingArc';
import { WaterSplashProj } from '../src/entities/SolutionProj';
import { Celeb2Rocket } from '../src/entities/Celeb2';
import { MountShot } from '../src/entities/Mounts';
import { MoonLordWhipProc } from '../src/entities/WhipTag';
import { TideSlash } from '../src/entities/TideSlash';
import { ElectroSphereProj } from '../src/entities/ElectroSphereProj';
import { TrapShot } from '../src/entities/Dart';
import { BeamBoltProj } from '../src/entities/MagnetSphereProj';
import { damageVarRoll } from '../src/stats/DamageVar';
import { withMutation } from './mutation-guard';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME_ROOT, 'src', p), 'utf8');
const spawnVitest = (filter: string, tName?: string) => spawnSync('npx',
  ['vitest', 'run', filter, '--reporter=basic', ...(tName ? ['-t', tName] : [])],
  { cwd: GAME_ROOT, encoding: 'utf8', timeout: 180_000, env: { ...process.env, G37A_MUT_SKIP: '1' } });
const itMut = process.env.G37A_MUT_SKIP === '1' ? it.skip : it;   // 变异子进程跳过（防递归,BJ725 判例 4）
afterEach(() => vi.restoreAllMocks());

interface MockEnemy {
  id: number; vanillaId: number; x: number; y: number; w: number; h: number;
  dead: boolean; iframes: number; dontTakeDamage: boolean; calls: Array<{ d: number; crit: boolean }>;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean) => boolean;
}
const mkEnemy = (id: number, cx: number, cy: number, vanillaId = 3): MockEnemy => {
  const e = { calls: [] } as unknown as MockEnemy;
  Object.assign(e, {
    id, vanillaId, x: cx - 10, y: cy - 10, w: 20, h: 20,
    dead: false, iframes: 0, dontTakeDamage: false,
    hurt(d: number, _kx: number, _ky: number, _g: GameHooks, _pen = 0, crit = false) {
      e.calls.push({ d, crit });
      return true;
    },
  });
  return e;
};
interface MockCritter {
  id: number; vanillaId: number; x: number; y: number; w: number; h: number;
  cx: number; cy: number;
  dead: boolean; iframes: number; dontTakeDamage: boolean; calls: unknown[][];
  hurt: (...a: unknown[]) => boolean;
}
const mkBird = (cx: number, cy: number, id = 50): MockCritter => {
  const calls: unknown[][] = [];
  return {
    id, vanillaId: 74, x: cx - 8, y: cy - 6, w: 16, h: 12, cx, cy,
    dead: false, iframes: 0, dontTakeDamage: false, calls,
    hurt(...a: unknown[]) { calls.push(a); return true; },
  };
};
interface MockTown {
  id: number; vanillaId: number; x: number; y: number; w: number; h: number;
  dead: boolean; bound: boolean; calls: unknown[][];
  hurt: (...a: unknown[]) => boolean;
}
const mkTown = (vanillaId: number, cx: number, cy: number, id = 1): MockTown => {
  const calls: unknown[][] = [];
  return {
    id, vanillaId, x: cx - 12, y: cy - 12, w: 24, h: 24,
    dead: false, bound: false, calls,
    hurt(...a: unknown[]) { calls.push(a); return true; },
  };
};

/** ★TimerCrit 态 mock player（Player.tryConsumingTimerCrit 消费语义 1:1：
 *  accTimerCrit ∧ (charge≥1000 ∨ charge<0) → charge>0 置 −15 + true） */
const mkTimerPlayer = (charge: number, eq: Record<string, boolean> = {}, critAgg = 0) => ({
  luck: 0,
  equipStats: eq,
  critChance: () => critAgg,
  accTimerCritCharge: charge,
  tryConsumingTimerCrit(_g: GameHooks, _x: number, _y: number, _w: number, _h: number) {
    const self = this as unknown as { equipStats: { accTimerCrit?: boolean }; accTimerCritCharge: number };
    if (!self.equipStats.accTimerCrit) return false;
    if (!(self.accTimerCritCharge >= 1000 || self.accTimerCritCharge < 0)) return false;
    if (self.accTimerCritCharge > 0) self.accTimerCritCharge = -15;
    return true;
  },
});

/** 扁平 hooks（爆面/接触面直驱;真 World store=湿段/四界/撞块读面,sfx 全桩） */
import { World } from '../src/world/World';
const mkWorld = (): World => {
  const w = new World(220, 140, 7, 'g37a-crit-segment');
  for (let x = 0; x < 220; x++) for (let y = 120; y < 140; y++) w.store.setTile(x, y, 1);
  return w;
};
const mkHooks = (opts: {
  enemies?: MockEnemy[]; critters?: MockCritter[]; towns?: MockTown[];
  player?: unknown; onAdd?: (e: unknown) => void; world?: World;
}): GameHooks => ({
  player: (opts.player ?? { luck: 0, equipStats: {}, critChance: () => 0, x: 60 * 16, y: 90 * 16, w: 20, h: 42, dead: false }) as never,
  npcs: () => opts.towns ?? [],
  enemies: () => opts.enemies ?? [],
  critters: () => opts.critters ?? [],
  ...(opts.onAdd ? { entities: { add: (e: unknown) => { opts.onAdd?.(e); } } } : {}),
  world: (opts.world ?? mkWorld()) as never,
  playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
  spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
  damagePlayer: (): number => 0,
  spawnDust: () => null,
  notifyInventoryChanged: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
} as unknown as GameHooks);

// ================= §D5 爆面族 TimerCrit :12928 消费 =================
describe('G37-A D5：爆面 TimerCrit 消费（rollVanillaHitCritConsumeTimer 单源）', () => {
  it('D5-1 617 arcanum 敌臂：满蓄 → crit 强制 true + charge −15（旧类掷-only 恒 false 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);     // DV 中性档;0.5>agg0 掷阈 → crit 只能来自 TimerCrit
    const e = mkEnemy(1, 600, 600);
    const p = mkTimerPlayer(1000, { accTimerCrit: true });
    const a = new Arrow(600 - 9, 600 - 9, 0, 0, 48, 6, 617, { grav: 0 });
    a.critChance = 0.04;
    (a as unknown as { arcanumDeathBurst: (g: GameHooks) => void }).arcanumDeathBurst(mkHooks({ enemies: [e], player: p }));
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);               // ★主判别：TimerCrit 强制（旧 false 必红）
    expect(e.calls[0]!.d).toBe(48);                    // DV 中性档 + S02 防后 ×2（基伤形态）
    expect(p.accTimerCritCharge).toBe(-15);            // ★主判别：消费位（:28568-71）
  });

  it('D5-2 gem 爆面城镇臂 settle：满蓄+voodoo 向导 → crit 镜像 + charge −15（敌怪臂同段）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const town = mkTown(22, 600, 600);                 // 向导 22 + killGuide
    const p = mkTimerPlayer(1000, { accTimerCrit: true, killGuide: true });
    const a = new Arrow(600 - 9, 600 - 9, 0, 0, 100, 6, 124, { grav: 0 });
    a.critChance = 0.04;
    (a as unknown as { gem: Record<string, boolean> }).gem = { aoeExplosion: true };
    (a as unknown as { gemAoeBurst: (g: GameHooks) => void }).gemAoeBurst(mkHooks({ towns: [town], player: p }));
    expect(town.calls.length).toBe(1);
    expect((town.calls[0]![6] as boolean)).toBe(true); // TownNPC.hurt 第 7 参 crit（TownHitSettle.crit）
    expect(p.accTimerCritCharge).toBe(-15);            // 城镇臂同段消费（「城镇臂同扩」条款）
  });

  it('D5-3 KILL_BURST 79：满蓄敌臂强制 crit + charge −15（MissileProj killNow）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const e = mkEnemy(2, 1600, 1600);
    const p = mkTimerPlayer(1000, { accTimerCrit: true });
    const m = new MagicMissileProj(1600 - 8, 1600 - 8, 1, 0, {
      projId: 79, damage: 100, knockback: 2, useTime: 30, payMana: () => true,
      channelCb: () => false, aimCb: () => ({ x: 0, y: 0 }),
    });
    (m as unknown as { killNow: (g: GameHooks) => void }).killNow(mkHooks({ enemies: [e], player: p }));
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);
    expect(p.accTimerCritCharge).toBe(-15);
  });

  it('D5-4 懒惰链双病判别：类掷已中（agg60）+ 满蓄 → charge 照消费 −15（||短路旧形留 1000 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0);     // 0.0<agg60 阈 → 类掷先中
    const e = mkEnemy(3, 600, 600);
    const p = mkTimerPlayer(1000, { accTimerCrit: true }, 60);
    const a = new Arrow(600 - 9, 600 - 9, 0, 0, 48, 6, 661, { grav: 0 });
    a.critChance = 0.04;
    (a as unknown as { blackBolt661Burst: (g: GameHooks) => void }).blackBolt661Burst(mkHooks({ enemies: [e], player: p }));
    expect(e.calls[0]!.crit).toBe(true);               // 双源并真单布尔
    expect(p.accTimerCritCharge).toBe(-15);            // ★主判别：已掷中照消费（:12928 无条件）
  });

  it('D5-5 41 face critter 环：满蓄 → crit 段同链消费（settleKillExplosion 邻位同形）', () => {
    // 41 内联支（Game.onProjectileDeath）:critter 环 rollVanillaHitCritConsumeTimer。
    // settle 段 Player.tryConsumingTimerCrit 经 fakeThis.player 消费。
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bird = mkBird(600, 600);
    const p = mkTimerPlayer(1000, { accTimerCrit: true });
    const fakeThis = {
      entities: { enemies: [] as MockEnemy[], critters: [bird] },
      player: p,
      world: { difficulty: 0, seedFlags: {} },
      playSfxFiles: () => {},
      spawnDust: () => null,
      playSfx: () => {},
    };
    (Game.prototype as unknown as {
      onProjectileDeath: (projId: number, x: number, y: number, w: number, h: number,
        oldVx: number, oldVy: number, dmg: number, flags?: { hostile?: boolean; kb?: number; arpen?: number }) => void;
    }).onProjectileDeath.call(fakeThis, 41, 600 - 8, 600 - 8, 16, 16, 0, 0, 20, { hostile: false });
    expect(bird.calls.length).toBe(1);
    expect((bird.calls[0]![5] as boolean)).toBe(true); // critter.hurt 第 6 参 crit
    expect(p.accTimerCritCharge).toBe(-15);            // critter 受害同链消费
  });

  it('D5-S 结构锁：单源形在位（proj1457 姊妹函数+Arrow/Game/MissileProj 消费位）', () => {
    expect(SRC('entities/proj1457.ts')).toContain('export function rollVanillaHitCritConsumeTimer(');
    expect(SRC('entities/proj1457.ts')).toContain('const rollCrit = classRollEnabled');
    const arrow = SRC('entities/Arrow.ts');
    expect(arrow).toContain('rollVanillaHitCritConsumeTimer(this.projId, game, e, this.critChance > 0);');
    expect(arrow).toContain('rollVanillaHitCritConsumeTimer(this.projId, game, c), 1, true);');   // 283 critter 环
    expect(SRC('core/Game.ts')).toContain('const critX41 = rollVanillaHitCritConsumeTimer(projId, this, e);');
    expect(SRC('entities/MissileProj.ts')).toContain('rollVanillaHitCritConsumeTimer(this.projId, game, e, this.critChance > 0);');
  });
});

// ================= §D6 接触面 DV/crit/TimerCrit =================
describe('G37-A D6：接触面 DV/crit 补齐 + Dart trap 域', () => {
  it('D6-1 443 敌臂 DV 判别档：0.9999 → 40×1.15=46（旧平值 40 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const e = mkEnemy(4, 1600, 1604);
    // ElectroSphereProj 直驱（electrosphere-launcher 同构;位置压敌心）
    const s = new ElectroSphereProj(1592, 1604, 40);
    (s as unknown as { critChance: number }).critChance = 0;
    s.fixedUpdate(1 / 60, mkHooks({ enemies: [e] }));
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(46);
  });

  it('D6-2 1045 敌臂：melee 掷（agg60 → crit）+ DV 域锁（旧恒 false 平值必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const e = mkEnemy(5, 600, 600);
    const p = mkTimerPlayer(0, {}, 60);
    let proc: MoonLordWhipProc | null = null;
    const hooks = mkHooks({ enemies: [e], player: p, onAdd: (x) => { proc = x as MoonLordWhipProc; } });
    MoonLordWhipProc.spawn(hooks, (el) => { proc = el as MoonLordWhipProc; },
      { x: 600, y: 600, w: 24, h: 24 }, { x: 0, y: 0 }, 0);
    const pr = proc as unknown as { x: number; y: number; w: number; h: number; vx: number; vy: number; fixedUpdate: (dt: number, g: GameHooks) => void };
    pr.x = 588; pr.y = 588; pr.w = 16; pr.h = 16; pr.vx = 0; pr.vy = 0;
    pr.fixedUpdate(1 / 60, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);               // melee 掷（:12915-27,agg60）
    const dvDomain1045 = new Set<number>();
    for (let i = 0; i < 31; i++) dvDomain1045.add(damageVarRoll(20, 0, () => i / 31));
    expect(dvDomain1045.has(e.calls[0]!.d)).toBe(true);
  });

  it('D6-3 TrapShot 166 雪球（非 trap ranged）：agg60 → crit 掷中（旧恒 false 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const e = mkEnemy(6, 2000, 1000);
    const p = mkTimerPlayer(0, {}, 60);
    const d = new TrapShot(1996, 996, 4, 0, 50, 'snowball');
    d.fixedUpdate(1, mkHooks({ enemies: [e], player: p }));
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);
  });

  it('D6-4 TrapShot 98 镖（trap=true）：agg60 仍零掷 + TimerCrit 不消费 + DV luck=0 域', () => {
    // trap ⇒ OwnedBySomeone=false（:580-588）→ crit 段（掷+TimerCrit）整跳;DV 无 luck 重掷。
    vi.spyOn(Math, 'random').mockReturnValue(0.0);     // 0.0 若有掷必中——判别零掷
    const e = mkEnemy(7, 2000, 1000);
    const p = mkTimerPlayer(1000, { accTimerCrit: true }, 60);
    const d = new TrapShot(1996, 996, 4, 0, 50, 'dart');
    d.fixedUpdate(1, mkHooks({ enemies: [e], player: p }));
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(false);              // ★trap 域零掷（agg60 不掷）
    expect(p.accTimerCritCharge).toBe(1000);           // ★TimerCrit 不消费（charge 保持）
    const dvDomainTrap = new Set<number>();
    for (let i = 0; i < 31; i++) dvDomainTrap.add(damageVarRoll(50, 0, () => i / 31));
    expect(dvDomainTrap.has(e.calls[0]!.d)).toBe(true);
  });

  it('D6-5 TrapShot 162 炮弹（非 trap flagless）：TimerCrit 照消费（类掷零 RNG）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const e = mkEnemy(8, 2000, 1000);
    const p = mkTimerPlayer(1000, { accTimerCrit: true });   // agg0 → 类掷不中
    const d = new TrapShot(1992, 992, 4, 0, 50, 'cannonball');
    d.fixedUpdate(1, mkHooks({ enemies: [e], player: p }));
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);               // flagless 零类掷,TimerCrit 强制
    expect(p.accTimerCritCharge).toBe(-15);
  });

  it('D6-6 MagnetSphere 敌臂 DV 判别档：0.9999 → 48×1.15=55（旧平值必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const e = mkEnemy(9, 2050, 1000);
    const b = new BeamBoltProj(2000, 1000, 6, 0, 48, 6);
    b.fixedUpdate(1 / 60, mkHooks({ enemies: [e] }));
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(55);
  });
});

// ================= §D7 接触面 critter 臂 =================
describe('G37-A D7：接触面 critter 臂（非 minion/sentry friendly 弹全放行）', () => {
  it('D7-1 SwingArc 锥形 critter：锥内鸟被击（几何镜像敌臂;旧零受击必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bird = mkBird(1600, 1600);
    const birdFar = mkBird(1900, 1600, 51);            // 锥外负控（reach 94×scale 内不达）
    const hooks = mkHooks({ critters: [bird, birdFar], player: { luck: 0, equipStats: {}, critChance: () => 0 } as never });
    const arc = new (SwingArc as unknown as {
      new (player: unknown, projId: number, animT: number, dmg: number, ai0: number, scale: number): SwingArc;
    })({ cx: 1600, cy: 1600, x: 1590, y: 1590, w: 20, h: 20 } as never, 984, 5, 30, 1, 1);
    arc.fixedUpdate(1, hooks);
    expect(bird.calls.length).toBe(1);                 // ★主判别：锥内命中（旧零受击必红）
    expect(birdFar.calls.length).toBe(0);              // 锥外负控
  });

  it('D7-2 Solution critter：受理即 splash 消亡（penetrate 1 镜像敌怪支）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bird = mkBird(1600, 1600);
    let splashed = 0;
    const p = new WaterSplashProj(1590, 1593, 3, 0, 69, 20, 3, () => { splashed++; });
    p.fixedUpdate(1 / 60, mkHooks({ critters: [bird] }));
    expect(bird.calls.length).toBe(1);
    expect(splashed).toBeGreaterThanOrEqual(1);        // splash 消亡位（Kill 转换）
  });

  it('D7-3 Celeb2 critter：受理即 explode 消亡', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bird = mkBird(1600, 1600);
    let exploded = false;
    const c = new Celeb2Rocket(717, 0, 1600 - 7, 1600 - 7, 3, 0, 60, 2, false,
      () => { exploded = true; });
    (c as unknown as { critChance: number }).critChance = 0;
    c.fixedUpdate(1, mkHooks({ critters: [bird] }));
    expect(bird.calls.length).toBe(1);
    expect(exploded).toBe(true);
  });

  it('D7-4 MountShot critter：受理即消亡（penetrate 1）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bird = mkBird(50, 0);
    const s = new MountShot(0, -8, 14, 0, 150, 0, 606);
    s.fixedUpdate(1 / 60, mkHooks({ critters: [bird] }));
    expect(bird.calls.length).toBe(1);
    expect((s as unknown as { dead: boolean }).dead).toBe(true);
  });

  it('D7-5 1045 critter：受理即亡 + 链式补发（gen<2 spawn 镜像城镇臂）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bird = mkBird(600, 600);
    const added: unknown[] = [];
    let proc: MoonLordWhipProc | null = null;
    const hooks = mkHooks({ critters: [bird], onAdd: (x) => added.push(x) });
    MoonLordWhipProc.spawn(hooks, (el) => { proc = el as MoonLordWhipProc; added.push(el); },
      { x: 600, y: 600, w: 24, h: 24 }, { x: 0, y: 0 }, 0);
    const pr = proc as unknown as { x: number; y: number; w: number; h: number; vx: number; vy: number; fixedUpdate: (dt: number, g: GameHooks) => void };
    pr.x = 588; pr.y = 588; pr.w = 16; pr.h = 16; pr.vx = 0; pr.vy = 0;
    pr.fixedUpdate(1 / 60, hooks);
    expect(bird.calls.length).toBe(1);
    expect((proc as unknown as { dead: boolean }).dead).toBe(true);
    const chained = added.filter((x) => x instanceof MoonLordWhipProc);
    expect(chained.length).toBe(2);                    // gen0（出生 add）+ gen1 链式补发（:14015-14018 victim 无关,bj729a D1-2 同账）
  });

  it('D7-6 451 TideSlash critter：自盒命中（hitCritters 单发）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bird = mkBird(600, 600);
    const t = new TideSlash(4, 0, 40, 2, 10);
    (t as unknown as { x: number }).x = 600 - 9;
    (t as unknown as { y: number }).y = 600 - 9;
    (t as unknown as { w: number }).w = 18;
    (t as unknown as { h: number }).h = 18;
    (t as unknown as { critChance: number }).critChance = 0;
    t.fixedUpdate(1, mkHooks({ critters: [bird] }));
    expect(bird.calls.length).toBe(1);
  });

  it('D7-S 结构锁：critter 臂六类站位（Solution/Celeb2/MountShot/1045/451/弧族）', () => {
    expect(SRC('entities/SolutionProj.ts')).toContain('if (hitCritters({ x: this.x, y: this.y, w: this.w, h: this.h, projId: this.projId }, game))');
    expect(SRC('entities/Celeb2.ts')).toContain('if (hitCritters({ x: this.x, y: this.y, w: this.w, h: this.h, projId: this.projId ?? 714 }, game))');
    expect(SRC('entities/Mounts.ts')).toContain('if (hitCritters({ x: this.x, y: this.y, w: this.w, h: this.h, projId: this.projId }, game))');
    expect(SRC('entities/WhipTag.ts')).toContain('const nCrit1045 = hitCrittersAll(');
    expect(SRC('entities/TideSlash.ts')).toContain('hitCritters({ x: this.x, y: this.y, w: this.w, h: this.h, projId: 451 }, game)');
    expect(SRC('entities/SwingArc.ts')).toContain('hitCrittersAll({ x: this.x, y: this.y, w: this.w, h: this.h, projId: this.projId }, game,');
  });
});

// ================= 变异恰红（withMutation,子进程隔离） =================
describe('G37-A 变异恰红', () => {
  itMut('M1 443 敌臂 DV 摘除 → D6-1 红（回平值形）', () => {
    withMutation(join(GAME_ROOT, 'src/entities/ElectroSphereProj.ts'),
      'Math.max(1, damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0)))   // ★G37-A（D6）：DV :12970 逐靶掷（:12592 victim 循环逐拍同链,旧平值=BJ729-A D6 登记债）',
      'Math.max(1, this.damage))   /* G37A-M1 变异:DV 摘除 */',
      () => {
        const r = spawnVitest('g37a-crit-segment', 'D6-1');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D6-1');
      }, { label: 'G37A-M1' });
  });
  itMut('M2 TrapShot trap 门摘除 → D6-4 红（trap 型误掷误消费）', () => {
    withMutation(join(GAME_ROOT, 'src/entities/Dart.ts'),
      "const TRAP_TYPE_KINDS: ReadonlySet<TrapShotKind> = new Set(\n  ['dart', 'superdart', 'flame', 'venomdart', 'spear', 'spiky', 'boulder', 'geyser', 'hail']);",
      "const TRAP_TYPE_KINDS: ReadonlySet<TrapShotKind> = new Set();",
      () => {
        const r = spawnVitest('g37a-crit-segment', 'D6-4');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D6-4');
      }, { label: 'G37A-M2' });
  });
  itMut('M3 617 爆面 TimerCrit 消费摘除（回类掷-only）→ D5-1 红', () => {
    withMutation(join(GAME_ROOT, 'src/entities/Arrow.ts'),
      'const crit = rollVanillaHitCritConsumeTimer(this.projId, game, e, this.critChance > 0);\n        const snapBonusDeath = projectileSnapStrikeBonus(game,\n          { projId: this.projId }, ecx, ecy,',
      'const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game); /* G37A-M3 变异:TimerCrit 摘除 */\n        const snapBonusDeath = projectileSnapStrikeBonus(game,\n          { projId: this.projId }, ecx, ecy,',
      () => {
        const r = spawnVitest('g37a-crit-segment', 'D5-1');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D5-1');
      }, { label: 'G37A-M3' });
  });
});
