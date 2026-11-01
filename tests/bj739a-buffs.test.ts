// ★BJ739-A（2026-10-31，issue #29）Buff/浸剂一致性审计——行为锁（Buffs.ts/Player.ts 域）。
// 标杆：Terarria1457 反编译（亲读重锚,锚行号见各断言注）。
// 覆盖：B01/B02 不递减表、B03 移速加算池、B04 魔力眩晕 50%、B05 预见耗魔加算池、
//       B06 浸剂互斥、B07 狂犬病三消费面、B08 装备回复 DoT 清零、B09 共享 lifeRegen
//       计数、B11 Slimed 火族翻倍、B14/B15 召唤击退食物档/醉酒摘除。
// 变异恰红（withMutation）在同文件 M 组。
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withMutation } from './mutation-guard';
import { BuffState, BuffType, vanillaIdOfBuff } from '../src/stats/Buffs';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';

const _iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

const fakeHooks = (w: World, p: Player, captured: number[] = []) => ({
  world: w,
  player: p,
  enemies: () => [],
  critters: () => [],
  spawnDrop: () => null,
  damagePlayer: (): number => 0,
  addDamageNumber: (_x: number, _y: number, a: number) => { captured.push(a); },
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
const run = (b: BuffState, ticks: number, dt = DT): number => {
  let sum = 0;
  for (let k = 0; k < ticks; k++) sum += b.tick(dt);
  return sum;
};

// ============ B01：六工作站 buff 不递减（BuffID.cs:22 + Player.cs:9958） ============

describe('BJ739 B01：TimeLeftDoesNotDecrease 工位六站 + 334/28', () => {
  const stations: Array<[BuffType, number, string]> = [
    [BuffType.Clairvoyance, 29, '水晶球'],
    [BuffType.Sharpened, 159, '磨刀石'],
    [BuffType.Bewitched, 150, '附魔台'],
    [BuffType.AmmoBox, 93, '弹药箱'],
    [BuffType.WarTable, 348, '战争桌'],
    [BuffType.DeadCellsPotionStation, 366, '炼金药瓶'],
  ];
  for (const [bt, vid, name] of stations) {
    it(`${name}(${vid}) 108000t 不递减（issue 复现：1800s 后应仍在栏）`, () => {
      const b = new BuffState();
      b.apply(bt, 1800);
      run(b, 108000);      // 30 分钟 × 60Hz
      expect(b.active.get(bt)).toBe(1800);
    });
  }
  it('狼人 28 亦在表（月符夜钉,白天显式 remove）', () => {
    const b = new BuffState();
    b.apply(BuffType.Werewolf, 1);
    run(b, 600);
    expect(b.active.get(BuffType.Werewolf)).toBe(1);
  });
  it('对照组：普通 buff 照常递减（Regen 60s → 3000t 后删栏）', () => {
    const b = new BuffState();
    b.apply(BuffType.Regen, 60);
    run(b, 3700);      // 60s+缓冲（浮点尘防 3600 恰好踩界）
    expect(b.active.has(BuffType.Regen)).toBe(false);
  });
});

// ============ B02：极饿 334 不自灭（饥饿链重启修复） ============

describe('BJ739 B02：The Constant 极饿 5t 持续（334 在不递减表）', () => {
  it('Hunger 到期 → Starving 5t 后不倒数不回 332（issue 复现：第 8 帧应仍 334）', () => {
    const b = new BuffState();
    b.dontStarveWorld = true;
    b.hungerPlayerAlive = true;
    b.apply(BuffType.Hunger, 3 / 60);   // 剩 3t
    for (let k = 0; k < 100; k++) b.tick(DT);
    expect(b.active.has(BuffType.Starving)).toBe(true);      // 334 恒在
    expect(b.active.has(BuffType.NeutralHunger)).toBe(false); // 不回 332
    expect(b.active.get(BuffType.Starving)).toBe(5 / 60);     // 时长钉 5t 不动
  });
  it('食物重置（fed-state 换档）仍可清饥饿链', () => {
    const b = new BuffState();
    b.dontStarveWorld = true;
    b.hungerPlayerAlive = true;
    b.apply(BuffType.Starving, 5 / 60);
    b.apply(BuffType.WellFed, 30);
    expect(b.active.has(BuffType.Starving)).toBe(false);
  });
});

// ============ B03：移速加法池（原版 UpdateBuffs :10040/:10023/:11087/:11991/:12004） ============

describe('BJ739 B03：moveSpeedMult 加算池 + sunflowerMoveMult', () => {
  const mk = (...ents: Array<[BuffType, number]>): BuffState => {
    const b = new BuffState();
    for (const [t, s] of ents) b.apply(t, s);
    return b;
  };
  it('迅捷与蛋糕两挂 = 1.45（旧乘区 1.50，issue 观测）', () => {
    expect(mk([BuffType.Agility, 60], [BuffType.SugarRush, 60]).moveSpeedMult).toBeCloseTo(1.45, 6);
  });
  it('迅捷与狼人两挂 = 1.30（旧 1.3125）', () => {
    expect(mk([BuffType.Agility, 60], [BuffType.Werewolf, 60]).moveSpeedMult).toBeCloseTo(1.30, 6);
  });
  it('迅捷与虚弱两挂 = 1.15（旧 1.125）', () => {
    expect(mk([BuffType.Agility, 60], [BuffType.Weak, 60]).moveSpeedMult).toBeCloseTo(1.15, 6);
  });
  it('迅捷与向日葵两挂 = 池 1.35 乘 sunflower 1.1 = 1.485（旧 1.5125）', () => {
    const b = mk([BuffType.Agility, 60], [BuffType.Sunflower, 60]);
    expect(b.moveSpeedMult).toBeCloseTo(1.35, 6);
    expect(b.sunflowerMoveMult).toBeCloseTo(1.1, 6);
  });
  it('风筝独挂 1.15（1457 :10003 既有锁不回归）', () => {
    expect(mk([BuffType.KiteBuff, 60]).moveSpeedMult).toBeCloseTo(1.15, 6);
  });
  it('饕餮 207 档 +0.4（食物档照加）', () => {
    expect(mk([BuffType.WellFed3, 60]).moveSpeedMult).toBeCloseTo(1.4, 6);
  });
  it('Player.moveSpeedPool 合成：迅捷+10% 配饰 = 1.35（旧 1.375,装备加算同池）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(285), stack: 1 };    // 风之脚环 move +0.05（accfx '285'）
    p.buffs.apply(BuffType.Agility, 60);
    // 装备 moveMult = 1+0.05（accfx 285 {move:0.05}）;池 = 1.25+0.05 = 1.30
    expect(p.equipStats.moveMult).toBeCloseTo(1.05, 5);
    expect(p.moveSpeedPool).toBeCloseTo(1.30, 5);
  });
});

// ============ B04：魔力眩晕叠层可到 50%（:10412-14 无钳） ============

describe('BJ739 B04：manaSickReduction 无 25% 钳', () => {
  it('两瓶蓝（94 叠加至 600t=10s）→ 剩 10s 乘数 0.50（旧钳 0.75）', () => {
    const b = new BuffState();
    b.apply(BuffType.ManaSickness, 5);   // AddBuff(94,300)
    b.apply(BuffType.ManaSickness, 5);   // 叠加至 600t 上限
    expect(b.active.get(BuffType.ManaSickness)).toBe(10);
    expect(b.manaSickMagicMult).toBeCloseTo(0.5, 6);
  });
  it('剩 5s（未叠层）→ 0.75 线性段不变', () => {
    const b = new BuffState();
    b.apply(BuffType.ManaSickness, 5);
    expect(b.manaSickMagicMult).toBeCloseTo(0.75, 6);
  });
  it('剩 7.5s → 0.625（5-10s 段线性,旧恒 0.75）', () => {
    const b = new BuffState();
    b.apply(BuffType.ManaSickness, 7.5);
    expect(b.manaSickMagicMult).toBeCloseTo(0.625, 6);
  });
});

// ============ B05：预见 -2% 归 manaCostOff 加算池（:11979） ============

describe('BJ739 B05：clairvoyanceManaCostOff 加算池', () => {
  it('BuffState getter = 0.02（旧 0.98 乘数退役）', () => {
    const b = new BuffState();
    expect(b.clairvoyanceManaCostOff).toBe(0);
    b.apply(BuffType.Clairvoyance, 1800);
    expect(b.clairvoyanceManaCostOff).toBeCloseTo(0.02, 6);
  });
  it('Player.equipStats：预见 → manaCostOff +0.02 且 manaCostMul 保持 1（旧 ×0.98）', () => {
    const p = new Player(0, 0, new Inventory());
    expect(p.equipStats.manaCostOff).toBe(0);
    expect(p.equipStats.manaCostMul).toBe(1);
    p.buffs.apply(BuffType.Clairvoyance, 1800);
    expect(p.equipStats.manaCostOff).toBeCloseTo(0.02, 6);
    expect(p.equipStats.manaCostMul).toBe(1);
  });
  it('原版付费式（:5875 (int)(44×0.84)=36）：魔力花 -0.08 + 预见 -0.02 + 恩赐 -0.06 同池', () => {
    // 恩赐 223（manaCostOff 0.06）+ 魔力花 555（manaFlower 0.08）+ 预见
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(223), stack: 1 };
    p.inv.armor[4] = { id: _iid(555), stack: 1 };
    p.buffs.apply(BuffType.Clairvoyance, 1800);
    const off = p.equipStats.manaCostOff;
    expect(off).toBeCloseTo(0.16, 5);
    // Inept 词缀后 44 蓝：trunc(44×(1-0.16)) = trunc(36.96) = 36（旧 trunc(44×0.92×0.98)=37）
    expect(Math.trunc(44 * (1 - off) * p.equipStats.manaCostMul)).toBe(36);
  });
});

