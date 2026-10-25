// 台账清偿·bossAI 双件回归锚（2026-08-31，duke_moonlord + dd2 批）
// 锚定 approx-registry-2026-08-31.md「bossAI 双件域专项清偿」：
//   ① 月总核心两态/猪鲨四态/鲨龙起扑窗 dontTakeDamage 真旗标（台账①）
//   ② 371 泡泡 1458 行为裁定——命中真实扣血/当拍转引信/破裂音+致命尘环（台账②,报告单列）
//   ⑥ BossNoCheese 免疫槽隔离（Player.damage __swNextHitBucket 门/写两面,P.cs Damage_EVP 分槽表）
//   ⑦ 四型弹重力日程表断言 + 686 两段式全值（AI_001 :58454-58460/:58653-58666/:58513-58529）
//   ⑧ solidBody 全盒 any（半砖骑线不再漏检）
//   ⑤ 686 oldPos 全轨迹扫掠命中（P.cs:16156-16172,TrailCacheLength[686]=20）
//   ⑨ 小妖精引信 startTrackedLoop 跟踪轨句柄面（点火/冲锋双轨 + 俯冲单轨）
import { describe, it, expect, vi, afterEach } from 'vitest';
afterEach(() => { vi.restoreAllMocks(); });   // ★BJ712-C
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import type { Player } from '../src/entities/Player';
import {
  dukeFishronAI, dukeBubbleAI, moonLordCoreAI, sharkronAI,
} from '../src/entities/bossAI_duke_moonlord';
import {
  divingFlyerAI, ai107ImprovedWalkers, DD2BetsyFireball, solidBody,
} from '../src/entities/bossAI_dd2';
import { Arrow } from '../src/entities/Arrow';
import { hitPlayer, evpNoCheeseSlot } from '../src/entities/projTargets';
import {
  HurtCooldownBuckets, registerGlobalHurtBuckets, ImmunityCooldownID,
} from '../src/player/HurtCooldownBuckets';
import { projGravSpec } from '../src/data/vanillaItemCombat';
import { soundTrackFiles } from '../src/data/vanillaNpcs';

// ---------------------------------------------------------------------------
// 假宿主（a-batch4 惯例：enemies/projectiles 同数组；audio/伤害面可插桩）。
// immunity.generalCd 模拟玩家 General 免疫位（Player.immune 40t 语义）；
// BossNoCheese 通道走真实 __swNextHitBucket 瞬态（桶写面在桩内按 num10 落地）。
// ---------------------------------------------------------------------------
interface Rec {
  sounds: string[];
  loops: Array<{ file: string; ops: string[] }>;
  dmgCalls: number[];
  particles: number;
  stops: number;
}

function emptyWorld(): World {
  return new World(200, 200, 42, 'open');
}

function fakePlayer(x: number, y: number, vx = 0, vy = 0): Player {
  return {
    x: x - 10, y: y - 21, w: 20, h: 42, cx: x, cy: y, vx, vy, dead: false,
    iframes: 0, hp: 400, maxHp: 400,
  } as unknown as Player;
}

