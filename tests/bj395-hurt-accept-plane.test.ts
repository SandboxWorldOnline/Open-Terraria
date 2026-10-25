// BJ395（2026-09-28）BJ393 同族债五处清偿判别面。标杆 Terarria1457 逐支亲读 + BJ393
//   vanillaGated 范式（WeaponProj.hitEnemies :393）：
//   Enemy.hurt 布尔返真=「本拍击杀/假人」（Enemy.ts:15033/:14184）非「受理」;返假
//   三族=①头部门拒（dead :13971/iframes :13972/dontTakeDamage :13978）②血尽级联
//   （realLifeHost :14369/月总 :14377/猪鲨泡 :14383/石巨人头 :14393/四塔 :14398——
//   伤害已实扣=原版受理）③普通未致命命中尾档 :15037（BJ388 二分漏掉的支配族）。
//   原版写梯 :14031-14183（含 IDStatic 支 :14031-14038）/penetrate-- :14189-14196/
//   numHits++ :14263 全在免疫门 :12635-12638 后【无死亡复查】→ 受理谓词=!vanillaGated。
//   五处（BJ393 登记）：
//     ① Arrow.ts:9431（IDStatic 清窗/GC1 写/numHits/pierce--）
//     ② FallingStar.ts:309（GC1 桥写）
//     ③ ForbiddenSignProj.ts:292（ghostHeal/localImmune/hitCount/numHits 四写）
//     ④ MagnetSphereProj.ts:211（ghostHeal/numHits）
//     ⑤ projTargets.ts:90（hitTownNpcs——TownNPC.hurt 返值契约=受理（TownNPC.ts:1535
//        单一受理返真点,返假仅门拒 :1404/:1407）→ 布尔即受理谓词=原版同相【锚备案,
//        不落刀】,本文件 E 组锁其契约事实基座）
//   双闸判别：每组「普通未致命命中（返假+伤害实扣+iframes=10）仍触发消费面」+
//   「门拒（iframes 残窗/dontTakeDamage）不触发」。
// 运行：cd game && npx vitest run tests/bj395-hurt-accept-plane.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Arrow } from '../src/entities/Arrow';
import { pinGameTimeTicks } from '../src/core/GameTime';   // ★BJ704-G10（G1 债②）：idStaticCheck GTW tick 钟钉拨
import { FallingStar } from '../src/entities/FallingStar';
import { ForbiddenSignProj } from '../src/entities/ForbiddenSignProj';
import { BeamBoltProj } from '../src/entities/MagnetSphereProj';
import { TownNPC } from '../src/entities/TownNPC';
import { Enemy } from '../src/entities/Enemy';
import { World } from '../src/world/World';
import { TileStore } from '../src/world/TileStore';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const PX = 60 * TILE, PY = 90 * TILE;

/** Enemy.hurt 普通未致命命中尾档形态（Enemy.ts:15037 返假+伤害实扣+写 10t :14274）：
 *  判别面载体——旧 hurtOk 闸在该形态整面不达（返假≠击杀）,vanillaGated 判据可达 */
type NormalHitEnemy = {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  hp: number; iframes?: number; dontTakeDamage?: boolean; vanillaId?: number | null;
  maxHp?: number; hits: number[]; lastStrikeDealt: number;
  hurt: (d: number, kx?: number, ky?: number, g?: unknown, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean) => boolean;
};
function mkNormalHitEnemy(id: number, cx: number, cy: number, w = 900, h = 400): NormalHitEnemy {
  const e: NormalHitEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, hp: 100000, hits: [],
    lastStrikeDealt: 0,
    hurt(d: number) {
      this.hp -= d; this.hits.push(d); this.lastStrikeDealt = d;
      this.iframes = 10;               // Enemy.hurt :14274 通用档（pierce∉{-2,1}）
      return false;                    // :15037 普通未致命命中尾档（非击杀非门拒）
    },
  };
  return e;
}

interface BridgeLog { npcId: number; ticks: number }

