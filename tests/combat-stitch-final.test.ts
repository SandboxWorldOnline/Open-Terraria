// 终局扫尾·战斗缝合批（A1..A8，2026-08-31）确定性回归。
// 标杆 Terarria1457/Terraria（行号见各用例）。桩口径承 melee-alignment-batch /
// weapon-melee-leftover（Object.create(Game.prototype)+updateSwingHits 直驱）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game, ownerMeleeCritBits } from '../src/core/Game';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { TownNPC } from '../src/entities/TownNPC';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TILE } from '../src/core/constants';
import { BuffType } from '../src/stats/Buffs';
import { hitEnemies, HitCooldown } from '../src/entities/WeaponProj';
import {
  projClassOfProjId, resolveProjClass, IS_A_WHIP_PROJS,
  DONT_APPLY_PARRY_DAMAGE_BUFF_PROJS, MINION_SHOT_PROJS, SENTRY_SHOT_PROJS,
  hittableForOnHitRewards, hitCritters,
} from '../src/entities/projTargets';
import { MinionProj, lightningAuraPenPercent } from '../src/entities/MinionProj';
import { SparkleGuitarProj } from '../src/entities/SparkleGuitarProj';
import type { GameHooks } from '../src/entities/types';
import { itemCombat } from '../src/data/vanillaItemCombat';

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

afterEach(() => { vi.restoreAllMocks(); });

/** updateSwingHits 驱动桩（对齐批同构） */
function swingStub(heldVid: number, opts: Partial<{ t: number; dur: number; dmg: number; kb: number }> = {}) {
  const world = new World(120, 120, 30, 'stitch-batch');
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  const player = new Player(50 * TILE, 90 * TILE, new Inventory());
  player.inv.add(iid(heldVid), 1);
  g.swing = { t: opts.t ?? 20, dur: opts.dur ?? 30, dmg: opts.dmg ?? 50,
    kb: opts.kb ?? 3, item: iid(heldVid), useStyle: 1 };
  g.swingHitSet = new Set<number>();
  g.swingTileCutSet = new Set<number>();
  const enemies: Enemy[] = [];
  const critters: Enemy[] = [];
  const npcs: TownNPC[] = [];
  const projectiles: unknown[] = [];
  g.entities = {
    critters, npcs, enemies,
    add: (ent: unknown, bucket: string) => {
      if (bucket === 'projectiles') projectiles.push(ent);
      return ent;
    },
    projectiles,
  };
  g.projectiles = projectiles;
  g.player = player;
  g.world = world;
  g.sfx = { playWavFile: () => true, playFiles: () => true, play: () => true };
  g.addDamageNumber = vi.fn();
  g.spawnParticles = vi.fn();
  g.spawnDrop = () => null;
  g.spawnDust = vi.fn();
  g.spawnFriendlyProj = vi.fn();
  g.net = null;
  g.bannerNpcActive = () => false;
  g.remotePlayerProxies = [];
  g.dropContext = () => undefined;
  g.onEnemyKilled = () => {};
  g.achievements = { notifyProgressionEvent: vi.fn() };
  return { g, player, world, enemies, critters, npcs, projectiles };
}

