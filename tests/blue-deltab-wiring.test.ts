// 蓝队·单条群（δB 红队四组"功能已实现但编排漏接/接线失实"生产面补齐）回归——
//   B4 TimerCrit(6170 蓄能暴击) 命中面 NightsEdge 编排 + d228×20 径向尘环
//     （原版真值 Terarria1457/Terraria/Player.cs TryConsumingTimerCrit :28564-28595）
//   B11 CattivaHit(67) 捣蛋猫命中拍生产接线（Projectile.cs SpawnHitVisuals :14466-14501,
//     :13633 每靶一发；镐力面 :52167 ai[0]=3 帮工意图未折算维持登记）
//   B12 InScreenDungeonSpawn(66) 双地牢自然刷生纸屑爆（NPC.SpawnNPC :5265-5273 包装位门；
//     微光之灵 SpawnFaelings 走裸 NewNPC :5924 不经包装=不笺,同构断言在负例③）
//   B13 BestReforge(18) 顶级词缀发光三连掷 + RainbowRodHit 双掷本地直驱
//     （Main.cs ReforgeItemInReforgeSlot :42638-42652,clientOnly:true=不广播）
// 台账：docs/audit/approx-registry-2026-08-31.md δB 批勾销 ✅2026-08-31 已清偿。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParticleOrchestraType } from '../src/net/syncModules';
import { Game } from '../src/core/Game';
import { Player } from '../src/entities/Player';
import { MinionProj } from '../src/entities/MinionProj';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { TileStore } from '../src/world/TileStore';
import { VanillaSpawner } from '../src/world/spawn/VanillaSpawner';
import { RNG } from '../src/core/rng';
import type { GameHooks } from '../src/entities/types';

// ---- B13 需要确定性 top-tier 词缀——只劫掷点，其余全透传原模块 ----
// ★BJ400 连坐修（2026-09-29 清偿刀 H 顺带）：doReforge 掷入口已迁 rollReforgePrefix
//   （TryGet 门化,旧 rollPrefix 直掷通道退役）——只劫 rollPrefix 令 B13 劫点失明,
//   doReforge 落回 Math.random 掷出非顶档（56≠59）。两掷入口同挂一钩,语义不变
const rollHook = vi.hoisted(() => ({ pick: null as null | ((pool: number[]) => number) }));
vi.mock('../src/data/vanillaPrefixes', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/data/vanillaPrefixes')>();
  const origRoll = m.rollPrefix;
  const origReforge = m.rollReforgePrefix;
  return {
    ...m,
    rollPrefix: (pool: number[], wantBest: boolean) =>
      rollHook.pick ? rollHook.pick(pool) : origRoll(pool, wantBest),
    rollReforgePrefix: (pool: number[], rand: () => number,
      stat?: Parameters<typeof origReforge>[2]) =>
      rollHook.pick ? rollHook.pick(pool) : origReforge(pool, rand, stat),
  };
});
beforeEach(() => { rollHook.pick = null; });

