// ★BJ492（2026-10-04）掷率收编尾批二件判别测试（BJ491 新登记）：
//   ① 946/755 三臂自造基 4 掷收编 rollVanillaHitCrit 单源。定谳链：
//      · 身份亲读修正（BJ491 判词表「833-835=阿比盖尔臂」误标——ProjectileID.cs 亲读：
//        833=StormTigerTier1(:2118)/834=StormTigerTier2(:2120)/835=StormTigerTier3(:2122)
//        =沙漠虎三阶,与本三掷面无涉;AbigailMinion=963(:2378)本体接触走 contact() 面
//        （BJ453 已接零类掷+TimerCrit/武僧）,亦无涉;真实三面=946 EmpressBlade
//        （Terraprisma 万花筒随从,:2344）体触敌怪臂+城镇臂、755 BatOfLight（血红蝙蝠杖,
//        :1962）体触臂）。
//      · 三面 SetDefaults 亲读（Projectile.cs:8924-8942 946/:7779-7793 755）皆 minion 旗
//        无 melee/ranged/magic 三类旗 → Damage_PVE_Inner :12916-12927 三类掷整段不存在,
//        旧自造 `Math.random()<0.04`=幻影 4% 暴击=原版偏离;数据面 vanilla-projectiles
//        对拍同值（六 id 三类旗全 false）。
//      · vanilla 掷面全链=类掷（无旗跳过）+TimerCrit :12928（ref-crit 无条件消费,不短路）
//        +武僧 688-690 强制掷 :12929-43——本刀三面收编 rollVanillaHitCrit（kind=null 捷径
//        返假零 RNG）+补 TimerCrit/武僧消费（contact() :4916-4917 同构,旧三面整缺）。
//   ② SkyDragonSwing(708)/Shot(709)/Circle(1110) 静态载体退役→rollVanillaHitCrit 单源。
//      定谳链：BJ491① 衔接判语兑现——三型 SetDefaults（:7493/:7510/:10342 亲读）皆
//      melee=true → 三类掷 :12916 达=owner.meleeCrit（:25712-14 逐帧折入,命中拍动态）;
//      旧右键面=出生拍 swCrit 静态冻结载体（Game.ts 计算+shot/swingP/circle 沿载体三写位）
//      与左键 707 面（BJ489 迁移=命中拍动态）时序差——收口=三型命中面
//      `critChance>0 && rollVanillaHitCrit`（707 现役同形）,swCrit 载体随 BJ486② 惯例
//      整体退役（写位无读者即摘;critChance 字段保留=关断钉,armorPen=活数据载体不动）;
//      伤害面（×0.5/kb+4/anim 时序）不动,迁移仅掷率口径。
//  判别力（旧码必红项）：
//   §1a 三面单源三段式结构锁+全文件零 `Math.random() < 0.04`（幻影掷复辟必红）;
//   §1b 六 id 身份+类旗定谳表+rollVanillaHitCrit 零 RNG（误加类旗必红）;
//   §1c 946 体触敌怪臂运行时：零掷（rnd=任意值不暴）+TimerCrit 消费达+crit 翻转 ×2;
//   §1d 946 城镇臂 settle 运行时：TimerCrit 照达 ×2/无 timer=dmg0（巫毒门位同相）;
//   §1e 755 体触臂运行时：同 §1c;
//   §1f 武僧 688-690 强制掷形位钉（三面结构;946/755 恒假零 RNG——contact() 面运行时
//      由 BJ491 §2c/2d 承载）;
//   §2a 三型命中面单源结构锁+旧 `Math.random()<this.critChance` 零残留+swCrit 载体
//      退役锁+关断钉/armorPen 载体保留钉（载体复辟/误摘必红）;
//   §2b 708/709/1110 melee 旗钉值（对称前提,BJ491 1b 交叉锚）;
//   §2c 冻结病负向锁（708 运行时）：同一弹体命中拍换 agg → 掷率随变（旧冻结载体
//      0.04 档恒不暴必红）+critChance=0 关断钉掷门关死;
//   §2d 709/1110 命中拍动态 ×2+圈面自掷（不沿载体复制——spawnCircle 后类字段 0.04）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'path';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { MinionProj } from '../src/entities/MinionProj';
import { SkyDragonSwing, SkyDragonShot, SkyDragonCircle } from '../src/entities/SkyDragonFury';
import type { GameHooks } from '../src/entities/types';
import type { Player } from '../src/entities/Player';
import { rollVanillaHitCrit } from '../src/entities/proj1457';
import { projectileData } from '../src/data/vanillaProjectiles';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME, 'src', p), 'utf8');
const TILE = 16;