function makeGame(enemies: unknown[], opts?: { player?: Player }): {
  hooks: GameHooks; bridge: BridgeLog[]; steal: Array<{ kind: string; numHits: number }>;
} {
  const store = new TileStore(200, 200);
  const bridge: BridgeLog[] = [];
  const steal: Array<{ kind: string; numHits: number }> = [];
  const hooks = {
    world: {
      store,
      get groundLevel() { return 100; },
      clock: { isDay: false },        // FallingStar 白天清除门 :24092 读取面
      seedFlags: {},
    } as unknown as GameHooks['world'],
    player: opts?.player ?? new Player(PX, PY, new Inventory()),
    enemies: () => enemies,
    critters: () => [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    spawnDust: (() => null) as never,
    // GC1 桥统一出口（projTargets.noteVanillaProjImmune → game.noteNpcPlayerImmune）
    noteNpcPlayerImmune: (npcId: number, ticks: number) => { bridge.push({ npcId, ticks }); },
    applyLifeSteal: (kind: string, _d: number, numHits: number) => {
      steal.push({ kind, numHits });
      return 0;
    },
  } as unknown as GameHooks;
  return { hooks, bridge, steal };
}

/** tick 钟（idStaticCheck 组表以 gameTickCount() 节流——★BJ704-G10（G1 债②）
 *  墙钟 Date.now 版退役,GTW 钉钟随迁：clock.t 仍按 ms 计步（1000/60=1t 恒速,
 *  调用体零改）,每写换算 tick 钉 pinGameTimeTicks（基值 70_000 偏移防撞窗;
 *  bj209/bj274 钉钟判例） */
function withTickClock(fn: (clock: { t: number }) => void): void {
  let ms = 1_000_000;
  const clock = {
    get t() { return ms; },
    set t(v: number) {
      ms = v;
      pinGameTimeTicks(70_000 + Math.round((v - 1_000_000) / (1000 / 60)));
    },
  };
  clock.t = 1_000_000;   // 初始钉
  try { fn(clock); } finally { pinGameTimeTicks(70_000 + Math.round((ms - 1_000_000) / (1000 / 60))); }
}

// ============================================================
// ① Arrow.ts:9431——IDStatic 清窗/GC1 写/numHits/pierce--
// ============================================================
describe('BJ395 ① Arrow:9431 受理面=!vanillaGated（普通未致命命中形态全链）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('A1 普通命中形态（hurt 返假+实扣+iframes=10）：IDStatic 三跳节拍保持+清窗照写+GC1(numHits 同面)+穿透耗尽', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（主环首掷 ×1.0,三跳同值）
    const e = mkNormalHitEnemy(39501, PX, PY);   // 189 idStaticGroup=189,pierceInit=3
    const { hooks, bridge } = makeGame([e]);
    const wasp = new Arrow(PX, PY, 9, 0, 31, 0.25, 189, { grav: 0, life: 600 });
    const hitTicks: number[] = [];
    withTickClock((clock) => {
      for (let t = 1; t <= 60 && !wasp.dead; t++) {
        clock.t += 1000 / 60;
        wasp.fixedUpdate(1, hooks);
        if (e.hits.length > hitTicks.length) hitTicks.push(t);
      }
    });
    // ①清窗：三跳节拍保持（旧 hurtOk 闸下返假跳不清窗→iframes=10 恒拦读门 :9258→恒 1 跳红）
    expect(hitTicks).toHaveLength(3);
    expect(hitTicks[1] - hitTicks[0]).toBeGreaterThanOrEqual(10);   // 组表 10t 节拍
    expect(e.iframes).toBe(0);     // ★判别面:受理跳清窗照写（:14033-14036 写 0 同相）
    expect(e.hits).toEqual([31, 31, 31]);
    // ②GC1 桥受理面照写（idStatic face 写 0 清窗档）——第 3 跳写位 penetrate 已=1
    //   （:14033 `penetrate != 1` 判定用【写位现存量】）→ 原版本相=末跳不触全局窗,
    //   桥逐相（projGlobalImmuneWriteTicks 同式）→ 恰 2 写
    expect(bridge).toEqual([{ npcId: e.id, ticks: 0 }, { npcId: e.id, ticks: 0 }]);
    // ③pierce 经济（penetrate-- :14189 受理面）+numHits（:14263）
    expect(wasp.pierce).toBe(0);
    expect((wasp as unknown as { pveNumHits: number }).pveNumHits).toBe(3);
    expect(wasp.dead).toBe(true);
  });

  it('A2 门拒形态（iframes 残窗,经 502 喵刀弹局部免疫支绕过读门直达 hurt）：hurt 被调但不写不计数不耗穿', () => {
    const e = mkNormalHitEnemy(39502, PX, PY, 16, 24);
    e.iframes = 5;                 // 外源残窗（502 局部免疫支 :9243 不查全局读门 :9258）
    e.hurt = () => false;          // Enemy.hurt :13972 iframes 门拒形态（零实扣）
    const { hooks, bridge } = makeGame([e]);
    const meow = new Arrow(PX, PY, 9, 0, 40, 1, 502, { grav: 0, life: 600 });
    expect(meow.pierceInit).toBe(5);          // 数据面 penetrate=5（≠1,门拒判据可达）
    meow.fixedUpdate(1, hooks);
    expect(e.hits).toHaveLength(0);           // hurt 零实扣（门拒形态自证）
    expect(bridge).toEqual([]);               // ★GC1 桥静默（旧无条件写=红）
    expect(meow.pierce).toBe(5);              // ★penetrate-- 静默（旧无条件递减=红）
    expect((meow as unknown as { pveNumHits: number }).pveNumHits).toBe(0);
  });
});