// ======================================================================== B4
describe('δB B4 TimerCrit 命中面（Player.cs:28574-28593）', () => {
  function makeHooks() {
    const parts: Array<{ x: number; y: number; color: string }> = [];
    const dusts: Array<Record<string, number | boolean>> = [];
    const broadcasts: Array<{ t: number; x: number; y: number }> = [];
    const hooks = {
      spawnParticles: ((x: number, y: number, color: string) => {
        parts.push({ x, y, color });
      }) as never,
      // spawnDust 返回可写尘对象（与 VanillaDust.spawn 契约一致——调用方做字段覆写）
      spawnDust: ((_x: number, _y: number, _w: number, _h: number, id: number) => {
        const d = {
          id, vx: 0, vy: 0, scale: 1, fadeIn: 0, alpha: 255,
          noLight: false, noGravity: false, noLightEmittance: false, followPlayer: false,
        };
        dusts.push(d);
        return d;
      }) as never,
      broadcastParticleOrchestra: ((t: number, x: number, y: number) => {
        broadcasts.push({ t, x, y });
      }) as never,
    };
    return { hooks: hooks as unknown as GameHooks, parts, dusts, broadcasts };
  }

  it('满蓄消费拍：NightsEdge 编排本地直生+广播盒心，d228×20 尘环参数面（scale.9/fadeIn1.1/Y钳中/径向基角族）', () => {
    const p = new Player(60 * 16, 100 * 16, new Inventory());
    // equipStats 为冻结记忆化 getter（无 setter）→ 实例自有数据属性遮蔽
    Object.defineProperty(p, 'equipStats',
      { value: Object.freeze({ ...p.equipStats, accTimerCrit: true }), configurable: true });
    p.accTimerCritCharge = 1000;
    const { hooks, parts, dusts, broadcasts } = makeHooks();

    const rx = 64, ry = 128, rw = 32, rh = 48;
    const consumed = p.tryConsumingTimerCrit(hooks, rx, ry, rw, rh);
    expect(consumed).toBe(true);
    expect(p.accTimerCritCharge).toBe(-15);

    // ① NightsEdge(clientOnly:false)：module8 上行恰好一发,载荷 = hitbox.Center
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].t).toBe(ParticleOrchestraType.NightsEdge);
    expect(broadcasts[0].x).toBeCloseTo(rx + rw / 2, 9);
    expect(broadcasts[0].y).toBeCloseTo(ry + rh / 2, 9);
    // 本地直生同本体（nightsEdgeFx 三臂双层紫尘 = 6 例）
    expect(parts.length).toBeGreaterThanOrEqual(6);

    // ② 尘 228×20：类型计数 + 后置字段面
    const ring = dusts.filter((d) => d.id === 228);
    expect(ring).toHaveLength(20);
    for (const d of ring) {
      expect(d.scale).toBe(0.9);
      expect(d.fadeIn).toBe(1.1);
      expect(d.noLight).toBe(true);
      expect(d.noGravity).toBe(true);
      expect(d.noLightEmittance).toBe(true);
      expect(d.followPlayer).toBe(false);            // customData=null
      expect(d.y).toBeCloseTo(ry + rh / 2, 9);       // Y 钳盒垂直中点
      const vx = d.vx as number, vy = d.vy as number;
      expect(Math.hypot(vx, vy)).toBeLessThanOrEqual(4 + 1e-9);   // NextFloat()×4
      const mag = Math.hypot(vx, vy);
      if (mag > 0.05) {
        // 方向族 ≡ π/4 (mod π/2)（(π/4 + π/2·i) 对角十字四象限环）
        const k = Math.atan2(vy, vx) - Math.PI / 4;
        const kk = Math.round(k / (Math.PI / 2));
        expect(Math.abs(k / (Math.PI / 2) - kk)).toBeLessThan(1e-6);
      }
    }
  });

  it('未满蓄未消费：零编排零尘（charge 处于回充中段）', () => {
    const p = new Player(60 * 16, 100 * 16, new Inventory());
    Object.defineProperty(p, 'equipStats',
      { value: Object.freeze({ ...p.equipStats, accTimerCrit: true }), configurable: true });
    p.accTimerCritCharge = 500;
    const { hooks, parts, dusts, broadcasts } = makeHooks();
    expect(p.tryConsumingTimerCrit(hooks, 0, 0, 32, 48)).toBe(false);
    expect(broadcasts).toHaveLength(0);
    expect(dusts).toHaveLength(0);
    expect(parts).toHaveLength(0);
  });
});

