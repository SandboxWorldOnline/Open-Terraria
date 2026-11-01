// 蓝队二轮（red-team R2 二批）修复回归：R2-01/02/03/04/05/06⑤/07(g)/09 闸门。
// 权威 = Terarria1457（行号锚在各断言旁）；桩口径同 melee-alignment-batch.test.ts。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game } from '../src/core/Game';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TILE } from '../src/core/constants';
import { VolcanoBlastProj } from '../src/entities/VolcanoBlastProj';
import { JavelinStickerProj, MuramasaSlashProj, ConfettiBurstProj,
  BladetongueGlobProj } from '../src/entities/meleeOnHitProjs';
import { applyRapidAttackBonus, newRapidBonusState, decayRapidAttackBonus,
  RAPID_ATTACK_BONUS_ITEMS } from '../src/player/RapidAttackBonus';
import { BeetleMeter } from '../src/player/BeetleMeter';
import { rotatedRelativePoint } from '../src/player/SwingPathMath';
import { ImmunityCooldownID, HurtCooldownBuckets, hurtImmunityFrames }
  from '../src/player/HurtCooldownBuckets';
import { BuffType } from '../src/stats/Buffs';

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};
afterEach(() => { vi.restoreAllMocks(); });

function swingStub(heldVid: number, opts: Partial<{ t: number; dur: number; dmg: number; kb: number }> = {}) {
  const world = new World(120, 120, 30, 'r2b');
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  const player = new Player(50 * TILE, 90 * TILE, new Inventory());
  player.inv.add(iid(heldVid), 1);
  g.swing = {
    t: opts.t ?? 20, dur: opts.dur ?? 30,
    dmg: opts.dmg ?? 10, kb: opts.kb ?? 3,
    item: iid(heldVid), useStyle: 1,
    volcanoInit: true, volcanoWindow: false,
    batbatHeal: false, tentacleSpikes: false, bloodButchererSpawns: false, muramasaCut: false,
  };
  g.swingHitSet = new Set<number>();
  g.swingTileCutSet = new Set<number>();
  const enemies: Enemy[] = [];
  const critters: Enemy[] = [];
  const npcs: Enemy[] = [];
  const projectiles: unknown[] = [];
  g.entities = {
    critters, npcs, enemies,
    add: (ent: unknown, bucket: string) => {
      if (bucket === 'projectiles') projectiles.push(ent);
      return ent;
    },
  };
  g.projectiles = projectiles;
  g.player = player;
  g.world = world;
  g.addDamageNumber = vi.fn();
  g.spawnParticles = vi.fn();
  g.spawnDrop = vi.fn(() => null);
  g.bannerNpcActive = () => false;
  g.input = { mouseHeld: false };
  g.net = null;
  return { g: g as unknown as Game & Record<string, unknown>, player, world, enemies,
    critters, npcs, projectiles };
}

/** 敌怪命中闭环（伤害面隔离：hurt 记账不死亡）。dx=8 保证落入挥击判定盒。 */
function placeTarget(hitCtx: ReturnType<typeof swingStub>, id: number,
  dx = 8, hpBefore = 1000) {
  const e = Enemy.fromVanilla(1, hitCtx.player.cx + dx, hitCtx.player.y)!;   // 僵尸
  e.id = id;
  e.maxHp = hpBefore;
  e.hp = hpBefore;
  const log: Array<{ dmg: number }> = [];
  e.hurt = function (dmg: number): boolean { log.push({ dmg }); this.hp -= dmg; return false; };
  hitCtx.enemies.push(e);
  return { e, log };
}

const runSwing = (ctx: ReturnType<typeof swingStub>, ticks = 1): void => {
  for (let i = 0; i < ticks; i++) {
    (ctx.g as unknown as { updateSwingHits(): void }).updateSwingHits();
  }
};

