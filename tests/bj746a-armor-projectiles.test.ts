// ★BJ746-A（issue#35 弹幕/AI 域子集,2026-11-01）：盔甲审计 16 件行为锁。
//  覆盖：A12-A14 钛金碎片 908 / A22 日曜冲撞爆闪 / A23-A25 幽灵兜帽治疗弹 /
//  A26 幽灵面具浮魂弹 356 / A29 烈焰塔死亡溅射 / A32-A33 星尘守护者 /
//  A34-A37 宝石袍族（发射端/特性序/转向源/反弹轴）。
//  反编译锚（Terarria1457 盘上亲读）：
//   · AI_175_TitaniumStormShards :46150-46175（相位=player.miscCounterNormalized×6,
//     Center+=player.position−player.oldPosition）;SetDefaults 908 :8627-8638
//     （penetrate=1/timeLeft=3600）;Damage_PVE_Inner :12635 flag3 / :14190-96 单穿截断
//   · DashMovement :21293-21352（(int)num5 直伤+NewProjectile(608).Kill 爆闪）;
//     608 Kill :73438-（penetrate=-1+Damage() 160 盒）
//   · ghostHeal :12097-12109（生成时跨槽选最缺血,3000 距离,PvP 门）;AI_052 :28928-;
//     NewProjectile :10878-79（中心语义）;timeLeft-- :17307（子步内）
//   · 356 SetDefaults :4466-4475 magic=true → DamageVar :12970/magicCrit :12915-27/
//     穿甲 :12852+:13685
//   · 664/666/668 Kill :73049-73160（96/208 盒 Damage();usesLocal+cd-1 免疫面;
//     penetrate 梯 :14189-96）
//   · AI_120_StardustGuardian :45453-45783（:45705-12 锁靶 CanBeChasedBy 失效即退;
//     :45468-73 timeLeft=2 续写=卸装 2 拍宽限）
//   · FinalizeProjectile_GemStaves :22259-96（ArPenSpread+4 穿甲）;AI_029 :38562-38641
//     （Homing→Swirl→FastThenSlow 序;num13=加速前速度）;HandleMovement :18105-18164
//     （CanBounce 逐轴反+重定向+清拖尾;FastThenSlow 贴壁）
//  变异恰红：每节【旧码必红项】注明。钛金/叶弹部分先例=bj383/chloro-setbonus。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { TileStore } from '../src/world/TileStore';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Arrow } from '../src/entities/Arrow';
import { HealProj } from '../src/entities/HealProj';
import { SpectreSoulProj } from '../src/entities/SpectreSoulProj';
import { MinionProj } from '../src/entities/MinionProj';
import { TitaniumStormShard } from '../src/entities/proj1457';
import { Game } from '../src/core/Game';
import { BuffType } from '../src/stats/Buffs';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');
const TILE = 16;

afterEach(() => { vi.restoreAllMocks(); });

// ---- 通用桩（bj383 同源）----
interface HitCall { d: number; crit: boolean; pen: number; pierce: number }
function mkEnemy(id: number, x: number, y: number, w = 24, h = 24,
  vanillaId: number | null = 15) {
  const e = {
    id, x, y, w, h, dead: false, vanillaId, maxHp: 100, hp: 100,
    iframes: 0, dontTakeDamage: false, vx: 0, vy: 0, attempts: 0,
    get cx() { return this.x + this.w / 2; },
    get cy() { return this.y + this.h / 2; },
    hurt(dmg: number, _kx: number, _ky: number, _g: unknown, pen = 0, crit = false,
      pierce = 0): boolean {
      (e as unknown as { calls: HitCall[] }).calls.push({ d: dmg, crit, pen, pierce });
      return true;
    },
    calls: [] as HitCall[],
  };
  return e;
}

