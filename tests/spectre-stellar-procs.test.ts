// 弹 661 黑爆 Colliding 重载 / 幽灵伤害头 ghostHurt 全链 / 星璇之音减伤批回归
// （2026-08-31 对齐批③④⑤⑥；标杆 Terarria1457/Terraria/Projectile.cs）
import { describe, it, expect, vi } from 'vitest';   // ★BJ741 R19-1：vi=Math.random 0.5 中性档（856 DV 接入随刀）
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { TILE_BY_KEY } from '../src/data/tiles';
import { Arrow } from '../src/entities/Arrow';
import { canHit, canHitLine } from '../src/physics/LineOfSight';
import {
  SpectreSoulProj, ghostHurtOnHit, playerHasGhostHurt, spectreVictimEligible,
  SPECTRE_NO_GHOST_HEAL, GHOST_BUDGET_CAP,
  _resetGhostBudgetForTest, ghostBudgetPeek,
} from '../src/entities/SpectreSoulProj';
import {
  SparkleGuitarProj, modifyStellarTuneDamage, computeStellarTuneShot,
  stellarTuneCritChance, catmullRom, nextVector2Circular, collectStellarTargets,
  sparkleGuitarTargetRect,
} from '../src/entities/SparkleGuitarProj';
import type { GameHooks } from '../src/entities/types';