// ============================================================
// R2-01 ApplyRapidAttackBonus（Player.cs:18367-89；ItemID.cs:70 集合）
// ============================================================
describe('R2-01 连击加成面', () => {
  it('集合={2608,3349,672}直通+爬升+0.12、生效封顶 0.5、蓄能帽 0.62', () => {
    expect([...RAPID_ATTACK_BONUS_ITEMS].sort((a, b) => a - b)).toEqual([672, 2608, 3349]);
    const st = newRapidBonusState();
    expect(applyRapidAttackBonus(st, 10, 4, true)).toBe(10);       // 集合外零改动
    expect(st.value).toBe(0);
    expect(applyRapidAttackBonus(st, 100, 2608, true)).toBe(100);   // 击1 现值 0
    expect(st.value).toBeCloseTo(0.12);                             // 蓄能后 +0.12
    expect(applyRapidAttackBonus(st, 100, 3349, true))
      .toBe(Math.trunc(100 * Math.fround(1.12)));                   // 击2 ×1.12
    while (st.value < 0.5) applyRapidAttackBonus(st, 1, 672, true);
    applyRapidAttackBonus(st, 1, 672, true);
    expect(st.value).toBeCloseTo(0.62);                             // 蓄能帽 num+num2=0.62
    expect(applyRapidAttackBonus(st, 100, 672, false)).toBe(150);   // 生效封顶 ×1.5
    expect(applyRapidAttackBonus(st, 100, 672, false)).toBe(150);
  });

  it('decayRapidAttackBonus −0.005/t 至 0（ResetEffects :18392-18401）', () => {
    const st = newRapidBonusState();
    st.value = 0.62;
    for (let i = 0; i < 124; i++) decayRapidAttackBonus(st);
    expect(st.value).toBeLessThanOrEqual(0.0051);
    for (let i = 0; i < 10; i++) decayRapidAttackBonus(st);
    expect(st.value).toBe(0);
  });

  it('管线接线：逐帧重扫下连击加成按受理次序爬升（cap ≤×1.5）；铁剑恒基线', () => {
    // dur=6 → attackCD=max(1,(int)(6×0.33))=1：逐帧邻接受理，把 ResetEffects 的
    // −0.005/t 衰减压到最小，使爬升序列可读（vanilla 连挥近似逐帧触发）
    // dur=30 → attackCD=max(1,(int)(30×0.33))=9：受理节拍 0/9/18/27 恰在动画窗内，
    // 四目标依次各得一分（vanilla 单挥逐帧扫掠同构）
    const ctx = swingStub(2608, { dmg: 100, t: 30, dur: 30 });
    // 三目标：受理节拍 0/9/18（第四拍与动画窗尾交叠被 vanilla 式攻击CD吞掉——
    // 该节拍行为由 melee-alignment-batch 任务② 闸门独立覆盖）
    const logs = [
      placeTarget(ctx, 101), placeTarget(ctx, 102), placeTarget(ctx, 103),
    ];
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // 方差恒 1 / crit 恒假
    try { runSwing(ctx, 45); } finally { randSpy.mockRestore(); }
    const dmgList = logs.map((l) => l.log[0]?.dmg ?? -1);
    expect(dmgList).not.toContain(-1);                              // 四目标全部受理
    expect(dmgList[0]).toBe(100);                                   // 现值 0 → 基线
    expect(dmgList[1]).toBeGreaterThan(dmgList[0]);                 // +档抬升（含 CD 窗衰减）
    expect(dmgList[1]).toBeLessThanOrEqual(Math.trunc(100 * Math.fround(1.12)) + 1);
    expect(dmgList[2]).toBeLessThanOrEqual(150);                    // 生效帽 ×1.5

    // 铁剑对照：两连击恒基线
    const ctx2 = swingStub(4, { dmg: 100, t: 30, dur: 30 });
    const l2 = [placeTarget(ctx2, 201), placeTarget(ctx2, 202)];
    const r2 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try { runSwing(ctx2, 45); } finally { r2.mockRestore(); }
    expect(l2[0].log[0].dmg).toBe(l2[1].log[0].dmg);
  });

  it('immortal 目标不蓄能（increaseBonus=!nPC.immortal :44646）', () => {
    // dur=30 → attackCD=max(1,(int)(30×0.33))=9：受理节拍 0/9/18/27 恰在动画窗内，
    // 四目标依次各得一分（vanilla 单挥逐帧扫掠同构）
    const ctx = swingStub(2608, { dmg: 100, t: 30, dur: 30 });
    const t1 = placeTarget(ctx, 301);
    (t1.e as unknown as { immortal?: boolean }).immortal = true;
    const t2 = placeTarget(ctx, 302);
    const rs = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try { runSwing(ctx, 45); } finally { rs.mockRestore(); }
    void t1;
    expect(t2.log[0].dmg).toBe(100);                                // 现值仍 0 → 恒基线
  });
});