function makeHooks(opts: {
  enemies?: unknown[]; critters?: unknown[]; projectiles?: unknown[];
  player?: Record<string, unknown>;
} = {}): GameHooks {
  const player = opts.player ?? {
    equipStats: {}, cx: 80 * TILE, cy: 90 * TILE, x: 80 * TILE - 10, y: 90 * TILE - 21,
    w: 20, h: 42, dead: false, facing: 1, vx: 0, vy: 0,
    buffs: { has: () => false },
  };
  const hooks = {
    world: { store: new TileStore(200, 120) } as never,
    player,
    enemies: () => opts.enemies ?? [],
    critters: () => opts.critters ?? [],
    projectiles: () => opts.projectiles ?? [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    onProjectileDeath: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    spawnDust: () => null,
    notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    playSfxWav: () => {}, playSfxAt: () => {},
    showPickupLabel: () => {},
    addLightAt: () => {},
  };
  return hooks as unknown as GameHooks;
}

/** 钛金碎片玩家桩：buff306 在身 + 可控 miscCounterNormalized/oldPosition */
function titaniumPlayer(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    equipStats: {}, cx: 80 * TILE, cy: 90 * TILE, x: 80 * TILE - 10, y: 90 * TILE - 21,
    w: 20, h: 42, dead: false, facing: 1, vx: 0, vy: 0,
    buffs: { has: (t: number) => t === BuffType.TitaniumStorm },
    miscCounterNormalized: 1 / 300,
    ...over,
  };
}

// ═══════════════ A12-A14：钛金碎片 908（AI_175） ═══════════════

describe('BJ746 A12：碎片相位源=玩家全局 miscCounterNormalized + 位移补偿', () => {
  it('A12a 相位=(index/total+miscCounterNormalized×6)×2π——单片首拍角 0.12566（旧 t/60×6=0.6283 五倍速必红）', () => {
    const shard = new TitaniumStormShard(80 * TILE, 90 * TILE, 50, 5);
    const g = makeHooks({ projectiles: [shard], player: titaniumPlayer() });
    shard.fixedUpdate(1, g);
    // f=(0+6/300)×2π=0.1256637;半径=24+1×6=30;目标=player.Center+(cos,sin×0.05)×30
    // 出生左上=(1280−7,1440−7);Lerp 0.3
    const f = (1 / 300 * 6) * Math.PI * 2;
    const tx = 80 * TILE + Math.cos(f) * 30 - 7;
    const ty = 90 * TILE + Math.sin(f) * 30 * 0.05 - 7;
    expect(shard.x).toBeCloseTo(80 * TILE - 7 + (tx - (80 * TILE - 7)) * 0.3, 4);
    expect(shard.y).toBeCloseTo(90 * TILE - 7 + (ty - (90 * TILE - 7)) * 0.3, 4);
  });

  it('A12b miscCounter 冻结 → 相位冻结（位置收敛静止;旧自身年龄驱动=持续公转必红）', () => {
    const shard = new TitaniumStormShard(80 * TILE, 90 * TILE, 50, 5);
    const g = makeHooks({ projectiles: [shard], player: titaniumPlayer() });
    for (let i = 0; i < 60; i++) shard.fixedUpdate(1, g);
    const f = (1 / 300 * 6) * Math.PI * 2;
    const tx = 80 * TILE + Math.cos(f) * 30 - 7;           // 冻结目标（Lerp 已收敛）
    const ty = 90 * TILE + Math.sin(f) * 30 * 0.05 - 7;
    expect(shard.x).toBeCloseTo(tx, 3);
    expect(shard.y).toBeCloseTo(ty, 3);
    // 旧码 t=60 → 相位=6×2π≡0 → 目标在 cos(0)×30 侧,≠冻结目标（判别距 ~60px）
  });

  it('A12c 玩家位移补偿：Center+=position−oldPosition（+10px 全额贴移;旧纯 Lerp 只追 +3 必红）', () => {
    // 先收敛到冻结相位目标（miscCounter 恒定）
    const shard = new TitaniumStormShard(80 * TILE, 90 * TILE, 50, 5);
    const g = makeHooks({ projectiles: [shard], player: titaniumPlayer() });
    for (let i = 0; i < 60; i++) shard.fixedUpdate(1, g);
    const before = shard.x;
    // 玩家本拍位移 +10（oldX=旧位,x=新位,cx 同步 +10）→ 目标亦 +10,补偿后 Lerp 增量=0
    const g2 = makeHooks({
      projectiles: [shard],
      player: titaniumPlayer({
        x: 80 * TILE - 10 + 10, oldX: 80 * TILE - 10, y: 90 * TILE - 21, oldY: 90 * TILE - 21,
        cx: 80 * TILE + 10, cy: 90 * TILE,
      }),
    });
    shard.fixedUpdate(1, g2);
    expect(shard.x - before).toBeCloseTo(10, 4);           // 全额位移（旧=10×0.3=3）
  });
});