afterEach(() => { vi.restoreAllMocks(); });

// ============ 夹具（Z1 makeGame/skydragon.test 缩编同构） ============

function stubPlayer(over: Record<string, unknown> = {}): Player {
  return {
    equipStats: {}, cx: 60 * TILE, cy: 90 * TILE, x: 60 * TILE - 10, y: 90 * TILE - 21,
    w: 20, h: 42, dead: false, facing: 1, vx: 0, vy: 0,
    buffs: { has: () => false }, critChance: () => 0,
    inv: { heldItem: () => null },
    ...over,
  } as unknown as Player;
}

function mkGame(list: unknown[] = [], towns: unknown[] = [], player?: Player) {
  const w = new World(200, 120, 7, 'bj492');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const p = player ?? stubPlayer();
  const hooks = {
    world: w as never, player: p as never,
    enemies: () => list, npcs: () => towns, critters: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {}, cutTilesBox: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {}, playSfxAt: () => {},
    showPickupLabel: () => {}, addLightAt: () => {}, spawnDust: () => null,
    applyLifeSteal: (): number => 0, tickCount: 0,
    entities: { add: () => {}, nextId: 1, projectiles: [] as unknown[] },
    stack: { anyTagged: () => false, hasActiveEffect: () => false },
  } as unknown as GameHooks;
  return { hooks, player: p };
}

function zombie(hooks: GameHooks, uid: number, px = 400, py = 600): Enemy {
  const z = Enemy.fromVanilla(3, px, py)!;
  z.id = uid;
  z.maxHp = 5000;
  z.hp = 5000;
  z.iframes = 0;
  (hooks as unknown as { enemies: () => Enemy[] }).enemies().push(z);
  return z;
}

const mk = (projId: number, player: Player, x: number, y: number): MinionProj =>
  new MinionProj(x, y, projId, 30, 2, false, 0, false, () => player);

const callAs = (m: MinionProj, method: 'tHitTick' | 'bHitTick') =>
  (g: GameHooks, p: Player, d: number) =>
    (m as unknown as Record<string, (g: GameHooks, p: Player, d: number) => void>)[method](g, p, d);

interface HurtCall { dmg: number; crit: boolean }
const hurtSpy = (calls: HurtCall[]) =>
  (d: number, _kx: number, _ky: number, _g: unknown, _pen: number, crit: boolean): boolean => {
    calls.push({ dmg: d, crit: !!crit });
    return true;
  };

function timerSpy(ret = true): { box: number[][]; fn: (g: unknown, x: number, y: number, w: number, h: number) => boolean } {
  const box: number[][] = [];
  return { box, fn: (_g, x, y, w, h) => { box.push([x, y, w, h]); return ret; } };
}

// ============ ① 946/755 三臂掷率收编（幻影 4% 摘除+TimerCrit/武僧照达） ============