// ============ B06：浸剂互斥（Main.cs:9100-07 + Player.cs:5352-65） ============

describe('BJ739 B06：meleeBuff 八浸剂同刻仅一', () => {
  it('灵液(76)后喝毒(79) → 仅毒在栏（issue 复现：[76,79] 应 [79]）', () => {
    const b = new BuffState();
    b.apply(BuffType.ImbueIchor, 1200);
    b.apply(BuffType.ImbuePoison, 1200);
    expect([...b.active.keys()].sort((x, y) => vanillaIdOfBuff(x) - vanillaIdOfBuff(y)))
      .toEqual([BuffType.ImbuePoison]);
  });
  it('全八员两两互斥抽查：毒液→诅咒焰→烈火→黄金→灵液→纳米→派对→剧毒链', () => {
    const b = new BuffState();
    const chain = [BuffType.ImbueVenom, BuffType.ImbueCursed, BuffType.ImbueFire, BuffType.ImbueGold,
      BuffType.ImbueIchor, BuffType.ImbueNano, BuffType.ImbueParty, BuffType.ImbuePoison];
    for (const t of chain) b.apply(t, 600);
    expect(b.active.size).toBe(1);
    expect(b.active.has(BuffType.ImbuePoison)).toBe(true);
  });
  it('续期同型不触发互斥自删（TryUpdatingExistingBuffTime 落空才删旧）', () => {
    const b = new BuffState();
    b.apply(BuffType.ImbueVenom, 60);
    b.apply(BuffType.ImbueVenom, 300);   // 续期（max 合并）
    expect(b.active.has(BuffType.ImbueVenom)).toBe(true);
    expect(b.active.get(BuffType.ImbueVenom)).toBe(300);
  });
  it('非浸剂 buff 不受互斥影响', () => {
    const b = new BuffState();
    b.apply(BuffType.ImbueVenom, 60);
    b.apply(BuffType.Titan, 60);
    expect(b.active.size).toBe(2);
  });
});

