// ★BJ741-A（2026-10-31）伤害面族清偿刀回归——红蓝 R19 轮发现 + G37 残差（D6-R ①/②）：
//   R19-1 nanoMul 四面（dealContacts/SkyDragonFury/MonkStaffFury/DeadCellsFlint）+ dealContacts
//     浸剂 debuff 面（StatusNPC :11197-11228 applyMeleeImbue）+ confetti 289（:13693-96）
//   G37① TimerCrit/DV 残差族收编（Prism/Rainbow/Medusa/Cluster/LunarNebula/SkyDragon/MonkStaff/
//     SparkleGuitar——单源 rollVanillaHitCritConsumeTimer 复用）
//   R19-2 箭袋 ×1.1 序反（武器半边先乘,Player.cs:54181-85 → :54208）+ isArrowKind 含 Stake 复核
//   R19-3 hail 1049 城镇臂 DV（G37-A 先手清偿,本刀锁判定谳）
//   R19-4 SuperCart 激光 591 DV（Mount.cs:5286-87 → :12970）
//   R19-5 Kill 爆族击退透传武器 kb（settleKillExplosion/41 敌臂,对齐 286 惯例）+ 圣坦城镇臂中心
//   R19-6 explodeAt 掷序 crit→TimerCrit→DV（:12915-28→:12970 原序）
//   G37② Dart.blastDamage 非_trap crit 掷+TimerCrit 消费（162/281/167-170 敌/城臂）
//   R19-8 deadCellsGroundPound 蓄力 ×4 双倍摘除（:29011 平值 30 恒定）
//   R19-9 挥砍城镇臂 kb 硬编码 2 → 武器 num4 链
// 变异恰红：withMutation 子进程隔离（BJ741A_MUT_SKIP 守卫,mutation-guard 三层护栏）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { BuffType } from '../src/stats/Buffs';
import { Game } from '../src/core/Game';
import { TrapShot } from '../src/entities/Dart';
import { Minecart, SUPER_CART_LASER_DMG } from '../src/entities/Minecart';
import { SkyDragonSpin } from '../src/entities/SkyDragonFury';
import { ConfettiBurstProj } from '../src/entities/meleeOnHitProjs';
import { dealContacts, HitCdImpl } from '../src/entities/proj1457';
import { withMutation } from './mutation-guard';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME_ROOT, 'src', p), 'utf8');
const spawnVitest = (filter: string, tName?: string) => spawnSync('npx',
  ['vitest', 'run', filter, '--reporter=basic', ...(tName ? ['-t', tName] : [])],
  { cwd: GAME_ROOT, encoding: 'utf8', timeout: 300_000, env: { ...process.env, BJ741A_MUT_SKIP: '1' } });
const itMut = process.env.BJ741A_MUT_SKIP === '1' ? it.skip : it;   // 变异子进程跳过（BJ725 判例 4）
afterEach(() => vi.restoreAllMocks());