// ============================================================
// ② FallingStar.ts:309——GC1 桥写（弹 12 pen=-1 → 末档写 10）
// ============================================================
describe('BJ395 ② FallingStar:309 GC1 桥=受理面（真实 Enemy 探针）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('B1 普通未致命命中（vid4 血量>1000,Enemy.hurt :15037 返假+实扣）：桥照写 10t（旧 hurtOk 闸=整面不达红）', () => {
    const w = new World(120, 160, 30, 'bj395b');
    w.clock.timeOfDay = 0;
    const e = Enemy.fromVanilla(4, 35 * TILE, 60 * TILE)!;   // EoC hp≈2800 > 1000
    expect(e.hp).toBeGreaterThan(1000);
    const hp0 = e.hp;
    const { hooks, bridge } = makeGame([e]);
    const s = new FallingStar(35 * TILE, 60 * TILE - 100, 0, 12, 0, false, true);
    for (let t = 0; t < 40 && !s.dead; t++) s.fixedUpdate(1 / 60, hooks);
    expect(e.hp).toBeLessThan(hp0);           // 实扣
    expect(e.hp).toBeGreaterThan(0);          // 未致命（:15037 返假形态自证）
    expect(e.iframes).toBe(10);               // :14274 写窗（hurt 已写,弹侧不重复）
    expect(bridge).toEqual([{ npcId: e.id, ticks: 10 }]);   // ★判别面:尾梯 pen≠1 档照写
  });

  it('B2 门拒形态（iframes 残窗 5t,pierce=-1≠1 :13972 拒收）：hp 不动+桥静默（vanillaGated 方向守卫）', () => {
    const w = new World(120, 160, 30, 'bj395b2');
    w.clock.timeOfDay = 0;
    const e = Enemy.fromVanilla(4, 35 * TILE, 60 * TILE)!;
    e.iframes = 5;
    const hp0 = e.hp;
    const { hooks, bridge } = makeGame([e]);
    const s = new FallingStar(35 * TILE, 60 * TILE - 100, 0, 12, 0, false, true);
    for (let t = 0; t < 40 && !s.dead; t++) s.fixedUpdate(1 / 60, hooks);
    expect(e.hp).toBe(hp0);                   // 门拒零实扣
    expect(bridge).toEqual([]);               // 尾梯不达（原版 :12635-12638 整跳 return 同面）
  });
});

// ============================================================
// ③ ForbiddenSignProj.ts:292——ghostHeal/localImmune/hitCount/numHits 四写
// ============================================================
describe('BJ395 ③ ForbiddenSign:292 四写=受理面（656 沙暴柱,普通未致命命中形态）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('C1 普通命中形态（hurt 返假+实扣+iframes=10）：四写照达（旧 hurtOk 闸=命中帽/吸血/局部窗整面不达红）', () => {
    const e = mkNormalHitEnemy(39503, 30 * 16 + 8, 34 * 16, 16, 16);
    const { hooks, steal } = makeGame([e]);
    const s = new ForbiddenSignProj(30 * 16 + 8, 34 * 16, 20);
    s.fixedUpdate(1 / 60, hooks);
    expect(e.hits).toEqual([20]);                       // 实扣发生
    expect((s as unknown as { hitCount: number }).hitCount).toBe(1);        // :14245 localAI[0]++
    expect((s as unknown as { pveNumHits: number }).pveNumHits).toBe(1);   // :14263
    const li = (s as unknown as { localImmune: Map<number, number> }).localImmune;
    expect(li.get(e.id)).toBe(7);                       // :14181-14182 写 8 + 同拍尾减 1（runContactHits 梯）
    expect(steal).toEqual([{ kind: 'ghost', numHits: 0 }]);   // :13877-79 proc（首跳 numHits=0 档）
  });

  it('C2 门拒形态（iframes 残窗 / dontTakeDamage）：四写整面静默（:12600/:12635-12638/:13978 同面）', () => {
    for (const gate of [{ iframes: 5 }, { dontTakeDamage: true }]) {
      const e = mkNormalHitEnemy(39504, 30 * 16 + 8, 34 * 16, 16, 16);
      Object.assign(e, gate);
      e.hurt = () => false;                             // 门拒形态（零实扣零写）
      const { hooks, steal } = makeGame([e]);
      const s = new ForbiddenSignProj(30 * 16 + 8, 34 * 16, 20);
      s.fixedUpdate(1 / 60, hooks);
      expect((s as unknown as { hitCount: number }).hitCount).toBe(0);
      const li = (s as unknown as { localImmune: Map<number, number> }).localImmune;
      expect(li.size).toBe(0);
      expect(steal).toEqual([]);
    }
  });
});