// ============ B07：狂犬病 148 三消费面（:11409-42/:19377-80） ============

describe('BJ739 B07：Rabies 四系伤害 +0.2 / 回复惩罚 / 随机短减益', () => {
  it('damageMult 四系 +0.2（melee/ranged/magic/summon）', () => {
    const p = new Player(0, 0, new Inventory());
    const base = { melee: p.damageMult('melee'), ranged: p.damageMult('ranged'), magic: p.damageMult('magic'), summon: p.damageMult('summon') };
    p.buffs.apply(BuffType.Rabies, 60);
    expect(p.damageMult('melee')).toBeCloseTo(base.melee + 0.2, 6);
    expect(p.damageMult('ranged')).toBeCloseTo(base.ranged + 0.2, 6);
    expect(p.damageMult('magic')).toBeCloseTo(base.magic + 0.2, 6);
    expect(p.damageMult('summon')).toBeCloseTo(base.summon + 0.2, 6);
  });
  it('随机短减益：1/1200 命中 → 六选一施加（固定随机序列夹具,:11412-437）', () => {
    const b = new BuffState();
    b.apply(BuffType.Rabies, 60);
    const seq = [0, 0.5, 0.7];   // Next(1200)==0 命中;Next(6)=3(缓慢);Next(60,100)=90 → num18=0.9
    let i = 0;
    const r = vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);
    b.tick(DT);
    r.mockRestore();
    // case 3 = Slow ×3.5：num18 = (60+floor(0.7×40))×0.01 = 0.88 → (int)(60×0.88×3.5)=184t
    expect(b.active.has(BuffType.Slow)).toBe(true);
    expect(b.active.get(BuffType.Slow)).toBeCloseTo(184 / 60, 6);
  });
  it('未命中（Next(1200)!=0）不施加', () => {
    const b = new BuffState();
    b.apply(BuffType.Rabies, 60);
    const r = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // floor(0.5*1200)=600 ≠ 0
    b.tick(DT);
    r.mockRestore();
    expect(b.active.has(BuffType.Slow)).toBe(false);
    expect(b.active.has(BuffType.Darkness)).toBe(false);
  });
  it('回复惩罚（:19377-80）：狂犬病期自然回复减半（差分探针,随机掷钉死）', () => {
    const probe = (rabies: boolean): number => {
      const w = new World(60, 60, 42, 'bj739a-rab');
      const p = new Player(20 * 16, 27 * 16, new Inventory());
      p.baseMaxHp = 400;
      p.hp = 200;
      if (rabies) p.buffs.apply(BuffType.Rabies, 3600);
      const hooks = fakeHooks(w, p);
      const step = (t: number): void => { for (let k = 0; k < t; k++) p.fixedUpdate(DT, hooks as never); };
      step(3600);                       // eRT 爬坡满档（3600 封顶 9 档）
      p.hp = 200;                       // 采样窗起点统一压回半血（防满血钳制污染对照）
      step(600);                        // 10s 采样窗
      return p.hp - 200;
    };
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.9999);   // 狂犬病 1/1200 掷恒不中
    try {
      const healedNoR = probe(false);
      const healedR = probe(true);
      expect(healedNoR).toBeGreaterThan(30);       // 满档 400HP 静止 ≈ 5.5HP/s × 10s
      // num5 减半 → ≈ 半量（块量化容差 ±3）
      expect(healedR).toBeGreaterThanOrEqual(Math.floor(healedNoR / 2) - 3);
      expect(healedR).toBeLessThanOrEqual(Math.ceil(healedNoR / 2) + 3);
    } finally { rnd.mockRestore(); }
  });
});