// ---- 夹具（bj482/g37a 同款：真 World + 真 Player + spy 桶） ----
const mkWorld = (): World => {
  const w = new World(200, 120, 7, 'bj741a-damage-face-family');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  return w;
};
interface Rec { d: number; crit: boolean; kx: number; nanoMul: number; args: unknown[] }
const mkEnemy = (id: number, cx: number, cy: number, vanillaId = 0) => {
  const rec: Rec[] = [];
  const e = {
    id, vanillaId, x: cx - 10, y: cy - 10, w: 20, h: 20, cx, cy,
    dead: false, iframes: 0, dontTakeDamage: false, hp: 500000, maxHp: 500000,
    calls: rec,
    hurt(...a: unknown[]): boolean {
      rec.push({ d: a[0] as number, crit: a[5] === true, kx: a[1] as number,
        nanoMul: (a[10] as number) ?? 1, args: a });
      return true;
    },
  };
  return e;
};
const mkTown = (vanillaId: number, cx: number, cy: number, id = 1) => {
  const calls: unknown[][] = [];
  return {
    id, vanillaId, x: cx - 12, y: cy - 12, w: 24, h: 24, cx, cy,
    dead: false, bound: false, calls,
    hurt(...a: unknown[]) { calls.push(a); return true; },
  };
};
const mkHooks = (opts: {
  enemies?: unknown[]; critters?: unknown[]; towns?: unknown[];
  player?: unknown; world?: World; spawned?: unknown[];
} = {}): GameHooks => {
  const hooks = {
    player: opts.player ?? { luck: 0, equipStats: {}, critChance: () => 0,
      x: 60 * 16, y: 90 * 16, w: 20, h: 42, cx: 60 * 16 + 10, cy: 90 * 16 + 21, dead: false },
    npcs: () => opts.towns ?? [],
    enemies: () => opts.enemies ?? [],
    critters: () => opts.critters ?? [],
    world: (opts.world ?? mkWorld()) as never,
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    spawnDust: () => null,
    damagePlayer: (): number => 0,
    notifyInventoryChanged: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    cutTile: () => {}, recLog: () => {},
    entities: { add: () => undefined },
  } as unknown as GameHooks;
  if (opts.spawned) {
    (hooks as unknown as { spawnFriendlyProj?: (e: unknown) => void }).spawnFriendlyProj =
      (e: unknown) => { opts.spawned!.push(e); };
  }
  return hooks;
};
const mkPlayer = (x = 60 * 16, y = 90 * 16) => new Player(x, y, new Inventory());

// ================= §R19-1 dealContacts：nanoMul + 浸剂 debuff + confetti =================
describe('BJ741-A R19-1 dealContacts（proj1457.ts）：nano/浸剂/confetti 三面', () => {
  it('1a nanoMul：1126（melee 旗）+ImbueNano → hurt 第 11 参 1.05;482（magic）同 buff → 1（:13688 门）', () => {
    const p = mkPlayer();
    p.buffs.apply(BuffType.ImbueNano, 60);
    const e1 = mkEnemy(1, 800, 800);
    const h1 = mkHooks({ enemies: [e1], player: p });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // DV 中性档
    dealContacts({ x: 790, y: 790, w: 40, h: 40, cx: 810, cy: 810,
      damage: 100, knockback: 0, armorPen: 0, critChance: 0, projId: 1126 } as never,
      h1, new HitCdImpl(), -1);
    expect(e1.calls.length).toBe(1);
    expect(e1.calls[0]!.nanoMul).toBe(1.05);          // ★melee 旗弹 ×1.05（GetNanoFlaskDamageBoost）
    expect(e1.calls[0]!.d).toBe(100);                 // DV 中性 ×1.00（伤害乘在 Enemy.hurt 内,此处实参原值）
    const e2 = mkEnemy(2, 800, 800);
    const h2 = mkHooks({ enemies: [e2], player: p });
    dealContacts({ x: 790, y: 790, w: 40, h: 40, cx: 810, cy: 810,
      damage: 100, knockback: 0, armorPen: 0, critChance: 0, projId: 482 } as never,
      h2, new HitCdImpl(), -1);
    expect(e2.calls[0]!.nanoMul).toBe(1);             // ★magic 旗弹不吃 nano（:13688 (melee||IsAWhip) 门）
  });

  it('1b 浸剂 debuff 面：1126+ImbuePoison → poisonT∈[5,9]（StatusNPC :11197-11228/BJ739 B17 整数秒）;482 同 buff 零施加', () => {
    const p = mkPlayer();
    p.buffs.apply(BuffType.ImbuePoison, 60);
    const e1 = mkEnemy(1, 800, 800);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    dealContacts({ x: 790, y: 790, w: 40, h: 40, cx: 810, cy: 810,
      damage: 100, knockback: 0, armorPen: 0, critChance: 0, projId: 1126 } as never,
      mkHooks({ enemies: [e1], player: p }), new HitCdImpl(), -1);
    expect((e1 as unknown as { poisonT?: number }).poisonT).toBeGreaterThanOrEqual(5);
    expect((e1 as unknown as { poisonT?: number }).poisonT).toBeLessThanOrEqual(9);
    const e2 = mkEnemy(2, 800, 800);
    dealContacts({ x: 790, y: 790, w: 40, h: 40, cx: 810, cy: 810,
      damage: 100, knockback: 0, armorPen: 0, critChance: 0, projId: 482 } as never,
      mkHooks({ enemies: [e2], player: p }), new HitCdImpl(), -1);
    expect((e2 as unknown as { poisonT?: number }).poisonT).toBeUndefined();   // ★非 melee 门关=零施加
  });

  it('1c confetti 289：1126+ImbueParty → spawnFriendlyProj 恰一发 ConfettiBurstProj@敌心（:13693-96）', () => {
    const p = mkPlayer();
    p.buffs.apply(BuffType.ImbueParty, 60);
    const spawned: unknown[] = [];
    const e1 = mkEnemy(1, 800, 800);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    dealContacts({ x: 790, y: 790, w: 40, h: 40, cx: 810, cy: 810,
      damage: 100, knockback: 0, armorPen: 0, critChance: 0, projId: 1126 } as never,
      mkHooks({ enemies: [e1], player: p, spawned }), new HitCdImpl(), -1);
    expect(spawned.length).toBe(1);
    expect(spawned[0]).toBeInstanceOf(ConfettiBurstProj);
    expect((spawned[0] as { x: number; y: number }).x).toBeCloseTo(800 - 5, 5);   // 敌心-半宽（289 盒 10×10 中心锚）
  });
});

