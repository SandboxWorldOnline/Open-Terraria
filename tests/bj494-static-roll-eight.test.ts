// ★BJ494（2026-10-04）静态掷载体残余八站逐站定谳判别测试（BJ492 新登记,BJ493 同窗并行）：
//   站表（BJ492 候选清单,行号=登记时点;判决=A 收编 rollVanillaHitCrit 口径 /
//         B 原版同相销案 / C 死字段结构锁）：
//     ① DeadCellsMushroom:114  1044 蘑菇爆爆弹   ——A（原版无三类旗=零掷,静态 4%=幻影）
//     ② ChainsawProj:256       509/252/445 持械钻锯 ——A（melee 动态掷+冻结注入退役）
//     ③ WeaponProj:4159        1125/1130/1134/1135 悠悠球伴生 ——A（melee 动态掷）
//     ④ Celeb2:353             715-718 庆祝烟花弹 ——A（ranged 动态掷+小数冻结注入退役;
//                               「疑有意小数阈值档」假说证伪:P.cs:49500/:49505 出生位
//                               亲读=裸 NewProjectile 无 crit 特设,Projectile 无 crit 字段
//                               ——小数档=冻结载体单位约定,非原版形态,且旧注入漏基 4）
//     ⑤ SolutionProj:279       69/70/621 圣/邪/血水 ——A（无三类旗=零掷,远程率注入=幻影）
//     ⑥ TerraArc:73            984 泰拉刃弧     ——C 死类（现役=SwingArc 泛化并入,
//                               BJ486③ 已 rollVanillaHitCrit 落位;零生产 import;
//                               ★BJ526 整档摘除,§6 锁改「文件缺席+别名摘除」形态）
//     ⑦ MagicProj:179          kind4 兜底圆点   ——C 死面（唯一活构造=net 傀儡重建,
//                               netPuppet 早退命中环不可达;phantom 登记 hurt crit 参硬编码 false）
//     ⑧ SparkleGuitarProj:124  856 星璇之音     ——A（magic 动态掷+stellarTuneCritChance
//                               冻结载体退役→路由门写位;类缺省 0=关断钉保留）
//   判别力（旧码必红项）：
//    §1c/§5c 零掷站运行时 rnd 零调用+TimerCrit 照达翻转 ×2（旧幻影掷必调 rnd=红）;
//    §2c/§3c/§4c/§8c 命中拍换 agg → 掷率随变（旧静态 0.04 档恒不暴=红）
//          +TimerCrit 消费达（旧整缺=红）;
//    §2d/§3d/§4d/§8d 关断钉语义钉（critChance≤0 关掷臂,TimerCrit 臂【不受】门限=原版
//          ownedBySomeone 无条件消费）;
//    §2a/§3a/§4a/§5a/§8a 结构锁（旧静态掷/冻结写位复辟必红）;
//    §6a/§7a 死面结构锁（死类复活接线/死面被误收编必红;现役面单源钉）;
//    §0 十四 id 类旗定谳表+flagless 零 RNG（误加类旗必红）。
//   ★BJ726 改判史（2026-10-27）：S02(BJ723-B) crit ×2 移 Enemy.hurt 防后（NPC.cs:82067
//    两步式,hurt 收基伤+crit 旗）——§1c/2c/3c/3d/4c/4d/5c/8c/8d 九处 dmg 断言由
//    【预倍 ×2 值】改【基伤+crit 旗分立】（逐处旧值见各行注）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'path';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { MushroomBoiExplosionProj } from '../src/entities/DeadCellsMushroom';
import { ChainsawProj } from '../src/entities/ChainsawProj';
import { YoyoShotProj } from '../src/entities/WeaponProj';
import { Celeb2Rocket } from '../src/entities/Celeb2';
import { WaterSplashProj } from '../src/entities/SolutionProj';
import { SparkleGuitarProj } from '../src/entities/SparkleGuitarProj';
import { MagicProj } from '../src/entities/MagicProj';
import type { GameHooks } from '../src/entities/types';
import { rollVanillaHitCrit } from '../src/entities/proj1457';
import { projectileData } from '../src/data/vanillaProjectiles';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME, 'src', p), 'utf8');
const TILE = 16;