// ============================================================
// ★A1 城镇近战暴击掷骰接线（ζ-L1：ProcessHitAgainstNPC :44651-57）
// ============================================================
describe('★A1 townNPC 分支 crit 掷骰 + TownNPC.hurt 第7形参（ζ 接收端）', () => {
  function setup(timerCritStub?: { count: number }) {
    const s = swingStub(3013);
    // equipStats 是冻结记忆化面——经只读代理注入巫毒旗（其余字段全量透传真实值）；
    // timerCritStub 同走代理拦截（覆写蓄能暴击消费位,:44656 的调用面）
    let swallowed = timerCritStub?.count ?? 0;
    const wrapped = new Proxy(s.player, {
      get(t, k, r) {
        if (k === 'equipStats') return { ...Reflect.get(t, k, r), killGuide: true };
        if (k === 'tryConsumingTimerCrit' && timerCritStub) {
          swallowed++;
          return () => true;
        }
        const v = Reflect.get(t, k, r);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    if (timerCritStub) {
      Object.defineProperty(timerCritStub, 'count', {
        get() { return swallowed; }, set(v2: number) { swallowed = v2; }, configurable: true,
      });
    }
    s.g.player = wrapped;
    const guide = new TownNPC('guide', s.player.cx + 8, s.player.y);
    s.npcs.push(guide);
    const seen: Array<unknown[]> = [];
    guide.hurt = function (...args: unknown[]) { seen.push(args); return true; } as typeof guide.hurt;
    return { ...s, guide, seen };
  }

  it('普通掷骰失败路：Math.random 高位钉死 → hurt 收到 crit=false（第7形参位）', () => {
    const { g, seen } = setup();
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.9);   // > 全域阈值
    try { (g as unknown as { updateSwingHits: () => void }).updateSwingHits(); }
    finally { rand.mockRestore(); }
    expect(seen.length).toBeGreaterThanOrEqual(1);
    for (const args of seen) expect(args[6]).toBe(false);         // (dmg,kbx,kby,g,pct,flat,crit)
  });

  it('TimerCrit 强制暴击路（:44656 同函数域）→ crit=true + 实参确定性核对', () => {
    const tc = { count: 0 };
    const { g, seen } = setup(tc);
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.9);   // 与对照案同方差流
    try { (g as unknown as { updateSwingHits: () => void }).updateSwingHits(); }
    finally { rand.mockRestore(); }
    expect(tc.count).toBeGreaterThan(0);                          // 消费被调用且强制暴击
    expect(seen.length).toBe(1);
    expect(seen[0][6]).toBe(true);                                // crit 形参位
    expect(seen[0][0]).toBe(Math.round(50 * 1.12));               // stub dmg=50×varMul1.12=56
  });

  it('接收端：TownNPC.hurt(...,crit=true) 防后 ×2（nurse def=15：49→98）', () => {
    const n = new TownNPC('nurse', 100 * TILE, 99 * TILE);
    const gameStub = {
      world: new World(200, 200, 100, 'a1-receive'),
      player: { x: -9999, y: -9999, w: 0, h: 0, dead: true },
      addDamageNumber: () => {}, spawnParticles: () => {}, playSfx: () => {},
      playSfxFiles: () => {}, critters: () => [], enemies: () => [],
      recLog: null,
    } as never;
    n.hurt(56, 0, 0, gameStub);
    // ★F9/η 截断口径（2026-08-31 蓝队三批）：受击终值 = (int)(dmg − def×0.5)
    // （TownNPC/Enemy 受击统一 trunc；Main.cs:67126-33 double 全程不取整 +
    // (int) 向零截断）——56 − 15×0.5 = 48.5 → 48（旧 half-up round 预期 49 已废）
    expect(n.maxHp - n.hp).toBe(48);
    n.iframes = 0;
    n.hurt(56, 0, 0, gameStub, 0, 0, true);
    expect(n.maxHp - n.hp).toBe(48 + 97);        // 同伤防后 ×2 = (int)(48.5×2)=97
  });
});

// ============================================================
// ★A2 ownerMeleeCritBits 位语义升级（ε#3：Player.Update :25712-714 + Item.cs:585）
// ============================================================
describe('★A2 aux 位4-11 携 meleeCrit 完整终值（含持械 item.crit 折词缀）', () => {
  const fakePlayer = (cc: number) => ({ critChance: (_k: 'melee' | 'ranged' | 'magic') => cc });

  it('无持械信息 = 旧行为面（base4+装备链 clamp≤100）——旧端读出值不破', () => {
    expect(ownerMeleeCritBits(fakePlayer(11)) >> 4).toBe(15);
  });

  it('持械加成并入：item.crit 基值直加、词缀 crt 直加单调不减、上限钳 ≤100', () => {
    let vid = -1;                                  // 数据集真实带 >4% crit 的武器作锚
    for (let i = 400; i < 5200 && vid < 0; i++) if ((itemCombat(i)?.crit ?? 0) > 4) vid = i;
    expect(vid).toBeGreaterThan(0);
    const baseCrit = itemCombat(vid)?.crit ?? 0;
    const totalNoPfx = Math.min(100, 4 + 11 + baseCrit);
    expect(ownerMeleeCritBits(fakePlayer(11), { vid }) >> 4).toBe(totalNoPfx);
    // prefixId=62 是可掷池真实 id（vanillaPrefixes stats 表有档）——crt≥0 单调
    const withPfx = ownerMeleeCritBits(fakePlayer(11), { vid, prefix: 62 }) >> 4;
    expect(withPfx).toBeGreaterThanOrEqual(totalNoPfx);
    expect(ownerMeleeCritBits(fakePlayer(99), { vid, prefix: 62 }) >> 4)
      .toBeLessThanOrEqual(100);                    // 原版有效上限
  });

  it('高值不越 i16 位段余量', () => {
    expect(ownerMeleeCritBits(fakePlayer(50))).toBeLessThan(32768);
  });
});

// ============================================================
// ★α-H1/H3 A3 projClass 数据投影 + 四消费面
// ============================================================
describe('★A3 projClass 数据面与消费面', () => {
  it('数据面逐型核对（SetDefaults 类旗）：javelin/骨弹=melee、蜂无类、蜂王针 magic', () => {
    expect(projClassOfProjId(971)).toBe('melee');   // JavelinStickerProj
    expect(projClassOfProjId(1111)).toBe('melee');  // BoneArrow（:10355-10362）
    expect(projClassOfProjId(181)).toBeNull();      // 蜂（:2675-2686 无类别旗!）
    expect(projClassOfProjId(566)).toBeNull();      // 强蜂（:6174-6186）
    expect(projClassOfProjId(189)).toBe('magic');   // :2777
    expect(projClassOfProjId(undefined)).toBeNull();
    expect(resolveProjClass({ meleeProj: true })).toBe('melee');
    expect(resolveProjClass(null)).toBeNull();
    expect(IS_A_WHIP_PROJS.has(1034)).toBe(true);
    expect(IS_A_WHIP_PROJS.has(1104)).toBe(true);
    expect(DONT_APPLY_PARRY_DAMAGE_BUFF_PROJS.has(524)).toBe(true);
  });

  function hitStub(projId: number | undefined, opts: Partial<{
    parry?: boolean; imbuNano?: boolean; imbuParty?: boolean; imbuIchor?: boolean;
  }> = {}) {
    const spawned: unknown[] = [];
    const hits: Array<{ dmg: number; crit: boolean }> = [];
    const strikeIchors: Array<number> = [];
    const e = { x: 10, y: 10, w: 40, h: 40, id: 7, dead: false, cx: 30, cy: 30,
      vx: 1, vy: 0, ichorT: 0,
      hurt(dmg: number, _kx: number, _ky: number, _g: unknown, _pen?: number, crit?: boolean) {
        hits.push({ dmg, crit: !!crit });
        strikeIchors.push((e as unknown as Record<string, number>).ichorT ?? 0);
        return true;
      } };
    const wants = { nano: opts.imbuNano === true, party: opts.imbuParty === true,
      ichor: opts.imbuIchor === true };
    const pl = {
      buffs: { has: (t: BuffType) =>
        t === BuffType.ImbueNano ? wants.nano
          : t === BuffType.ImbueParty ? wants.party
            : t === BuffType.ImbueIchor ? wants.ichor : false },
      equipStats: { frostBurn: false, magmaStone: false },
      critChance: () => 10,
      parryDamageBuff: opts.parry === true,
      parryDamageBuffT: opts.parry === true ? 300 : 0,
    };
    const game = { player: pl, enemies: () => [e],
      spawnParticles: () => {}, spawnFriendlyProj: (x: unknown) => { spawned.push(x); } } as never;
    const me = { x: 10, y: 10, w: 16, h: 16, vx: 1, vy: 0, damage: 100,
      knockback: 3, projId };
    return { me: me as never, cd: new HitCooldown(), game, hits, spawned, e, strikeIchors };
  }

  it("① 缺省掷按类补默认面：melee 弹未注入 → (4+critChance)/100 自动掷", () => {
    const s = hitStub(1111);
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    try { hitEnemies(s.me, s.game, s.cd, 9999, 1); } finally { rand.mockRestore(); }
    expect(s.hits.length).toBe(1);
    expect(s.hits[0].crit).toBe(true);
    expect(s.hits[0].dmg).toBe(85);                 // ★W01(BJ723-B)改判:DV(100,0.01→−15 档)=85 未翻倍直传(旧 200=预倍形)
  });

  it("①' 无类弹（908 钛金碎片族）/summon 不掷 auto-crit（Projectile.cs:12898 只列三类）", () => {
    const s = hitStub(908);
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.01);     // 若掷必暴——证其未掷
    try { hitEnemies(s.me, s.game, s.cd, 9999, 1); } finally { rand.mockRestore(); }
    expect(s.hits[0].crit).toBe(false);
    expect(s.hits[0].dmg).toBe(85);                 // ★W01 改判:DV −15 档 85(旧 100=无 DV 平值)
  });

  it('③ parryDamageBuff ×5：melee 清 buff 并乘 5；排除族 524 不消费不清除', () => {
    const a = hitStub(1111, { parry: true });       // random 高钉 ⇒ 无 crit 纯净面
    const rA = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try { hitEnemies(a.me, a.game, a.cd, 9999, 1); } finally { rA.mockRestore(); }
    expect(a.hits[0].dmg).toBe(575);                // ★W01 改判:DV(100,0.99→+15 档)=115×5(旧 500=无 DV)
    expect(a.hits[0].crit).toBe(false);
    expect((a.game as never as { player: { parryDamageBuff: boolean } }).player.parryDamageBuff).toBe(false);

    const b = hitStub(524, { parry: true });        // Bladetongue 血舌∈DontApply
    const rB = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try { hitEnemies(b.me, b.game, b.cd, 9999, 1); } finally { rB.mockRestore(); }
    expect(b.hits[0].dmg).toBe(115);                // ★W01 改判:DV(100,0.99→+15 档)=115(旧 100=无 DV)
    expect((b.game as never as { player: { parryDamageBuff: boolean } }).player.parryDamageBuff).toBe(true);
  });

  it('④ nano×1.05（melee||IsAWhip 门）+ confetti 289 真弹出射口', () => {
    // random 高位钉死 ⇒ 恒无暴击（自动掷面被排除,variance 不在本管线）
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const a = hitStub(1111, { imbuNano: true, imbuParty: true });
      hitEnemies(a.me, a.game, a.cd, 9999, 1);
      expect(a.hits[0].dmg).toBe(Math.trunc(115 * 1.05));   // ★W01 改判:DV +15 档 115×1.05(旧 105=无 DV)
      expect(a.spawned.length).toBe(1);

      const whip = hitStub(1034, { imbuNano: true }); // IsAWhip 臂：无类也吃门
      hitEnemies(whip.me, whip.game, whip.cd, 9999, 1);
      expect(whip.hits[0].dmg).toBe(Math.trunc(115 * 1.05));   // ★W01 改判:DV +15 档

      const none = hitStub(1111);
      hitEnemies(none.me, none.game, none.cd, 9999, 1);
      expect(none.spawned.length).toBe(0);
    } finally { rand.mockRestore(); }
  });

  it('②浸剂位次搬前（A5 弹幕侧）：ichor 在 StrikeNPC 调用时已施加（StatusNPC :13640→strike 序）', () => {
    const s = hitStub(971, { imbuIchor: true });    // javelin=melee ⇒ 浸剂门开
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try { hitEnemies(s.me, s.game, s.cd, 9999, 1); } finally { rand.mockRestore(); }
    expect(s.strikeIchors[0]).toBeGreaterThan(0);
  });
});

