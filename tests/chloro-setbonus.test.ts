// 叶绿水晶叶套装 SetBonus 全套回归（台账 L3 清偿批 2026-08-31）。
// 原版真值：Terarria1458（1457 同值）——
//   · 三件套四头变体授予 AddBuff(60,5)+setChlorophyte（ArmorSetBonuses.cs:128-146）
//     + !setChlorophyte → ClearBuff(60)（Player.cs:16436-16440）；
//   · 锚体 226 aiStyle42 索敌/冷却 40t（Projectile.cs:28188-28256）、上限=每玩家一只
//     （Player.cs buff60 效果分支 :11749-11766,只留最先扫到者）；
//   · 叶弹 227 一拍全路径扫掠（extraUpdates 181 子步/timeLeft 子步消耗 :16781-17346）、
//     落地伤 crystalLeafDamage=100/KK=10 static（Player.cs:821/:823）、pierce=1 flag3；
//   · on-hit 引援叶三门（Player.OnHit :6986-7040,1456 :6615-6640"三修门"）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { Game } from '../src/core/Game';
import { BuffType } from '../src/stats/Buffs';
import { ARMOR_SET_BONUSES } from '../src/data/vanillaArmorSets';
import {
  ChloroLeafCrystalAnchor, ChloroLeafShot,
  CHLORO_LEAF_DAMAGE, CHLORO_LEAF_KB, CHLORO_LEAF_SHOT_SIZE, getChaseResults,
} from '../src/entities/ChloroLeafCrystalProj';
import { damageVarRoll } from '../src/stats/DamageVar';
import { leafTrailInfoByte, leafSparkleCss } from '../src/fx/orchestraFx';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

afterEach(() => { vi.restoreAllMocks(); });

const mkWorld = (): World => {
  const w = new World(160, 160, 33, 'chloro-l3');
  for (let x = 12; x <= 140; x++) w.store.setTileSilent(x, 30, 1 /* dirt */);
  return w;
};

/** 全叶绿套佩戴（头变体参数化；默认近战头 Mask 1001） */
function equipChloro(p: Player, headVid = 1001): void {
  p.inv.armor[0] = { id: iid(headVid), stack: 1 };
  p.inv.armor[1] = { id: iid(1004), stack: 1 };
  p.inv.armor[2] = { id: iid(1005), stack: 1 };
}