afterEach(() => { vi.restoreAllMocks(); });

// ============ 夹具（bj492 makeGame 缩编同构+免疫窗桩;agg/held/timer 可编程桩） ============

/** agg.v=player.critChance(kind) 聚合（不含基 4）;held.v=heldItem();timer=TimerCrit 桩。
 *  mkGame() 内 resetStubs() 归零——逐测需要的非零值在 mkGame 之后置位。 */
const agg = { v: 0 };
const held = { v: null as { id: number; prefix?: number } | null };
const timer = {
  v: false,
  box: [] as number[][],
  fn: (_g: unknown, x: number, y: number, w: number, h: number): boolean => {
    if (timer.v) { timer.box.push([x, y, w, h]); return true; }
    return false;
  },
};
function resetStubs(): void {
  agg.v = 0; held.v = null; timer.v = false; timer.box.length = 0;
}

function stubPlayerAt(cx: number, cy: number): Record<string, unknown> {
  return {
    equipStats: {}, cx, cy, x: cx - 10, y: cy - 21,
    w: 20, h: 42, dead: false, facing: 1, vx: 0, vy: 0,
    buffs: { has: () => false },
    critChance: () => agg.v,
    inv: { heldItem: () => held.v },
    tryConsumingTimerCrit: timer.fn,
  };
}

function mkGame(list: unknown[] = [], player?: Record<string, unknown>): GameHooks {
  resetStubs();
  const w = new World(200, 120, 7, 'bj494');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const winMap = new Map<number, number>();
  return {
    world: w as never, player: (player ?? stubPlayerAt(60 * TILE, 90 * TILE)) as never,
    enemies: () => list, npcs: () => [], critters: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {}, cutTilesBox: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {}, playSfxAt: () => {},
    showPickupLabel: () => {}, addLightAt: () => {}, spawnDust: () => null,
    applyLifeSteal: (): number => 0, tickCount: 0,
    entities: { add: () => {}, nextId: 1, projectiles: [] as unknown[] },
    stack: { anyTagged: () => false, hasActiveEffect: () => false },
    noteNpcPlayerImmune: (id: number, t: number) => {
      if (t > 0) winMap.set(id, t); else if (t === 0) winMap.delete(id);
    },
    meleeNpcImmuneGateOf: (id: number): boolean => winMap.get(id) === undefined,
  } as unknown as GameHooks;
}

interface HurtCall { dmg: number; crit: boolean }
const hurtSpy = (calls: HurtCall[]) =>
  (d: number, _kx: number, _ky: number, _g: unknown, _pen: number, crit: boolean): boolean => {
    calls.push({ dmg: d, crit: !!crit });
    return true;
  };

/** 空域敌怪（def.friendly=false → playerCanHitEnemy 放行;iframes=0 → 免疫窗读面全开） */
function mkEnemy(id: number, x: number, y: number, w = 40, h = 40): Record<string, unknown> {
  const e: Record<string, unknown> = {
    id, x, y, w, h, dead: false, iframes: 0,
    def: { lifeMax: 100, friendly: false },
  };
  e.cx = (e.x as number) + w / 2;
  e.cy = (e.y as number) + h / 2;
  return e;
}

// ============ §0 十四 id 身份+类旗定谳表（SetDefaults 亲读锚） ============