// ============================================================
// ★α-H4 A4 钛金风暴 OnHit life>5 门（调用位 Player.cs:44678/:13642-44）
// ============================================================
describe('★A4 Enemy.hurt 钛金屏障 on-hit 门（life>5 ∪ statue/488 flag）', () => {
  /** 轻量玩家桩（equipStats 冻结面绕行——hurt 只读 dead/cx/cy/buffs/equipStats/
   *  titaniumStormCd 五面） */
  function titanGame(playerCd = 0): { g: GameHooks; shards: () => number; buff306: () => number } {
    let shards = 0, buff306 = 0;
    const playerStub = {
      dead: false, cx: 1, cy: 1,
      titaniumStormCd: playerCd,
      buffs: {
        has: (_t: number) => false,
        apply(t: number) { if (t === 306) buff306++; },
      },
      equipStats: { titaniumStorm: true, frostBurn: false, magmaStone: false },
      addDPS: () => {},                                  // :12303 DPS 计
      hurtCooldownBuckets: { registerHit: () => {} },     // 命中冷却桶（若消费）
      mpApplyInteraction: () => {},
    };
    const g = {
      player: playerStub,
      spawnParticles: () => {}, addDamageNumber: () => {},
      bannerNpcActive: () => false,
      world: { isExpert: false, isMaster: false, flags: { hardMode: false } },
      bossDamageSink: {},
      spawnTitaniumShard: () => { shards++; },
      playSfxFiles: vi.fn(), playSfxWav: vi.fn(),
      spawnDrop: () => null,                             // 死亡掉落链桩（防死亡链炸测）
      onEnemyKilled: () => {},                           // 击杀链桩
    } as never as GameHooks;
    return { g, shards: () => shards, buff306: () => buff306 };
  }

  it('满血触发：碎片+buff306，冷却窗随后拒第二发', () => {
    const t = titanGame(0);
    const e = Enemy.fromVanilla(1, 60 * TILE, 60 * TILE)!;
    e.hp = 999;                                     // 防死亡链（僵尸 lifeMax 小）
    e.maxHp = 999;                                  // 飘值门 maxHp>1 面
    e.def = { ...e.def, defense: 0 } as typeof e.def;
    e.hurt(20, 0, 0, t.g, 0, false, 1, true);
    expect(t.shards()).toBe(1);
    expect(t.buff306()).toBe(1);
    e.iframes = 0;
    e.hurt(20, 0, 0, t.g, 0, false, 1, true);
    expect(t.shards()).toBe(1);                     // cd=10 窗内不再发
  });

  it('残血≤5 不触发（#α-H4 主案）；statue 敌不触发（:6918 flag 成员）', () => {
    const t = titanGame(0);
    const e = Enemy.fromVanilla(1, 60 * TILE, 60 * TILE)!;
    e.hp = 5;                                       // = 边界值（life>5 才过）
    e.hurt(20, 0, 0, t.g, 0, false, 1, true);
    expect(t.shards()).toBe(0);

    const e3 = Enemy.fromVanilla(1, 60 * TILE, 60 * TILE)!;
    (e3 as unknown as { spawnedFromStatue: boolean }).spawnedFromStatue = true;
    e3.hurt(20, 0, 0, t.g, 0, false, 1, true);
    expect(t.shards()).toBe(0);
  });

  it('488 训练假人不触发（flag 另一成员 :6917）；速度参数语义=Zero（:6930-6934 无方向项）', () => {
    const t = titanGame(0);
    const d488 = Enemy.fromVanilla(488, 60 * TILE, 60 * TILE)!;
    d488.hurt(20, 3, 0, t.g, 0, false, 1, true);   // kbx≠0 亦不 proc
    expect(t.shards()).toBe(0);
  });
});