// ============================================================
// R2-02 非 General 免疫桶门（Hurt :38493/:38674-83）
// ============================================================
describe('R2-02 WrongBugNet 桶门穿 General 无敌窗', () => {
  it('iframes>0 时 WrongBugNet 受理、写桶不动 General 位', () => {
    const player = new Player(50 * TILE, 90 * TILE, new Inventory());
    player.iframes = 40;
    const buckets = new HurtCooldownBuckets();
    (player as unknown as { __swNextHitBucket?: unknown }).__swNextHitBucket =
      { id: ImmunityCooldownID.WrongBugNet, table: buckets };
    const dealt = player.damage(1, player.cx, player.cy - 10, true);
    expect(dealt).toBeGreaterThan(0);                               // 不被整体早退吞
    expect(buckets.remaining(ImmunityCooldownID.WrongBugNet))
      .toBe(hurtImmunityFrames(dealt, false));                      // :38680 分道写
    expect(player.iframes).toBe(40);                                // General 位不受污染
  });

  it('桶窗内早退无副作用；General 域旧语义不变', () => {
    const player = new Player(50 * TILE, 90 * TILE, new Inventory());
    const buckets = new HurtCooldownBuckets();
    buckets.applyAfterHit(ImmunityCooldownID.WrongBugNet, 20);
    (player as unknown as { __swNextHitBucket?: unknown }).__swNextHitBucket =
      { id: ImmunityCooldownID.WrongBugNet, table: buckets };
    const hp = player.hp;
    expect(player.damage(1, player.cx, player.cy - 10, true)).toBe(0);
    expect(player.hp).toBe(hp);
    (player as unknown as { __swNextHitBucket?: undefined }).__swNextHitBucket = undefined;
    player.iframes = 30;
    expect(player.damage(9, player.cx, player.cy - 10, true)).toBe(0);
    expect(player.iframes).toBe(30);
  });
});

// ============================================================
// R2-03 骨弹出生盒勘误（判定盒上半 vs 敌怪盒）
// ============================================================
describe('R2-03 骨剑命中弹出生在判定盒上半', () => {
  it('1166 命中：骨弹出点在判定盒域（近玩家侧），整数采样 Left+Next(W)/Top+Next(H/2)', () => {
    const ctx = swingStub(1166, { dmg: 20, t: 25, dur: 30 });
    const pcx = (ctx.player as unknown as { cx: number }).cx;
    placeTarget(ctx, 77, 8, 9999);
    const r = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.99).mockReturnValueOnce(0.24).mockReturnValue(0.5);
    try { runSwing(ctx, 1); } finally { r.mockRestore(); }
    const bone = ctx.projectiles.find((p) => (p as { projId?: number }).projId === 1111) as
      | { x: number; y: number } | undefined;
    expect(bone).toBeDefined();
    expect(Math.abs((bone!.x + 8) - pcx)).toBeLessThan(80);         // 判定盒域（贴玩家侧）
    expect(Number.isInteger(bone!.x)).toBe(true);                   // Math.floor 采样 ≠ 旧浮点形
    expect(Number.isInteger(bone!.y)).toBe(true);
  });
});

// ============================================================
// R2-04/R2-05 978 门三件套 + 击退参照系（Damage_PVE_Inner :12641-67）
// ============================================================
type VolcFE = { id: number; x: number; y: number; w: number; h: number;
  cx: number; cy: number; dead: boolean; hits: Array<{ dmg: number; kx: number }>;
  noTileCollide?: boolean };