describe('BJ494-§0：八站十四 id 类旗定谳表+rollVanillaHitCrit 零 RNG/类臂率形', () => {
  it('0a 类旗定谳表（vanilla SetDefaults 行号亲读,数据面对拍同值;全表 trap=false）', () => {
    const table: Array<[number[], 'melee' | 'ranged' | 'magic' | null, string]> = [
      [[1044], null, '蘑菇爆爆弹 P.cs:9877-9891 无三类旗'],
      [[509, 252], 'melee', '钻锯 DefaultToDrillOrChainsaw :10734-10744 melee=true'],
      [[445], 'melee', '激光钻 :5165-5177 melee=true'],
      [[1125, 1130, 1134, 1135], 'melee', '悠悠球伴生 :10530-10670 melee=true'],
      [[714, 615, 715, 716, 717, 718], 'ranged', '庆祝族 :7574-7585/:6622-6633/:7586-7611 ranged=true'],
      [[69, 70, 621], null, '圣/邪/血水 :1490-1513 无三类旗'],
      [[856], 'magic', '星璇之音 :8208-8220 magic=true'],
    ];
    for (const [ids, flag, tag] of table) {
      for (const id of ids) {
        const pd = projectileData(id);
        expect(pd, `proj ${id}（${tag}）在册`).toBeDefined();
        expect(!!pd?.melee, `proj ${id} melee（${tag}）`).toBe(flag === 'melee');
        expect(!!pd?.ranged, `proj ${id} ranged（${tag}）`).toBe(flag === 'ranged');
        expect(!!pd?.magic, `proj ${id} magic（${tag}）`).toBe(flag === 'magic');
        // trap 在 ProjectileData TS 接口未声明（json 有列）——窄化读取（ownedBySomeone=!trap）
        expect(!!(pd as unknown as { trap?: boolean })?.trap, `proj ${id} trap（${tag}）`).toBe(false);
      }
    }
  });

  it('0b flagless 四 id 零 RNG（rollVanillaHitCrit kind=null 捷径,误加类旗必红）', () => {
    const g = mkGame();
    const rnd = vi.spyOn(Math, 'random');
    for (const id of [1044, 69, 70, 621]) {
      expect(rollVanillaHitCrit(id, g), `proj ${id} 零掷`).toBe(false);
    }
    expect(rnd).not.toHaveBeenCalled();
  });

  it('0c 类臂率形（melee/ranged/magic 抽查）：阈=0.04+agg/100 命中拍动态（agg 50 → 阈 0.54）', () => {
    const g = mkGame();
    agg.v = 50;
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(rollVanillaHitCrit(856, g)).toBe(true);      // 0.5 < 0.54
    expect(rollVanillaHitCrit(509, g)).toBe(true);
    expect(rollVanillaHitCrit(715, g)).toBe(true);
    rnd.mockReturnValue(0.6);
    expect(rollVanillaHitCrit(856, g)).toBe(false);     // 0.6 > 0.54
    expect(rollVanillaHitCrit(509, g)).toBe(false);
    expect(rollVanillaHitCrit(715, g)).toBe(false);
  });
});

// ============ §1 DeadCellsMushroom:114（1044）——A 收编（零掷+TimerCrit 照达） ============

describe('BJ494-§1：蘑菇爆爆弹 1044 幻影 4% 摘除→单源零掷+TimerCrit', () => {
  it('1a 结构锁：rollCrit/timerCrit/crit 三段式+旧静态掷零残留', () => {
    const s = SRC('entities/DeadCellsMushroom.ts');
    expect(s.match(/const rollCrit = this\.critChance > 0 && rollVanillaHitCrit\(this\.projId, game\);/g)?.length).toBe(1);
    expect(s.match(/const crit = rollCrit \|\| timerCrit;/g)?.length).toBe(1);
    expect(s).not.toContain('Math.random() < this.critChance');   // 旧幻影掷复辟必红
  });

  it('1c 运行时：零掷（rnd 零调用）+TimerCrit 消费达+crit 翻转 ×2;无 timer=单倍', () => {
    for (const timerOn of [true, false]) {
      const calls: HurtCall[] = [];
      const e = mkEnemy(1, 1590, 790);
      e.hurt = hurtSpy(calls);
      const g = mkGame([e]);
      timer.v = timerOn;                                          // 桩在 mkGame 归零后置位
      // boom 注入 no-op（音槽掷面与本判别无涉,隔离 rnd 计数）
      const b = new MushroomBoiExplosionProj(1600, 800, 30, 6, () => {});
      const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);   // 夹具装配后装 spy（旧幻影掷必中=必红钉）
      b.fixedUpdate(1 / 60, g);
      expect(calls.length).toBe(1);
      expect(rnd).not.toHaveBeenCalled();                          // ★零掷（旧码必红）
      if (timerOn) {
        expect(timer.box[0]).toEqual([e.x, e.y, e.w, e.h]);        // ★TimerCrit :12928 消费达（旧整缺必红）
        expect(calls[0].crit).toBe(true);
        // ★BJ726 改判史：S02(BJ723-B) crit ×2 移 Enemy.hurt 防后,旧期望=预倍 ×2 值 60,
        //  现收基伤+crit 旗（30;×2 下游 hurt 内）
        expect(calls[0].dmg).toBe(30);
      } else {
        expect(calls[0].crit).toBe(false);
        expect(calls[0].dmg).toBe(30);
      }
      vi.restoreAllMocks();
    }
  });
});