// 碎片 ≤7 cap 与出射口参数（ownedProjectileCounts[908]<7 支,Player.cs:6931-6934）
describe('★A4 出射口：spawnTitaniumShard ≤7 cap + Zero 速度/dmg50×meleeMult/kb15', () => {
  function shardHarness() {
    const s = swingStub(3013);
    const mkShard = () => ({ projId: 908, dead: false,
      x: 0, y: 0, w: 14, h: 14, damage: 50, knockback: 15 });
    const projs = (s.g.entities as unknown as { projectiles: Array<Record<string, unknown>> }).projectiles;
    return { s, projs, mkShard };
  }
  /** 经 Game.prototype 直调 spawnTitaniumShard（swingStub 的 Object.create 实例） */
  const spawnT = (gInstance: unknown, x: number, y: number): void => {
    ((Game.prototype as unknown as
      { spawnTitaniumShard?: (this: Game, x: number, y: number) => void })
      .spawnTitaniumShard?.call(gInstance as Game, x, y));
  };

  it('已有 7 枚存活 → 不再生成；死亡一枚后恢复可生成', () => {
    const { s, projs, mkShard } = shardHarness();
    for (let i = 0; i < 7; i++) projs.push(mkShard());
    spawnT(s.g, 10, 10);
    expect(projs.length).toBe(7);                   // cap 面（alive 计存活同型）
    (projs[3] as Record<string, unknown>).dead = true;
    spawnT(s.g, 10, 10);
    expect(projs.length).toBe(8);                   // 死档不计数(:6932 active 源)
  });

  it('出射参数：位置居玩家中心、dmg=max(1,round(50×meleeMult))、kb=15', () => {
    const { s, projs } = shardHarness();
    spawnT(s.g, s.player.cx, s.player.cy);
    const sh = projs[0] as unknown as { x: number; y: number; w: number; damage: number; knockback: number };
    expect(sh.damage).toBe(Math.max(1, Math.round(50 * s.player.damageMult('melee'))));
    expect(sh.knockback).toBe(15);
    expect(sh.x + sh.w / 2).toBeCloseTo(s.player.cx, 5);     // NewProjectile X/Y=Center
  });
});