// ======================================================================== B11
describe('δB B11 CattivaHit 生产（MinionProj.contact 每靶一发）', () => {
  interface MockEnemy {
    id: number; x: number; y: number; w: number; h: number;
    dead: boolean; cx: number; cy: number; hp: number; hits: number[];
    hurt: (d: number) => boolean;
  }
  function mkEnemy(id: number, cx: number, cy: number): MockEnemy {
    const e: MockEnemy = {
      id, x: cx - 8, y: cy - 12, w: 16, h: 24, dead: false, cx, cy, hp: 100000, hits: [],
      hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
    };
    return e;
  }
  function makeCatEnv(enemies: MockEnemy[]) {
    const store = new TileStore(120, 80);
    for (let x = 0; x < 120; x++) for (let y = 60; y < 80; y++) store.setTile(x, y, 1);
    const player = new Player(60 * 16, 70 * 16, new Inventory());
    const parts: string[] = [];
    const broadcasts: Array<{ t: number; x: number; y: number; mx: number; my: number }> = [];
    const hooks = {
      world: { store },
      player,
      enemies: () => enemies as never[],
      critters: () => [] as never[],
      spawnParticles: ((_x: number, _y: number, color: string) => {
        void _x; void _y; parts.push(color);
      }) as never,
      broadcastParticleOrchestra: ((t: number, x: number, y: number, mx?: number, my?: number) => {
        broadcasts.push({ t, x, y, mx: mx ?? 0, my: my ?? 0 });
      }) as never,
      entities: { add: () => ({}), projectiles: [] as unknown[] },
    };
    return { hooks: hooks as unknown as GameHooks, player, parts, broadcasts };
  }
  const bite = (m: MinionProj, g: GameHooks, d = 10): boolean =>
    (m as unknown as { contact(g: GameHooks, dmg: number): boolean }).contact(g, d);

  it('1093 接触命中拍：CattivaHit 广播一发、Position=Center+(dir·8,0)+Circular(4,4)、Movement=CircularEdge(4,4)', () => {
    const anchor = { cx: 60 * 16, cy: 70 * 16 };
    const e = mkEnemy(9001, anchor.cx + 4, anchor.cy);
    const { hooks, parts, broadcasts } = makeCatEnv([e]);
    const m = new MinionProj(anchor.cx, anchor.cy - 12, 1093, 10, 2, false, 0, false, () =>
      (hooks.player as never as Player));
    m.facing = 1;
    expect(bite(m, hooks)).toBe(true);
    // 广播恰好一发且型值 67
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].t).toBe(ParticleOrchestraType.CattivaHit);
    // PositionInWorld 载荷窗：弹心（盒中点）+ (facing×8,0) 基点 ± Circular(4,4)
    expect(Math.abs(broadcasts[0].x - (m.cx + 8))).toBeLessThanOrEqual(4 + 1e-9);
    expect(Math.abs(broadcasts[0].y - m.cy)).toBeLessThanOrEqual(4 + 1e-9);
    // MovementVector = CircularEdge(4,4) —— 恒落在椭圆边（模长恰 4）
    expect(Math.hypot(broadcasts[0].mx, broadcasts[0].my)).toBeCloseTo(4, 9);
    // 本地直生六芒簇（cattivaHitFx 六臂各一粒）
    expect(parts.length).toBeGreaterThanOrEqual(6);
  });

  it('1118 黏土蓓蕾等其他随从命中不发 CattivaHit（防误植）', () => {
    const bx = 60 * 16, by = 70 * 16;
    const e = mkEnemy(9002, bx + 4, by);
    const { hooks, parts, broadcasts } = makeCatEnv([e]);
    const m = new MinionProj(bx, by - 12, 1118, 10, 2, false, 0, false, () =>
      (hooks.player as never as Player));
    m.facing = 1;
    expect(bite(m, hooks)).toBe(true);
    expect(broadcasts).toHaveLength(0);
    expect(parts).toHaveLength(0);
  });

  it('1112 可靠的捣蛋猫同样接通（双猫族共 arm :14493 type 门）', () => {
    const bx = 60 * 16, by = 70 * 16;
    const e = mkEnemy(9003, bx + 4, by);
    const { hooks, broadcasts } = makeCatEnv([e]);
    const m = new MinionProj(bx, by - 12, 1112, 10, 2, false, 0, false, () =>
      (hooks.player as never as Player));
    m.facing = 1;
    expect(bite(m, hooks)).toBe(true);
    expect(broadcasts.map((b) => b.t)).toEqual([ParticleOrchestraType.CattivaHit]);
  });
});