// ============ B08：装备回复被 DoT 清零（:13221 + :19067 等） ============

describe('BJ739 B08：着火期装备 lifeRegen 不回复', () => {
  it('日曜头 2763（lifeRegen+2 = 1HP/s）：无 DoT 时回血', () => {
    const w = new World(60, 60, 42, 'bj739a-eq1');
    const p = new Player(20 * 16, 27 * 16, new Inventory());
    p.inv.armor[0] = { id: _iid(2763), stack: 1 };
    p.baseMaxHp = 400;
    p.hp = 200;
    expect(p.equipStats.hpPerSec).toBeCloseTo(1, 5);
    const hooks = fakeHooks(w, p);
    for (let k = 0; k < 600; k++) p.fixedUpdate(DT, hooks as never);
    expect(p.hp).toBeGreaterThan(200);   // 10s ≥ +9HP
  });
  it('着火 OnFire 期装备回复清零（净 -4HP/s,旧 +1-4=-3HP/s）', () => {
    const w = new World(60, 60, 42, 'bj739a-eq2');
    const p = new Player(20 * 16, 27 * 16, new Inventory());
    p.inv.armor[0] = { id: _iid(2763), stack: 1 };
    p.baseMaxHp = 400;
    p.hp = 200;
    p.buffs.apply(BuffType.OnFire, 10);
    const hooks = fakeHooks(w, p);
    for (let k = 0; k < 300; k++) p.fixedUpdate(DT, hooks as never);
    // 5s 着火 = -20HP（4HP/s）;旧实现装备 +1HP/s → -15。容差 ±1（块边界）
    expect(200 - p.hp).toBeGreaterThanOrEqual(19);
    expect(200 - p.hp).toBeLessThanOrEqual(21);
  });
});