// ============================================================
// ★γ A6 弹 856 EU 化（寿尽 ceil((90-1)/3)=30 tick、曲线逐子步取样）
// ============================================================
describe('★A6 弹 856 numUpdates EU 化', () => {
  it('无接触寿尽在 tick=30 进 Kill（旧口径 89/tick 三倍差收口）', () => {
    const p = new Player(24 * 16, 104 * 16, new Inventory());
    const hooks = { player: p, enemies: () => [], critters: () => [],
      cutTile: () => {},
      world: new World(220, 160, 40, 'a6') } as never as GameHooks;
    const g = new SparkleGuitarProj(900, 900, 50, -30, 81, 1200, 700);
    let diedAt = -1;
    for (let t = 1; t <= 95 && diedAt < 0; t++) {
      g.fixedUpdate(1 / 60, hooks);
      if (g.dead) diedAt = t;
    }
    expect(diedAt).toBe(30);
  });

  it('曲线 EU 取样对拍（红线：不许只改计时）——tick3 后盒心 ≡ 手推 CatmullRom(num2=9/90)', () => {
    const p = new Player(24 * 16, 104 * 16, new Inventory());
    const hooks = { player: p, enemies: () => [], critters: () => [],
      cutTile: () => {},
      world: new World(220, 160, 40, 'a6b') } as never as GameHooks;
    const g = new SparkleGuitarProj(900, 900, 50, -30, 81, 1200, 700);
    for (let t = 1; t <= 3; t++) g.fixedUpdate(1 / 60, hooks);
    const pcx = 24 * 16 + 10, pcy = 104 * 16 + 21;   // Player 中心（20×42 盒）
    const nvx = -50, nvy = 30;                       // vector2=-velocity=(−v×2 前)同式
    const t01 = 9 / 90;                              // 每 tick 三步 ⇒ localAI[0]=9
    const p3x = 1200 + nvx * (1 - t01 * 3), p3y = 700 + nvy * (1 - t01 * 3);
    const x = catmullRomRef(
      { x: pcx + nvx * 2, y: pcy + nvy * 2 }, { x: pcx, y: pcy },
      { x: 1200, y: 700 }, { x: p3x, y: p3y }, t01).x;
    expect(g.x + g.w / 2).toBeCloseTo(x, 4);
  });
});