describe('BJ492-①：MinionProj 三臂掷面收编 rollVanillaHitCrit 单源', () => {
  it('1a 结构锁：三面单源三段式（rollCrit/timerCrit/monkCrit,消费不短路）+全文件零 Math.random()<0.04', () => {
    const s = SRC('entities/MinionProj.ts');
    // ★BJ684（2026-10-15）锁随刀走：755/946 敌怪臂结算体收编 ai156Strike（tag 链
    //  补课,见 tests/bj684-sanguine-bats.test.ts §2）——三段式内联位迁移：
    //  · 敌怪臂（en×2 → ai156Strike 单源 ×1）：三段仍在+并链 critHit（res.crit‖
    //    rollCrit‖timerCrit‖monkCrit‖golemCrit,ref-crit 消费不短路=vanilla
    //    TryConsumingTimerCrit(:12928) 无条件语义,|| 链内联会短路=禁）
    //  · 城镇臂（tn×1,tHitTick settle 内原位未动）
    // ★BJ723-C S05 改判（2026-10-26 随刀走）：946 城镇臂三段后并入 golemCrit →
    //  critTown 并链形（三段不短路语义保持;旧裸三段锁随 S05 重构退役）
    const triple = s.match(/const rollCrit = rollVanillaHitCrit\(this\.projId, game\);\s*\n\s*const timerCrit = tryConsumeTimerCritOf\(this\.ownerRef\(\), game, tn\.x, tn\.y, tn\.w, tn\.h\);\s*\n\s*const monkCrit = monkAuraForcedCrit\(this\.ownerRef\(\), this\.projId\);/g);
    expect(triple?.length).toBe(1);                   // 946 城镇臂（tHitTick settle 原位）
    // 敌怪臂新形：ai156Strike 内三段+并链（摘任一段/摘并链必红）
    const a156 = s.indexOf('private ai156Strike(');
    const a156Block = s.slice(a156, s.indexOf('private abigailBody(', a156));
    expect(a156Block).toContain('const rollCrit = rollVanillaHitCrit(this.projId, game);');
    expect(a156Block).toContain('tryConsumeTimerCritOf(this.ownerRef(), game, en.x, en.y, en.w, en.h);');
    expect(a156Block).toContain('const monkCrit = monkAuraForcedCrit(this.ownerRef(), this.projId);');
    expect(a156Block).toContain('const critHit = res.crit || rollCrit || timerCrit || monkCrit || golemCrit;');
    expect(s).not.toContain('Math.random() < 0.04');  // ★幻影基掷复辟必红
  });

  it('1b 身份+类旗定谳表（BJ491 误标修正）：946=EmpressBlade/755=BatOfLight/833-835=StormTiger(非阿比盖尔,963)=全系无三类旗零 RNG', () => {
    //  身份钉=vanilla ProjectileID.cs 行号亲读（SetDefaults 无三类旗 :8924-8942/:7779-7793/
    //  :8084-8123/:8450± 963）;aiStyle+minion 数据面在册位佐证身份（156 棱镜族/67 虎族/62 射手族）
    const table: Array<[number, number, string]> = [
      [946, 156, 'EmpressBlade Terraprisma 随从（:2344）'],
      [755, 156, 'BatOfLight 血红蝙蝠杖（:1962）'],
      [833, 67, 'StormTigerTier1 沙漠虎一阶（:2118,非阿比盖尔）'],
      [834, 67, 'StormTigerTier2（:2120）'],
      [835, 67, 'StormTigerTier3（:2122）'],
      [963, 62, 'AbigailMinion 阿比盖尔本体（:2378,接触走 contact() 面）'],
    ];
    const g = mkGame().hooks;
    const rnd = vi.spyOn(Math, 'random');
    for (const [id, ai, tag] of table) {
      const pd = projectileData(id);
      expect(pd?.melee ?? false, `proj ${id}（${tag}）melee`).toBe(false);
      expect(pd?.ranged ?? false, `proj ${id} ranged`).toBe(false);
      expect(pd?.magic ?? false, `proj ${id} magic`).toBe(false);
      expect(pd?.minion ?? false, `proj ${id} minion`).toBe(true);
      expect(pd?.aiStyle, `proj ${id} aiStyle`).toBe(ai);
      expect(rollVanillaHitCrit(id, g), `proj ${id} roll`).toBe(false);   // kind=null 捷径
    }
    expect(rnd).not.toHaveBeenCalled();               // ★六 id 全程零 RNG
  });

  it('1c 946 体触敌怪臂运行时：零掷+TimerCrit 消费达（victim box 透传）+crit 翻转 ×2', () => {
    const t = timerSpy(true);
    const calls: HurtCall[] = [];
    const player = stubPlayer({ tryConsumingTimerCrit: t.fn });
    const { hooks } = mkGame([], [], player);
    const z = zombie(hooks, 4921);
    z.hurt = hurtSpy(calls) as unknown as Enemy['hurt'];
    const m = mk(946, player, z.cx - 8, z.cy - 12);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // 夹具装配后装 spy;★BJ716-A:DV 中性档（R18-F2 首掷 ×1.0）
    callAs(m, 'tHitTick')(hooks, player, 30);
    expect(rnd).toHaveBeenCalledTimes(1);              // ★唯一掷=DamageVar 首掷（BJ716-A）;类旗掷零（幻影基掷复辟=2 必红）
    expect(t.box.length).toBe(1);                     // ★TimerCrit :12928 消费达（旧整缺必红）
    expect(t.box[0]).toEqual([z.x, z.y, z.w, z.h] as unknown as number[]);
    expect(calls[0].crit).toBe(true);
    expect(calls[0].dmg).toBe(30);                    // ★S02(BJ723-B)改判:TimerCrit 强制位走 hurt 防后 ×2——spy 收未翻倍基伤(旧 60=预倍形)
  });

  it('1d 946 城镇臂 settle 运行时：TimerCrit 照达 ×2 / 无 timer=dmg0（巫毒门位同相零 RNG）', () => {
    for (const timerRet of [true, false]) {
      const t = timerSpy(timerRet);
      const calls: HurtCall[] = [];
      const player = stubPlayer({ equipStats: { killGuide: true }, tryConsumingTimerCrit: t.fn });
      const towns = [{
        id: 4922, x: 400, y: 600, w: 20, h: 40, dead: false, vanillaId: 22, bound: false,
        iframes: 0, hurt: hurtSpy(calls),
      }];
      const { hooks } = mkGame([], towns, player);
      const m = mk(946, player, 400 + 10 - 8, 600 + 20 - 12);
      const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);
      callAs(m, 'tHitTick')(hooks, player, 30);
      expect(rnd).not.toHaveBeenCalled();             // 零掷
      expect(t.box.length).toBe(1);                   // 消费达（tn.x/y/w/h=城镇靶盒）
      expect(calls[0].dmg).toBe(30);  // ★S02 改判:TimerCrit 翻转走 hurt 防后 ×2——两态同基值,crit 旗分(旧 timerRet?60:30=预倍形)
    }
  });

  it('1e 755 体触臂运行时：零掷+TimerCrit 消费达+crit 翻转 ×2', () => {
    const t = timerSpy(true);
    const calls: HurtCall[] = [];
    const player = stubPlayer({ tryConsumingTimerCrit: t.fn });
    const { hooks } = mkGame([], [], player);
    const z = zombie(hooks, 4923);
    z.hurt = hurtSpy(calls) as unknown as Enemy['hurt'];
    const m = mk(755, player, z.cx - 8, z.cy - 12);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    callAs(m, 'bHitTick')(hooks, player, 30);
    expect(rnd).toHaveBeenCalledTimes(1);              // ★唯一掷=DamageVar 首掷（BJ716-A）
    expect(t.box.length).toBe(1);
    expect(calls[0].crit).toBe(true);
    expect(calls[0].dmg).toBe(30);   // ★S02 改判:×2=Enemy.hurt 防后
  });

  it('1f 武僧强制掷形位钉（:12929-43 全链;946/755 恒假零 RNG——contact() 面运行时=BJ491 §2c/2d 承载）', () => {
    const s = SRC('entities/MinionProj.ts');
    // ★BJ684 锁随刀走：敌怪臂两处（tHitTick/bHitTick）收编 ai156Strike 单源
    //  （三段内联+tag 并链）——monkCrit 行 3→2（ai156Strike 敌怪单源 + tHitTick
    //  城镇 settle 原位）;此处钉消费端读位=三段式含 monk 臂
    expect(s.match(/const monkCrit = monkAuraForcedCrit\(this\.ownerRef\(\), this\.projId\);/g)?.length).toBe(2);
    // 946/755 不达 688-690 门（(projId-688)>>>0>2 恒假）——1c/1d/1e rnd 未被调已证零 RNG
  });
});