function makeGame(
  w: World, list: unknown[] = [], projectiles: unknown[] = [], rec?: Rec,
): GameHooks {
  const st = { generalCd: 0 };
  const hooks = {
    world: w,
    player: null as unknown,
    enemies: () => list,
    critters: () => [],
    entities: {
      nextId: 1,
      add: (en: unknown, bucket: string) => { (bucket === 'projectiles' ? projectiles : list).push(en); },
    },
    playSfx: () => {},
    playSfxFile: () => {},
    playSfxFiles: (files: string[]) => { files.forEach((f) => rec?.sounds.push(f)); },
    playSfxWav: (file: string) => { rec?.sounds.push(file); },
    startTrackedLoop: (file: string, _vol: number, _x: number, _y: number) => {
      const h = { file, ops: [] as string[] };
      if (!rec) return null;
      rec.loops.push(h);
      return {
        stop: () => { h.ops.push('stop'); rec.stops += 1; },
        setPos: () => { h.ops.push('pos'); },
      };
    },
    spawnParticles: () => { rec && (rec.particles += 1); },
    addDamageNumber: () => {}, spawnDrop: () => null, cutTile: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, notifyInventoryChanged: () => {},
    onProjectileDeath: () => {},
    damagePlayer: (dmg: number) => {
      const p = hooks.player as
        | { __swNextHitBucket?: { id: number; table: HurtCooldownBuckets } | undefined }
        | null | undefined;
      const bkt = p?.__swNextHitBucket;
      if (bkt) {                                          // BossNoCheese：独立桶门/写面
        if (bkt.table.blocksHit(bkt.id)) return 0;
        bkt.table.applyAfterHit(bkt.id, 40);
        rec?.dmgCalls.push(dmg);
        return dmg;
      }
      if (st.generalCd > 0) return 0;                     // General 免疫位
      st.generalCd = 40;
      rec?.dmgCalls.push(dmg);
      return dmg;
    },
  };
  return hooks as unknown as GameHooks;
}

// ===========================================================================
// ② 371 泡泡 1458 行为裁定（报告顶部单列项）
// ===========================================================================
describe('371 泡泡 1458 裁定', () => {
  it('命中照常扣血（Enemy.hurt 零伤早退退役），血尽拍经 AI 首行转引信态', () => {
    const w = emptyWorld();
    const rec: Rec = { sounds: [], loops: [], dmgCalls: [], particles: 0, stops: 0 };
    const game = makeGame(w, [], [], rec);
    const b = Enemy.fromVanilla(371, 100 * TILE, 100 * TILE)!;
    const hp0 = b.hp;
    // 通用管线照走（lifeMax=1 时 CombatText/HitSound 的 maxHp>1 门静音=原版一致）
    // + legacy 死音库 style3 破裂音（StrikeNPC :85185 PlaySound(4,…,3)）
    expect(b.hurt(500, 0, 0, game)).toBe(false);
    expect(b.hp).toBeLessThan(hp0);
    expect(rec.sounds.filter((s) => s === 'NPC_Killed_3').length).toBe(1);
    // 血尽放行 → dukeBubbleAI 首行接管 checkDead 转换(:78850-78855)
    dukeBubbleAI(b, game, null);
    expect(b.ai0).toBe(1);                             // checkDead → 引信态
    expect(b.ai1).toBeLessThanOrEqual(4);              // 首拍已进入引信递减(同一拍)
    expect(b.hp).toBe(b.maxHp);                        // PrepareForDeathAnimation
    expect(b.dontTakeDamage).toBe(true);               // 后续弹被拒
    expect(b.hurt(500, 0, 0, game)).toBe(false);
    expect(rec.particles).toBeGreaterThanOrEqual(1);   // 致命拍蓝环尘近似
    // 引信扩盒 100×100、4t 消散（不走掉落管线 :35262-35268）
    expect(b.w).toBe(100);
    let burstTicks = 0;
    while (!b.dead && burstTicks < 6) { dukeBubbleAI(b, game, null); burstTicks += 1; }
    expect(b.dead).toBe(true);
  });

  it('非致命擦伤同样经 justHit 即刻进引信态（aiStyle70 :35270 justHit||ai[0]==1 支）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const b = Enemy.fromVanilla(371, 100 * TILE, 100 * TILE)!;
    b.bInit = true;
    b.maxHp = 5000;                                    // 构造擦伤面
    b.hp = 4900;
    b.justHitT = 2;                                    // 单帧受击旗标
    dukeBubbleAI(b, game, null);
    expect(b.ai0).toBe(1);
    expect(b.dontTakeDamage).toBe(true);
    expect(b.hurt(1, 0, 0, game)).toBe(false);
  });

  it('随机尺寸 scale=ai[3] 应用到渲染面（C 条目,:35226 scale = ai[3] 每拍恒等式）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const b = Enemy.fromVanilla(371, 100 * TILE, 100 * TILE)!;
    b.bInit = true;
    b.ai3 = 1.05;                                      // Next(80,121)/100 抽象值
    dukeBubbleAI(b, game, null);
    expect(b.vanillaScale).toBeCloseTo(1.05, 10);
  });
});