describe('BJ746 A13：碎片单穿语义（penetrate=1 flag3）', () => {
  it('A13a 同拍两重叠敌 → 只结算桶序首个（旧两敌各吃必红）', () => {
    const e1 = mkEnemy(1, 80 * TILE - 12, 90 * TILE - 12);
    const e2 = mkEnemy(2, 80 * TILE - 12, 90 * TILE - 12);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);         // DV 中性档（tier 0 ×1）
    const shard = new TitaniumStormShard(80 * TILE, 90 * TILE, 50, 5);
    const g = makeHooks({ enemies: [e1, e2], projectiles: [shard], player: titaniumPlayer() });
    shard.fixedUpdate(1, g);
    expect(e1.calls.length).toBe(1);
    expect(e2.calls.length).toBe(0);                       // keepIterating=false（:14194）
    expect(shard.dead).toBe(true);                         // 单发命中即亡
  });

  it('A13b 全局免疫靶照打（flag3 豁免 :12636;旧 iframes>0 跳过必红）', () => {
    const e = mkEnemy(1, 80 * TILE - 12, 90 * TILE - 12);
    e.iframes = 10;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const shard = new TitaniumStormShard(80 * TILE, 90 * TILE, 50, 5);
    const g = makeHooks({ enemies: [e], projectiles: [shard], player: titaniumPlayer() });
    shard.fixedUpdate(1, g);
    expect(e.calls.length).toBe(1);
    expect(shard.dead).toBe(true);
  });
});

describe('BJ746 A14：碎片 3600 拍自然寿命（timeLeft :8632/:17307）', () => {
  it('持续维持 buff：3599 拍存活,第 3600 拍自然消亡（旧无寿命面=恒活必红）', () => {
    const shard = new TitaniumStormShard(80 * TILE, 90 * TILE, 50, 5);
    const g = makeHooks({ projectiles: [shard], player: titaniumPlayer() });
    for (let i = 0; i < 3599; i++) {
      shard.fixedUpdate(1, g);
      if (shard.dead) throw new Error(`提前亡于第 ${i + 1} 拍`);
    }
    expect(shard.dead).toBe(false);
    shard.fixedUpdate(1, g);
    expect(shard.dead).toBe(true);
  });
});

// ═══════════════ A22：日曜冲撞爆闪（DashMovement :21293-21352） ═══════════════

describe('BJ746 A22：日曜冲撞 (int) 截断 + 每次碰撞 608 范围爆闪', () => {
  const driveDash = (hooks: GameHooks, player: Player): void => {
    (player as unknown as { dashMovement: (g: GameHooks, eq: unknown, ix: number,
      spd: number, db: boolean, slow: number) => void })
      .dashMovement(hooks, { dash: 0, runSlowMul: 1, moveMult: 1 }, 0, 1, false, 1);
  };
  const solarPlayer = (enemies: unknown[]): { hooks: GameHooks; player: Player } => {
    const world = new World(200, 120, 7, 'bj746a-solar');
    const player = new Player(60 * TILE, 90 * TILE, new Inventory());
    const hooks: GameHooks = {
      world: world as never, player: player as never,
      enemies: () => enemies, npcs: () => [], critters: () => [],
      spawnDrop: () => null, damagePlayer: (): number => 0,
      addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {},
      spawnEnemy: () => {}, spawnParticles: () => {}, spawnDust: () => null,
      notifyInventoryChanged: () => {}, playSfx: () => {}, playSfxFiles: () => {},
      showPickupLabel: () => {},
      entities: { add: () => undefined, projectiles: [] } as never,
    } as unknown as GameHooks;
    return { hooks, player };
  };

  it('A22a 直接基伤 150×1.25=187（(int) 截断;旧 round=188 必红）', () => {
    const e = mkEnemy(1, 975, 1450, 20, 20);
    const { hooks, player } = solarPlayer([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player, 'damageMult').mockReturnValue(1.25);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);         // 50≥4 不暴;DV tier 0 ×1
    player.solarDashing = true; player.dashDelay = -1; player.dashLatched = 3;
    player.solarShields = 1; player.vx = 21.9;
    driveDash(hooks, player);
    expect(e.calls[0]!.d).toBe(187);                       // 直击（ApplyDamageToNPC 无 DV）
  });

  it('A22b 每次碰撞生成 608 爆闪：160 盒邻靶吃 AoE（旧邻靶 0 伤必红）;直击靶双吃（原版 ApplyDamageToNPC 不写 immune）', () => {
    // 直击靶 e1（冲撞盒内）;邻靶 e2 距玩家 50px（160 盒内、直撞盒外）
    const e1 = mkEnemy(1, 975, 1450, 20, 20);
    const e2 = mkEnemy(2, 1030, 1450, 20, 20);             // 距玩家心 ~70px < 80 半宽
    const { hooks, player } = solarPlayer([e1, e2]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player, 'damageMult').mockReturnValue(1);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    player.solarDashing = true; player.dashDelay = -1; player.dashLatched = 3;
    player.solarShields = 1; player.vx = 21.9;
    driveDash(hooks, player);
    expect(e1.calls.length).toBe(2);                       // 直击 + AoE 第二击
    expect(e1.calls[0]!.d).toBe(150);
    expect(e1.calls[1]!.d).toBe(150);                      // AoE（DV tier0 ×1）
    expect(e1.calls[1]!.pierce).toBe(-1);                  // 608 写 10t 档
    expect(e2.calls.length).toBe(1);                       // ★主判别：邻靶 AoE（旧=0）
    expect(e2.calls[0]!.d).toBe(150);
    expect(e2.calls[0]!.pierce).toBe(-1);
    expect(e1.iframes).toBe(6);                            // :21348 爆闪后写 6
  });

  it('A22c AoE 免疫门：远处 iframes>0 靶拒收（pierce=-1 走全局窗门）', () => {
    const e1 = mkEnemy(1, 975, 1450, 20, 20);
    const e2 = mkEnemy(2, 1030, 1450, 20, 20);
    e2.iframes = 10;
    const { hooks, player } = solarPlayer([e1, e2]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player, 'damageMult').mockReturnValue(1);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    player.solarDashing = true; player.dashDelay = -1; player.dashLatched = 3;
    player.solarShields = 1; player.vx = 21.9;
    driveDash(hooks, player);
    expect(e2.calls.length).toBe(0);                       // 全局免疫拒收（flag3 假）
  });
});