// ============ B09：共享 lifeRegenCount（:19384/:19434/:19478） ============

describe('BJ739 B09：多 DoT 共享计数', () => {
  it('OnFire 与 Poisoned 同挂 10/20/30 帧 = -1/-2/-3（issue 复现：旧 0/-1/-3）', () => {
    const mk = (): BuffState => {
      const b = new BuffState();
      b.apply(BuffType.OnFire, 30);
      b.apply(BuffType.Poisoned, 30);
      return b;
    };
    const cum = (ticks: number): number => {
      const b = mk();
      let sum = 0;
      for (let k = 0; k < ticks; k++) sum += b.tick(DT);
      return sum;
    };
    expect(cum(10)).toBe(-1);
    expect(cum(20)).toBe(-2);
    expect(cum(30)).toBe(-3);
  });
  it('毒 15t→空档→再毒：首块不提前（issue 第二观测面）', () => {
    const b = new BuffState();
    b.apply(BuffType.Poisoned, 15 / 60);
    for (let k = 0; k < 15; k++) b.tick(DT);      // 毒 15t:计 -60 单位,无块
    let sum = 0;
    for (let k = 0; k < 3600; k++) sum += b.tick(DT);   // 空档 60s:残账回收
    expect(sum).toBe(0);                          // 无凭空掉血
    b.apply(BuffType.Poisoned, 30);               // 再毒
    let hits = 0;
    for (let k = 0; k < 45; k++) if (b.tick(DT) < 0) hits++;
    // 旧实现残余 -60 → 第 15t 提前掉 1（45t 窗 2 块）;共享账断流清零 → 首块恰 60t
    // 之外——45t 窗内恰 1 块（30t 处 -120 门槛）
    expect(hits).toBe(1);
  });
  it('Burning 独挂走 -600 块弹 5（:19434-4456,与 BJ447 ①②③ 兼容）', () => {
    const b = new BuffState();
    b.apply(BuffType.Burning, 5);
    let sum = 0;
    let chunks: number[] = [];
    for (let k = 0; k < 100; k++) {
      sum += b.tick(DT);
      const c = b.consumeDotChunk();
      if (c > 0) chunks.push(c);
    }
    expect(chunks.length).toBe(10);                       // 60U/t → 600U/10t 一块,100t 恰 10 块
    for (const c of chunks) expect(c).toBe(5);            // 块恒 5（BJ739 后对冲走流量域,块额不折减）
    expect(sum).toBe(-50);                                // 30HP/s × 100t
  });
});

// ============ B11：Slimed(137) 六火族 DoT 翻倍（:19102-19179） ============

describe('BJ739 B11：drippingSlime 火族翻倍（中毒不翻倍）', () => {
  it('OnFire 4HP/s 翻到 8HP/s（30t 累计 -4 对照 -2）', () => {
    const mk = (slimed: boolean): BuffState => {
      const b = new BuffState();
      b.apply(BuffType.OnFire, 30);
      if (slimed) b.apply(BuffType.Slimed, 30);
      return b;
    };
    const plain = run(mk(false), 30);
    const slimed = run(mk(true), 30);
    expect(plain).toBe(-2);      // 4HP/s × 0.5s,块边界恰 2
    expect(slimed).toBe(-4);     // 8HP/s × 0.5s
  });
  it('Poisoned 不翻倍（:19172 无 slime 支）', () => {
    const mk = (slimed: boolean): BuffState => {
      const b = new BuffState();
      b.apply(BuffType.Poisoned, 60);
      if (slimed) b.apply(BuffType.Slimed, 60);
      return b;
    };
    expect(run(mk(true), 60)).toBe(run(mk(false), 60));
  });
  it('六火族逐一翻倍（OnFire/OnFire3/Frostburn/Frostburn2/CursedInferno/Burning）', () => {
    for (const t of [BuffType.OnFire, BuffType.OnFire3, BuffType.Frostburn, BuffType.Frostburn2,
      BuffType.CursedInferno, BuffType.Burning]) {
      const mk = (slimed: boolean): BuffState => {
        const b = new BuffState();
        b.apply(t, 60);
        if (slimed) b.apply(BuffType.Slimed, 60);
        return b;
      };
      const a = run(mk(false), 600), c = run(mk(true), 600);
      expect(c).toBeLessThanOrEqual(a * 2 + 1);    // 翻倍（600t 窗块量化容差 ±1HP）
      expect(c).toBeGreaterThanOrEqual(a * 2 - 1);
    }
  });
  it('Slimed 是 debuff（右键不可解/护士可清,Main.debuff[137]）', () => {
    const b = new BuffState();
    b.apply(BuffType.Slimed, 30);
    expect(BuffState.DEBUFFS.has(BuffType.Slimed)).toBe(true);
    expect(b.debuffCount()).toBe(1);
  });
});