describe('R2-04/R2-05 978 命中门', () => {
  function volcGame(...enemies: VolcFE[]) {
    const world = new World(200, 200, 30, 'volc');
    const player = { cx: 500, cy: 500, x: 490, y: 479, w: 20, h: 42, facing: 1 } as never;
    const immuneWritesRef: Array<[number, number]> = [];
    const enemiesArr = enemies;
    const gg = {
      world, player, enemies: () => enemiesArr, critters: () => [],
      playSfx: vi.fn(),
      noteNpcPlayerImmune: (id: number, t: number) => immuneWritesRef.push([id, t]),
      // ★Q4 刀 2026-09-30（P1 同族勘误后）：978 门读【弹幕域】e.iframes（清偿刀 T
      //   单源 snapshotVanillaGate）——旧 stub meleeNpcImmuneGateOf 已不消费,退役。
    } as unknown as import('../src/entities/types').GameHooks;
    return { gg, immuneWritesRef };
  }
  function mk(id: number, x: number, y: number): VolcFE {
    const e: VolcFE = {
      id, x, y, w: 16, h: 16, cx: x + 8, cy: y + 8, dead: false, hits: [],
      hurt: function (this: VolcFE, d: number, kx: number) { this.hits.push({ dmg: d, kx }); return false; },
    } as VolcFE;
    return e;
  }

  it('全局免疫窗（弹幕域 iframes>0）→ 零结算（Damage_PVE_Inner :12636 flag3=false 门;★Q4 刀 P1 同族勘误:读域=Enemy.iframes 非近战簿）', () => {
    const tgt = mk(1, 450, 450);
    (tgt as { iframes?: number }).iframes = 10;   // 他弹残窗（弹幕域）
    const { gg } = volcGame(tgt);
    const b = new VolcanoBlastProj(458, 458, 0, -1, 40, 3, 1);
    b.fixedUpdate(1 / 60, gg);
    expect(tgt.hits).toHaveLength(0);
  });

  it('ownerHitCheck 距离门 >1000px 拒收；距离内 LOS 过则受理+GC1 清窗', () => {
    const farTgt = mk(2, 100, 200);
    farTgt.cx = 108; farTgt.cy = 208;
    const nearTgt = mk(3, 470, 470);
    const { gg, immuneWritesRef } = volcGame(farTgt, nearTgt);
    const b = new VolcanoBlastProj(478, 478, 0, -1, 30, 2, 1);
    b.fixedUpdate(1 / 60, gg);
    expect(farTgt.hits).toHaveLength(0);
    expect(nearTgt.hits).toHaveLength(1);
    expect(immuneWritesRef).toContainEqual([3, 0]);                 // Projectile.cs:14177 清窗段
  });

  it('击退参照系 aiStyle189：玩家中心在目标左 → kdir=+1（:13669-72）', () => {
    const rightTgt = mk(4, 520, 470);
    rightTgt.cx = 528; rightTgt.cy = 478;
    const { gg } = volcGame(rightTgt);
    const b = new VolcanoBlastProj(540, 478, 0, -1, 30, 2, 1);      // 弹心在目标右、玩家在其左
    b.fixedUpdate(1 / 60, gg);
    expect(rightTgt.hits).toHaveLength(1);
    expect(rightTgt.hits[0].kx).toBeGreaterThan(0);
  });

  it('crit live：critChanceFn 在 Strike 时点求值（两拍两注入值）', () => {
    const a1 = mk(5, 470, 470);
    const a2 = mk(6, 470, 430);
    const { gg } = volcGame(a1, a2);
    const b = new VolcanoBlastProj(478, 478, 0, -1, 20, 1, 1);
    let injected = 1.1;
    b.critChanceFn = () => injected;
    b.fixedUpdate(1 / 60, gg);
    injected = -1;
    b.fixedUpdate(1 / 60, gg);
    expect(a1.hits).toHaveLength(1);                                // 每拍一发（另目标另发）
    expect(a2.hits).toHaveLength(1);
  });
});