// ═══════════════ A23：鬼疗选靶（ghostHeal :12097-12109） ═══════════════

describe('BJ746 A23：applyLifeSteal ghost 生成时跨槽选最缺血者', () => {
  const realSteal = Game.prototype.applyLifeSteal;
  const mkFake = (p: Player, cands: Player[], heals: unknown[]): Game => {
    const fake = {
      player: p, entities: { add: (e: unknown) => { heals.push(e); } },
      candidatePlayers: () => cands,
    } as unknown as Game;
    return fake;
  };
  const hoodOn = (p: Player): void => {
    Object.defineProperty(p, 'equipStats', {
      value: Object.freeze({ ...p.equipStats, setBonus: { ...(p.equipStats.setBonus ?? {}), ghostHeal: true } }),
      configurable: true,
    });
  };

  it('A23a 3000 内更缺血队友优先（旧恒 owner 必红）', () => {
    const owner = new Player(0, 0, new Inventory());
    hoodOn(owner); owner.lifeSteal = 80;
    const ally = new Player(400, 0, new Inventory());
    ally.hp = 50;                                           // 缺 50（owner 满血缺 0）
    const heals: unknown[] = [];
    realSteal.call(mkFake(owner, [owner, ally], heals), 'ghost', 100, 0, 0, 0, true);
    expect(heals.length).toBe(1);
    expect((heals[0] as unknown as { target: unknown })['target']).toBe(ally);
  });

  it('A23b 全满血 → 回落 owner;>3000 拒;异队敌对拒/同队敌对收;vampire 恒 owner', () => {
    const owner = new Player(0, 0, new Inventory());
    hoodOn(owner); owner.lifeSteal = 80;
    const ally = new Player(400, 0, new Inventory());       // 满血
    const heals: unknown[] = [];
    realSteal.call(mkFake(owner, [owner, ally], heals), 'ghost', 100, 0, 0, 0, true);
    expect((heals[0] as unknown as { target: unknown })['target']).toBe(owner);

    const far = new Player(4000, 0, new Inventory());
    far.hp = 50;
    const heals2: unknown[] = [];
    realSteal.call(mkFake(owner, [owner, far], heals2), 'ghost', 100, 0, 0, 0, true);
    expect((heals2[0] as unknown as { target: unknown })['target']).toBe(owner);   // >3000 拒

    // PvP 门（:12099）：(!own.hostile ∧ !cand.hostile) ∨ own.team===cand.team
    // —— 异队+敌对拒;同队（含双双 team 0）照收（原版 team 0==0 恒真,同队敌对不拒）
    const foe = new Player(400, 0, new Inventory());
    foe.hp = 50; foe.hostile = true; foe.team = 1;
    const heals3: unknown[] = [];
    realSteal.call(mkFake(owner, [owner, foe], heals3), 'ghost', 100, 0, 0, 0, true);
    expect((heals3[0] as unknown as { target: unknown })['target']).toBe(owner);   // 异队敌对拒

    const mate = new Player(400, 0, new Inventory());
    mate.hp = 50; mate.hostile = true;                      // 同队（0==0）敌对照收
    const healsMate: unknown[] = [];
    realSteal.call(mkFake(owner, [owner, mate], healsMate), 'ghost', 100, 0, 0, 0, true);
    expect((healsMate[0] as unknown as { target: unknown })['target']).toBe(mate);

    const ally2 = new Player(400, 0, new Inventory());
    ally2.hp = 50;
    owner.lifeSteal = 80;                                   // 前四支已扣满（80−4×20=0）
    const heals4: unknown[] = [];
    realSteal.call(mkFake(owner, [owner, ally2], heals4), 'vampire', 100, 0, 0, 0, true);
    expect((heals4[0] as unknown as { target: unknown })['target']).toBe(owner);   // vampire 恒 owner
  });
});