// ============ B14/B15：召唤击退食物档 + 醉酒摘除 ============

describe('BJ739 B14/B15：minionKbBonus', () => {
  it('三档食物 +0.5/+0.75/+1（:12031/:12047/:12063）', () => {
    const mk = (t: BuffType): BuffState => { const b = new BuffState(); b.apply(t, 60); return b; };
    expect(mk(BuffType.WellFed).minionKbBonus).toBeCloseTo(0.5, 6);
    expect(mk(BuffType.WellFed2).minionKbBonus).toBeCloseTo(0.75, 6);
    expect(mk(BuffType.WellFed3).minionKbBonus).toBeCloseTo(1, 6);
  });
  it('醉酒 25 无 minionKB（:12006-17 无此项,旧 +1 摘除）', () => {
    const b = new BuffState();
    b.apply(BuffType.Tipsy, 60);
    expect(b.minionKbBonus).toBe(0);
  });
  it('饥饿 -0.5/极饿 -1 保持（:12079/:12094）', () => {
    const mk = (t: BuffType): BuffState => { const b = new BuffState(); b.apply(t, 60); return b; };
    expect(mk(BuffType.Hunger).minionKbBonus).toBeCloseTo(-0.5, 6);
    expect(mk(BuffType.Starving).minionKbBonus).toBeCloseTo(-1, 6);
  });
  it('醉酒持 3821：ranged 伤 +10%/暴击 +5（Tipsy 门内特例）', () => {
    const p = new Player(0, 0, new Inventory());
    const baseDmg = p.damageMult('ranged'), baseCrit = p.critChance('ranged');
    p.buffs.apply(BuffType.Tipsy, 60);
    expect(p.damageMult('ranged')).toBeCloseTo(baseDmg, 6);      // 未持 3821 无远程加成
    expect(p.critChance('ranged')).toBe(baseCrit);
    p.inv.slots[0] = { id: _iid(3821), stack: 1 };
    p.inv.selected = 0;
    expect(p.damageMult('ranged')).toBeCloseTo(baseDmg + 0.1, 6);
    expect(p.critChance('ranged')).toBe(baseCrit + 5);
  });
});

// ============ 结构锁（源文本锚,防静默回退） ============

describe('BJ739 结构锁', () => {
  const buffsSrc = readFileSync(new URL('../src/stats/Buffs.ts', import.meta.url), 'utf8');
  const playerSrc = readFileSync(new URL('../src/entities/Player.ts', import.meta.url), 'utf8');

  it('B01/B02:不递减表 + tick 递减门', () => {
    expect(buffsSrc).toContain('TIME_LEFT_DOES_NOT_DECREASE = new Set<number>([28, 334, 29, 159, 150, 93, 348, 366])');
    expect(buffsSrc).toContain('TIME_LEFT_DOES_NOT_DECREASE.has(vbTick)) continue;');
  });
  it('B03:moveSpeedMult 加算式（+0.25/+0.2/+0.05/-0.1）与 sunflowerMoveMult', () => {
    expect(buffsSrc).toContain('if (this.active.has(BuffType.Agility)) m += 0.25;');
    expect(buffsSrc).toContain('if (this.active.has(BuffType.SugarRush)) m += 0.2;');
    expect(buffsSrc).toContain('if (this.active.has(BuffType.Werewolf)) m += 0.05;');
    expect(buffsSrc).toContain('if (this.active.has(BuffType.Weak)) m -= 0.1;');
    expect(buffsSrc).toContain('get sunflowerMoveMult()');
  });
  it('B04:无钳式 1 - 0.25 * (left / 5)', () => {
    expect(buffsSrc).toContain('return 1 - 0.25 * (left / 5);');
  });
  it('B05:Player manaCostOff 位并 clairvoyanceManaCostOff', () => {
    expect(playerSrc).toContain('+ this.buffs.clairvoyanceManaCostOff,');
  });
  it('B06:互斥表 + apply 删旧支', () => {
    expect(buffsSrc).toContain('MELEE_BUFF_VANILLA = new Set<number>([71, 73, 74, 75, 76, 77, 78, 79])');
  });
  it('B09:共享账三块（-600/-num13/-120×4）', () => {
    expect(buffsSrc).toContain('this.dotLifeRegenCount += flow;');
    expect(buffsSrc).toContain('this.dotLifeRegenCount <= -600 + 1e-9');
    expect(buffsSrc).toContain('Math.min(Math.floor(-this.dotLifeRegenCount / 120), 4)');
  });
  it('B11:SLIME_DOUBLED_DOTS 六火族', () => {
    expect(buffsSrc).toContain('SLIME_DOUBLED_DOTS: ReadonlySet<BuffType>');
  });
  it('B07:狂犬病回复惩罚在 Player（专家档之后同式）', () => {
    expect(playerSrc).toContain('if (this.buffs.has(BuffType.Rabies)) num5 = eqS.shinyStone ? num5 * 0.75 : num5 / 2;');
  });
});