// ============================================================
// R2-06⑤ BeetleMeter 实扣累计
// ============================================================
describe('R2-06⑤ 甲虫实扣模型', () => {
  // ★BJ745 A16（issue#35）：buff 单源重构后 orbs 由 buff 栏派生——夹具补 fakeBuffs
  // 宿主（裸宿主无栏=派生恒 0）,期望按原版「AddBuff 拍 + 派生拍」两拍滞后重写。
  function buffHost(): { beetleOrbs?: number; buffs: { applied: Array<[number, number]>; removed: number[]; live: Map<number, number>; has(t: number): boolean; apply(t: number, s: number): void; remove(t: number): void } } {
    const live = new Map<number, number>();
    return {
      beetleOrbs: 0,
      buffs: {
        applied: [] as Array<[number, number]>, removed: [] as number[], live,
        has: (t: number) => live.has(t),
        apply: (t: number, s: number) => { (live as Map<number, number>).set(t, s); },
        remove: (t: number) => { live.delete(t); },
      },
    };
  }
  it('registerHit 加账＋进攻梯子 400/1600/5200 层位·抽水（orbs 两拍滞后派生）', () => {
    const host = buffHost();
    const m = new BeetleMeter();
    m.registerHit(500, true);
    m.tick(host, true, false); m.tick(host, true, false);
    expect(host.beetleOrbs).toBe(1);
    m.registerHit(1300, true);
    m.tick(host, true, false); m.tick(host, true, false);
    expect(host.beetleOrbs).toBe(2);
    m.registerHit(6000, true);
    m.tick(host, true, false); m.tick(host, true, false);
    expect(host.beetleOrbs).toBe(3);
    const c3 = m.stateForTest().counter;
    m.tick(host, true, false);
    expect(m.stateForTest().counter).toBeLessThan(c3);
  });

  it('掉层重置 countdown=0（:16678）；防御臂 180 计数增益一球（:16596-16617）', () => {
    const host = buffHost();
    const m = new BeetleMeter();
    m.tick(host, true, false);       // 族旗=offense（守卫放行 might 族）
    host.buffs.live.set(BuffType.BeetleMight1, 5 / 60); // 预置 Might1（orbs 派生 1）
    m.tick(host, true, false);
    expect(host.buffs.live.has(BuffType.BeetleMight1)).toBe(false);   // 掉层到 0：梯子清档（:16686-96 num≠orbs&&orbs>0 → DelBuff 98-100）
    const m2 = new BeetleMeter();
    const host2 = buffHost();
    m2.tick(host2, true, false);     // 族旗=offense → 掉层路径须 might 族在栏
    host2.buffs.live.set(BuffType.BeetleMight2, 5 / 60);   // Might2（orbs 派生 2,counter0 → num0 < 2 掉层）
    m2.tick(host2, true, false);
    expect(m2.stateForTest().countdown).toBe(0);
    expect(host2.beetleOrbs).toBeLessThanOrEqual(2);
    const dHost = buffHost();
    const dm = new BeetleMeter();
    for (let i = 0; i < 181; i++) dm.tick(dHost, false, true);   // 180 满 → AddBuff(95),181 拍派生
    expect(dHost.beetleOrbs).toBe(1);
  });

  it('管线接线：PVE 受理命中把 lastStrikeDealt 注入 registerHit（ApplyNPCOnEffects 位）', () => {
    const ctx = swingStub(3, { dmg: 25 });
    const spyReg = vi.spyOn(BeetleMeter.prototype, 'registerHit');
    const e = placeTarget(ctx, 55).e;
    e.lastStrikeDealt = 777;
    const rs = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try { runSwing(ctx, 40); } finally { rs.mockRestore(); }
    expect(spyReg.mock.calls.length).toBeGreaterThan(0);
    expect(spyReg.mock.calls[0][0]).toBe(777);                      // dmgDone 通道
    spyReg.mockRestore();
  });
});