/** 完整 player.fixedUpdate 桩（blue-r6 fakeHooks 同构 + 本批钩子） */
function fakeHooks(w: World, p?: Player, enemies: unknown[] = [], extra: Record<string, unknown> = {}) {
  return {
    world: w,
    player: p,
    enemies: () => enemies,
    critters: () => [],
    projectiles: [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: vi.fn(),
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    playSfxWav: vi.fn(),
    spawnDust: vi.fn(),
    showPickupLabel: () => {},
    recLog: () => {},
    achievements: undefined,
    scene: {},
    ...extra,
  } as never;
}

// ============================================================
// ① 三件套检测（四头变体 → equipStats.crystalLeaf / endurance 面）
// ============================================================
describe('叶绿三件套检测（ArmorSetBonuses.cs:128-146 四头变体 × 胸 1004(bs51)×腿 1005(ls47)）', () => {
  it.each([1001, 1002, 1003, 5524])('头 %i 组合 → crystalLeaf=true（hs78/79/80/283 | bs51 | ls47）', (headVid) => {
    const w = mkWorld();
    const p = new Player(40 * 16, 27 * 16, new Inventory());
    equipChloro(p, headVid as number);
    expect(p.equipStats.crystalLeaf).toBe(true);
  });

  it('缺腿件 → 不触发（QueryCount Complete 门）', () => {
    const w = mkWorld();
    const p = new Player(40 * 16, 27 * 16, new Inventory());
    p.inv.armor[0] = { id: iid(1002), stack: 1 };
    p.inv.armor[1] = { id: iid(1004), stack: 1 };
    expect(p.equipStats.crystalLeaf).toBe(false);
  });

  it('近战头 Mask 1001 额外 endurance += 0.05（ArmorSetBonuses.cs:131 ChlorophyteMelee）', () => {
    const w = mkWorld();
    const base = new Player(40 * 16, 27 * 16, new Inventory());
    equipChloro(base, 1002);
    const endBase = base.equipStats.enduranceEq;
    const p = new Player(40 * 16, 27 * 16, new Inventory());
    equipChloro(p, 1001);
    expect(p.equipStats.enduranceEq).toBeCloseTo(endBase + 0.05, 6);
    expect(p.equipStats.crystalLeaf).toBe(true);
  });

  it('表键自检：四条目 crystalLeaf 且召唤头随从面由 SUMMON_SET 承载（不重复建模）', () => {
    expect(ARMOR_SET_BONUSES['78|51|47']?.crystalLeaf).toBe(true);
    expect(ARMOR_SET_BONUSES['79|51|47']?.crystalLeaf).toBe(true);
    expect(ARMOR_SET_BONUSES['80|51|47']?.crystalLeaf).toBe(true);
    expect(ARMOR_SET_BONUSES['283|51|47']?.crystalLeaf).toBe(true);
    expect((ARMOR_SET_BONUSES['78|51|47'] as { endurance?: number }).endurance).toBeCloseTo(0.05);
  });
});

// ============================================================
// ② buff 维护（AddBuff(60,5) 每 tick 重钉 / 卸套 ClearBuff）
// ============================================================
describe('BuffType.LeafCrystal 授予/清除对账（Player.cs:16436-16440 + ArmorSetBonuses Effect）', () => {
  it('套装在场 → fixedUpdate 后持有 buff；卸下腿件 → 同拍清除', () => {
    const w = mkWorld();
    const p = new Player(40 * 16, 27 * 16, new Inventory());
    equipChloro(p, 1002);
    const hooks = fakeHooks(w, p);
    p.fixedUpdate(1 / 60, hooks);
    expect(p.buffs.has(BuffType.LeafCrystal)).toBe(true);
    // 卸套：下一次 fixedUpdate 的 else 支 remove()（同拍生效,等同 ClearBuff(60)）
    p.inv.armor[0] = null;
    p.inv.armor[1] = null;
    p.inv.armor[2] = null;
    p.fixedUpdate(1 / 60, hooks);
    expect(p.buffs.has(BuffType.LeafCrystal)).toBe(false);
  });

  it('buff 在场时驱动锚体对账钩（GameHooks.updateChloroCrystalAnchor）', () => {
    const w = mkWorld();
    const p = new Player(40 * 16, 27 * 16, new Inventory());
    equipChloro(p, 1002);
    const reconcile = vi.fn();
    p.fixedUpdate(1 / 60, fakeHooks(w, p, [], { updateChloroCrystalAnchor: reconcile }));
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// ③ 锚体对账：全场单锚+最旧保留（Player.cs:11752-11763 flag29 怪癖）
// ============================================================
describe('锚体上限替换（全桶 type==226 只留最先扫到的一只,多余 Kill）', () => {
  function anchorStub(): Game {
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    g.player = new Player(40 * 16, 27 * 16, new Inventory());
    const projArr: unknown[] = [];
    g.entities = {
      projectiles: projArr,
      add: (e: unknown) => { projArr.push(e); return e; },
    };
    return g as unknown as Game;
  }

  it('多锚并存 → 最旧者存活、其余标记 dead（桶序=index 升序）', () => {
    const g = anchorStub() as unknown as { entities: { projectiles: unknown[] }; player: Player };
    const a = new ChloroLeafCrystalAnchor();
    const b = new ChloroLeafCrystalAnchor();
    const c = new ChloroLeafCrystalAnchor();
    g.entities.projectiles.push(a, b, c);
    (g as unknown as { updateChloroCrystalAnchor(): void }).updateChloroCrystalAnchor();
    expect(a.dead).toBe(false);          // 最先扫到 → 保留
    expect(b.dead).toBe(true);           // 多余者 Kill
    expect(c.dead).toBe(true);
  });

  it('无存活锚且玩家存活 → 缺位补生恰一只并钉到头顶 −60px（aiStyle42 :28193-95）', () => {
    const g = anchorStub() as unknown as { entities: { projectiles: unknown[] }; player: Player; updateChloroCrystalAnchor(): void };
    g.updateChloroCrystalAnchor();
    const spawned = g.entities.projectiles.filter(
      (q) => q instanceof ChloroLeafCrystalAnchor && !(q as ChloroLeafCrystalAnchor).dead,
    ) as ChloroLeafCrystalAnchor[];
    expect(spawned.length).toBe(1);
    const p = g.player;
    expect(spawned[0].cx - (p.cx)).toBeLessThanOrEqual(11 + 1e-6);
    expect(Math.abs(spawned[0].cy - (p.cy - 60))).toBeLessThanOrEqual(21 + 1e-6);
    g.updateChloroCrystalAnchor();       // 再跑一拍不重复生
    expect(g.entities.projectiles.length).toBe(1);
  });
});

// ============================================================
// ④ 被动出手节奏（cd 40t 窗内静默;到期恢复）
// ============================================================
describe('锚体被动发射节奏（Projectile.cs:28254 cooldown=40 + Player :25664-67 递减）', () => {
  function rig() {
    const w = mkWorld();
    const p = new Player(40 * 16, 26 * 16, new Inventory());
    equipChloro(p, 1002);                              // 穿套装→buff 维护每拍续期
    p.buffs.apply(BuffType.LeafCrystal, 300);          // 首拍即有（穿戴稳态模拟）
    const enemyBucket: unknown[] = [];                 // 敌怪面延迟接入（先沉降）
    const shots: Array<{ x: number; y: number; vx: number; vy: number }> = [];
    const spawnShot = vi.fn((x: number, y: number): void => { void x; void y; });
    const hooks = fakeHooks(w, p, enemyBucket, {
      spawnChloroLeafShot: (x: number, y: number, vx: number, vy: number) => { shots.push({ x, y, vx, vy }); },
      updateChloroCrystalAnchor: () => {},              // 对账另测——此处手动持锚
    }) as never;
    const anchor = new ChloroLeafCrystalAnchor();
    /** 沉降：无敌怪空跑让玩家落稳（canHit 对盒固体重叠敏感） */
    const settle = (): void => {
      for (let i = 0; i < 45; i++) {
        p.fixedUpdate(1 / 60, hooks);
        anchor.fixedUpdate(1 / 60, hooks);
      }
    };
    /** 沉降后布置敌怪到锚体右侧 offset px 的同带盒 */
    const addEnemyNear = (offsetX: number, vid = 21): Record<string, unknown> => {
      const z = { x: anchor.cx + offsetX, y: anchor.cy - 21, w: 24, h: 42,
        id: 900 + enemyBucket.length, dead: false, vanillaId: vid,
        vx: 0, vy: 0, hp: 60, def: { lifeMax: 45 }, hurt: vi.fn(() => true) };
      enemyBucket.push(z);
      return z;
    };
    return { p, w, hooks, anchor, shots, settle, addEnemyNear, enemyBucket };
  }

  function tickOnce(t: ReturnType<typeof rig>): void {
    t.p.fixedUpdate(1 / 60, t.hooks);                  // 引擎序:p 先递减冷却
    t.anchor.fixedUpdate(1 / 60, t.hooks);             // 锚体后索敌出手
  }

  it('目标同带可及→出手;随后 39 拍静默、40t 周期重开', () => {
    const t = rig();
    t.settle();
    const z = t.addEnemyNear(96);                      // 近距真目标
    expect(t.shots.length).toBe(0);                    // 未出手过
    tickOnce(t);
    expect(t.shots.length).toBe(1);                    // cd==0 → 出手
    expect(t.p.crystalLeafCooldown).toBe(40);          // :28254
    expect(z.hurt).not.toHaveBeenCalled();             // 出手≠命中（叶另测）
    let secondAt = -1;
    for (let i = 2; i <= 46 && secondAt < 0; i++) {
      tickOnce(t);
      if (t.shots.length === 2) secondAt = i;
    }
    // 第一发后 cd=40，递减 39 拍仍 >0 → 第 41 拍窗口重开（两拍序差容差 +1）
    expect(secondAt).toBeGreaterThanOrEqual(39);
    expect(secondAt).toBeLessThanOrEqual(42);
  });

  it('索敌门：仅 ≥700 远目标+训练假人 488 时永不触发（CanBeChasedBy 排除族）', () => {
    const t = rig();
    t.settle();
    const far = t.addEnemyNear(800) as unknown as Record<string, unknown>;   // 曼哈顿 ≈800>700
    const dummy = t.addEnemyNear(96, 488) as unknown as Record<string, unknown>; // immortal 族
    dummy.vanillaId = 488;
    for (let i = 0; i < 45; i++) tickOnce(t);          // 覆盖两个完整周期窗
    expect(t.shots.length).toBe(0);                    // 全程无出手
    expect(far.x).toBeGreaterThan(t.anchor.cx + 700);  // 自检：远距仍在场外
  });
});

// ============================================================
// ⑤ 弹伤与单发语义（static 100/10 直传;pierce=1 flag3 免疫豁免+命中即亡）
// ============================================================
describe('叶弹 227 结算面（dealContacts 单源;pierce=1;sweep 一拍全路径）', () => {
  it('重叠敌怪一拍结算一次,伤=damageVarRoll(100) 桶,kb=±10,pierce 形参=1,随后 dead+Kill 尘/音', () => {
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const victim = {
      x: 400, y: 400, w: 24, h: 42, id: 777, dead: false, vanillaId: 21,
      hurt: vi.fn(() => true),
    };
    const shot = new ChloroLeafShot(412, 421, 12, 0);   // 出生即与盒相交
    const g = {
      enemies: () => [victim],
      world: mkWorld(),
      player: new Player(200, 500, new Inventory()),
      spawnDust: vi.fn(),
      playSfxWav: vi.fn(),
      bannerNpcActive: () => false,
      broadcastParticleOrchestra: vi.fn(),
      spawnParticles: vi.fn(),
    } as never;
    shot.fixedUpdate(1 / 60, g);
    expect(victim.hurt).toHaveBeenCalledTimes(1);
    const args = (victim.hurt as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const expectedDmg = Math.max(1, Math.round(damageVarRoll(CHLORO_LEAF_DAMAGE, 0)));
    expect(args[0]).toBe(expectedDmg);                  // DamageVar/banter/crit 链终端值
    const expKb = Math.sign((victim.x + victim.w / 2) - (400 + CHLORO_LEAF_KB / 2 + CHLORO_LEAF_KB - 13))
      || 1;
    void expKb;
    const kbVal = args[1] as number;
    expect(Math.abs(kbVal)).toBe(CHLORO_LEAF_KB);       // 归一击退幅值=10
    expect(kbVal).toBe(
      (Math.sign((victim.x + victim.w / 2) - (412 + 14 / 2)) || 1) * CHLORO_LEAF_KB);
    expect(args[0] as number).toBe(expectedDmg);        // DamageVar/banner/crit 链终端值
    expect(args[6] as number).toBe(1);                  // pierce=1 flag3
    expect(args[9] as number).toBe(227);                // srcProjId → ON_HIT_EXCLUDED 断链
    expect(args[6]).toBe(1);                            // pierce=1 flag3
    expect(args[9]).toBe(227);                          // srcProjId → ON_HIT_EXCLUDED 断链
    expect(shot.dead).toBe(true);                       // penetrate=1 命中即亡
    expect(randSpy).toHaveBeenCalled();
  });

  it('未命中路径：timeLeft=180 于 181 子步内耗尽 → 一拍 Kill（Kill 尘×15+音,BJ692 勘正后锚）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const g = {
      enemies: () => [],
      world: mkWorld(),
      player: new Player(200, 500, new Inventory()),
      spawnDust: vi.fn(),
      playSfx: vi.fn(),
      bannerNpcActive: () => false,
      broadcastParticleOrchestra: vi.fn(),
      spawnParticles: vi.fn(),
    } as never;
    // ★BJ708-G28 夹具勘正：旧 cx=5000 在 160 格（2560px）世界外 → 首子步 :347 边界
    // 静默出界（无 killWithFx）,旧断言实际锚住的是【出生拍】音——BJ692 修码前出生
    // :28264 与消亡 :76022 两处同为 'Item_6' 故绿。归位标题语义：界内反向飞满子步,
    // timeLeft 180 恰耗尽（179 子步 Kill,x 终位 ≈245 仍界内）。
    const shot = new ChloroLeafShot(2400, 500, -12, 0); // 反向飞行,全程界内
    shot.fixedUpdate(1 / 60, g);
    expect(shot.dead).toBe(true);                       // 寿命尽自然 Kill（非边界静默出界）
    // ★BJ692 复诊勘误（2026-10-17;本测试漏改=BJ708-A 起预先红根源）：227 出生
    // :28264 与消亡 :76022 两处均 legacy PlaySound(6,x,y)=【Grass 声库】
    // （LegacySoundPlayer.cs case 6 SoundGrass,±0.30 随机音调）→ 仓内映射
    // playSfx('chop',Sfx.ts chop:['Grass']+put[-30,30] 同款方差);旧 'Item_6'=
    // 魔镜回城采样=误译（用户实报「穿叶绿套攻击出魔镜音」根因）。
    const playSfx = (g as unknown as { playSfx: ReturnType<typeof vi.fn> }).playSfx;
    const sfxCalls = playSfx.mock.calls as unknown[][];
    expect(sfxCalls.length).toBe(2);                     // 出生拍 + Kill 拍各一
    expect(sfxCalls.every((c) => c[0] === 'chop' && c[1] === 1)).toBe(true);   // 两拍均 Grass 声库（单杀拍回退 'Item_6' 恰红）
    expect(playSfx).toHaveBeenCalledWith('chop', 1, expect.anything(), expect.anything());
    // Kill 尘 15×d157（:76024-76031 noGravity/scale1.5/vel+=oldVel×NextFloat）+
    // 出生尘 8×d157（:28265-28274）——按 type=157 计数锁两拍合计
    const dustCalls = ((g as unknown as { spawnDust: ReturnType<typeof vi.fn> }).spawnDust)
      .mock.calls as unknown[][];
    expect(dustCalls.filter((c) => c[4] === 157).length).toBe(8 + 15);
  });
});

// ============================================================
// ⑥ on-hit 引援叶三门（Player.OnHit :6986-7040）
// ============================================================
describe('chloroOnHitLeafStrike 三门+桶序怪癖（Game 端 Player.OnHit 尾段同构）', () => {
  function gameStub(crystalLeaf: boolean) {
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    const p = new Player(40 * 16, 26 * 16, new Inventory());
    // 走【真实装备路径】翻转 equipStats.crystalLeaf（记忆化对象为只读快照,不直改）
    if (crystalLeaf) {
      p.inv.armor[0] = { id: iid(1002), stack: 1 };    // 叶绿头盔(hs79)
      p.inv.armor[1] = { id: iid(1004), stack: 1 };    // 胸(bs51)
      p.inv.armor[2] = { id: iid(1005), stack: 1 };    // 腿(ls47)
    }
    g.player = p;
    const projArr: unknown[] = [];
    g.entities = { projectiles: projArr, add: (e: unknown) => { projArr.push(e); return e; } };
    const fired: Array<{ x: number; y: number }> = [];
    g.spawnChloroLeafShot = (x: number, y: number): void => { fired.push({ x, y }); };
    const chloroOnHitLeafStrike = (g as unknown as { chloroOnHitLeafStrike: (v: unknown) => void }).chloroOnHitLeafStrike;
    return { g: g as unknown as { chloroOnHitLeafStrike: (v: unknown) => void }, p, projArr, fired,
      chloroOnHitLeafStrike };
  }

  const victim = {
    x: 700, y: 380, w: 24, h: 42, id: 555, dead: false, vanillaId: 21, vx: 0, vy: 0,
  };

  it('①锚在场 ≤1200 → petalTimer=50 + 从锚 Center.X−4 出手一发', () => {
    const { g, p, projArr, fired } = gameStub(true);
    const anchor = new ChloroLeafCrystalAnchor();
    anchor.pinTo(p);                                   // 同点出生,距离 0
    projArr.push(anchor);
    g.chloroOnHitLeafStrike(victim);
    expect(fired.length).toBe(1);                      // break 单发（:7033）
    expect(fired[0].x).toBe(anchor.cx - 4);            // Center.X−4f（:7029）
    expect(fired[0].y).toBe(anchor.cy);
    expect(p.petalTimer).toBe(50);                     // :7009
  });

  it('②petalTimer!=0 早退（花瓣/叶绿共享计时,:6986）', () => {
    const { g, p, projArr, fired } = gameStub(true);
    p.petalTimer = 20;
    const anchor = new ChloroLeafCrystalAnchor();
    anchor.pinTo(p);
    projArr.push(anchor);
    g.chloroOnHitLeafStrike(victim);
    expect(fired.length).toBe(0);
    expect(p.petalTimer).toBe(20);                     // 早退不重钉
  });

  it('③序依赖 break 怪癖：首个 >1200 锚截断扫描,更近锚不再获机会（:7006-08）', () => {
    const { g, p, projArr, fired } = gameStub(true);
    const farFirst = new ChloroLeafCrystalAnchor();    // 桶首=远锚
    farFirst.x = p.cx + 1300;
    farFirst.y = p.cy - 60;
    projArr.push(farFirst);
    const nearSecond = new ChloroLeafCrystalAnchor();  // 更近但不获机会
    nearSecond.pinTo(p);
    projArr.push(nearSecond);
    g.chloroOnHitLeafStrike(victim);
    expect(fired.length).toBe(0);
    expect(p.petalTimer).toBe(0);                      // 未进入赋位段
  });

  it('④非 crystalLeaf 直退（Gate ① 前半）', () => {
    const { g, p, projArr, fired } = gameStub(false);
    const anchor = new ChloroLeafCrystalAnchor();
    anchor.pinTo(p);
    projArr.push(anchor);
    g.chloroOnHitLeafStrike(victim);
    expect(fired.length).toBe(0);
    expect(p.petalTimer).toBe(0);
  });
});

// ============================================================
// ⑦ 追及解算数值锚（Utils.GetChaseResults/SolveQuadratic 移植保真）
// ============================================================
describe('getChaseResults 数值锚（Utils.cs:651-692）', () => {
  it('静止目标：追及时间=dist/speed,方向=直指向量,speed 量纲保持', () => {
    const r = getChaseResults(0, 0, 2160, 432, 0, 0, 0);
    expect(r.happens).toBe(true);
    expect(r.time).toBeCloseTo(432 / 2160, 8);
    expect(r.vx).toBeCloseTo(2160, 6);                 // (拦截点−源)/T
    expect(r.vy).toBeCloseTo(0, 8);
  });

  it('移动目标按匀速追及二叉根取小正值', () => {
    const r = getChaseResults(0, 0, 2160, 432, 0, 8, 0); // 目标向 +x 逃逸
    expect(r.happens).toBe(true);
    expect(r.time).toBeGreaterThan(432 / 2160);        // 逃逸拉长追及时间
    expect(r.vx).toBeGreaterThan(0);
  });

  it('重合特例（InterceptionHappens=true + ChaserVelocity Zero,:656-664）', () => {
    const r = getChaseResults(10, 10, 2160, 10, 10, 3, 4);
    expect(r).toEqual({ happens: true, time: 0, vx: 0, vy: 0 });
  });
});

// ============================================================
// ⑧ δA 复查批清偿断言（2026-08-31 蓝队单条群）
//    ① 幻影暴击面 ② 首命中即截断 ③ type17 三段式载荷锚
//    ④ 出生中心=锚+(3,7) ⑤ 边界原值判定（疑② 蠕虫段体粒度=引擎层备案,无运行时锚）
// ============================================================
describe('δA 清偿批：叶弹 227 暴击/穿透/坐标/边界/色链（Terarria1458 对账）', () => {
  /** 无敌怪/可注入敌怪桶最小 hooks（broadcast/spawnParticles 面可观测） */
  function shotHooks(w?: World, enemies: unknown[] = []): Record<string, unknown> & {
    broadcastParticleOrchestra: ReturnType<typeof vi.fn>;
  } {
    return {
      enemies: () => enemies,
      world: w ?? mkWorld(),
      player: new Player(200, 500, new Inventory()),
      spawnDust: vi.fn(),
      playSfxWav: vi.fn(),
      bannerNpcActive: () => false,
      broadcastParticleOrchestra: vi.fn(),
      spawnParticles: vi.fn(),
    };
  }

  it('δA① critChance===0 永不暴击——随机掷恒 0（原 0.04 必暴面）不得出现 crit=true（P.cs:12932-12945 三旗掷+SetDefaults :3126-3137 无类别旗）', () => {
    const shot = new ChloroLeafShot(400, 400, 12, 0);
    expect(shot.critChance).toBe(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.0);          // 任何未撤的 crit 面都会命中掷
    const victim = { x: 388, y: 388, w: 24, h: 42, id: 777, dead: false,
      vanillaId: 21, hurt: vi.fn(() => true) };
    const g = shotHooks(undefined, [victim]);
    shot.fixedUpdate(1 / 60, g as never);
    const args = victim.hurt.mock.calls[0] as unknown[];
    expect(args[5]).toBe(false);                            // crit 形参恒 false
    const expDmg = Math.max(1, Math.round(damageVarRoll(CHLORO_LEAF_DAMAGE, 0)));
    expect(args[0]).toBe(expDmg);                           // ×2 暴击乘区绝不并入
  });

  it('δA② 重叠双怪一拍只伤桶序首个（keepIterating=false 截断映射,Damage_PVE_Inner :14186-14201/:12592）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const v1 = { x: 400, y: 414, w: 24, h: 42, id: 771, dead: false, vanillaId: 21, hurt: vi.fn(() => true) };
    const v2 = { x: 408, y: 414, w: 24, h: 42, id: 772, dead: false, vanillaId: 21, hurt: vi.fn(() => true) };
    const g = shotHooks(undefined, [v1, v2]);
    const shot = new ChloroLeafShot(412, 421, 0, 0);        // 盒 [405..419]×[414..428]
    // 自检:两怪确实都与弹盒相交（旧行为会同拍连吃两份伤害）
    const overlap = (v: typeof v1): boolean =>
      shot.x < v.x + v.w && shot.x + shot.w > v.x && shot.y < v.y + v.h && shot.y + shot.h > v.y;
    expect(overlap(v1)).toBe(true);
    expect(overlap(v2)).toBe(true);
    shot.fixedUpdate(1 / 60, g as never);
    expect(v1.hurt).toHaveBeenCalledTimes(1);               // 桶序首个受击
    expect(v2.hurt).not.toHaveBeenCalled();                 // 截断后不遍历后继敌怪
    expect(shot.dead).toBe(true);
  });

  it('δA③ type17 载荷三段式数值锚（P.cs:28282-84 全链→(byte) 截断;消费端 :3139-46 还原）', () => {
    // 数值锚（wrap 多圈:(−6×0.85)/180 ≈ 每 35.3t 循环一周）
    expect(leafTrailInfoByte(180)).toBe(83);   // 出生 num330=0.33 纯绿带（round 会得 84）
    expect(leafTrailInfoByte(150)).toBe(77);   // round 会得 78
    expect(leafTrailInfoByte(120)).toBe(55);   // remap 带尾蓝段（round 会得 56）
    expect(leafTrailInfoByte(90)).toBe(66);    // num330=0.78 → Red 压满 → LimeGreen/Gold 混色
    expect(leafTrailInfoByte(45)).toBe(69);
    expect(leafTrailInfoByte(15)).toBe(58);
    // 广播载荷与本地渲染同一字节面（两端一致=bug③ 口径）;消费端终色直值：
    expect(leafSparkleCss(leafTrailInfoByte(180))).toBe('rgb(18,254,0)');
    expect(leafSparkleCss(66)).toBe('rgb(146,246,0)');
    expect(leafSparkleCss(55)).toBe('rgb(206,241,0)');
  });

  it('δA③b trailStep 广播即该字节——type17 四站采样全对拍（u∈{0,45,90,135}）', () => {
    const g = shotHooks();
    const shot = new ChloroLeafShot(1200, 1280, 0, 0);      // 世界中腹零速 → 全寿命走完
    shot.fixedUpdate(1 / 60, g as never);
    const calls = g.broadcastParticleOrchestra.mock.calls.filter((c: unknown[]) => c[0] === 17);
    expect(calls.length).toBe(4);
    for (let k = 0; k < 4; k++) {
      expect(calls[k][5]).toBe(leafTrailInfoByte(180 - 45 * k));   // trailStep 先于子步递减
    }
    expect(calls[0][5]).toBe(83);                           // 出生字节直面锚
  });

  it('δA④ spawnChloroLeafShot 形参=NewProjectile position(top-left)（:28253 Center.X−4f）→ 实际中心=top-left+(7,7)', () => {
    const g = Object.create(Game.prototype) as unknown as {
      player: Player;
      entities: { add: (e: unknown) => void };
      spawnChloroLeafShot: (this: unknown, x: number, y: number, vx: number, vy: number) => void;
    };
    g.player = new Player(200, 300, new Inventory());
    const added: unknown[] = [];
    g.entities = { add: (e: unknown): void => { added.push(e); } };
    (g.spawnChloroLeafShot as (x: number, y: number, vx: number, vy: number) => void)
      .call(g, 400, 300, 12, 3);
    const s = added[0] as ChloroLeafShot;
    expect(s.cx).toBe(400 + CHLORO_LEAF_SHOT_SIZE / 2);     // 锚 center+(+3,+7)
    expect(s.cy).toBe(300 + CHLORO_LEAF_SHOT_SIZE / 2);
    expect(s.damage).toBe(CHLORO_LEAF_DAMAGE);
    expect(s.knockback).toBe(CHLORO_LEAF_KB);
    expect(s.projId).toBe(227);
  });

  it('δA⑤ 世界边界原值判定（leftWorld=0/rightWorld=tiles×16,P.cs:16787+Main.cs:1080-1086）——旧 ±16px 内缩带内全程存活', () => {
    // 左缘贴边 8px（<16 内缩带;旧门 x<=16 即刻截杀 → lifeT 冻 180 且零广播）
    const gL = shotHooks();
    const left = new ChloroLeafShot(CHLORO_LEAF_SHOT_SIZE / 2 + 8, 1280, 0, 0);
    left.fixedUpdate(1 / 60, gL as never);
    expect(left.dead).toBe(true);
    expect(left.lifeT).toBeLessThanOrEqual(0);              // 寿命耗尽路径=边界从未触发
    expect(gL.broadcastParticleOrchestra.mock.calls.filter((c: unknown[]) => c[0] === 17).length).toBe(4);
    // 右缘对称:x+w 距 rightWorld 8px 同样全程存活
    const w = mkWorld();
    const twPx = w.store.w * 16;
    const gR = shotHooks(w);
    const right = new ChloroLeafShot(twPx - CHLORO_LEAF_SHOT_SIZE / 2 - 8, 1280, 0, 0);
    right.fixedUpdate(1 / 60, gR as never);
    expect(right.dead).toBe(true);
    expect(right.lifeT).toBeLessThanOrEqual(0);
    // 出界仍必须死（新门原值判定生效）：left edge 逐子步越界于第 3 子步截杀
    const gOut = shotHooks();
    const out = new ChloroLeafShot(30, 1280, -12, 0);
    out.fixedUpdate(1 / 60, gOut as never);
    expect(out.dead).toBe(true);
    expect(out.lifeT).toBeLessThanOrEqual(178);             // 旧门会在第 2 子步截杀(lifeT=179)
  });
});