/** 种子化 rng（分布形状断言用,mulberry32——只求可重复,不追求密码学性） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 220, H = 160;
function makeStore(): TileStore {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 120; y < H; y++) store.setTile(x, y, 1);
  return store;
}
interface HurtSpy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; hits: number[]; lastStrikeDealt?: number; kxs: number[];
}
function mkEnemy(id: number, x: number, y: number, w = 18, h = 40): HurtSpy & {
  hurt: (...a: unknown[]) => boolean;
} {
  const e: HurtSpy = {
    id, x, y, w, h, dead: false, hits: [], kxs: [],
    cx: x + w / 2, cy: y + h / 2,
  };
  return Object.assign(e, {
    hurt(dmg: number, kx?: number): boolean {
      e.hits.push(dmg); e.lastStrikeDealt = dmg;
      e.kxs.push(kx ?? 0);
      return true;
    },
  }) as never;
}
function makeHooks(enemies: unknown[], store = makeStore(),
  player?: Player): { hooks: GameHooks; added: unknown[]; store: TileStore;
    cutCalls: Array<{ ix: number; iy: number }>; advanceTick: (n: number) => void;
    winPeek: (id: number) => number | undefined } {
  const pl = player ?? new Player(30 * 16, 100 * 16, new Inventory());
  const added: unknown[] = [];
  // ★F3/F6 测试面：cutTile 记录 + immune[owner] 窗（与 Game.noteNpcPlayerImmune/
  //   meleeNpcImmuneGateOf 同构的最小 Map/tick 桩）
  const cutCalls: Array<{ ix: number; iy: number }> = [];
  const winMap = new Map<number, number>();
  let simTick = 0;
  const hooks = {
    world: { store, flags: { hardMode: false } } as never,
    player: pl as never,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: (ix: number, iy: number) => { cutCalls.push({ ix, iy }); },
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    noteNpcPlayerImmune: (id: number, t: number) => {
      if (t > 0) winMap.set(id, simTick + t);
      else if (t === 0) winMap.delete(id);
    },
    meleeNpcImmuneGateOf: (id: number): boolean => {
      const exp = winMap.get(id);
      if (exp !== undefined && exp <= simTick) { winMap.delete(id); return true; }
      return exp === undefined ? true : false;
    },
  };
  const anyHooks = hooks as unknown as Record<string, unknown>;
  anyHooks.entities = { add: (e: unknown) => { added.push(e); } };
  const advanceTick = (n: number) => { simTick += n; };
  return {
    hooks: hooks as unknown as GameHooks, added, store, cutCalls, advanceTick,
    winPeek: (id: number) => winMap.get(id),
  };
}

// ---- 批③：弹 661 Colliding（Projectile.cs:15877-15883,★F8 校准）----
describe('661 黑爆命中管线：dist>500 或 CanHitLine 断 ⇒ 不结算', () => {
  it('盒相交但敌心距 >500(超大 boss 段形态)→ 该拍不判定命中', () => {
    // 弹 10×10 放在原点；敌宽 1200 从弹右侧遮到远处——中心距 590>500
    const big = mkEnemy(1, 12, -20, 1200, 40);
    const { hooks } = makeHooks([big]);
    const a = new Arrow(-5, -5, 0.01, 0, 50, 2, 661);
    a.fixedUpdate(1 / 60, hooks);
    expect(big.hits).toEqual([]);
  });
  it('近距小目标正常结算（对照臂）', () => {
    const near = mkEnemy(1, 4, -14, 18, 40);
    const { hooks } = makeHooks([near]);
    const a = new Arrow(-8, -8, 0.01, 0, 50, 2, 661);
    a.fixedUpdate(1 / 60, hooks);
    expect(near.hits.length).toBeGreaterThan(0);
  });
  it('500 内但隔墙视线断 → 不结算(CanHitLine 点对 :15891)', () => {
    const near = mkEnemy(1, 1300, 1720, 18, 40);   // 弹右 300px、地面上方
    const { hooks, store } = makeHooks([near]);
    // 石墙整列立在弹与敌之间的列位（全高覆盖,不依赖世界外负行）
    for (let ty = 60; ty <= 110; ty++) {
      store.setTile(74, ty, TILE_BY_KEY['stone']);
      store.setTile(75, ty, TILE_BY_KEY['stone']);
    }
    const a = new Arrow(1000 - 5, 1734 - 20, 0.01, 0, 50, 2, 661);
    a.fixedUpdate(1 / 60, hooks);
    expect(near.hits).toEqual([]);
  });
});

// ---- 批⑥：Projectile.ghostHurt（:12021-12070）+ 触发门（:13875/:13712）----
describe('ghostHurtOnHit 门族', () => {
  const victimBase = { x: 200, y: 200, w: 18, h: 40, cx: 209, cy: 220 };
  const srcBase = (over: object = {}) => ({
    magic: true, projDamage: 80, projX: 205, projY: 210, projW: 6, projH: 6,
    ownerCx: 100, ownerCy: 300, ...over,
  });

  function worldWith(chasers: unknown[], ghostHurtSet: boolean) {
    _resetGhostBudgetForTest(0);
    // equipStats 为只读 getter——用裸形玩家对象注旗（proc 本体不读 player）
    const player = ghostHurtSet
      ? { dead: false, cx: 480, cy: 1600,
          equipStats: { setBonus: { ghostHurt: true } } } as never as Player
      : new Player(30 * 16, 100 * 16, new Inventory());
    return makeHooks(chasers, undefined, player);
  }

  it('玩家无 SpectreDamage 套装旗标 ⇒ 整链不触发(playerHasGhostHurt)', () => {
    const hooksA = makeHooks([], undefined, new Player(30 * 16, 100 * 16, new Inventory())).hooks;
    expect(playerHasGhostHurt(hooksA.player)).toBe(false);
    const hooksB = worldWith([], true).hooks;
    expect(playerHasGhostHurt(hooksB.player)).toBe(true);
  });
  it('victim.canGhostHeal=false 族(384/387/388/523)门(:13875 canGhostHeal)', () => {
    for (const vid of SPECTRE_NO_GHOST_HEAL) expect(spectreVictimEligible(vid)).toBe(false);
    expect(spectreVictimEligible(15)).toBe(true);          // 默认 true(NPC.cs:6270)
    expect(spectreVictimEligible(null)).toBe(true);        // 自造怪缺省放行由调用端兜
  });
  it('非魔法弹 / 基伤≤0 / 防后实扣≤1 / lifeMax≤5 四门各自拦截(:12022-26,:13712)', () => {
    const ghostOn = (() => { const h = worldWith([mkEnemy(9, 400, 180)], true); return h.hooks; })();
    let calls = 0;
    ghostHurtOnHit(ghostOn, srcBase({ magic: false }), { ...victimBase, dealt: 70, lifeMax: 100 });   // !magic
    ghostHurtOnHit(ghostOn, srcBase({ projDamage: 0 }), { ...victimBase, dealt: 70, lifeMax: 100 });  // damage<=0
    ghostHurtOnHit(ghostOn, srcBase(), { ...victimBase, dealt: 1, lifeMax: 100 });                    // num41<=1
    ghostHurtOnHit(ghostOn, srcBase(), { ...victimBase, dealt: 70, lifeMax: 5 });                     // flag10 lifeMax>5
    void calls;
  });
  it('预算池闸门(cap1500,:12031)+入账按弹基伤+产出浮魂弹属性(:12068)', () => {
    const direct = mkEnemy(11, 320, 190, 40, 40);   // 距 victim 窗内且有视线(dist>50)
    const blocked = mkEnemy(12, 260, 240, 18, 18);
    const { hooks, added } = worldWith([direct, blocked], true);
    blocked.dead = false;
    // 把 12 隔进墙里 → 只进备胎桶；构造墙
    const st = (hooks.world as unknown as { store: TileStore }).store;
    st.setTile(Math.floor(blocked.x / 16), Math.floor((blocked.y + 9) / 16), TILE_BY_KEY['stone']);
    ghostHurtOnHit(hooks, srcBase(), { ...victimBase, dealt: 70, lifeMax: 100, vanillaId: 15 });
    expect(added.length).toBe(1);
    const orb = added[0] as SpectreSoulProj;
    expect(orb).toBeInstanceOf(SpectreSoulProj);
    expect(orb.damage).toBe(80);                      // num=this.damage（基伤,非 dealt）
    expect(orb.w).toBe(6); expect(orb.h).toBe(6);     // SetDefaults :4467-4468
    expect(orb.friendly).toBe(false);                 // SetDefaults 无 friendly——AI ≥60t 转正
    expect(Math.hypot(orb.vx, orb.vy)).toBeCloseTo(4, 5);  // ±100 归一 ×4(:12059-12067)
    expect(orb.aiLock).toBeGreaterThanOrEqual(0);     // NewProjectile ai[0]=picked index
    expect(Math.abs(ghostBudgetPeek() - 80)).toBeLessThan(1e-6); // pool += projDamage
    // cap 之上不再出弹（直接置池超限,lastMs=-1 使下一拍只锚不衰减）
    _resetGhostBudgetForTest(GHOST_BUDGET_CAP + 100);
    ghostHurtOnHit(hooks, srcBase(), { ...victimBase, dealt: 70, lifeMax: 100, vanillaId: 15 });
    expect(added.length).toBe(1);
  });
});

describe('SpectreSoulProj AI_059（:29368-29431,★三轮蓝队 F2 EU 全套化后）', () => {
  it('预热=EU 计数 ÷4 ⇒ 14t 未满(ai1=56)；tick15 子步跨 60 置 friendly 先行(:29371)、场内无可追候选同拍 Kill(:29399)', () => {
    const { hooks } = makeHooks([]);
    const orb = new SpectreSoulProj(100, 100, 2, 2, 30, null);
    for (let i = 0; i < 14; i++) orb.fixedUpdate(1 / 60, hooks);   // ai1=56<60
    expect((orb as unknown as { warmup: number }).warmup).toBe(56);
    expect(orb.friendly).toBe(false);
    expect(orb.dead).toBe(false);
    orb.fixedUpdate(1 / 60, hooks);                                // 第15拍子步4 ai1=60→置位→空场 Kill
    expect(orb.friendly).toBe(true);   // 原版先置 friendly 再选人,:29371→:29399 保序
    expect(orb.dead).toBe(true);
  });
  it('★触敌即亡（链保序）：预热面 14t 内接触零伤零死；跨 60 拍当拍单跳 Kill（penetrate 默认 1,:14189→:17312）', () => {
    // ★BJ748（A26 尾迹收口）：BJ746 A26 给 356 敌臂补 DamageVar（:12970）后
    //  foe.hits[0] 进随机域（30±15% 逐跑漂移）——0.5 中性档（×1.00 恒等,同 BJ741 R19-1 式）。
    const rnd748 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // 与弹重叠的敌——预热期（ai1<60）friendly=false ⇒ Damage_PVE 不受理
    const foe = mkEnemy(7, 96, 100, 40, 40);
    const { hooks } = makeHooks([foe]);
    const orb = new SpectreSoulProj(98, 112, 0.01, 0, 30, foe);
    for (let i = 0; i < 14; i++) orb.fixedUpdate(1 / 60, hooks);
    expect(foe.hits.length).toBe(0);            // 预热期零伤（EU 后预热窗=14t）
    expect(orb.dead).toBe(false);
    // 第 15 拍 ai1 跨 60 → friendly 置位 → 该子步位移+runContactHits 首触即 hurt，
    // penetrate-- → 0 同拍 Kill（timeLeft 判死在命中之后=Damage 先行保序）
    orb.fixedUpdate(1 / 60, hooks);
    expect(foe.hits.length).toBe(1);            // 单次结算（无每敌冷却连发）
    expect(foe.hits[0]).toBe(30);
    expect(orb.dead).toBe(true);                // :17312 penetrate 归零同拍
    expect('hitCd' in (orb as unknown as Record<string, unknown>)).toBe(false);
    expect((orb as unknown as { penetrate: number }).penetrate).toBe(0);
    rnd748.mockRestore();
  });

  it('锁失重选随机(:29403)后朝目标平滑转向(v×29+dir)/30(:29414)且速度保持 ~4', () => {
    // ★F2 后每 tick 走速 ×4（blend 也 ×4 更早收敛）——靶距挪到 3000px 级防 120t 窗接触;
    // 保留「锁得上/转得动/速不变/不早死」四个断言点。
    const tgt = mkEnemy(3, 2600, 1600, 18, 24);
    const { hooks } = makeHooks([tgt]);
    const orb = new SpectreSoulProj(96, 112, 3.5, -3, 30, tgt);
    for (let i = 0; i < 120 && !orb.dead; i++) orb.fixedUpdate(1 / 60, hooks);
    expect(orb.friendly).toBe(true);
    expect(tgt.hits.length).toBe(0);
    expect(Math.abs(Math.hypot(orb.vx, orb.vy) - 4)).toBeLessThan(1.5);
    expect(orb.aiLock).toBe(3);
    const dxt = (tgt.x + 9) - orb.cx, dyt = (tgt.y + 12) - orb.cy;
    const vl = Math.hypot(orb.vx, orb.vy), dtl = Math.hypot(dxt, dyt) || 1;
    expect((orb.vx * dxt + orb.vy * dyt) / (vl * dtl)).toBeGreaterThan(0);
  });

  it('★F2 定谳三案：①混合式每【子步】应用(同列靶=want 恒向)②timeLeft 每拍 -4③寿命尽=子步计尽', () => {
    // ① blend per-substep：锁同列正下靶(dx≡0 ⇒ want=(0,4) 与距离无关),跨预热后
    //    折算次数 = 4t−59（tick15 子步3 首次,tick16 补 4 次）⇒ 16 拍后共 5 折。
    //    旧半套化实现一拍只折一轮 ⇒ 断言必然区分。
    {
      const downTgt = mkEnemy(21, 84, 1600, 24, 24);       // cx=96 与弹心同列
      const { hooks } = makeHooks([downTgt]);
      const orb = new SpectreSoulProj(96, 112, 0, 0, 30, downTgt);
      for (let t = 0; t < 16; t++) orb.fixedUpdate(1 / 60, hooks);
      let ex = 0, ey = 0;
      for (let u = 0; u < 5; u++) { ey = (ey * 29 + 4) / 30; }
      void ex;
      expect(orb.vy).toBeCloseTo(ey, 9);
      expect(orb.vx).toBeCloseTo(0, 9);
    }
    // ② timeLeft(--life) 在子步循环内逐拍 -4（:17309）：预置 life 字段直读速率
    {
      const padTgt = mkEnemy(22, 84, 1600, 24, 24);
      const { hooks } = makeHooks([padTgt]);
      const orb = new SpectreSoulProj(96, 112, 0, 0, 30, padTgt);
      const lifeOf = () => (orb as unknown as { life: number }).life;
      for (let t = 1; t <= 10; t++) {
        orb.fixedUpdate(1 / 60, hooks);
        expect(lifeOf()).toBe(3600 - 4 * t);
      }
    }
    // ③ 寿命终局：life 预置 7 ⇒ 两拍后（7÷≤4）耗尽当拍死——终点判死在 Damage 之后
    //    （AI/位移照跑满该子步,:17309-17312 保序）,寿命 3600 子步÷4=900t 收口。
    {
      const padTgt2 = mkEnemy(23, 84, 1600, 24, 24);
      const { hooks } = makeHooks([padTgt2]);
      const orb = new SpectreSoulProj(96, 112, 0, 0, 30, padTgt2);
      (orb as unknown as { life: number }).life = 7;
      orb.fixedUpdate(1 / 60, hooks);
      expect((orb as unknown as { life: number }).life).toBe(3);
      expect(orb.dead).toBe(false);
      orb.fixedUpdate(1 / 60, hooks);
      expect(orb.dead).toBe(true);
    }
  });
});

// ---- 批④：星璇之音 Stellar Tune（Item.cs:38755-38768 / Projectile.cs:15268-15273）----
describe('modifyStellarTuneDamage ×0.75 截断乘区（两调用点共式 :13339/:14722）', () => {
  it('LOS 开阔不改伤；遮挡时 C# int 截断 ×0.75（80→60、85→63.75→63）', () => {
    expect(modifyStellarTuneDamage(80, false)).toBe(80);
    expect(modifyStellarTuneDamage(80, true)).toBe(60);
    expect(modifyStellarTuneDamage(85, true)).toBe(63);
    expect(modifyStellarTuneDamage(85, false)).toBe(85);
    expect(modifyStellarTuneDamage(3, true)).toBe(2);   // trunc(2.25)
  });
});

// ---- 二轮蓝队 FR2-F：出手 crit 词缀位单源（Game case4715 曾漏 psTune.crt）----
describe('stellarTuneCritChance（GetWeaponCrit 口径：4 + 装备链 + 武器 20 + 词缀 crt）', () => {
  it('Item.cs:38764 基础 crit=20、无词缀 ⇒ (4+equip+20)/100', () => {
    expect(stellarTuneCritChance(0, 20, 0)).toBeCloseTo(0.24, 9);
    expect(stellarTuneCritChance(12, 20, undefined)).toBeCloseTo(0.36, 9);
  });
  it('词缀位进档（Item.Prefix :585 `crit += crt` 折算还原）并钳到 1 上限', () => {
    expect(stellarTuneCritChance(10, 20, 5)).toBeCloseTo(0.39, 9);   // Godly +5%
    expect(stellarTuneCritChance(90, 20, 15)).toBe(1);
    // 缺省容错（数据面缺词条 → 与 Game `?? 0` 形制一致）
    expect(stellarTuneCritChance(4, undefined, undefined)).toBeCloseTo(0.08, 9);
  });
});

describe('SparkleGuitarProj 出手向量/脚本曲线/AI_167 寿命(:47427)/一敌一跳', () => {
  it('computeStellarTuneShot：锁定支 speed=dist×2 + 锚=Center+v×20;未锁定 700 钳耗抖动', () => {
    const lockedOut = computeStellarTuneShot({
      playerCx: 100, playerCy: 100, mouseWorldX: 900, mouseWorldY: 900,
      targets: [{ cx: 600, cy: 400, vx: 2, vy: -1 }],
      targetRoll: () => 0,
      nextJitter: () => ({ x: 10, y: 10 }),
      nextEdgeUnit: () => ({ x: 0, y: -1 }),
      nextFloat01: () => 0,
    });
    expect(lockedOut.aimX).toBe(640);                 // 600 + vx(2)×20
    expect(lockedOut.aimY).toBe(380);
    expect(lockedOut.vx).toBeCloseTo(0, 9);           // edge unit (0,-1)
    expect(lockedOut.vy).toBeLessThan(0);
    expect(lockedOut.spawnX).toBe(100);
    // 未锁定：距离 800>700 → 锚点钳回 player + 700 向量；★F1② 无归一化 ⇒
    //   |v| = dist×2×|unit|，unit=(1,-0.75)（uy∈<0.5 支 nextFloat01=0.5→-0.75）,
    //   |unit|=1.25 ∈(1,√2] 波段 —— 旧 /norm 版会把幅值错误压回 1400。
    const free = computeStellarTuneShot({
      playerCx: 100, playerCy: 100, mouseWorldX: 900, mouseWorldY: 100,
      targets: [], targetRoll: () => 0,
      nextJitter: () => ({ x: 999, y: 999 }),          // 抖动不改变钳后锚
      nextEdgeUnit: () => ({ x: 1, y: 0 }),
      nextFloat01: () => 0.5,
    });
    expect(free.aimX).toBeCloseTo(100 + 700, 9);
    expect(Math.hypot(free.vx, free.vy)).toBeCloseTo(1400 * 1.25, 6);   // ★F1②
    expect(free.vy).toBeLessThan(0);                   // 上半平面压向
  });

  it('★F1② |v| 波段对拍：保平支恒 unit、上扬支 (1,√2] 不回落;上限 √2×dist×2', () => {
    // |Y|≥0.5 原始样本不做改写 → |unit|≡1
    const calm = computeStellarTuneShot({
      playerCx: 0, playerCy: 0, mouseWorldX: 500, mouseWorldY: -100,
      targets: [], targetRoll: () => 0, nextJitter: () => ({ x: 0, y: 0 }),
      nextEdgeUnit: () => ({ x: Math.SQRT1_2, y: -Math.SQRT1_2 }),
      nextFloat01: () => 0,
    });
    expect(Math.hypot(calm.vx, calm.vy)).toBeCloseTo(Math.hypot(500, 100) * 2, 9);
    // 上扬支：edge=(cos a≈0.98, sin a>0 取反→-0.199)，f=0.4 → uy=-0.7；
    // |unit|=√(0.96+0.49)=√1.45——恒 >1 且 <√2（归一化版本恒会缩回 1）
    const lift = computeStellarTuneShot({
      playerCx: 0, playerCy: 0, mouseWorldX: 400, mouseWorldY: 50,
      targets: [], targetRoll: () => 0, nextJitter: () => ({ x: 0, y: 0 }),
      nextEdgeUnit: () => ({ x: 0.98, y: 0.199 }),
      nextFloat01: () => 0.4,
    });
    expect(lift.vy).toBeCloseTo(-0.7 * 2 * Math.hypot(400, 50), 6);
    expect(Math.hypot(lift.vx, lift.vy)).toBeGreaterThan(2 * Math.hypot(400, 50));
    expect(Math.hypot(lift.vx, lift.vy)).toBeLessThan(2 * Math.hypot(400, 50) * Math.SQRT2);
  });
  it('AI_167 触敌即亡(penetrate 默认 1→:14194--→:17312 同拍 Kill)；隔墙 ×0.75 即时折算(:13333)', () => {
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：856 敌臂 DV 接入（G37①）——0.5 中性档（tier=floor(0.5×31)−15=0 ×1.00）
    const p = new Player(24 * 16, 104 * 16, new Inventory());   // 玩家左侧 (cx≈394)
    const foe = mkEnemy(5, 1600, 1660, 40, 40);                 // 弹右侧近敌
    const { hooks, store } = makeHooks([foe], undefined, p);
    // 光路断：弹/敌(x≈1616)与玩家(cx≈394)之间整列石墙（col 70=1120px 全高）
    for (let ty = 0; ty < H; ty++) store.setTile(70, ty, TILE_BY_KEY['stone']);
    const g = new SparkleGuitarProj(1620, 1665, 50, 0, 81, 1620, 1665);
    const preHits = foe.hits.length;
    for (let t = 0; t < 89 && !g.dead; t++) g.fixedUpdate(1 / 60, hooks);
    expect(g.dead).toBe(true);                         // 首个有效敌命中当拍死亡
    expect(foe.hits.length).toBe(preHits + 1);         // 触杀一跳；爆裂轮免疫不双扣
    expect(foe.hits[preHits]).toBe(60);                // trunc(81×0.75)=60.75→60（DV 中性 ×1.00）
    rnd741.mockRestore();
  });

  it('寿尽路(:47429 AI 自身 Kill)★A6 EU 化：无接触也在 tick30（第88/89子步）进 Kill；曲线逐子步取样对拍', () => {
    const { hooks } = makeHooks([]);
    const g = new SparkleGuitarProj(900, 900, 50, -30, 81, 1200, 700);
    let diedAt = -1;
    // 每拍读盒中心——EU 化后每子步推进 num2=localAI[0]/90,应首拍触及预期样点
    const cxAt: number[] = [];
    for (let t = 1; t <= 95 && diedAt < 0; t++) {
      g.fixedUpdate(1 / 60, hooks);
      if (!g.dead) cxAt.push(g.x + g.w / 2);
      if (g.dead) diedAt = t;
    }
    expect(diedAt).toBe(30);                           // extraUpdates=2 ⇒ localAI[0] 每 tick+3,
    // ++localAI[0]>=num-1=89 首达于 tick30 子步2（t 值 87→88→89）
    // 曲线 EU 取样对拍（红线：不许只改计时）：tick3 后 localAI[0]=9，与手推
    // CatmullRom(…, 9/90) 一致 ⇒ AI 与位移同步 EU 化成立
    const g2 = new SparkleGuitarProj(900, 900, 50, -30, 81, 1200, 700);
    for (let t = 1; t <= 3; t++) g2.fixedUpdate(1 / 60, hooks);
    const expected = stellarSampleRef(g2, hooks);
    expect(cxAt[2]).toBeCloseTo(expected.x, 5);         // 第 3 拍后盒心 x
  });

  /** 手工按 vanilla 步序重算 tick3 后的样点：每 tick 三子步 → localAI[0]=9，
   *  最后一次取样 num2=9/90。控制点全同 AI_167(:47433-47436)。 */
  function stellarSampleRef(_proj: SparkleGuitarProj, hooks: GameHooks): { x: number } {
    const pl = (hooks as unknown as { player: { cx: number; cy: number } }).player;
    // 出手 v=(50,-30) ⇒ vector2=-v=(-50,30)
    const nvx = -50, nvy = 30;
    const p0x = pl.cx + nvx * 2, p0y = pl.cy + nvy * 2;
    const p1x = pl.cx, p1y = pl.cy;
    const p2x = 1200, p2y = 700;
    const num2 = 9 / 90;
    const p3x = p2x + nvx * (1 - num2 * 3), p3y = p2y + nvy * (1 - num2 * 3);
    return { x: catmullRom({ x: p0x, y: p0y }, { x: p1x, y: p1y }, { x: p2x, y: p2y },
      { x: p3x, y: p3y }, num2).x };
  }

  it('KB 方向 num40=direction(:13652,aiStyle167 走自动换向表⇒按出手 vx 符号)；kb 值直通 StrikeNPC', () => {
    const p = new Player(24 * 16, 104 * 16, new Inventory());
    const foe = mkEnemy(5, 1600, 1660, 40, 40);
    const { hooks } = makeHooks([foe], undefined, p);
    const g = new SparkleGuitarProj(1620, 1665, 50, 0, 81, 1620, 1665);
    g.knockback = 2;
    for (let t = 0; t < 89 && !g.dead; t++) g.fixedUpdate(1 / 60, hooks);
    expect(g.dead).toBe(true);
    expect(foe.kxs[foe.kxs.length - 1]).toBe(2);       // vx>0 ⇒ num40=+1
  });

  it('爆裂真结算(:72831-72841)：128×128 弹心居中盒,盒内全吃/盒外免疫/幂等', () => {
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：856 敌臂 DV 接入——0.5 中性档
    const p = new Player(120, 940, new Inventory());   // 玩家盒 (120,940,20,42)——LOS 锚
    const inBox = mkEnemy(10, 494, 950, 18, 18);       // 盒内 [424..552]×[904..1032]
    const outBox = mkEnemy(11, 490, 1038, 16, 16);     // 底沿外 6px
    const { hooks } = makeHooks([inBox, outBox], undefined, p);
    const g = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    g.knockback = 3;
    const killOf = () =>
      ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
        .killStellarTune as (gh: GameHooks) => void);
    killOf().call(g, hooks);                                   // 直驱 Kill 856 段
    expect(g.dead).toBe(true);
    expect(g.w).toBe(128); expect(g.h).toBe(128);      // Resize 面（本轮判定即用 128 形）
    expect(inBox.hits).toEqual([81]);                  // 开阔 LOS 全额
    expect(inBox.kxs).toEqual([3]);                    // vx>0 ⇒ num40=+1 × kb=3
    expect(outBox.hits).toEqual([]);                   // 盒外零结算
    killOf().call(g, hooks);                           // active=false 幂等（:71761 同构）
    expect(inBox.hits.length).toBe(1);
    expect(outBox.hits.length).toBe(0);
    rnd741.mockRestore();
  });

  it('F2 减伤视线=步行族整盒对整盒(Collision.cs:373→383→388)：非对称走廊判别场', () => {
    // 走廊 row60 通、row61 地板带实心：CanHit 步行族「垂直对偶双实心才夹杀」放行,
    // CanHitLine 三 tile 组 ANY 即断——判别式实证两族互异(旧 canHitLine 挂法此处错折 25%)
    const st = ((): TileStore => {
      const s = new TileStore(W, H);
      for (let x = 4; x <= 36; x++) s.setTile(x, 61, TILE_BY_KEY['stone']);
      return s;
    })();
    // 判别前置自证：同一对参 walking 通过 / line 阻断
    expect(canHit(st, 424, 904, 128, 128, 120, 940, 20, 42)).toBe(true);
    expect(canHitLine(st, 424, 904, 128, 128, 120, 940, 20, 42)).toBe(false);
    const p = new Player(120, 940, new Inventory());
    const inBox = mkEnemy(10, 494, 950, 18, 18);
    const { hooks } = makeHooks([inBox], st, p);
    const g = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：856 DV 接入——0.5 中性档
    ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
      .killStellarTune as (gh: GameHooks) => void).call(g, hooks);
    rnd741.mockRestore();
    expect(inBox.hits).toEqual([81]);                  // 步行族视线通 → 无 ×0.75
  });

  it('爆裂轮同样吃 ModifyStellarTuneDamage(:13335 在 Damage_PVE_Inner 内)——遮挡时折算', () => {
    const p = new Player(120, 940, new Inventory());
    const inBox = mkEnemy(10, 494, 950, 18, 18);
    const st = makeStore();
    for (let ty = 56; ty <= 64; ty++) {                // 全厚板阻断 row60 走廊
      st.setTile(18, ty, TILE_BY_KEY['stone']);
      st.setTile(19, ty, TILE_BY_KEY['stone']);
    }
    const { hooks } = makeHooks([inBox], st, p);
    expect(canHit(st, 424, 904, 128, 128, 120, 940, 20, 42)).toBe(false);
    const g = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：856 DV 接入——0.5 中性档
    ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
      .killStellarTune as (gh: GameHooks) => void).call(g, hooks);
    rnd741.mockRestore();
    expect(inBox.hits).toEqual([60]);                  // trunc(81×0.75)
  });

  it('飞行端到端：触杀敌不被爆裂双扣 + 盒内次邻各一跳 + 远敌绝缘', () => {
    const p = new Player(24 * 16, 104 * 16, new Inventory());   // center≈(394,1685)
    const v = mkEnemy(1, 394 - 12, 1685 - 12, 24, 24);          // 曲线首拍必交（t01 极小近 P1）
    const mid = mkEnemy(2, 452, 1685 - 9, 18, 18);              // 距心 ~67px>32 触区、<64 爆区
    const far = mkEnemy(3, 594, 1685 - 9, 18, 18);              // >64px 爆区外
    const { hooks } = makeHooks([v, mid, far], undefined, p);
    const g = new SparkleGuitarProj(394, 1685, 50, 0, 81, 394, 1685);
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：856 DV 接入——0.5 中性档
    for (let t = 0; t < 20 && !g.dead; t++) g.fixedUpdate(1 / 60, hooks);
    rnd741.mockRestore();
    expect(g.dead).toBe(true);
    expect(v.hits).toEqual([81]);
    expect(mid.hits).toEqual([81]);
    expect(far.hits).toEqual([]);
  });
});