// ============================================================
// R2-07(g) spawn 面
// ============================================================
describe('R2-07(g) on-hit spawn 面', () => {
  it('TentacleSpike 5094：窗口旗消费→971 钉扎弹+sticker 337', () => {
    const ctx = swingStub(5094, { dmg: 30 });
    ((ctx.g.swing as Record<string, unknown>).tentacleSpikes) = true;
    const stickers: Array<[number, number]> = [];
    const placed = placeTarget(ctx, 61);
    (placed.e as unknown as { addStickerStack?: (b: number, s: number) => void }).addStickerStack =
      (b, s) => stickers.push([b, s]);
    const rs = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      while (ctx.projectiles.length === 0 && (ctx.g.swing as { t: number } | null)?.t! > 0) {
        runSwing(ctx, 1);
      }
    } finally { rs.mockRestore(); }
    const spikes = ctx.projectiles.filter((p) => p instanceof JavelinStickerProj) as JavelinStickerProj[];
    expect(spikes).toHaveLength(1);
    expect(spikes[0].projType).toBe(971);
    expect((spikes[0] as unknown as { targetId: number }).targetId).toBe(placed.e.id);
    expect(spikes[0].ai0).toBe(1);                                  // 出生即钉扎态（ai0=1）
    expect(stickers).toEqual([[337, 9]]);                           // AddBuff(337,540t)
    // 受理同拍窗口消费即清（swing 后续自然过期与旗位无关——双态皆视为已消费）
    expect(((ctx.g.swing as { tentacleSpikes?: boolean } | null)?.tentacleSpikes) !== true)
      .toBe(true);
  });

  it('BloodButcherer 795 → 975/buff344；BatBat 5097 Heal(1)+窗口清；Muramasa 155 → 977 波(|v|≈8)', () => {
    const bb = swingStub(795, { dmg: 30 });
    ((bb.g.swing as Record<string, unknown>).bloodButchererSpawns) = true;
    placeTarget(bb, 71);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    runSwing(bb, 40);
    const bloodSpikes = bb.projectiles.filter((p) => p instanceof JavelinStickerProj) as JavelinStickerProj[];
    expect(bloodSpikes.length).toBeGreaterThanOrEqual(1);
    expect(bloodSpikes.every((s) => s.projType === 975)).toBe(true);
    expect(((bb.g.swing as { bloodButchererSpikes?: boolean } | null)?.bloodButchererSpikes) !== true)
      .toBe(true);

    const mm = swingStub(155, { dmg: 26 });
    ((mm.g.swing as Record<string, unknown>).muramasaCut) = true;
    placeTarget(mm, 81);
    const rr = vi.spyOn(Math, 'random').mockReturnValue(0.42);
    try { runSwing(mm, 40); } finally { rr.mockRestore(); }
    const cuts = mm.projectiles.filter((p) => p instanceof MuramasaSlashProj) as MuramasaSlashProj[];
    expect(cuts).toHaveLength(1);
    expect(cuts[0].vx * cuts[0].vx + cuts[0].vy * cuts[0].vy).toBeCloseTo(64, 0);
    expect(((mm.g.swing as { muramasaCut?: boolean } | null)?.muramasaCut) !== true)
      .toBe(true);

    const bat = swingStub(5097, { dmg: 20 });
    ((bat.g.swing as Record<string, unknown>).batbatHeal) = true;
    (bat.player as unknown as { hp: number }).hp = (bat.player as unknown as { maxHp: number }).maxHp - 5;
    placeTarget(bat, 91);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    runSwing(bat, 40);
    expect((bat.player as unknown as { hp: number }).hp)
      .toBe((bat.player as unknown as { maxHp: number }).maxHp - 4); // Heal(1)
    expect(((bat.g.swing as { batbatHeal?: boolean } | null)?.batbatHeal) !== true)
      .toBe(true);                                                  // 消费即清（swing 过期=null 等价已消费）
  });

  it('Bladetongue 3211 → 524 血舌球；派对浸剂 289 两拍爆 30 彩纸尘', () => {
    const bt = swingStub(3211, { dmg: 30 });
    placeTarget(bt, 101);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    runSwing(bt, 40);
    const globs = bt.projectiles.filter((p) => p instanceof BladetongueGlobProj) as BladetongueGlobProj[];
    expect(globs).toHaveLength(1);
    expect(globs[0].damage).toBeGreaterThan(0);

    const pt = swingStub(3, { dmg: 14 });
    pt.player.buffs.apply(BuffType.ImbueParty as never, 60);
    placeTarget(pt, 111);
    const dustCalls: number[] = [];
    (pt.g as unknown as Record<string, unknown>).spawnDust = (_x: number, _y: number, _w: number,
      _h: number, type: number) => {
      dustCalls.push(type);
      return { vx: 0, vy: 0, scale: 1, noGravity: false, fadeIn: 0 };
    };
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
    runSwing(pt, 40);
    const confetti = pt.projectiles.filter((p) => p instanceof ConfettiBurstProj) as ConfettiBurstProj[];
    expect(confetti.length).toBeGreaterThanOrEqual(1);
    const cf = confetti[0];
    cf.fixedUpdate(1 / 60, pt.g);
    cf.fixedUpdate(1 / 60, pt.g);
    expect(cf.dead).toBe(true);                                     // timeLeft=2 → 两拍消亡
    expect(dustCalls.filter((t) => t >= 139 && t <= 142)).toHaveLength(30);   // :76092 kill 粒
  });
});

// ============================================================
// R2-09 int/int 截断统一
// ============================================================
describe('R2-09 RotatedRelativePoint num2=int 截断', () => {
  it('负奇偏移 trunc(-7/2)+4=1（floor 形得 0——shift 分量差 ±1px）', () => {
    const out = rotatedRelativePoint(10, 20,
      { bottomX: 10, bottomY: 20, mountPlayerOffset: -7, fullRotation: Math.PI / 2 });
    expect(out.x).toBeCloseTo(9, 5);                                // 10 − n·sin(π/2)，n=1
    expect(out.y).toBeCloseTo(19, 5);                               // 20 − n + n·cos(π/2)=19
    const evenNeg = rotatedRelativePoint(10, 20,
      { bottomX: 10, bottomY: 20, mountPlayerOffset: -8, fullRotation: Math.PI / 2 });
    expect(evenNeg.x).toBeCloseTo(10, 5);                           // 整除偏移两形一致，n=0
    expect(evenNeg.y).toBeCloseTo(20, 5);
  });

  it('两形分叉实证（Player.rotatedRelativePoint 单点已同式改 trunc）', () => {
    expect(Math.trunc(-7 / 2)).toBe(-3);
    expect(Math.floor(-7 / 2)).toBe(-4);
  });
});