// ======================================================================== B12
describe('δB B12 InScreenDungeonSpawn 自然刷生门（NPC.SpawnNPC :5265-5273 折算）', () => {
  function spawner(seedDual: boolean, worldH = 300) {
    const w = new World(160, worldH, 40, `delatab${Number(seedDual)}`);
    w.seedFlags = seedDual ? { dualDungeons: true } : {};
    w.groundLevel = 50;                       // worldSurface（tile 行）→ px 界 800
    w.lavaLine = 200;                         // UnderworldLayer = h−200 → px 界 3200
    const sp = new VanillaSpawner(w);
    const emitted: Array<{ t: number; x: number; y: number; mx: number; my: number; info: number }> = [];
    sp.spawnOrchestra = (t, x, y, mx, my, info) => { emitted.push({ t, x, y, mx, my, info }); };
    return { w, sp, emitted };
  }
  const spawnViaSpawner =
    (sp: VanillaSpawner, x: number, y: number, netId = 1): unknown =>
      (sp as unknown as {
        spawnNPC(x: number, y: number, netId: number, rng: RNG): unknown;
      }).spawnNPC(x, y, netId, new RNG(12345));

  it('dualDungeons 世界地下带刷生：包装位出口发纸屑爆,movement=(w,h)、uniqueInfo=npcType', () => {
    const { sp, emitted } = spawner(true);
    const e = spawnViaSpawner(sp, 60 * 16 + 8, 150 * 16, 1);           // Y∈(800,3200)
    expect(e).not.toBeNull();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].t).toBe(ParticleOrchestraType.InScreenDungeonSpawn);
    expect(emitted[0].x).toBe(60 * 16 + 8);
    expect(emitted[0].y).toBe(150 * 16);
    expect(emitted[0].mx).toBe((e as { w: number }).w);
    expect(emitted[0].my).toBe((e as { h: number }).h);
    expect(emitted[0].info).toBe(1);
  });

  it('非双地牢种子：恒静默（普通世界零感）', () => {
    const { sp, emitted } = spawner(false);
    spawnViaSpawner(sp, 60 * 16 + 8, 150 * 16, 1);
    expect(emitted).toHaveLength(0);
  });

  it('双地牢但落点在地表带上方（≤worldSurface×16）/地狱层（≥UnderworldLayer×16）：门不开', () => {
    const { sp, emitted } = spawner(true);
    spawnViaSpawner(sp, 60 * 16 + 8, 45 * 16, 1);                      // 720 < 800
    spawnViaSpawner(sp, 60 * 16 + 8, 50 * 16, 1);                      // ==界（严格不等）
    spawnViaSpawner(sp, 60 * 16 + 8, 205 * 16, 1);                     // ≥3200 地狱层
    expect(emitted).toHaveLength(0);
  });
});