// ═══════════════ A24/A25：治疗弹寿命与出生中心 ═══════════════

describe('BJ746 A24/A25：HealProj 子步寿命 + NewProjectile 中心语义', () => {
  it('A25 出生 (100,100) → 盒左上 (97,97)（6×6 盒;旧直收当左上=中心偏 (+3,+3) 必红）', () => {
    const t = { x: 0, y: 0, w: 20, h: 42, hp: 100, maxHp: 400 };
    const h = new HealProj(298, 100, 100, 10, t);
    expect(h.x).toBe(97);
    expect(h.y).toBe(97);
  });

  it('A24 298（extraUpdates=3）：3600 子步=900 拍自然亡（旧每 tick 递减=3600 拍必红）', () => {
    // 目标放 141k px 外：4px/子步×4 子步/拍 ⇒ 900 拍仅追 14400px,绝不命中
    const t = { x: 100000, y: 100000, w: 20, h: 42, hp: 100, maxHp: 400 };
    const h = new HealProj(298, 100, 100, 10, t);
    const g = makeHooks({ player: { buffs: {} } });
    for (let i = 0; i < 899; i++) {
      h.fixedUpdate(1, g);
      if (h.dead) throw new Error(`提前亡于第 ${i + 1} 拍`);
    }
    expect(h.dead).toBe(false);
    h.fixedUpdate(1, g);                                    // 第 900 拍（子步 3597-3600）
    expect(h.dead).toBe(true);
  });

  it('A24b 305（extraUpdates=10）：3600 子步=328 拍自然亡', () => {
    const t = { x: 100000, y: 100000, w: 20, h: 42, hp: 100, maxHp: 400 };
    const h = new HealProj(305, 100, 100, 10, t);
    const g = makeHooks({ player: { buffs: {} } });
    for (let i = 0; i < 327; i++) h.fixedUpdate(1, g);
    expect(h.dead).toBe(false);                             // 327×11=3597 子步
    h.fixedUpdate(1, g);
    expect(h.dead).toBe(true);                              // 第 328 拍打满 3600
  });
});

// ═══════════════ A26：浮魂弹 356（DV/魔法暴击/属主穿甲） ═══════════════