// ============================================================
// ④ MagnetSphereProj.ts:211——ghostHeal/numHits（255/260 flag3 单发）
// ============================================================
describe('BJ395 ④ MagnetSphere:211 受理面=!vanillaGated（pierce=1 flag3,门拒仅 dontTakeDamage 可达）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('D1 普通命中形态（hurt 返假+实扣）：ghostHeal proc+numHits 照达（旧布尔闸=整面不达红）', () => {
    const e = mkNormalHitEnemy(39505, 2050, 2000, 20, 40);
    const { hooks, steal } = makeGame([e]);
    const bolt = new BeamBoltProj(2000, 2000, 6, 0, 48, 6);
    bolt.fixedUpdate(1 / 60, hooks);
    expect(e.hits).toEqual([48]);                       // 实扣（返假形态自证）
    expect(steal).toEqual([{ kind: 'ghost', numHits: 0 }]);   // :13877-79 proc
    expect((bolt as unknown as { pveNumHits: number }).pveNumHits).toBe(1);   // :14263
    expect(bolt.dead).toBe(true);                       // 单发照常回收（命中位铺束链不受判据影响）
  });

  it('D2 门拒形态（dontTakeDamage,原版外层 :12600 同门）：proc/计数静默', () => {
    const e = mkNormalHitEnemy(39506, 2050, 2000, 20, 40);
    e.dontTakeDamage = true;
    e.hurt = () => false;                               // :13978 门拒形态
    const { hooks, steal } = makeGame([e]);
    const bolt = new BeamBoltProj(2000, 2000, 6, 0, 48, 6);
    bolt.fixedUpdate(1 / 60, hooks);
    expect(e.hits).toHaveLength(0);
    expect(steal).toEqual([]);
    expect((bolt as unknown as { pveNumHits: number }).pveNumHits).toBe(0);
  });
});

// ============================================================
// ⑤ projTargets.ts:90——TownNPC.hurt 返值契约=受理（锚备案的事实基座锁）
// ============================================================
describe('BJ395 ⑤ TownNPC.hurt 返值契约=受理（projTargets:90 布尔消费=原版同相,不落刀）', () => {
  afterEach(() => vi.restoreAllMocks());

  function npcGame(): GameHooks {
    const w = new World(200, 200, 42, 'bj395e');
    return {
      world: w,
      player: { x: -9999, y: -9999, w: 0, h: 0, dead: true },
      enemies: () => [], critters: () => [], npcs: () => [],
      spawnParticles: () => {}, playSfx: () => {}, playSfxFiles: () => {},
      addDamageNumber: () => {},
    } as unknown as GameHooks;
  }

  it('E1 普通未致命命中返真（TownNPC.ts:1535 单一受理返真点——与 Enemy.hurt :15037 返假族反相）', () => {
    const npc = new TownNPC('guide', 100 * TILE, 100 * TILE);
    const hp0 = npc.hp;
    expect(npc.hurt(10, 2, 0, npcGame())).toBe(true);   // 实扣+返真=布尔即受理
    expect(npc.hp).toBeLessThan(hp0);                   // 实扣发生（防后伤值按 def 结算,不钉绝对值）
    expect(npc.dead).toBe(false);
  });

  it('E2 门拒两族返假（dead :1404 / iframes>0 :1407）——返假⟺门拒,无级联/尾档返假族', () => {
    const npc = new TownNPC('guide', 100 * TILE, 100 * TILE);
    npc.iframes = 5;
    expect(npc.hurt(10, 2, 0, npcGame())).toBe(false);  // 帧窗门拒
    expect(npc.hp).toBe(npc.maxHp);
    const npc2 = new TownNPC('guide', 100 * TILE, 100 * TILE);
    (npc2 as unknown as { dead: boolean }).dead = true;
    expect(npc2.hurt(10, 2, 0, npcGame())).toBe(false); // dead 门拒
  });
});