// ============ §2 ChainsawProj:256（509/252/445）——A 收编（melee 动态掷） ============

describe('BJ494-§2：持械钻锯静态掷退役→rollVanillaHitCrit+冻结注入摘除', () => {
  it('2a 结构锁：三段式+旧静态掷零残留+Game.ts 冻结载体退役+armorPen 活载体保留', () => {
    const s = SRC('entities/ChainsawProj.ts');
    expect(s.match(/const rollCrit = this\.critChance > 0 && rollVanillaHitCrit\(this\.projId, game\);/g)?.length).toBe(1);
    expect(s).not.toContain('Math.random() < this.critChance');
    const game = SRC('core/Game.ts');
    // （判词注释含「saw.critChance = 0.04 + meleeCrit/100」字样,钉须锚旧码全形避自命中）
    expect(game).not.toContain("saw.critChance = 0.04 + this.player.critChance('melee')");   // 冻结载体复辟必红
    expect(game).toContain('saw.armorPen = (eq.armorPen ?? 0) + this.player.meleeArmorPen;');
  });

  it('2c 冻结病负向锁（运行时）：同弹体命中拍换 agg → 掷率随变（旧静态 0.04 档恒不暴必红）', () => {
    const calls: HurtCall[] = [];
    const e = mkEnemy(1, 1590, 790);
    e.hurt = hurtSpy(calls);
    const g = mkGame([e]);
    const owner = { cx: 1600, cy: 800, facing: 1, dead: false, h: 42, gfxOffY: 0, fullRotation: 0 };
    const saw = new ChainsawProj(owner as never, 50, 1, () => true,
      () => ({ x: 1700, y: 800 }), { projId: 509, pick: 0, shootSpeed: 48 });
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // 阈值中点：0.04 档假/0.54 档真
    saw.fixedUpdate(1 / 60, g);                                  // tick1：agg=0 → 不暴
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(false);
    agg.v = 50;                                                  // 命中拍换装配
    for (let t = 0; t < 12 && calls.length < 2; t++) saw.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(2);                                // 10t 免疫窗期满第二跳
    expect(calls[1].crit).toBe(true);                            // ★旧冻结载体（0.04 档恒假）必红
    // ★BJ726 改判史：S02(BJ723-B) crit ×2 移 Enemy.hurt 防后,旧期望=预倍比值 ×2
    //  （calls[0].dmg×2）,现两跳同基伤+crit 旗分立（比值 ×1 恒定,×2 下游 hurt 内）
    expect(calls[1].dmg).toBe(calls[0].dmg);
  });

  it('2d/2e TimerCrit 消费达（掷不达照强制 ×2）+关断钉掷臂关死', () => {
    // 2d：rnd 0.5（roll 臂 0.04 档假）+timer=true → crit 照达 ×2
    const calls: HurtCall[] = [];
    const e = mkEnemy(1, 1590, 790);
    e.hurt = hurtSpy(calls);
    const g = mkGame([e]);
    timer.v = true;
    const owner = { cx: 1600, cy: 800, facing: 1, dead: false, h: 42, gfxOffY: 0, fullRotation: 0 };
    const saw = new ChainsawProj(owner as never, 50, 1, () => true,
      () => ({ x: 1700, y: 800 }), { projId: 509, pick: 0, shootSpeed: 48 });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    saw.fixedUpdate(1 / 60, g);
    expect(calls[0].crit).toBe(true);                            // ★旧无 timer 臂必红
    expect(timer.box[0]).toEqual([e.x, e.y, e.w, e.h]);          // 消费达
    // 2e：critChance=0 → 掷臂关死（rnd 0.0 若臂开必暴=红,DamageVar 亦关掷后恒单倍判定）
    const calls2: HurtCall[] = [];
    const e2 = mkEnemy(2, 1590, 790);
    e2.hurt = hurtSpy(calls2);
    const g2 = mkGame([e2]);
    const saw2 = new ChainsawProj(owner as never, 50, 1, () => true,
      () => ({ x: 1700, y: 800 }), { projId: 509, pick: 0, shootSpeed: 48 });
    saw2.critChance = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    saw2.fixedUpdate(1 / 60, g2);
    expect(calls2[0].crit).toBe(false);                          // 关断钉（掷臂关死=旧门被拆必红）
  });
});