// ===========================================================================
// ① dontTakeDamage 真旗标族
// ===========================================================================
describe('dontTakeDamage 真旗标（台账①）', () => {
  it('月总核心 -1 出生/-2 归位持旗(NPC.cs:41601/:41625)、phase1 显式清(:41719-41726)', () => {
    const w = emptyWorld();
    const list: Enemy[] = [];
    const game = makeGame(w, list as unknown[]);
    const core = Enemy.fromVanilla(398, 100 * TILE, 100 * TILE)!;
    list.push(core);
    moonLordCoreAI(core, game, fakePlayer(101 * TILE, 100 * TILE));
    expect(core.ai0).toBe(-1);
    expect(core.dontTakeDamage).toBe(true);
    for (let t = 0; t < 62; t++) moonLordCoreAI(core, game, fakePlayer(101 * TILE, 100 * TILE));
    expect(core.ai0).toBe(0);                          // 出生演毕进 phase0
    expect(core.dontTakeDamage).toBe(true);            // phase0 继续持旗(:41668)
    core.ai0 = 1;                                      // 三残肢解锁态直驱
    moonLordCoreAI(core, game, fakePlayer(101 * TILE, 100 * TILE));
    expect(core.dontTakeDamage).toBe(false);           // phase1 每 tick 清(:41726)
  });

  it('猪鲨四态持旗、常规态清旗(:49519/:49815/:50040/:50202 → :50278 每拍双向)', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const d = Enemy.fromVanilla(370, 100 * TILE, 60 * TILE)!;
    const p = fakePlayer(104 * TILE, 61 * TILE);
    dukeFishronAI(d, game, p);                         // bInit=-1 出生态
    expect(d.dontTakeDamage).toBe(true);
    for (const s of [4, 9]) {                          // 两段变身态
      d.ai0 = s; d.ai2 = 0;
      dukeFishronAI(d, game, p);
      expect(d.dontTakeDamage).toBe(true);
    }
    d.ai0 = 12; d.ai2 = 0;                             // 瞬移段
    dukeFishronAI(d, game, p);
    expect(d.dontTakeDamage).toBe(true);
    d.ai0 = 1;                                         // 冲撞（可受击态）
    dukeFishronAI(d, game, p);
    expect(d.dontTakeDamage).toBe(false);
  });

  it('鲨鱼龙:升空无敌→嵌块蓄势窗保持无敌→离块起扑解除(AI_071 :35300/:35381)', () => {
    const w = emptyWorld();
    for (let x = 95; x <= 106; x++) {
      for (const y of [55, 56, 57, 58]) w.store.setTile(x, y, 1);   // 嵌体块
    }
    const game = makeGame(w);
    const s = Enemy.fromVanilla(372, 100 * TILE, 55.4 * TILE)!;
    sharkronAI(s, game, fakePlayer(110 * TILE, 100 * TILE));       // 升空蓄力首拍
    expect(s.dontTakeDamage).toBe(true);
    for (let t = 0; t < 90; t++) sharkronAI(s, game, fakePlayer(110 * TILE, 100 * TILE));
    expect(s.ai0).toBe(1);                                         // 蓄力期满转起扑
    expect(s.ai1).toBeLessThan(1);                                 // 原地嵌块 → 受阻延后
    expect(s.dontTakeDamage).toBe(true);                           // ★起扑窗持续无敌
    sharkronAI(s, game, fakePlayer(110 * TILE, 100 * TILE));
    expect(s.dontTakeDamage).toBe(true);
    s.x = 130 * TILE; s.y = 52 * TILE;                             // 移出体外自由空域
    sharkronAI(s, game, fakePlayer(110 * TILE, 100 * TILE));
    expect(s.ai1).toBeGreaterThanOrEqual(1);
    expect(s.dontTakeDamage).toBe(false);                          // :35381 起扑生效解除
  });
});