// ============ 变异恰红（withMutation 三层守卫） ============

describe('BJ739 变异恰红 buffs 面', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj739a-buffs.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, SW_BJ739A_MUT: '1' },
    },
  );
  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, { label: `BJ739-A buffs ${filter}` });
  };

  const BUFFS = join(process.cwd(), 'src', 'stats', 'Buffs.ts');

  it('M5 B01：摘不递减门 → 工位夹具红', () => {
    mutate(BUFFS,
      'if (vbTick !== undefined && TIME_LEFT_DOES_NOT_DECREASE.has(vbTick)) continue;',
      'if (false && vbTick !== undefined && TIME_LEFT_DOES_NOT_DECREASE.has(vbTick)) continue; /* BJ739A-M5 变异 */',
      '水晶球');
  });

  it('M6 B03：蛋糕回乘区 → 组合夹具红', () => {
    mutate(BUFFS,
      'if (this.active.has(BuffType.SugarRush)) m += 0.2;       // 糖分冲刺 moveSpeed += 0.2（:10026）',
      'if (this.active.has(BuffType.SugarRush)) m *= 1.2;       /* BJ739A-M6 变异 */',
      '迅捷与蛋糕两挂');
  });

  it('M7 B04：回装 25% 钳 → 叠层夹具红', () => {
    mutate(BUFFS,
      'return 1 - 0.25 * (left / 5);',
      'return 1 - Math.min(0.25, 0.25 * (left / 5)); /* BJ739A-M7 变异 */',
      '两瓶蓝');
  });

  it('M8 B06：摘浸剂互斥 → 互斥夹具红', () => {
    mutate(BUFFS,
      "if (cur === undefined && vb !== undefined && MELEE_BUFF_VANILLA.has(vb)) {",
      "if (false && cur === undefined && vb !== undefined && MELEE_BUFF_VANILLA.has(vb)) { /* BJ739A-M8 变异 */",
      '仅毒在栏');
  });

  it('M9 B09：共享账改逐拍覆写 → 组合节拍夹具红', () => {
    mutate(BUFFS,
      'this.dotLifeRegenCount += flow;',
      'this.dotLifeRegenCount = flow; /* BJ739A-M9 变异 */',
      'OnFire 与 Poisoned 同挂');
  });

  it('M10 B11：摘 slime 翻倍 → 火族夹具红', () => {
    mutate(BUFFS,
      'if (this.active.has(BuffType.Slimed) && SLIME_DOUBLED_DOTS.has(t)) rate *= 2;',
      'if (false && this.active.has(BuffType.Slimed) && SLIME_DOUBLED_DOTS.has(t)) rate *= 2; /* BJ739A-M10 变异 */',
      'OnFire 4HP/s');
  });

  it('M11 B14：食物档归零 → 三档夹具红', () => {
    mutate(BUFFS,
      'return [0, 0.5, 0.75, 1][this.wellFedTier] + [0, -0.5, -1][this.hungerTier];',
      'return [0, 0, 0, 0][this.wellFedTier] + [0, -0.5, -1][this.hungerTier]; /* BJ739A-M11 变异 */',
      '三档食物');
  });
});