/** XNA CatmullRom 手抄对拍版（SparkleGuitarProj.catmullRom 同源公式独立实现） */
function catmullRomRef(v1: { x: number; y: number }, v2: { x: number; y: number },
  v3: { x: number; y: number }, v4: { x: number; y: number }, t: number): { x: number; y: number } {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2 * v2.x + (-v1.x + v3.x) * t + (2 * v1.x - 5 * v2.x + 4 * v3.x - v4.x) * t2
      + (-v1.x + 3 * v2.x - 3 * v3.x + v4.x) * t3),
    y: 0.5 * (2 * v2.y + (-v1.y + v3.y) * t + (2 * v1.y - 5 * v2.y + 4 * v3.y - v4.y) * t2
      + (-v1.y + 3 * v2.y - 3 * v3.y + v4.y) * t3),
  };
}

// ============================================================
// ★GC A7 DD2 哨兵真盒（Projectile.cs:7132-7157/:7243-7255）注册面
// ============================================================
describe('★A7 MinionProj 哨兵 SetDefaults 真盒', () => {
  const owner = (): Player | null => null;
  const mk = (pid: number) => new MinionProj(0, 0, pid, 1, 1, true, 0, true, owner);
  it('火焰塔逐型终值：663=30×54 / 665=28×58 / 667=28×60（switch 覆写权威）', () => {
    expect([mk(663).w, mk(663).h]).toEqual([30, 54]);
    expect([mk(665).w, mk(665).h]).toEqual([28, 58]);
    expect([mk(667).w, mk(667).h]).toEqual([28, 60]);
  });
  it('弩车三档恒 26×54；普通随从缺省档不回归', () => {
    expect([mk(677).w, mk(677).h]).toEqual([26, 54]);
    expect([mk(678).w, mk(678).h]).toEqual([26, 54]);
    const plain = new MinionProj(0, 0, 373, 1, 1, false, 0, false, owner);
    expect(plain.w).toBe(16);                        // 五射手非特判型维持基底
  });
});