// ===========================================================================
// ⑥ BossNoCheese 免疫槽隔离
// ===========================================================================
describe('BossNoCheese 免疫槽（台账⑥,Damage_EVP P.cs:14853-14858 分槽表）', () => {
  it('死光/幻影族不吃 General 无敌帧、按独立 40t 槽节流；普通敌弹仍吃 General 门', () => {
    const buckets = new HurtCooldownBuckets();
    registerGlobalHurtBuckets(buckets);
    try {
      const w = emptyWorld();
      const p = fakePlayer(100 * TILE, 100 * TILE);
      p.iframes = 100;                                 // 通用无敌帧拉满
      const hooks = makeGame(w, [], []);
      (hooks as unknown as { player: Player }).player = p;

      const general = { x: p.x - 10, y: p.y - 20, w: 30, h: 30, projId: 999 };
      expect(hitPlayer(general, hooks, 50)).toBe(false);          // General 弹被 immune 位拦

      const ray = { x: p.x - 10, y: p.y - 20, w: 30, h: 30, projId: 455 };
      expect(hitPlayer(ray, hooks, 75)).toBe(true);               // 死光穿透 General 帧
      expect(buckets.remaining(ImmunityCooldownID.BossNoCheese)).toBe(40);
      expect(hitPlayer(ray, hooks, 75)).toBe(false);              // 独立桶节流

      const orb = { x: p.x - 10, y: p.y - 20, w: 30, h: 30, projId: 454 };
      expect(hitPlayer(orb, hooks, 60)).toBe(false);              // 幻影能量球共享同一槽

      expect(evpNoCheeseSlot(462)).toBe(true);                    // 幻影矢入轨
      expect(evpNoCheeseSlot(923)).toBe(true);                    // 灾厄天界弹族同表
      expect(evpNoCheeseSlot(686)).toBe(false);                   // 火球仍走 General
    } finally {
      registerGlobalHurtBuckets(null);
    }
  });
});