describe('BJ746 A26：356 命中面 DV+魔法动态暴击+属主穿甲（SetDefaults :4471 magic=true）', () => {
  it('DV(-15% 档)+magicCrit(聚合 96)+属主 pen5 全通（旧固定伤/crit=false/pen=0 必红）', () => {
    const e = mkEnemy(1, 0, 0, 24, 24);
    const p = new SpectreSoulProj(12, 12, 1, 0, 100, null);
    (p as unknown as { friendly: boolean }).friendly = true;
    const g = makeHooks({
      enemies: [e],
      player: {
        equipStats: { armorPen: 5 }, dead: false, luck: 0,
        critChance: (k: string) => (k === 'magic' ? 96 : 0),
        inv: { heldItem: () => null },
      },
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);            // 类掷 0<1.0 暴;DV tier −15 ×0.85
    (p as unknown as { runContactHits: (g: GameHooks) => void }).runContactHits(g);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(85);                         // 100×0.85（DV 存在面）
    expect(e.calls[0]!.crit).toBe(true);                    // magicCrit 掷（旧恒 false）
    expect(e.calls[0]!.pen).toBe(5);                        // 属主穿甲（旧恒 0）
  });
});

// ═══════════════ A29：烈焰塔弹 664/666/668 Kill 溅射 ═══════════════

describe('BJ746 A29：664 Kill 溅射（:73049-73160）', () => {
  const mk664 = (dmg = 100): Arrow => new Arrow(800, 800, 0, 0, dmg, 4, 664, { grav: 0 });
  const kill = (a: Arrow, g: GameHooks): void =>
    (a as unknown as { killNow: (g: GameHooks) => void }).killNow(g);

  it('A29a 直击死（penetrate 已 0）→ 全盒逐靶 + 直击靶（hitSet=局部表 -1）跳过（旧零溅射必红）', () => {
    const a = mk664();
    (a as unknown as { pierce: number }).pierce = 0;        // 直击耗尽后 Kill 形态
    const victim = mkEnemy(1, 800, 800, 20, 20);            // 弹心 (808,808),victim 心 (812,812)
    (a as unknown as { hitSet: Set<number> }).hitSet.add(victim.id);
    const n1 = mkEnemy(2, 850, 800, 20, 20);                // 心 (862,810)：|Δcx|=54<48+10 ✓
    const n2 = mkEnemy(3, 800, 850, 20, 20);                // 心 (812,862)：|Δcy|=54 ✓
    vi.spyOn(Math, 'random').mockReturnValue(0.5);          // DV tier 0 ×1
    const g = makeHooks({ enemies: [victim, n1, n2], projectiles: [a] });
    kill(a, g);
    expect(victim.calls.length).toBe(0);                    // localNPCImmunity=-1 读门
    expect(n1.calls.length).toBe(1);                        // ★主判别：邻靶溅射
    expect(n1.calls[0]!.d).toBe(100);
    expect(n1.calls[0]!.pierce).toBe(-3);                   // usesLocal 写档（清全局窗）
    expect(n2.calls.length).toBe(1);
    expect(a.dead).toBe(true);
  });

  it('A29b 撞块/寿命死（penetrate=1）→ 首靶后 keepIterating=false 单靶结算（:14190-96）', () => {
    const a = mk664();                                      // pierce=1（未耗）
    const n1 = mkEnemy(1, 850, 800, 20, 20);
    const n2 = mkEnemy(2, 800, 850, 20, 20);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const g = makeHooks({ enemies: [n1, n2], projectiles: [a] });
    kill(a, g);
    expect(n1.calls.length).toBe(1);                        // 桶序首个
    expect(n2.calls.length).toBe(0);                        // penetrate 1→0 ⇒ 截断
  });

  it('A29c 暗黑艺术家 T3 → 208 盒（|Δcx|=110 邻靶命中;基档 96 盒拒）', () => {
    const mk = (t3: boolean): void => {
      const a = mk664();
      const far = mkEnemy(1, 908, 800, 20, 20);             // 心 (918,810)：Δ=110——96 盒(58)拒/208 盒(114)收
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const g = makeHooks({
        enemies: [far], projectiles: [a],
        player: { equipStats: t3 ? { summonSet: { apprenticeT3: true } } : {},
          dead: false, buffs: {} },
      });
      kill(a, g);
      expect(far.calls.length).toBe(t3 ? 1 : 0);
      vi.restoreAllMocks();
    };
    mk(false);
    mk(true);
  });
});

// ═══════════════ A32/A33：星尘守护者 623 ═══════════════

describe('BJ746 A32/A33：守护者锁靶失效门 + 卸装宽限', () => {
  const mkGame = (enemies: unknown[]): { hooks: GameHooks; player: Player } => {
    const world = new World(200, 120, 7, 'bj746a-guardian');
    const player = new Player(60 * TILE, 90 * TILE, new Inventory());
    const hooks: GameHooks = {
      world: world as never, player: player as never,
      enemies: () => enemies, npcs: () => [], critters: () => [],
      projectiles: () => [],
      spawnDrop: () => null, damagePlayer: (): number => 0,
      addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {},
      onProjectileDeath: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
      spawnDust: () => null, notifyInventoryChanged: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, showPickupLabel: () => {},
      spawnFriendlyProj: () => undefined, applyLifeSteal: () => 0,
      stack: { anyTagged: () => false, hasActiveEffect: () => false },
      entities: { add: () => undefined, projectiles: [] } as never,
    } as unknown as GameHooks;
    return { hooks, player };
  };
  const mk623 = (hooks: GameHooks, player: Player): MinionProj =>
    new MinionProj(player.x, player.y, 623, 30, 2, false, 0, false, () => player);

  it('A32 锁靶转 dontTakeDamage → 首拍退 state0（CanBeChasedBy :45705-12;旧滞留拳击态必红）', () => {
    const e = mkEnemy(1, 60 * TILE + 250, 90 * TILE, 38, 38);
    e.dontTakeDamage = true;
    const { hooks, player } = mkGame([e]);
    const m = mk623(hooks, player);
    (m as unknown as { gA0: number }).gA0 = 2;
    (m as unknown as { gA1: number }).gA1 = e.id;
    m.fixedUpdate(1, hooks);
    expect((m as unknown as { gA0: number }).gA0).toBe(0);   // ★首拍退出（旧=2 滞留）
    expect((m as unknown as { gFrame: number }).gFrame).toBe(18);
  });

  it('A32b 对照：健康锁靶保持 state2（距离内不误退）', () => {
    const e = mkEnemy(1, 60 * TILE + 250, 90 * TILE, 38, 38);
    const { hooks, player } = mkGame([e]);
    const m = mk623(hooks, player);
    (m as unknown as { gA0: number }).gA0 = 2;
    (m as unknown as { gA1: number }).gA1 = e.id;
    m.fixedUpdate(1, hooks);
    expect((m as unknown as { gA0: number }).gA0).toBe(2);
  });

  it('A33 卸装宽限 2 拍：AI 照跑（拳击可达）后自然亡（旧即杀吞尾拍必红）', () => {
    // 敌心置于守护者初始拳盒带内（守护者心 ~(985,1480),拳盒 x∈[985,1065]）
    const e = mkEnemy(1, 1008, 1468, 24, 24);               // 心 (1020,1480) ∈ 拳盒
    const { hooks, player } = mkGame([e]);
    const m = mk623(hooks, player);
    (m as unknown as { gA0: number }).gA0 = 2;
    (m as unknown as { gA1: number }).gA1 = e.id;
    (m as unknown as { expireGraceT: number }).expireGraceT = 2;
    m.fixedUpdate(1, hooks);                                // 宽限拍 1：AI 照跑
    expect(m.dead).toBe(false);
    expect(e.calls.length).toBeGreaterThanOrEqual(1);       // 宽限拍拳击机会仍在
    m.fixedUpdate(1, hooks);                                // 宽限拍 2：递减归零亡
    expect(m.dead).toBe(true);
  });
});

// ═══════════════ A34-A37：宝石袍族 ═══════════════

describe('BJ746 A34：红玉袍 ArPenSpread 穿甲不被发射端覆写（+4 保留）', () => {
  it('A34a 发射端 armorPen 叠加：ctor +4（ArPenSpread）∪ 玩家 3 → 7（旧覆写=3 必红）', () => {
    const realFire = (Game.prototype as unknown as {
      fireGemStaffBolts: (this: Game, cw: unknown, def: unknown, ps: unknown,
        ang: number, px: number, py: number, critVid: number, pen: number,
        midSwing: boolean) => boolean;
    }).fireGemStaffBolts;
    const player = new Player(100 * TILE, 100 * TILE, new Inventory());
    Object.defineProperty(player, 'equipStats', {
      value: Object.freeze({ ...player.equipStats, armorPen: 3 }), configurable: true,
    });
    const bolts: Arrow[] = [];
    const fake = {
      player, tickCount: 0,
      entities: { add: (e: unknown) => { bolts.push(e as Arrow); }, projectiles: [] },
    } as unknown as Game;
    const ok = realFire.call(fake,
      { kind: 'magic', shoot: 125, shootSpeed: 9, damage: 20, knockback: 4, useTime: 20 },
      { vid: 125, key: 'ruby_staff' }, { arpen: 0 }, 0, 1600, 1600, 125, 1, true);
    expect(ok).toBe(true);
    expect(bolts.length).toBe(1);
    expect(bolts[0]!.projId).toBe(125);
    expect(bolts[0]!.armorPen).toBe(7);                     // ★4+3（旧=arpen 覆写 3）
  });

  it('A34b 结构锁：发射端 += 非 =（防回退）', () => {
    expect(SRC('core/Game.ts')).toContain('b.armorPen += arpen;');
    expect(SRC('core/Game.ts')).not.toContain('b.armorPen = arpen;');
  });
});

describe('BJ746 A35/A36：AI_029 特性序 + 转向速度源', () => {
  it('A35 Homing 先于 FastThenSlow：首速 40、目标正下 200 → 首帧 (38.8,0)（旧先减速再追踪=vy≠0 必红）', () => {
    const a = new Arrow(500, 800, 40, 0, 60, 2, 121,
      { grav: 0, life: 300, pierce: 1, gem: { homing: true, fastThenSlow: true } as never });
    const tgt = mkEnemy(1, 493, 993);                       // 敌心 (505,1005)：弹心 (505,805) 正下 200
    const g = makeHooks({ enemies: [tgt], projectiles: [a] });
    a.fixedUpdate(1, g);
    expect(a.vx).toBeCloseTo(38.8, 3);                      // 40×0.97（Homing 读 40 → 转向衰减 0）
    expect(a.vy).toBeCloseTo(0, 6);                         // ★零竖速（旧序=0.419…）
  });

  it('A36 低速转向读加速前速度：sp0=1 → 角 1.2、(0.4385,1.1278)（旧读加速后 1.21 → 角 1.0866 必红）', () => {
    const a = new Arrow(500, 800, 1, 0, 60, 2, 121,
      { grav: 0, life: 300, pierce: 1, gem: { homing: true } as never });
    const tgt = mkEnemy(1, 493, 993);                       // 敌心 (505,1005)：距 200（<500 视距）
    const g = makeHooks({ enemies: [tgt], projectiles: [a] });
    a.fixedUpdate(1, g);
    // num13=1（加速前）→ turn=((1−200/500)×0.1+0.01+0.05)×Remap(1,1,3,10,1)=1.2;
    // 旋转向量长=加速后 1.21（1+0.1 单位向 → ×1.1）
    expect(a.vx).toBeCloseTo(Math.cos(1.2) * 1.21, 3);
    expect(a.vy).toBeCloseTo(Math.sin(1.2) * 1.21, 3);
  });
});

describe('BJ746 A37 补充：碰后追踪重定向 + 清拖尾 + FastThenSlow 贴壁', () => {
  it('A37a CanBounce+Homing 撞块 → 重定向至 2400 视线敌（保 |lastVelocity|×0.8）+ 拖尾清空', () => {
    const st = new TileStore(200, 120);
    for (let y = 45; y < 55; y++) st.setTile(50, y, 1);     // 竖壁列 50
    const tgt = mkEnemy(1, 688, 888);                       // 敌心 (700,900)：壁同侧（LOS 不穿列 50）
    const a = new Arrow(790, 46 * 16, 8, 0, 60, 2, 597,
      { grav: 0, life: 300, pierce: 5, gem: { canBounce: true, homing: true } as never });
    (a as unknown as { gemTrail: number[] }).gemTrail.push(1, 2, 3, 4);
    const g = makeHooks({ enemies: [tgt], projectiles: [a] });
    g.world = { store: st } as never;
    a.fixedUpdate(1, g);
    // 重定向：|v|=8×0.8=6.4 朝目标（目标在下方 → vy>0;旧无重定向=纯反弹 vy=0 必红）
    expect(Math.hypot(a.vx, a.vy)).toBeCloseTo(6.4, 3);
    expect(a.vy).toBeGreaterThan(0);
    expect((a as unknown as { gemTrail: number[] }).gemTrail.length).toBe(0);   // oldPos 清空
  });

  it('A37b FastThenSlow 撞块 → 贴壁不亡（速度缩 1e-4 向;旧落通用消亡口即死必红）', () => {
    const st = new TileStore(200, 120);
    for (let y = 45; y < 55; y++) st.setTile(50, y, 1);
    const a = new Arrow(790, 46 * 16, 8, 0, 60, 2, 124,
      { grav: 0, life: 300, pierce: 1, gem: { fastThenSlow: true } as never });
    const g = makeHooks({ projectiles: [a] });
    g.world = { store: st } as never;
    a.fixedUpdate(1, g);
    expect(a.dead).toBe(false);                             // flag7=true 不 Kill
    expect(Math.hypot(a.vx, a.vy)).toBeCloseTo(0.0001, 8);  // lastVelocity 向 ×1e-4
  });
});

// ═══════════════ 结构锁：A33 Game 侧接线 ═══════════════

describe('BJ746 结构锁（A33 Game 侧宽限接线）', () => {
  it('卸装分支置宽限 2 而非即杀;旗续期清零', () => {
    const s = SRC('core/Game.ts');
    expect(s).toContain('if (g623.expireGraceT <= 0) g623.expireGraceT = 2;');
    expect(s).toContain('g623.expireGraceT = 0;');
    expect(s).not.toContain('} else if (!guardianOn && g623) g623.dead = true;');
  });
});