// ============================================================
// ★三轮蓝队 F5③ 法杖系哨兵真盒补注册（物品 1572/2366/3571/3569/5119/5463→shoot）
// ============================================================
describe('★F5③ MinionProj 法杖系哨兵 SetDefaults 真盒', () => {
  const owner = (): Player | null => null;
  const mk = (pid: number) => new MinionProj(0, 0, pid, 1, 1, true, 0, true, owner);
  it('308=80×74 / 377=66×50 / 966=18×60 / 1025=42×38 / 641·643=32×32', () => {
    expect([mk(308).w, mk(308).h]).toEqual([80, 74]);    // 冰九头蛇(:4001-4002)
    expect([mk(377).w, mk(377).h]).toEqual([66, 50]);    // 蜘蛛皇后(:4619-4620)
    expect([mk(966).w, mk(966).h]).toEqual([18, 60]);    // 猎犬底座(:9146-9147)
    expect([mk(1025).w, mk(1025).h]).toEqual([42, 38]);  // 悬空毒眼球(:9710-9711)
    expect([mk(641).w, mk(641).h]).toEqual([32, 32]);    // 月门(:6919)
    expect([mk(643).w, mk(643).h]).toEqual([32, 32]);    // 彩虹水晶(:6932)
  });
});

// ============================================================
// ★三轮 η 红队：闪电光环 penPercent 双条件门（Projectile.cs:13266-13269）
// ============================================================
describe('lightningAuraPenPercent 门（非 68 且 def<999 ⇒ 1）', () => {
  it('守卫拒：vanillaId===68 或防御≥999 → 0；undefined 兜底按 0 防算', () => {
    expect(lightningAuraPenPercent(68, 0)).toBe(0);        // 地牢守卫族
    expect(lightningAuraPenPercent(15, 999)).toBe(0);      // 高防位（<999 严格比较）
    expect(lightningAuraPenPercent(null, undefined)).toBe(1);
    expect(lightningAuraPenPercent(undefined, 0)).toBe(1);
  });
  it('普通过：普通敌 999 内全给 100% 护穿;贴线 998 过 999 拒', () => {
    expect(lightningAuraPenPercent(202, 20)).toBe(1);
    expect(lightningAuraPenPercent(77, 998)).toBe(1);
  });
});

// ============================================================
// ★ζ#3/#4 A8 countsAsCritter 出口谓词 + MinionShot/SentryShot 数据表接 gate
// ============================================================
describe('★A8 hittableForOnHitRewards 统一出口 + 两张 id 表', () => {
  it('谓词三态（NPC.cs:91152 !CountsAsACritter && !immortal）', () => {
    expect(hittableForOnHitRewards({})).toBe(true);
    expect(hittableForOnHitRewards({ immortal: true })).toBe(false);
    expect(hittableForOnHitRewards({ def: { critter: true } })).toBe(false);
  });

  it('表位全量抽验（ProjectileID.cs Factory.CreateBoolSet 提取线）', () => {
    expect([...MINION_SHOT_PROJS]).toHaveLength(12);
    expect(MINION_SHOT_PROJS.has(614) && MINION_SHOT_PROJS.has(1120)).toBe(true);
    expect([...SENTRY_SHOT_PROJS]).toHaveLength(14);
    expect(SENTRY_SHOT_PROJS.has(309) && SENTRY_SHOT_PROJS.has(967)).toBe(true);
  });

  it('hitCritters gate 接表：木箭杀小动物；374(MinionShot)/309(SentryShot) 被 flag 拒杀', () => {
    const box = { x: 18, y: 18, w: 14, h: 14 };
    const runWith = (projId?: number): { died: boolean; ret: boolean } => {
      const c: { killed: boolean; hurt(): boolean; x: number; y: number; w: number; h: number; dead: boolean }
        = { x: 20, y: 20, w: 12, h: 12, dead: false, killed: false,
            hurt() { this.killed = true; return true; } };
      const gg = { critters: () => [c], player: { equipStats: {} } } as never;
      const selfBox = projId === undefined ? box : { ...box, projId };
      const r = hitCritters(selfBox as never, gg, undefined);
      return { died: c.killed, ret: r };
    };
    // 木箭（projId 1 friendly 非 minion 族）：小动物被一击致死
    expect(runWith(undefined)).toEqual({ died: true, ret: true });
    // MinionShot 成员：flag 组装含表臂 → 拒杀（:eq:20675 全式）
    expect(runWith(374)).toEqual({ died: false, ret: false });
    // SentryShot 成员：即便现无可达路径也由数据面闸住（防未来陷阱）
    expect(runWith(309)).toEqual({ died: false, ret: false });
  });
});