// ================= §R19-1/G37① SkyDragonFury 707（hurtEnemy 共享出口族代表） =================
describe('BJ741-A R19-1+G37① SkyDragonSpin 707：DV+TimerCrit+nano/浸剂收编', () => {
  const mkSpin = (damage = 100) => new SkyDragonSpin(
    { cx: 700, cy: 800, facing: 1, dead: false, vx: 1, vy: 0 },
    1, 0, damage, 3, () => true, () => ({ x: 0, y: 0 }), () => {});
  it('2a TimerCrit 消费：critChance=0 关断钉 + 满蓄 6170 → crit=true（:12928 无条件段）+ DV 中性', () => {
    const p = mkPlayer();
    vi.spyOn(p, 'tryConsumingTimerCrit' as never).mockReturnValue(true as never);
    const e = mkEnemy(1, 800, 800);
    const spin = mkSpin();
    spin.critChance = 0;                              // 类掷关断（BJ482② 关断钉通道）
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    (spin as unknown as { applyHits: (g: GameHooks, x0: number, y0: number, x1: number, y1: number) => void })
      .applyHits(mkHooks({ enemies: [e], player: p }), 700, 800, 900, 800);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);              // ★TimerCrit 强制面（旧仅类掷=整缺）
    expect(e.calls[0]!.d).toBe(100);                  // ★DV :12970 首掷（0.5 中性;旧恒平值）
    expect(e.calls[0]!.nanoMul).toBe(1);              // 无 ImbueNano → 1
  });
  it('2b nano+浸剂：ImbueNano → nanoMul=1.05（第 11 参）;ImbueIchor → ichorT∈[10,19]', () => {
    // 浸剂互斥（flask 族一次一瓶）→ 两档分立玩家
    const pN = mkPlayer();
    pN.buffs.apply(BuffType.ImbueNano, 60);
    const eN = mkEnemy(1, 800, 800);
    const spinN = mkSpin();
    spinN.critChance = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    (spinN as unknown as { applyHits: (g: GameHooks, x0: number, y0: number, x1: number, y1: number) => void })
      .applyHits(mkHooks({ enemies: [eN], player: pN }), 700, 800, 900, 800);
    expect(eN.calls[0]!.nanoMul).toBe(1.05);          // ★四近战弹结算面 nano（P.cs:13689）
    const pI = mkPlayer();
    pI.buffs.apply(BuffType.ImbueIchor, 60);
    const eI = mkEnemy(2, 800, 800);
    const spinI = mkSpin();
    spinI.critChance = 0;
    (spinI as unknown as { applyHits: (g: GameHooks, x0: number, y0: number, x1: number, y1: number) => void })
      .applyHits(mkHooks({ enemies: [eI], player: pI }), 700, 800, 900, 800);
    expect((eI as unknown as { ichorT?: number }).ichorT).toBeGreaterThanOrEqual(10);
    expect((eI as unknown as { ichorT?: number }).ichorT).toBeLessThanOrEqual(19);
  });
});