// ===================== 三轮蓝队批（F1/F3/F6,2026-08-31） =====================
describe('★F1① NextVector2Circular 线性半径分布形状（Utils.cs:1301-04）', () => {
  const N = 40000;
  const draw = (rng: () => number) => {
    const s = nextVector2Circular(rng, 24, 24);
    return { r: Math.hypot(s.x, s.y), a: Math.atan2(s.y, s.x) };
  };
  it('E[R]=R/2、P(R<R/2)=0.5 —— 面积均匀(√rand)版两值 = R/3 与 0.25,判别式可分辨', () => {
    const rng = mulberry32(20260831);
    let sum = 0, belowHalf = 0;
    for (let i = 0; i < N; i++) {
      const { r } = draw(rng);
      sum += r;
      if (r < 12) belowHalf++;
    }
    expect(sum / N).toBeGreaterThan(11.5);          // ≈12 (线性均值 R/2);√版≈8
    expect(sum / N).toBeLessThan(12.5);
    expect(belowHalf / N).toBeGreaterThan(0.485);   // ≈0.5;√版≈0.25
    expect(belowHalf / N).toBeLessThan(0.515);
  });
  it('双掷契约：恰消耗两个 rng 样本（角+半径）——旧内联版每样本掷三次', () => {
    let calls = 0;
    nextVector2Circular(() => { calls++; return 0.25; }, 24, 24);
    expect(calls).toBe(2);
  });
});