// ============ §3 WeaponProj:4159 YoyoShotProj（1125/1130/1134/1135）——A 收编 ============

describe('BJ494-§3：悠悠球伴生弹静态掷退役→rollVanillaHitCrit（melee 动态）', () => {
  it('3a 结构锁：WeaponProj 全文件旧静态掷零残留（原恰 1 站=4159）+三段式落位', () => {
    const s = SRC('entities/WeaponProj.ts');
    expect(s).not.toContain('Math.random() < this.critChance');   // 旧站复辟必红
    expect(s.match(/const rollCrit = this\.critChance > 0 && rollVanillaHitCrit\(this\.projId, game\);/g)?.length).toBe(1);
  });

  it('3c 冻结病负向锁（1125 运行时）：敌 1 命中拍 agg=0 不暴/敌 2 命中拍 agg=50 暴 ×2', () => {
    const calls: HurtCall[] = [];
    const e1 = mkEnemy(1, 1580, 780);
    e1.hurt = hurtSpy(calls);
    const g = mkGame([e1]);
    const shot = new YoyoShotProj({ x: 1600, y: 800, vx: 0, vy: 0, projId: 1125, dmg: 50, kb: 2 });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    shot.fixedUpdate(1 / 60, g);                                 // 敌1：agg=0 → 不暴
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ dmg: 50, crit: false });
    const e2 = mkEnemy(2, 1580, 780);                            // 同弹体第二敌（1125 usesLocal 每敌一跳）
    e2.hurt = hurtSpy(calls);
    (g as unknown as { enemies: () => unknown[] }).enemies = () => [e1, e2];
    agg.v = 50;                                                  // 命中拍换装配（旧静态载体恒不暴=红）
    shot.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(2);
    // ★BJ726 改判史：S02(BJ723-B) crit ×2 移 Enemy.hurt 防后,旧期望=预倍 ×2 值 100,
    //  现收基伤+crit 位达（50+true;×2 下游 hurt 内）
    expect(calls[1]).toEqual({ dmg: 50, crit: true });
  });

  it('3d 关断钉语义钉：critChance=0 关掷臂,TimerCrit 臂【不受】门限照达 ×2', () => {
    const calls: HurtCall[] = [];
    const e = mkEnemy(1, 1580, 780);
    e.hurt = hurtSpy(calls);
    const g = mkGame([e]);
    timer.v = true;
    const shot = new YoyoShotProj({ x: 1600, y: 800, vx: 0, vy: 0, projId: 1125, dmg: 50, kb: 2 });
    shot.critChance = 0;
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    shot.fixedUpdate(1 / 60, g);
    // ★BJ726 改判史：S02(BJ723-B) crit ×2 移 Enemy.hurt 防后,旧期望=预倍 ×2 值 100,
    //  现收基伤+crit 旗（TimerCrit 照达,50+true;零掷≠跳消费,旧整缺必红）
    expect(calls[0]).toEqual({ dmg: 50, crit: true });
  });
});

// ============ §4 Celeb2:353 Celeb2Rocket（715-718）——A 收编（ranged 动态掷） ============