// ================= §G37① 残差族单源迁移结构锁（9 文件零旧形） =================
describe('BJ741-A G37① TimerCrit 残差族单源迁移（结构锁）', () => {
  it('3a 九文件旧形 rollVanillaHitCrit( 零残留 + ConsumeTimer 各≥1（Prism/Rainbow/Medusa/Cluster/LunarNebula/SkyDragon/MonkStaff/DeadCells/SparkleGuitar）', () => {
    const files = [
      'entities/PrismProj.ts', 'entities/RainbowProj.ts', 'entities/MedusaHeadProj.ts',
      'entities/ClusterFragmentProj.ts', 'entities/LunarNebula.ts', 'entities/SkyDragonFury.ts',
      'entities/MonkStaffFury.ts', 'entities/DeadCellsFlint.ts', 'entities/SparkleGuitarProj.ts',
    ];
    for (const f of files) {
      const src = SRC(f);
      expect(src, `${f} 旧形残留`).not.toMatch(/rollVanillaHitCrit\(/);   // 旧单掷形退役（ConsumeTimer 含 TimerCrit 消费）
      expect(src, `${f} 单源缺失`).toMatch(/rollVanillaHitCritConsumeTimer\(/);
    }
  });
  it('3b LunarNebula/SparkleGuitar/SkyDragon/MonkStaff/DeadCells DV 首掷在场（G37① DV✗ 档）', () => {
    for (const f of ['entities/LunarNebula.ts', 'entities/SparkleGuitarProj.ts',
      'entities/SkyDragonFury.ts', 'entities/MonkStaffFury.ts', 'entities/DeadCellsFlint.ts']) {
      expect(SRC(f), `${f} DV 缺`).toMatch(/damageVarRoll\(/);
    }
  });
});

// ================= §R19-2 箭袋 ×1.1 序反（结构锁：序+Stake 门） =================
describe('BJ741-A R19-2 箭袋击退序（Game.ts 发射链,结构锁）', () => {
  it('4a quiver ×1.1 乘【武器半边】先于弹药 KB 加法（Player.cs:54181-85 → :54208）;isArrowKind 含 Stake 1836', () => {
    const src = SRC('core/Game.ts');
    const iQuiver = src.indexOf('if (isArrowKind && eq.quiver) knockback *= 1.1');
    const iAmmo = src.indexOf('knockback += (ammoC?.knockBack ?? 0)');
    expect(iQuiver).toBeGreaterThan(-1);
    expect(iAmmo).toBeGreaterThan(iQuiver);           // ★序反清偿：旧 (武器+弹药)×1.1 → 弹药后加
    expect(src).toMatch(/const isArrowKind = useAmmo === 40 \|\| useAmmo === 1836;/);   // Stake=1836（AmmoID.cs:142,StakeLauncher 1835 useAmmo=AmmoID.Stake Item.cs:20326 亲读）
  });
});

// ================= §R19-3 hail 1049 城镇臂 DV（G37-A 先手清偿,锁判定谳） =================
describe('BJ741-A R19-3 hail 1049 城镇臂 DV（结构锁+判定谳）', () => {
  it('5a hailKill 独立城镇臂 = damageVarRoll(this.damage, 0)（trap 假臂 luck=0,:12970;R19 轮报文=裸值,G37-A D6 已先手清偿——本刀复核锁）', () => {
    const src = SRC('entities/Dart.ts');
    expect(src).toMatch(/t\.hurt\(Math\.max\(1, damageVarRoll\(this\.damage, 0\)\)/);
  });
});

// ================= §R19-4 SuperCart 激光 591 DV =================
describe('BJ741-A R19-4 SuperCart 激光 DV（Minecart.castSuperCartLaser）', () => {
  it('6a 591 逐靶 DV（Mount.cs:5286-87 damage=60→Damage()→:12970,owner luck 正向）:rnd=0 → 51=round(60×0.85)', () => {
    const cart = new Minecart();
    cart.x = 700; cart.y = 800 - cart.h; cart.vx = 5;   // 非静止（:5207 门）+ mech 点右向
    const e = mkEnemy(1, 800, 800);                     // 机械点右 100px,锥内
    vi.spyOn(Math, 'random').mockReturnValue(0);        // tier=−15 → ×0.85
    (cart as unknown as { castSuperCartLaser: (p: unknown, g: GameHooks) => void })
      .castSuperCartLaser({ facing: 1 }, mkHooks({ enemies: [e] }));
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(51);                     // ★DV 首掷（旧裸 60 平值）;banner 无旗=恒等
  });
});

// ================= §R19-5 Kill 爆族击退透传 + 圣坦城镇臂中心 =================
describe('BJ741-A R19-5 击退透传武器 kb（对齐 286 支惯例）', () => {
  const mkGame = () => {
    const g = Object.create(Game.prototype) as Record<string, unknown>;
    g.world = mkWorld();
    g.player = { luck: 0, equipStats: {}, critChance: () => 0,
      cx: 60 * 16, cy: 60 * 16, w: 20, h: 42, dead: false, lastDamageCause: null };
    g.entities = { enemies: [], critters: [], npcs: [], add: () => {} };
    g.recLog = () => {};
    g.damagePlayer = () => 0;
    return g;
  };
  it('7a settleKillExplosion：flags.kb 透传 → kbx=sign×kb（旧裸像素差 ±32..75）;DV 中性', () => {
    const e = mkEnemy(1, 820, 800);                     // 爆心右 → sign=+1
    const g = mkGame();
    (g as unknown as { entities: { enemies: unknown[] } }).entities.enemies = [e];
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    (g as unknown as { settleKillExplosion: (...a: unknown[]) => void })
      .settleKillExplosion(800, 800, 40, 100, 246, { kb: 8 });
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.kx).toBe(8);                     // ★武器 kb（flags.kb 载体,Damage_PVE num5）
    expect(e.calls[0]!.d).toBe(100);                    // DV 中性
  });
  it('7b 圣坦 930 城镇臂 kb 中心 = tn.x+tn.w/2（旧 x+8 假定 16 宽,结构锁）', () => {
    const src = SRC('entities/Mounts.ts');
    expect(src).toMatch(/kb: Math\.sign\(tn\.x \+ tn\.w \/ 2 - this\.cx\) \* 8,/);
    expect(src).not.toMatch(/\+ 8 - this\.cx\) \* 8/);
  });
});

// ================= §R19-6 explodeAt 掷序 + TimerCrit 面 =================
describe('BJ741-A R19-6 explodeAt 掷序（crit→TimerCrit→DV,:12915-28→:12970）', () => {
  const mkGame = (player: Record<string, unknown>) => {
    const g = Object.create(Game.prototype) as Record<string, unknown>;
    g.world = mkWorld();
    g.player = player;
    g.entities = { enemies: [], critters: [], npcs: [], add: () => {} };
    g.recLog = () => {};
    g.damagePlayer = () => 0;
    g.sfx = { play: () => {} };                        // sfxAt 桩（Game.sfxAt 读 this.sfx.play）
    g.cutTile = () => {};
    return g;
  };
  it('8a 序判别：30（ranged 表成员）掷序 [crit=0.0→true, DV=0.5→中性] → d=100∧crit=true（旧 DV 先跑=d 85）', () => {
    const e = mkEnemy(1, 820, 800);
    const g = mkGame({ luck: 0, equipStats: {}, critChance: () => 0,
      cx: 60 * 16, cy: 60 * 16, w: 20, h: 42, dead: false, lastDamageCause: null });
    (g as unknown as { entities: { enemies: unknown[] } }).entities.enemies = [e];
    // ★spy 后置（World 构造期消费 Math.random——序敏感掷流须在夹具就绪后装表）
    const seq = [0.0, 0.5];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++] ?? 0.5);
    (g as unknown as { explodeAt: (...a: unknown[]) => void })
      .explodeAt(50, 50, 100, 0, false, 64, 0, 30, 800, 800);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                // ★首掷=crit（0.0<0.04 基率）
    expect(e.calls[0]!.d).toBe(100);                    // ★次掷=DV 中性（序反则 85）
  });
  it('8b TimerCrit 消费面：28（非 ranged 非 trap）满蓄 → crit=true;108（trap）整段跳过=零消费', () => {
    let timerCalls = 0;
    const player = { luck: 0, equipStats: {}, critChance: () => 0,
      cx: 60 * 16, cy: 60 * 16, w: 20, h: 42, dead: false, lastDamageCause: null,
      tryConsumingTimerCrit: () => { timerCalls++; return true; } };
    const e28 = mkEnemy(1, 820, 800);
    const g28 = mkGame(player);
    (g28 as unknown as { entities: { enemies: unknown[] } }).entities.enemies = [e28];
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    (g28 as unknown as { explodeAt: (...a: unknown[]) => void })
      .explodeAt(50, 50, 100, 0, false, 64, 0, 28, 800, 800);
    expect(e28.calls[0]!.crit).toBe(true);              // ★flagless 弹 TimerCrit 照消费（:12928）
    const e108 = mkEnemy(2, 820, 800);
    const g108 = mkGame(player);
    (g108 as unknown as { entities: { enemies: unknown[] } }).entities.enemies = [e108];
    (g108 as unknown as { explodeAt: (...a: unknown[]) => void })
      .explodeAt(50, 50, 100, 0, false, 64, 0, 108, 800, 800);
    expect(e108.calls[0]!.crit).toBe(false);            // ★trap=OwnedBySomeone=false 整跳
    expect(timerCalls).toBe(1);                         // ★108 零消费（单源契约:陷阱族勿传 victim）
  });
});