describe('★F1③ collectStellarTargets 候选携带 velocity 提前量(:47039 门/:48453 锚)', () => {
  it('矩形过滤照旧;命中候选带 vx/vy,空缺弹速缺省 0', () => {
    const rect = sparkleGuitarTargetRect(500, 500);
    const ents = [
      { x: 700, y: 700, w: 20, h: 20, vx: -1.5, vy: 0.25 },
      { x: 8000, y: 8000, w: 20, h: 20 },                       // 框外
      { x: 300, y: 480, w: 16, h: 16 },                          // 框内无速度
    ];
    const got = collectStellarTargets(ents, rect, () => true);
    expect(got.length).toBe(2);
    expect(got[0]).toEqual({ cx: 710, cy: 710, vx: -1.5, vy: 0.25 });
    expect(got[1].vx ?? null).toBe(0);
  });
  it('CanBeChasedBy 门在收集侧生效', () => {
    const rect = sparkleGuitarTargetRect(0, 0);
    const ents = [{ x: -200, y: -100, w: 40, h: 40 }];
    expect(collectStellarTargets(ents, rect, () => false).length).toBe(0);
    expect(collectStellarTargets(ents, rect, () => true).length).toBe(1);
  });
});

describe('★F3 弹体 CutTiles/小动物旁路（Projectile.cs:12513-12518→CutTiles :15276）', () => {
  it('856 子步 CutTiles：单 tick 三子步各自盒(右/下排除界)全数上报 game.cutTile', () => {
    const p = new Player(120, 940, new Inventory());
    const { hooks, cutCalls } = makeHooks([], undefined, p);
    const g = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    g.fixedUpdate(1 / 60, hooks);
    // 手推三子步曲线位（同 stellarSampleRef 法式）：w=32 盒 → 期望 tile 集 =
    // floor(pos/T)..floor((pos+32)/T)+1 的笛卡尔积;总集按序拼接
    const pl = hooks.player as unknown as { cx: number; cy: number };
    const expectedSet = new Set<string>();
    for (let u = 1; u <= 3; u++) {
      const t01 = u / 90;
      const pos = catmullRom(
        { x: pl.cx + (-g.vx) * 2, y: pl.cy + (-g.vy) * 2 },
        { x: pl.cx, y: pl.cy },
        { x: 488, y: 968 },
        { x: 488 + (-g.vx) * (1 - t01 * 3), y: 968 + (-g.vy) * (1 - t01 * 3) }, t01);
      const bx = pos.x - 16, by = pos.y - 16;               // w=h=32 → 左上=心−16
      const x0 = Math.floor(bx / 16), y0 = Math.floor(by / 16);
      // ★SW-BJ88 债4②：cutTilesBox 右/下 +1=循环排除界（CutTilesAt P.cs:15377/
      //  :15379 `i < num2`）——末含格 = floor((bx+32)/16);旧期望式 `<= …+1` 把
      //  排除界当含端再吃一遍=多 1 列/行（陈旧金标随刀更新,三子步盒交叠曾使其
      //  间歇性假绿）
      for (let ix = x0; ix <= Math.floor((bx + 32) / 16); ix++) {
        for (let iy = y0; iy <= Math.floor((by + 32) / 16); iy++) {
          expectedSet.add(`${ix},${iy}`);
        }
      }
    }
    const gotSet = new Set(cutCalls.map((c) => `${c.ix},${c.iy}`));
    expect(gotSet).toEqual(expectedSet);
    // 多子步盒交叠 ⇒ 同 tile 跨子步重复上报（原版每 Damage() 亦重跑 CutTiles,KillTile 幂等）：
    // 唯一集等价 + 总数≥唯一数 即可
    expect(cutCalls.length).toBeGreaterThanOrEqual(expectedSet.size);
  });

  it('856 Kill 爆裂轮同样以 128×128 盒砍一轮(:72840 Damage 再过 :12515 门)', () => {
    const p = new Player(120, 940, new Inventory());
    const { hooks, cutCalls } = makeHooks([], undefined, p);
    const g = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    cutCalls.length = 0;
    ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
      .killStellarTune as (gh: GameHooks) => void).call(g, hooks);
    // 盒左上=(488-64,968-64)=(424,904),右缘 552 → X 末含格 = floor(552/16)=34
    // （★SW-BJ88 债4②：右/下 +1=排除界,旧 35 列 [560,576) 盒根本不触,不再上报）
    const xs = cutCalls.map((c) => c.ix);
    expect(Math.min(...xs)).toBe(Math.floor(424 / 16));
    expect(cutCalls.some((c) => c.ix === Math.floor((424 + 128) / 16))).toBe(true);
    expect(cutCalls.some((c) => c.ix === Math.floor((424 + 128) / 16) + 1)).toBe(false);
  });

  it('356 预热期不砍(friendly=false 早退)；转正后子步照砍', () => {
    const foeless = makeHooks([]);
    const orbW = new SpectreSoulProj(100, 100, 1, 1, 30, null);
    orbW.fixedUpdate(1 / 60, foeless.hooks);
    expect(foeless.cutCalls.length).toBe(0);                // ai1<60 ⇒ runContact早退
    // 转正后子步照砍：直置计数器过预热（锁靶必须真实在场——失效重选空场先 Kill）
    const hb2 = makeHooks([mkEnemy(31, 2600, 1600, 18, 18)]);
    const lockEnt = mkEnemy(30, 2600, 1596, 18, 18);
    (hb2.hooks as unknown as { enemies: () => unknown[] }).enemies =
      () => [lockEnt, mkEnemy(31, 2700, 1610, 18, 18)];
    const orbH = new SpectreSoulProj(100, 100, 1, 1, 30, lockEnt);
    (orbH as unknown as { ai1: number }).ai1 = 60;
    orbH.fixedUpdate(1 / 60, hb2.hooks);
    expect(hb2.cutCalls.length).toBeGreaterThan(0);
  });

  it('856/356 命中小动物：一击致死并自毁（MagicProj 形态;356 同步耗穿）', () => {
    const p = new Player(120, 940, new Inventory());
    const scene = makeHooks([], undefined, p);
    let critterHits = 0;
    const critter = {
      x: 470, y: 950, w: 14, h: 14, dead: false,
      hurt(): boolean { critterHits++; critter.dead = true; return true; },
    };
    (scene.hooks as unknown as { critters: () => unknown[] }).critters = () => [critter];
    const g = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    // 直驱 Kill 段（曲线首拍远在玩家侧——小动物命中经爆裂轮 Damage 的 hitCritters 面）
    ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
      .killStellarTune as (gh: GameHooks) => void).call(g, scene.hooks);
    expect(critterHits).toBe(1);                            // 爆裂盒含小动物 ⇒ 一击
    expect(g.dead).toBe(true);                              // Kill 弹 856 段（带爆裂）
    expect(scene.cutCalls.length).toBeGreaterThan(0);       // 爆裂 128 盒同拍砍面
    // 356：friendly 转正后重叠小动物 ⇒ 耗穿一击即死
    const sceneB = makeHooks([], undefined, new Player(120, 940, new Inventory()));
    let critterHitsB = 0;
    const cB = { x: 90, y: 90, w: 16, h: 16, dead: false,
      hurt(): boolean { critterHitsB++; cB.dead = true; return true; } };
    (sceneB.hooks as unknown as { critters: () => unknown[] }).critters = () => [cB];
    const orbLock = mkEnemy(41, 2600, 1600, 18, 18);
    (sceneB.hooks as unknown as { enemies: () => unknown[] }).enemies = () => [orbLock];
    const orb = new SpectreSoulProj(95, 95, 0.01, 0.01, 30, orbLock);
    (orb as unknown as { ai1: number }).ai1 = 60;
    orb.fixedUpdate(1 / 60, sceneB.hooks);
    expect(critterHitsB).toBe(1);
    expect(orb.dead).toBe(true);
    expect((orb as unknown as { penetrate: number }).penetrate).toBe(0);
  });
});