// ===========================================================================
// ⑦ 四型弹重力日程表 + ⑤⑧ 686 扫掠/两段式
// ===========================================================================
describe('DD2 弹幕物理（台账⑦⑤）', () => {
  it('projGravSpec 规格链逐型取值', () => {
    expect(projGravSpec(662)).toEqual({ grav: 0.3, delay: 61 });   // 标枪:>60 才弧化
    expect(projGravSpec(685)).toEqual({ grav: 0.3, delay: 61 });   // T3 标枪同档
    expect(projGravSpec(671)).toEqual({ grav: 0.1, delay: 15 });   // 德拉肯:>=15 才 +0.1
    expect(projGravSpec(676)).toEqual({ grav: 0.1, delay: 15 });   // 食人魔涎同兜底支
  });

  it('662 标枪前 60 update 平飞、第 61 update 起弧化(vy+=0.3 且 vx*=0.98 同拍)', () => {
    const w = emptyWorld();
    const hooks = makeGame(w, [], []);
    (hooks as unknown as { player: Player }).player = fakePlayer(400 * TILE, 400 * TILE);
    const j = new Arrow(100 * TILE, 100 * TILE, 11.5, 0, 15, 0, 662, { hostile: true });
    const vy: number[] = [];
    for (let t = 0; t < 70; t++) { vy.push(j.vy); j.fixedUpdate(1 / 60, hooks); }
    for (let t = 0; t <= 60; t++) expect(vy[t]).toBe(0);        // 前 60t 直飞相缺失面已修
    expect(vy[61]).toBeCloseTo(0.3, 10);                        // 第 61 update 起 0.3/t
    expect(vy[69]).toBeCloseTo(2.7, 10);
    void w;
  });

  it('671 德拉肯弹前 15 update 直飞、此后 0.1/t（"两式"斜率）；无 X 阻力', () => {
    const w = emptyWorld();
    const hooks = makeGame(w, [], []);
    (hooks as unknown as { player: Player }).player = fakePlayer(400 * TILE, 400 * TILE);
    const k = new Arrow(100 * TILE, 100 * TILE, 13, 0, 25, 0, 671, { hostile: true });
    const vy: number[] = [];
    for (let t = 0; t < 24; t++) { vy.push(k.vy); k.fixedUpdate(1 / 60, hooks); }
    for (let t = 0; t < 15; t++) expect(vy[t]).toBe(0);         // 直飞相
    expect(vy[15]).toBeCloseTo(0.1, 10);
    expect(vy[23]).toBeCloseTo(0.9, 10);
  });

  it('686 专用实体:≥10 +0.1/t、≥20 合计 0.2/t、vx×0.99 恒定、vy 上限 32', () => {
    const w = emptyWorld();
    const rec: Rec = { sounds: [], loops: [], dmgCalls: [], particles: 0, stops: 0 };
    const hooks = makeGame(w, [], [], rec);
    (hooks as unknown as { player: Player }).player = fakePlayer(400 * TILE, 400 * TILE);
    const f = new DD2BetsyFireball(hooks, 100 * TILE, 100 * TILE, 12, 0, 35);
    const vy: number[] = [];
    for (let t = 0; t < 120 && !f.dead; t++) { vy.push(f.vy); f.fixedUpdate(1 / 60, hooks); }
    expect(vy[9]).toBe(0);                              // ai[0]<10 无重力
    expect(vy[10]).toBeCloseTo(0.1, 10);                // 第 10 update 起一档
    expect(vy[19]).toBeCloseTo(1.0, 10);                // 十拍 ×0.1
    expect(vy[21]).toBeCloseTo(vy[19] + 0.4, 10);       // 第 20 update 起两档并存=0.2/t
    expect(f.vy).toBeLessThanOrEqual(32);
    // 出膛音:AI_001 type686 支首帧 PlayTrackedSound(:57487-57490)——多变体组逐文件入录
    expect(rec.sounds.filter((s) => s.startsWith('dd2_betsy_fireball')).length)
      .toBe(soundTrackFiles('dd2_betsy_fireball_shot').length);
  });

  it('686 尾迹扫掠:当前盒已越过而尾迹盒命中 → 单盒单测必漏、扫掠必中且免疫帧去重', () => {
  // ★BJ712-C：DamageVar 首掷入参包装（P.cs:14904）后链带 ±15% 掷——mock 0.5
  // = tier 0 档（×1.0）,表值即掷中值;掷形面由 tests/bj712c-martian-dmg 三掷形承载
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const w = emptyWorld();
    const rec: Rec = { sounds: [], loops: [], dmgCalls: [], particles: 0, stops: 0 };
    const hooks = makeGame(w, [], [], rec);
    const p = fakePlayer(100 * TILE, 100 * TILE);
    (hooks as unknown as { player: Player }).player = p;
    // 出膛盒心对准玩家心(trail[0]=移动前盒即命中),速度 50 → 移动后当前盒整体越过
    const f = new DD2BetsyFireball(hooks, p.cx, p.cy, 50, 0, 35);
    f.fixedUpdate(1 / 60, hooks);
    expect(rec.dmgCalls.length).toBe(1);
    expect(rec.dmgCalls[0]).toBeGreaterThan(60);        // 经典 35 × 通用乘区×2 = 70
    f.fixedUpdate(1 / 60, hooks);
    expect(rec.dmgCalls.length).toBe(1);                // General 免疫位去重(旧尾迹不重复计)
  });
});