// ================= §G37② Dart.blastDamage 非_trap crit 面 =================
describe('BJ741-A G37② Dart.blastDamage crit 掷+TimerCrit 消费（敌/城臂）', () => {
  it('9a 281 兔爆（flagless 非 trap）：TimerCrit → 敌臂 crit=true;1049 hail（trap）→ false 且零消费;城镇臂同掷', () => {
    let timerCalls = 0;
    const player = { luck: 0, equipStats: { killGuide: true }, critChance: () => 0,
      x: 60 * 16, y: 90 * 16, w: 20, h: 42, cx: 60 * 16 + 10, cy: 90 * 16 + 21, dead: false,
      tryConsumingTimerCrit: () => { timerCalls++; return true; } };
    const bunny = new TrapShot(800, 800, 5, 0, 100, 'bunny');
    const e = mkEnemy(1, 820, 800);
    const town = mkTown(22, 820, 830);                  // 向导+巫毒娃娃门
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    (bunny as unknown as { blastDamage: (g: GameHooks, cx: number, cy: number, r: number, k?: number) => void })
      .blastDamage(mkHooks({ enemies: [e], towns: [town], player }), 800, 800, 32, 281);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                // ★非 trap TimerCrit 消费（旧 crit=false 恒）
    expect(town.calls.length).toBe(1);
    expect(town.calls[0]![6]).toBe(true);               // ★城镇臂 settle crit（TownNPC.hurt 第 7 参位）
    const timerCallsBeforeHail = timerCalls;
    const hail = new TrapShot(800, 800, 5, 0, 100, 'hail');
    const e2 = mkEnemy(2, 820, 800);
    (hail as unknown as { blastDamage: (g: GameHooks, cx: number, cy: number, r: number, k?: number) => void })
      .blastDamage(mkHooks({ enemies: [e2], player }), 800, 800, 32);
    expect(e2.calls[0]!.crit).toBe(false);              // trap 型整跳（EXPLODE 同判）
    expect(timerCalls).toBe(timerCallsBeforeHail);      // ★零消费
  });
});