// ★清偿刀 P1（C5 红蓝定谳#2,2026-09-29）本组夹具勘误：:12635-12641 门读【弹幕域】
//  immune[owner]=本仓 Enemy.iframes 共享窗——旧档 duck-call meleeNpcImmuneGateOf
//  （近战三重门 :44598 的仓内独立簿）系错域投影,夹具从近战域簿桩改 victim.iframes
//  承载;近战域簿只保留 ② 的受理写尾桥面（W 刀 face=usesLocal→0 出表）。
describe('★F6 856 immune[owner] 读清双语义（:12636 拒收门弹幕域 + 受理写尾清近战域簿）', () => {
  function burstScene(winTicks?: number): {
    hooks: GameHooks; victim: ReturnType<typeof mkEnemy>; winPeek: (id: number) => number | undefined;
    advanceTick: (n: number) => void;
  } {
    const p = new Player(120, 940, new Inventory());
    const scene = makeHooks([], undefined, p);
    const victim = mkEnemy(10, 494, 950, 18, 18);           // 落于爆裂 128 盒内
    (scene.hooks as unknown as { enemies: () => unknown[] }).enemies = () => [victim];
    if (winTicks !== undefined)
      (scene.hooks as unknown as { noteNpcPlayerImmune: (i: number, t: number) => void })
        .noteNpcPlayerImmune(victim.id, winTicks);
    const g = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
      .killStellarTune as (gh: GameHooks) => void).call(g, scene.hooks);
    return { ...scene, victim, gproj: g } as never;
  }

  it('①弹幕域残窗拒爆裂：iframes>0 受害者整跳跳过且【不落局部免疫标】', () => {
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：856 DV 接入——0.5 中性档
    const { hooks } = makeHooks([], undefined, new Player(120, 940, new Inventory()));
    const victim = mkEnemy(10, 494, 950, 18, 18);           // 落于爆裂 128 盒内
    (hooks as unknown as { enemies: () => unknown[] }).enemies = () => [victim];
    (victim as { iframes?: number }).iframes = 10;          // ★P1：弹幕域窗（快照判据读此域,旧近战域簿桩退役）
    const g1 = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
      .killStellarTune as (gh: GameHooks) => void).call(g1, hooks);
    expect(victim.hits).toEqual([]);                        // 窗开 ⇒ 爆裂整圈不吃
    // 「不落标」证明：窗过期（iframes 归 0,敌 tick 衰减语义外置模拟）后同盒再爆一轮即可吃伤
    // （同弹 hitOnce 不落标的直击面=debt-p1 判别测试;此处锁窗本体+爆裂轮门拒零结算）
    (victim as { iframes?: number }).iframes = 0;           // 窗过期
    const sceneB = makeHooks([], undefined, new Player(120, 940, new Inventory()));
    (sceneB.hooks as unknown as { enemies: () => unknown[] }).enemies = () => [victim];
    const g2 = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    g2.critChance = -5;                                     // 排除与第一发共享实例的可能
    ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
      .killStellarTune as (gh: GameHooks) => void).call(g2, sceneB.hooks);
    expect(victim.hits).toEqual([81]);                      // 新弹无窗正常结算
    rnd741.mockRestore();
  });

  it('②近战域簿对门位惰性（P1 勘误面）+受理写尾 noteNpcPlayerImmune(id,0) 出表照达', () => {
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：856 DV 接入——0.5 中性档
    const p = new Player(120, 940, new Inventory());
    const scene = makeHooks([], undefined, p);
    const victim = mkEnemy(11, 494, 950, 18, 18);
    (scene.hooks as unknown as { enemies: () => unknown[] }).enemies = () => [victim];
    const hs = scene.hooks as unknown as { noteNpcPlayerImmune: (i: number, t: number) => void };
    // 近战域簿残窗（已过期未出表）——P1 后该簿【不再】参与 856 门位（弹幕域 iframes=0 开门）
    hs.noteNpcPlayerImmune(victim.id, -0 + 1);              // expiry=tick+1
    scene.advanceTick(2);                                   // 已过期仍未删表(懒删语义)
    expect(scene.winPeek(victim.id)).toBeDefined();
    const gA = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
      .killStellarTune as (gh: GameHooks) => void).call(gA, scene.hooks);
    expect(scene.winPeek(victim.id)).toBeUndefined();       // ★受理写尾桥面出表（W 刀 face=usesLocal→0）
    expect(victim.hits).toEqual([81]);                      // 弹幕域开门 → 照结
    rnd741.mockRestore();
  });

  it('③独立计数隔离：弹幕域带窗者拒、不带者结；两账互不串扰,窗满释后后续弹照样落地', () => {
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：856 DV 接入——0.5 中性档
    const p = new Player(120, 940, new Inventory());
    const scene = makeHooks([], undefined, p);
    const wVictim = mkEnemy(12, 494, 950, 18, 18);          // 带弹幕域窗 10t
    const clean = mkEnemy(13, 500, 906, 18, 18);            // 同盒但无窗(盒上沿内侧)
    (scene.hooks as unknown as { enemies: () => unknown[] }).enemies = () => [wVictim, clean];
    (wVictim as { iframes?: number }).iframes = 10;         // ★P1：弹幕域窗
    const g = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
      .killStellarTune as (gh: GameHooks) => void).call(g, scene.hooks);
    expect(wVictim.hits).toEqual([]);                       // 带窗拒
    expect(clean.hits).toEqual([81]);                       // 无窗照结
    expect(scene.winPeek(clean.id)).toBeUndefined();
    expect(scene.winPeek(wVictim.id)).toBeUndefined();      // ★拒收不落任何写尾（含近战域桥）
    (wVictim as { iframes?: number }).iframes = 0;          // 窗自然到期（敌 tick 衰减语义外置模拟）
    const later = new SparkleGuitarProj(488, 968, 100, 0, 81, 488, 968);
    ((SparkleGuitarProj.prototype as unknown as Record<string, (gh: GameHooks) => void>)
      .killStellarTune as (lh: GameHooks) => void).call(later, scene.hooks);
    expect(wVictim.hits).toEqual([81]);                     // 后续弹终获释放
    rnd741.mockRestore();
  });
});