describe('BJ494-§4：庆祝烟花弹静态掷退役→rollVanillaHitCrit+小数冻结注入摘除', () => {
  it('4a 结构锁：三段式+旧静态掷零残留+Game.ts 小数冻结载体退役（armorPen 保留）', () => {
    const s = SRC('entities/Celeb2.ts');
    expect(s.match(/const rollCrit = this\.critChance > 0 && rollVanillaHitCrit\(this\.projId, game\);/g)?.length).toBe(1);
    expect(s).not.toContain('Math.random() < this.critChance');
    const game = SRC('core/Game.ts');
    expect(game).not.toContain('rk.critChance = ');               // 小数冻结载体复辟必红
    expect(game).toContain('rk.armorPen = (eq.armorPen ?? 0) + (ps?.arpen ?? 0);');
  });

  it('4c 冻结病负向锁（715 运行时）：命中拍 agg=0 不暴 → agg=50 暴 ×2（弹 1/弹 2 同构面）', () => {
    const calls: HurtCall[] = [];
    const e = mkEnemy(1, 1590, 790);
    e.hurt = hurtSpy(calls);
    const g = mkGame([e]);
    const rk1 = new Celeb2Rocket(715, 0, 1593, 793, 5, 0, 50, 5, false, () => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    rk1.fixedUpdate(1 / 60, g);                                  // agg=0 → 不暴
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ dmg: 50, crit: false });
    agg.v = 50;
    const rk2 = new Celeb2Rocket(715, 0, 1593, 793, 5, 0, 50, 5, false, () => {});
    rk2.fixedUpdate(1 / 60, g);                                  // 命中拍 agg=50 → 暴（旧 0.04 档恒假=红）
    expect(calls.length).toBe(2);
    // ★BJ726 改判史：S02(BJ723-B) crit ×2 移 Enemy.hurt 防后,旧期望=预倍 ×2 值 100,
    //  现收基伤+crit 旗（50+true;×2 下游 hurt 内）
    expect(calls[1]).toEqual({ dmg: 50, crit: true });
  });

  it('4d TimerCrit 消费达（rnd 0.5 掷不达照强制）', () => {
    const calls: HurtCall[] = [];
    const e = mkEnemy(1, 1590, 790);
    e.hurt = hurtSpy(calls);
    const g = mkGame([e]);
    timer.v = true;
    const rk = new Celeb2Rocket(715, 0, 1593, 793, 5, 0, 50, 5, false, () => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    rk.fixedUpdate(1 / 60, g);
    expect(timer.box[0]).toEqual([e.x, e.y, e.w, e.h]);          // 消费达（旧整缺必红）
    // ★BJ726 改判史：S02(BJ723-B) crit ×2 移 Enemy.hurt 防后,旧期望=预倍 ×2 值 100,
    //  现收基伤+crit 旗（50+true;×2 下游 hurt 内）
    expect(calls[0]).toEqual({ dmg: 50, crit: true });
  });
});

// ============ §5 SolutionProj:279 WaterSplashProj（69/70/621）——A 收编（零掷+TimerCrit） ============

describe('BJ494-§5：圣/邪/血水幻影远程率摘除→单源零掷+TimerCrit', () => {
  it('5a 结构锁：三段式+旧静态掷零残留+Game.ts 幻影率注入退役', () => {
    const s = SRC('entities/SolutionProj.ts');
    expect(s.match(/const rollCrit = this\.critChance > 0 && rollVanillaHitCrit\(this\.projId, game\);/g)?.length).toBe(1);
    expect(s).not.toContain('Math.random() < this.critChance');
    const game = SRC('core/Game.ts');
    expect(game).not.toContain('water.critChance = ');            // 幻影率注入复辟必红
  });

  it('5c 运行时：零掷（rnd 零调用）+TimerCrit 消费达翻转 ×2/无 timer=单倍（69/70/621 全表）', () => {
    for (const projId of [69, 70, 621]) {
      for (const timerOn of [true, false]) {
        const calls: HurtCall[] = [];
        const e = mkEnemy(1, 1595, 790);
        e.hurt = hurtSpy(calls);
        const g = mkGame([e]);
        timer.v = timerOn;
        const flask = new WaterSplashProj(1590, 793, 3, 0, projId, 20, 3, () => {});
        const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);
        flask.fixedUpdate(1 / 60, g);
        expect(calls.length).toBe(1);
        expect(rnd).not.toHaveBeenCalled();                       // ★零掷（旧幻影掷必调 rnd=红）
        if (timerOn) {
          expect(timer.box[0]).toEqual([e.x, e.y, e.w, e.h]);     // TimerCrit 照达（旧整缺必红）
          // ★BJ726 改判史：S02(BJ723-B) crit ×2 移 Enemy.hurt 防后,旧期望=预倍 ×2 值 40,
          //  现收基伤+crit 旗（20+true;×2 下游 hurt 内）
          expect(calls[0]).toEqual({ dmg: 20, crit: true });
        } else {
          expect(calls[0]).toEqual({ dmg: 20, crit: false });
        }
        vi.restoreAllMocks();
      }
    }
  });
});