// ================= §R19-8 deadCellsGroundPound 蓄力 ×4 摘除 =================
describe('BJ741-A R19-8 蓄力下砸（Player.deadCellsGroundPound,:29011 平值 30 恒定）', () => {
  it('10a 蓄力档（downDashTime≥10）：hurt(30,…,crit=true)——crit 旗单布尔承载 ×2（Enemy.hurt 防后）;旧 60 预倍+crit=×4', async () => {
    const p = mkPlayer();
    (p as unknown as { downDashTime: number }).downDashTime = 20;   // 32×20=640>300 蓄力档
    const e = mkEnemy(1, p.cx + 38, p.cy);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    p.deadCellsGroundPound(mkHooks({ enemies: [e], player: p }));
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(30);                     // ★:29011 平值（无 DamageVar 掷）
    expect(e.calls[0]!.crit).toBe(true);                // ★蓄力=crit 旗（×2 在接收端）
  });
});

// ================= §R19-9 挥砍城镇臂 kb（结构锁） =================
describe('BJ741-A R19-9 挥砍城镇臂 kb 武器化（Game.ts,结构锁）', () => {
  it('11a tn.hurt 击退 = 方向×tnKb741（武器 num4 链,ProcessHitAgainstNPC :44773 城镇靶同参）;旧 ×2 硬编码退役', () => {
    const src = SRC('core/Game.ts');
    expect(src).toMatch(/\* tnKb741, 0, this,/);
    expect(src).not.toMatch(/\* 2, 0, this,\n        isFlyMeal/);
  });
});