// ===========================================================================
// ⑧ solidBody 全盒 any
// ===========================================================================
describe('solidBody 全盒 any（台账⑨）', () => {
  it('内部列含实心而四角/中心采样点皆空时仍判真（五点采样曾漏爆的面）', () => {
    const w = emptyWorld();
    const st = w.store;
    const game = makeGame(w);
    st.setTile(24, 100, 1);                                       // 单格砖(col24,row100)
    const body = Enemy.fromVanilla(574, 0, 0)!;
    body.w = 64; body.h = 14;
    body.x = 23 * TILE + 8;                                       // 盒跨 col23..27
    body.y = 100 * TILE + 1;
    expect(body.vanillaId).toBe(574);
    // 采样五点 = 左上/右上/左下/右下(col23/27)+中心(col25) 全落空列;
    // 内部 col24 含砖 → 全盒 any 必真
    expect(solidBody(game, body)).toBe(true);
    st.setTile(24, 100, 0);
    expect(solidBody(game, body)).toBe(false);
  });
});

// ===========================================================================
// ⑨ 小妖精引信跟踪循环轨
// ===========================================================================
describe('小妖精引信循环轨（台账⑨,startTrackedLoop 跟踪轨）', () => {
  it('地面型:点火窗 30 拍起双轨、冲锋窗位置随动且不重触发、再触发起爆拆轨', () => {
    const w = emptyWorld();
    const list: Enemy[] = [];
    const rec: Rec = { sounds: [], loops: [], dmgCalls: [], particles: 0, stops: 0 };
    const game = makeGame(w, list as unknown[], [], rec);
    const p = fakePlayer(102 * TILE, 100 * TILE);
    (game as unknown as { player: Player }).player = p;
    const k = Enemy.fromVanilla(572, 100 * TILE, 100 * TILE)!;
    list.push(k);
    k.bInit = true;
    k.ai0 = 40; k.ai1 = 0; k.vx = 0; k.vy = 0; k.facing = 1;    // 点火窗直驱
    for (let t = 0; t < 32; t++) ai107ImprovedWalkers(k, game, p);
    const started = rec.loops.filter((l) =>
      l.file === 'dd2KoboldIgniteLoop' || l.file === 'dd2KoboldChargeLoop');
    // ★终清波:键改 WAV_MAP 逻辑名(dd2KoboldIgniteLoop/dd2KoboldChargeLoop)——
    //   旧 raw 文件名键未入 WAV_MAP,startTrackedLoop 在实机恒 null(仅测试 mock 收),
    //   键补齐后两轨真通;测试随接线面改名
    expect(started.length).toBe(2);                    // 双轨各建一次(GetActiveSound-null 语义)
    k.ai0 = 0; k.ai1 = 1;                              // 冲锋窗
    ai107ImprovedWalkers(k, game, p);
    ai107ImprovedWalkers(k, game, p);
    expect(started.every((l) => l.ops.includes('pos'))).toBe(true);
    expect(rec.loops.length).toBe(started.length);     // 不重触发
    k.ai0 = 1; k.ai1 = 2;                              // 再触发 → 起爆
    ai107ImprovedWalkers(k, game, p);
    expect(rec.stops).toBeGreaterThanOrEqual(2);
  });

  it('俯冲滑翔怪 574:俯冲 ai[1]>=20 起单轨、退出俯冲即停（此前整段缺失）', () => {
    const w = emptyWorld();
    const list: Enemy[] = [];
    const rec: Rec = { sounds: [], loops: [], dmgCalls: [], particles: 0, stops: 0 };
    const game = makeGame(w, list as unknown[], [], rec);
    const p = fakePlayer(103 * TILE, 103 * TILE);
    (game as unknown as { player: Player }).player = p;
    const f = Enemy.fromVanilla(574, 100 * TILE, 100 * TILE)!;
    list.push(f);
    f.bInit = true;
    f.spawnAlpha = 0;
    f.ai0 = 2; f.ai1 = 25;                             // 俯冲中段直驱
    divingFlyerAI(f, game, p);
    const igns = rec.loops.filter((l) => l.file === 'dd2KoboldIgniteLoop');
    expect(igns.length).toBe(1);
    f.ai0 = 0; f.ai1 = 45;                             // 回旋态退出俯冲
    divingFlyerAI(f, game, p);
    expect(igns[0].ops.includes('stop')).toBe(true);
  });
});