// ============ §6 TerraArc（984）——C 死类结构锁（★BJ526 整档摘除;复活必红） ============

describe('BJ494-§6：TerraArc 死类定谳（现役 984=SwingArc 已 rollVanillaHitCrit 落位;★BJ526 整档摘除）', () => {
  it('6a 结构锁：整档缺席+零 import+别名摘除+现役面单源钉（复活接线必红）', () => {
    // ① 整档缺席（★BJ526 摘除;文件重现=复活必红）
    expect(existsSync(join(GAME, 'src', 'entities', 'TerraArc.ts'))).toBe(false);
    // ② 全 src 树零 `from '…/TerraArc'`（旧名 import 复辟必红）
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') ? [p] : []);
      });
    const srcDir = join(GAME, 'src');
    for (const p of walk(srcDir)) {
      const s = readFileSync(p, 'utf8');
      expect(s.match(/from '[^']*\/TerraArc'/), `${p} 误 import 死类`).toBeNull();
    }
    // ③ 现役面单源：别名已摘（`export const TerraArc` 复辟必红）;SWING_STYLE 984 在册;
    //    984 掷面=单源三站（BJ486③ rollVanillaHitCrit 口径,复活掷率必须重走此口径）
    const live = SRC('entities/SwingArc.ts');
    expect(live).not.toContain('export const TerraArc');
    expect(live).toContain('984: {');
    expect(live.match(/const crit = this\.critChance > 0 && rollVanillaHitCrit\(this\.projId, game\);/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

// ============ §7 MagicProj:179（kind4）——C 死面结构锁（傀儡拓扑不可达） ============

describe('BJ494-§7：MagicProj 命中环死面定谳（唯一活构造=net kind4 傀儡重建）', () => {
  it('7a 结构锁：new MagicProj 恰 1 站（netMakeProj case4）+netPuppet 早退先于命中环+判词标记', () => {
    const game = SRC('core/Game.ts');
    expect(game.match(/new MagicProj\(/g)?.length).toBe(1);       // 第二活构造点出现必红
    expect(game).toContain('case 4: return new MagicProj(');
    const s = SRC('entities/MagicProj.ts');
    expect(s).toContain('★BJ494（2026-10-04）定谳 C=死面');        // 判词标记在位（弱引用不算）
    // 源序钉：netPuppet 早退先于敌怪命中环（拓扑不可达判据;早退被移位必红）
    const earlyRet = s.indexOf('if (this.netPuppet) { this.netPuppetStep(); return; }');
    const hitLoop = s.indexOf('for (const ent of game.enemies())');
    expect(earlyRet).toBeGreaterThan(-1);
    expect(hitLoop).toBeGreaterThan(earlyRet);
    // 死面原样保留（勿收编钉——接活线时按 rollVanillaHitCrit+TimerCrit 整体收编,见判词）
    expect(s).toContain('Math.random() < this.critChance');
  });

  it('7b 运行时佐证：傀儡 fixedUpdate 零结算零 RNG（命中环拓扑不可达）', () => {
    const calls: HurtCall[] = [];
    const e = mkEnemy(1, 1584, 784);
    e.hurt = hurtSpy(calls);
    const g = mkGame([e]);
    const p = new MagicProj(1600, 800, 5, 0, 9, 45, '#8090FF');
    (p as unknown as { netPuppet: boolean }).netPuppet = true;
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);
    p.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(0);                                 // 傀儡早退零结算
    expect(rnd).not.toHaveBeenCalled();                           // 零 RNG
    // projId 0=vanilla 无出生面 → 单源 kind=null 捷径零掷（未来接活线兜底形）
    expect(rollVanillaHitCrit(0, g)).toBe(false);
  });
});

// ============ §8 SparkleGuitarProj:124（856）——A 收编（magic 动态掷+冻结载体退役） ============

describe('BJ494-§8：星璇之音静态掷退役→rollVanillaHitCrit（直击/爆裂共口 stellarStrike）', () => {
  it('8a 结构锁：stellarStrike 三段式+旧静态掷零残留+冻结载体退役/路由门在位+关断钉保留', () => {
    const s = SRC('entities/SparkleGuitarProj.ts');
    expect(s.match(/const rollCrit = critChance > 0 && rollVanillaHitCrit\(proj\?\.projId \?\? 856, game\);/g)?.length).toBe(1);
    expect(s).not.toContain('Math.random() < critChance');        // 旧冻结掷复辟必红
    expect(s).toContain('critChance = 0;');                       // 类缺省 0=关断钉（直构测试确定性）
    const game = SRC('core/Game.ts');
    // （判词注释含「orb.critChance = stellarTuneCritChance(...)」字样,钉锚旧码实参形避自命中）
    expect(game).not.toContain("stellarTuneCritChance(p.critChance('magic')");   // 冻结率载体复辟必红
    expect(game).toContain('orb.critChance = 0.04');              // 路由门写位在位
    const imp = game.match(/import \{[^}]*\} from '\.\.\/entities\/SparkleGuitarProj';/)?.[0] ?? '';
    expect(imp).not.toContain('stellarTuneCritChance');           // 生产 import 面退役钉
  });

  it('8c 冻结病负向锁（直击站运行时）：命中拍 agg=0 不暴 → agg=50 暴 ×2', () => {
    const calls: HurtCall[] = [];
    const e = mkEnemy(1, 1580, 780);
    e.hurt = hurtSpy(calls);
    // 曲线 P1=player.Center——玩家桩钉在弹位（1600,800）,t≈0 即扫过敌盒
    const g = mkGame([e], stubPlayerAt(1600, 800));
    const g1 = new SparkleGuitarProj(1600, 800, 200, 0, 50, 1700, 800);
    g1.critChance = 0.04;                                         // 生产路由门写位模拟（Game.ts spawn 同值;直构缺省 0=关断钉）
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    for (let t = 0; t < 35 && calls.length < 1 && !g1.dead; t++) g1.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ dmg: 50, crit: false });           // agg=0 → 0.04 档假
    agg.v = 50;
    const e2 = mkEnemy(2, 1580, 780);
    e2.hurt = hurtSpy(calls);
    (g as unknown as { enemies: () => unknown[] }).enemies = () => [e2];
    const g2 = new SparkleGuitarProj(1600, 800, 200, 0, 50, 1700, 800);
    g2.critChance = 0.04;                                         // 路由门同模拟
    for (let t = 0; t < 35 && calls.length < 2 && !g2.dead; t++) g2.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(2);
    // ★BJ726 改判史：S02(BJ723-B) crit ×2 移 Enemy.hurt 防后,旧期望=预倍 ×2 值 100,
    //  现收基伤+crit 旗（50+true;★命中拍动态判别不变,旧冻结载体恒 0.04 档=红）
    expect(calls[1]).toEqual({ dmg: 50, crit: true });
  });

  it('8d TimerCrit 消费达（critChance=0 关断钉下掷臂关死,timer 臂照达 ×2）', () => {
    const calls: HurtCall[] = [];
    const e = mkEnemy(1, 1580, 780);
    e.hurt = hurtSpy(calls);
    const g = mkGame([e], stubPlayerAt(1600, 800));
    timer.v = true;
    const g1 = new SparkleGuitarProj(1600, 800, 200, 0, 50, 1700, 800);   // 类缺省 critChance=0
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    for (let t = 0; t < 35 && calls.length < 1 && !g1.dead; t++) g1.fixedUpdate(1 / 60, g);
    // ★BJ726 改判史：S02(BJ723-B) crit ×2 移 Enemy.hurt 防后,旧期望=预倍 ×2 值 100,
    //  现收基伤+crit 旗（TimerCrit 照达,50+true;×2 下游 hurt 内,旧整缺必红）
    expect(calls[0]).toEqual({ dmg: 50, crit: true });
  });
});

// ============ §9 夹具健康度自证 ============

describe('BJ494-§9：夹具健康度', () => {
  it('9a Enemy.fromVanilla 夹具可用（敌桩连通性）', () => {
    const g = mkGame();
    const z = Enemy.fromVanilla(3, 400, 600)!;
    expect(z.maxHp).toBeGreaterThan(0);
    expect(g.enemies()).toBeDefined();
  });
});