// ================= 变异恰红（withMutation,子进程隔离） =================
describe('BJ741-A 变异恰红', () => {
  itMut('M1 proj1457 nanoMul 摘除 → 1a 红', () => {
    withMutation(join(GAME_ROOT, 'src/entities/proj1457.ts'),
      'const nanoMul741 = meleeGate741 && pl741?.buffs?.has(BuffType.ImbueNano as unknown as never) ? 1.05 : 1;',
      'const nanoMul741 = 1;',
      () => {
        const r = spawnVitest('tests/bj741a-damage-face-family.test.ts', '1a nanoMul');
        expect(r.status, '变异须证红').not.toBe(0);
      }, { label: 'BJ741 M1' });
  });
  itMut('M2 SkyDragonFury 707 TimerCrit 摘除 → 2a 红', () => {
    withMutation(join(GAME_ROOT, 'src/entities/SkyDragonFury.ts'),
      'const crit = rollVanillaHitCritConsumeTimer(this.projId, game, e, this.critChance > 0);\n      // ★BJ741 R19-1：DamageVar 首掷',
      'const crit = false;\n      // ★BJ741 R19-1：DamageVar 首掷',
      () => {
        const r = spawnVitest('tests/bj741a-damage-face-family.test.ts', '2a TimerCrit');
        expect(r.status, '变异须证红').not.toBe(0);
      }, { label: 'BJ741 M2' });
  });
  itMut('M3 Dart blast crit 摘除 → 9a 红', () => {
    withMutation(join(GAME_ROOT, 'src/entities/Dart.ts'),
      'const critBlast741 = TRAP_TYPE_KINDS.has(this.kind) ? false\n        : rollVanillaHitCritConsumeTimer(blProjId ?? (this.projId ?? 0), game, e);',
      'const critBlast741 = false;',
      () => {
        const r = spawnVitest('tests/bj741a-damage-face-family.test.ts', '9a 281');
        expect(r.status, '变异须证红').not.toBe(0);
      }, { label: 'BJ741 M3' });
  });
  itMut('M4 explodeAt trap 门摘除（108 也进单源）→ 8b 红', () => {
    withMutation(join(GAME_ROOT, 'src/core/Game.ts'),
      'const crit = Game.EXPLODE_TRAP_PROJS.has(projId) ? false',
      'const crit = false ? false',
      () => {
        const r = spawnVitest('tests/bj741a-damage-face-family.test.ts', '8b TimerCrit');
        expect(r.status, '变异须证红').not.toBe(0);
      }, { label: 'BJ741 M4' });
  });
  itMut('M5 箭袋序回退（弹药 KB 先加）→ 4a 红', () => {
    withMutation(join(GAME_ROOT, 'src/core/Game.ts'),
      'let knockback = (bowC?.knockBack ?? rg?.knockback ?? 2) * (ps?.kb ?? 1);\n      if (isArrowKind && eq.quiver) knockback *= 1.1; // 箭袋击退 ×1.1——武器半边（:54181-85）\n      knockback += (ammoC?.knockBack ?? 0);           // 弹药 KB 后加（:54208）',
      'let knockback = (bowC?.knockBack ?? rg?.knockback ?? 2) * (ps?.kb ?? 1) + (ammoC?.knockBack ?? 0);\n      if (isArrowKind && eq.quiver) knockback *= 1.1; // 箭袋击退 ×1.1——武器半边（:54181-85）',
      () => {
        const r = spawnVitest('tests/bj741a-damage-face-family.test.ts', '4a quiver');
        expect(r.status, '变异须证红').not.toBe(0);
      }, { label: 'BJ741 M5' });
  });
  itMut('M6 groundpound 预倍复辟（×4 双倍）→ 10a 红', () => {
    withMutation(join(GAME_ROOT, 'src/entities/Player.ts'),
      'const damage = 30;                                     // :29011 平值 30 恒定',
      'const damage = charged ? 60 : 30;                      // :29011 平值 30 恒定',
      () => {
        const r = spawnVitest('tests/bj741a-damage-face-family.test.ts', '10a 蓄力档');
        expect(r.status, '变异须证红').not.toBe(0);
      }, { label: 'BJ741 M6' });
  });
  itMut('M7 settleKillExplosion kb 回退裸像素差 → 7a 红', () => {
    withMutation(join(GAME_ROOT, 'src/core/Game.ts'),
      'Math.sign(e.cx - cx) * (flags?.kb ?? 0), 0, this, flags?.arpen ?? 0, critX, 0, true);',
      'cx - e.cx, 0, this, flags?.arpen ?? 0, critX, 0, true);',
      () => {
        const r = spawnVitest('tests/bj741a-damage-face-family.test.ts', '7a settleKillExplosion');
        expect(r.status, '变异须证红').not.toBe(0);
      }, { label: 'BJ741 M7' });
  });
  itMut('M8 SuperCart 激光 DV 摘除（裸 60）→ 6a 红', () => {
    withMutation(join(GAME_ROOT, 'src/entities/Minecart.ts'),
      'damageVarRoll(SUPER_CART_LASER_DMG,\n          ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0)',
      'SUPER_CART_LASER_DMG',
      () => {
        const r = spawnVitest('tests/bj741a-damage-face-family.test.ts', '6a 591');
        expect(r.status, '变异须证红').not.toBe(0);
      }, { label: 'BJ741 M8' });
  });
  itMut('M9 hail 城镇臂 DV 摘除（裸值）→ 5a 红', () => {
    withMutation(join(GAME_ROOT, 'src/entities/Dart.ts'),
      't.hurt(Math.max(1, damageVarRoll(this.damage, 0)),',
      't.hurt(Math.max(1, this.damage),',
      () => {
        const r = spawnVitest('tests/bj741a-damage-face-family.test.ts', '5a hailKill');
        expect(r.status, '变异须证红').not.toBe(0);
      }, { label: 'BJ741 M9' });
  });
});