// ======================================================================== B13
describe('δB B13 BestReforge 顶级词缀发光（Main.ReforgeItemInReforgeSlot :42638-42652）', () => {
  async function findReforgable(): Promise<{ id: number; vid: number; pool: number[]; top: number; bestMul: number }> {
    const prefixMod = await vi.importActual<typeof import('../src/data/vanillaPrefixes')>(
      '../src/data/vanillaPrefixes');
    const { ITEM_BY_KEY, ITEM_DEFS } = await import('../src/data/items');
    // vid 推导与 Game.doReforge 同式（vid 缺省时走 vi_<id> 键名反解）
    const derVid = (k: string, idx: number): number => {
      const d = (ITEM_DEFS as unknown as Record<number, { vid?: number; key?: string } | undefined>)[idx];
      return d?.vid
        ?? (d?.key && d.key.startsWith('vi_') ? parseInt(d.key.slice(3), 10) : -1);
    };
    let picked = { id: 0, vid: -1, pool: [] as number[], top: 0, bestMul: 0 };
    for (const [key, idRaw] of Object.entries(ITEM_BY_KEY)) {
      const id = Number(idRaw);
      if (!Number.isFinite(id)) continue;
      const vid = derVid(key, id);
      if (!Number.isFinite(vid) || vid <= 0) continue;
      const pool = prefixMod.rollablePrefixes(vid, false);
      if (!pool || pool.length < 3) continue;
      const bestMul = Math.max(...pool.map(prefixMod.prefixValueMul));
      const top = pool.find((q) => prefixMod.prefixValueMul(q) === bestMul)!;
      picked = { id: Number(id), vid, pool, top, bestMul };
      break;
    }
    expect(picked.id).toBeGreaterThan(0);
    return picked;
  }

  it('top-tier：连发三度八粒 Research_Spark(#FFE98A) + RainbowRodHit 两掷直驱、零广播', async () => {
    const pickable = await findReforgable();
    rollHook.pick = () => pickable.top;                    // 劫顶档掷（其余透传）

    const parts: Array<{ x: number; y: number; color: string }> = [];
    const dustCalls: unknown[] = [];
    const wavCalls: string[] = [];
    const broadcasts: number[] = [];
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    const player = new Player(60 * 16, 100 * 16, new Inventory());
    const mc = player.mountedCenter;
    g.player = player;
    g.cb = {};
    g.sfx = { playWavFile: (name: string) => { wavCalls.push(name); } };
    g.reforgeCost = () => 10;
    g.coinsOwned = () => 999999;
    g.spendCopper = () => true;
    g.spawnParticles = (x: number, y: number, color: string) => {
      parts.push({ x, y, color });
      return undefined;
    };
    g.spawnDust = (...a: unknown[]) => {
      dustCalls.push(a);
      return { vx: 0, vy: 0 };
    };
    g.broadcastParticleOrchestra = (t: number) => { broadcasts.push(t); };

    const res = (g as unknown as {
      doReforge(i: { id: number; stack: number; prefix?: number }): number;
    }).doReforge({ id: pickable.id, stack: 1 });
    expect(res).toBe(pickable.top);                        // 顶级词缀必然入支

    // 音：BestReforge 一声；非最优档 Item37 不出现
    expect(wavCalls).toEqual(['best_reforge']);
    // ① BestReforge 三连掷 × Spawn_BestReforge 八粒 Research_Spark = 24 粒
    const sparks = parts.filter((q) => q.color === '#FFE98A');
    expect(sparks).toHaveLength(24);
    // ② RainbowRodHit 两掷直驱（每掷彩色六 + 白核六 = 12 白核）——两掷位置 =
    //    MountedCenter+(0,−16×gravDir)
    // ★BJ731 改判史（2026-10-27）：BJ704-G24（件4,G2 族一致性清偿）起双层
    //    sparkle 自 spawnParticles 单标量方块退役 → spawnDust prettySparkle
    //    专用档（白核 tint {255,255,255,0}、scale×0.6、perfect 直装）——白核
    //    断言自 parts(color='rgba(255,255,255,0.85)') 改读 dustCalls 第 9 参
    //    白 tint（彩色层/d267 族 tint 均非全白 a=0,判别唯一）。每掷 6 白核
    //    ×2 掷 = 12。
    const whitesD = dustCalls.filter((a) => {
      const t = (a as unknown[])[8] as { r: number; g: number; b: number; a: number } | undefined;
      return !!t && t.r === 255 && t.g === 255 && t.b === 255 && t.a === 0;
    });
    expect(whitesD).toHaveLength(12);
    const gy = mc.y - 16 * player.gravDir;
    for (const a of whitesD) {
      expect(Math.abs(((a as unknown[])[1] as number) - gy)).toBeLessThanOrEqual(12);
    }
    // clientOnly:true 面 = 全部本地直驱,module8 上行零调用
    expect(broadcasts).toHaveLength(0);
  });
});