// ============ ② SkyDragon 三型静态载体退役→单源（冻结病负向锁） ============

describe('BJ492-②：SkyDragonSwing/Shot/Circle 静态载体退役→rollVanillaHitCrit 单源', () => {
  it('2a 结构锁：三型命中面单源+旧 Math.random()<critChance 零残留+swCrit 载体退役+关断钉/armorPen 保留', () => {
    const fury = SRC('entities/SkyDragonFury.ts');
    expect(fury).not.toContain('Math.random() < this.critChance');   // 旧冻结掷复辟必红
    // 四型现役同形（707=BJ489 迁移既有位 + 708/709/1110=本刀）
    expect(fury.match(/const crit = this\.critChance > 0 && rollVanillaHitCrit\(this\.projId, game\);/g)?.length).toBe(4);
    expect(fury.match(/critChance = 0\.04;/g)?.length).toBe(4);      // 关断钉字段（含 707）保留
    const game = SRC('core/Game.ts');
    expect(game).not.toMatch(/const swCrit = /);                     // 载体计算块摘除
    expect(game).not.toContain('shot.critChance = swCrit');
    expect(game).not.toContain('swingP.critChance = swCrit');
    expect(game).not.toContain('circle.critChance = shot.critChance');   // 沿载体写位摘除
    expect(game).toContain('shot.armorPen = (eq.armorPen ?? 0);');   // armorPen=活数据载体不动
    expect(game).toContain('circle.armorPen = shot.armorPen;');
  });

  it('2b 对称前提钉值：708/709/1110 melee 旗（SetDefaults :7493/:7510/:10342 亲读,数据面同值;BJ491 1b 交叉锚）', () => {
    for (const id of [708, 709, 1110]) {
      const pd = projectileData(id);
      expect(pd?.melee, `proj ${id} melee`).toBe(true);   // 三类掷 :12916 melee 臂达
      expect(pd?.ranged ?? false, `proj ${id} ranged`).toBe(false);
      expect(pd?.magic ?? false, `proj ${id} magic`).toBe(false);
    }
  });

  it('2c 冻结病负向锁（708 运行时）：同一弹体命中拍换 agg → 掷率随变（旧冻结载体必红）+关断钉关死', () => {
    const w = new World(160, 200, 30, 'bj492-swing');
    const list: unknown[] = [];
    const agg = { v: 0 };
    const player = stubPlayer({ cx: 80 * TILE, cy: 100 * TILE, critChance: () => agg.v });
    const game = {
      world: w, player, enemies: () => list, npcs: () => [], critters: () => [],
      entities: { nextId: 1, add: () => {} },
      playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
      spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
      damagePlayer: () => 0, notifyInventoryChanged: () => {},
      onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    } as unknown as GameHooks;
    const owner = { cx: 80 * TILE, cy: 100 * TILE, facing: 1, dead: false, vx: 0, vy: 0 };
    const calls: HurtCall[] = [];
    const en = { id: 1, x: 80 * TILE - 120, y: 100 * TILE - 120, w: 240, h: 240, dead: false, hurt: hurtSpy(calls) };
    list.push(en);
    let animT = 30;
    const sw = new SkyDragonSwing(owner, 36, 0, 70, 9, () => animT, () => {});
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // 阈值中点：0.04 档假/0.54 档真
    // hit1（agg=0）：阈 0.04 → 不暴
    animT = 29; sw.fixedUpdate(1, game);
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ dmg: 70, crit: false });
    // hit2（同弹体,agg=50）：阈 0.04+0.50=0.54 → 暴——旧冻结载体（出生拍 0.04 档）恒不暴必红
    agg.v = 50;
    for (let i = 0; i < 8 && calls.length < 2; i++) {
      animT = Math.max(3, 28 - i);
      sw.fixedUpdate(1, game);
    }
    expect(calls.length).toBe(2);                     // 6t 冷却期满第二跳
    expect(calls[1]).toEqual({ dmg: 70, crit: true });   // ★S02(BJ723-B)改判:×2 移 Enemy.hurt 防后——spy 面收未翻倍基伤(旧 140=预倍形)
    // 关断钉：critChance=0 → 掷门关死——agg=100（阈 1.04,rnd 0.5 必暴）下仍不暴
    // =门关死判别（skydragon.test.ts critChance=0 同相;尘面掷与判定掷分离,不数 rnd 总调用）
    const calls2: HurtCall[] = [];
    (en as { hurt: unknown }).hurt = hurtSpy(calls2);
    agg.v = 100;
    const sw2 = new SkyDragonSwing(owner, 36, 0, 70, 9, () => 29, () => {});
    sw2.critChance = 0;
    sw2.fixedUpdate(1, game);
    expect(calls2[0].dmg).toBe(70);                   // 关断钉关死（门开则 1.04 阈必暴=S02 后仍 70,×2 在 hurt 防后）
  });

  it('2d 709/1110 命中拍动态 ×2+圈面自掷（spawnCircle 后类字段 0.04,不沿载体复制）', () => {
    const w = new World(160, 200, 30, 'bj492-shot');
    const list: unknown[] = [];
    const player = stubPlayer({ cx: 80 * TILE, cy: 100 * TILE, critChance: () => 50 });
    const game = {
      world: w, player, enemies: () => list, npcs: () => [], critters: () => [],
      entities: { nextId: 1, add: () => {} },
      playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
      spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
      damagePlayer: () => 0, notifyInventoryChanged: () => {},
      onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    } as unknown as GameHooks;
    // 709：命中拍动态（agg 50+rnd 0.5 → 暴 ×2）——出生拍无载体可冻（构造器无 crit 入参）
    const calls: HurtCall[] = [];
    const en = { id: 1, x: 80 * TILE + 20, y: 100 * TILE - 40, w: 80, h: 80, dead: false, hurt: hurtSpy(calls) };
    list.push(en);
    const shot = new SkyDragonShot(80 * TILE, 100 * TILE, 12, 0, 70);
    const circles: Array<[number, number, number]> = [];
    shot.spawnCircle = (x, y, dmg) => circles.push([x, y, dmg]);
    shot.consumeCircles = () => {};
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    shot.fixedUpdate(1, game);
    expect(calls[0]).toEqual({ dmg: 70, crit: true });   // 命中拍动态暴击（★S02 改判:spy 收未翻倍基伤）
    expect(shot.dead).toBe(true);                     // penetrate 1 → 命中即 Kill
    expect(circles[0][2]).toBe(70);                   // 圈伤=弹伤（伤害面不动）
    // 1110：圈面自掷（单源直掷,旧 circle.critChance=shot.critChance 沿载体已摘）
    const calls2: HurtCall[] = [];
    const en2 = { id: 2, x: 80 * TILE - 40, y: 100 * TILE - 40, w: 80, h: 80, dead: false, hurt: hurtSpy(calls2) };
    list.push(en2);
    const circle = new SkyDragonCircle(80 * TILE, 100 * TILE, 70, 300);
    expect(circle.critChance).toBe(0.04);             // 类字段关断钉（无载体复制）
    circle.fixedUpdate(1, game);
    expect(calls2[0]).toEqual({ dmg: 70, crit: true });   // 自掷同单源动态（★S02 改判:未翻倍基伤）
  });
});
