// ★BJ714-A（R16-P1 清偿,2026-10-25）:实体侧传送面漏接 migrateMinecartOnTeleport
// 三面 + P2 两件（BreathMeter 第四 lavaMax 消费位聚合 / 岩浆回充门 flag26）。
// 锚=memory/bj713r16-summon-cart-redblue3.md P1/P2 + memory/bj713a-cart-transfer-death.md
// 迁移范式;campaign-playbook 每刀 Checklist;标杆 Terarria1457 亲读定谳:
//   面1 皇后钩瞬移:DoQueenSlimeHookTeleport（Player.cs:22924-22939）尾 Teleport
//       (vector,10)（:22937）→ 全 style 汇聚 :37698-37780【零 Dismount】→ 矿车
//       Cart mount 态随迁。触发链=Projectile.cs AI_007 挂墙回调 type 935
//       （:49876-49878/1457 :53704-53705）。
//   面2 传送门穿越:PortalHelper.TryGoingThroughPortals（:105-215）Player 支
//       `player.Teleport(vector, 4, num4)`（:187;msg96 网面 MessageBuffer.cs:3557
//       同 style4）。style4 专属面（Teleport :37759-37765 lastPortalColorIndex/
//       portalPhysicsFlag/gravity=0）为既有未移植域,非本刀。
//   面3 微光脱困:ShimmerUnstuck（Player.cs:29088-29116）→ Teleport(vector+
//       (0,-2),12)（:29095）;timeShimmering 归零（:29090）→ 不随迁=脱困被拖回
//       +计时归零重累 3600t 空转。
//   拖回机制=同拍实体序（bj713a 判例:player.fixedUpdate→entities.update,车
//   「玩家坐骑位回写段」Minecart.ts:626-630 每拍 p.x=this.x 锁回）——修法=
//   BJ713-A 的 migrateMinecartOnTeleport 上 GameHooks 可选钩（BJ108
//   startCameraTransitionForPlayerTeleport 先例,Game.ts:13629-13633 注已声明
//   实体面经钩消费）→ 三调用点消费。
//   P2① vanilla 火焰条读 player.lavaMax 单帧累计字段（Main.cs:42829-42932,
//       含坐骑面 Mount.cs:5138 +420）→ BreathMeter 聚合读口（Player getter）。
//   P2② 回充门 flag26（Player.cs:27884 true → :27886 `if (flag25 && !lavaImmune)
//       flag26=false` → :27926 `if (flag26 && lavaTime < lavaMax) lavaTime++`）
//       =!inLava||lavaImmune——浸浆但免疫态（黑曜石皮 :9573/buff305 熔岩鲨坐骑
//       /modLavaImmune）原版照回充,SW 旧 !inLava 单门=冻结。
// 修前复现=本文件先落盘后跑（A1/A2/A3/B1/B2 五红=旧态观察）;变异恰红 M1-M5
// 见文末批注（摘面1/面2/面3/BreathMeter 回退/回充门回退各恰红对应组）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Minecart } from '../src/entities/Minecart';
import { Portal, portalRegistry, clearPortals } from '../src/entities/Portal';
import { GrappleProj, GRAPPLE_LATCH } from '../src/entities/GrappleProj';
import { Game } from '../src/core/Game';
import { World } from '../src/world/World';
import { TileStore, LIQUID_TYPE } from '../src/world/TileStore';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TILE_BY_KEY } from '../src/data/tiles';
import { TILE } from '../src/core/constants';
import { BuffType } from '../src/stats/Buffs';
import { VanillaBreathMeter } from '../src/render/BreathMeter';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = {
  game: readFileSync(join(ROOT, 'src/core/Game.ts'), 'utf8'),
  player: readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8'),
  portal: readFileSync(join(ROOT, 'src/entities/Portal.ts'), 'utf8'),
  types: readFileSync(join(ROOT, 'src/entities/types.ts'), 'utf8'),
  breath: readFileSync(join(ROOT, 'src/render/BreathMeter.ts'), 'utf8'),
};

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];
const proto = Game.prototype as unknown as Record<string, unknown>;

/** 直驱矿车夹具（bj713a mkCart 同款:手置状态=零物理干扰） */
function mkCart(mountId: number, x = 1000, y = 500): Minecart {
  const c = new Minecart();
  c.mountId = mountId;
  c.applyMountStats();
  c.mounted = true;
  c.x = x; c.y = y;
  return c;
}

/** 真身迁移单源驱动（Game.prototype.migrateMinecartOnTeleport,bj713a A1 同式） */
const migrate = (c: Minecart, p: Player): void =>
  (proto.migrateMinecartOnTeleport as (this: unknown) => void).call({ minecart: c, player: p });

// =====================================================================
// §A P1 三面:实体侧传送接 migrateMinecartOnTeleport（骑矿车随迁）
// =====================================================================
describe('BJ714-A §A 面1 皇后钩 935 挂墙瞬移随迁（Teleport style10 :22937）', () => {
  it('A1 全链（发射 935→挂墙→doQueenSlimeHookTeleport）:骑 Hell 车瞬移成立且车随迁、fallStart 重置、保持骑乘——旧=车留原位下一拍锁回（道具废）', () => {
    const w = new World(60, 60, 42, 'bj714a-a1');
    for (let x = 26; x <= 34; x++) w.store.setTileSilent(x, 24, TILE_BY_KEY['dirt']!);  // 天花板
    const p = new Player(30 * TILE, 40 * TILE, new Inventory());
    const c = mkCart(22, 999, 999);
    c.vx = 7; c.vy = 2;
    p.ridingCart = true; p.cart = c;
    const cam = vi.fn();
    const hooks = {
      world: w, player: p,
      spawnDrop: () => null, addDamageNumber: () => {},
      playSfx: () => {}, spawnParticles: () => {}, spawnBurst: () => {},
      onInventoryChanged: () => {},
      enemies: () => [], critters: () => [], spawnEnemy: () => {},
      damagePlayer: (): number => 0,
      startCameraTransitionForPlayerTeleport: cam,
      migrateMinecartOnTeleport: () => migrate(c, p),
    } as unknown as GameHooks;
    const g = new GrappleProj(p.cx - 8, p.y + 8, 0, -4, 935, () => (p.dead ? null : p));
    p.registerGrappleProj(g);
    for (let t = 0; t < 4000 && g.ai0 !== GRAPPLE_LATCH; t++) g.fixedUpdate(1 / 60, hooks);
    expect(g.ai0).toBe(GRAPPLE_LATCH);                      // 夹具有效性:确挂墙
    expect(p.y).toBeLessThan(40 * TILE - 100);              // 瞬移成立（bj108 同式）
    expect(c.x).toBe(p.x);                                  // ★车随迁同落
    expect(c.y).toBe(p.y);
    expect(c.vx).toBe(0);                                   // 镜像玩家终值（SW 清速近似面）
    expect(c.vy).toBe(0);
    expect(c.fallStart).toBe(Math.trunc(c.y / TILE));       // Teleport :37739 fallStart 重置
    expect(c.mounted).toBe(true);                           // vanilla 不卸 mount
    expect(p.ridingCart).toBe(true);
  });
});

describe('BJ714-A §A 面2 传送门穿越随迁（Teleport style4 PortalHelper.cs:187）', () => {
  afterEach(() => clearPortals());
  it('A2 直驱 Portal.fixedUpdate:骑 Hell 车穿越成立（速度改向+冷却）且车随迁镜像改向后速度——旧=车留原位被锁回', () => {
    const w = new World(60, 60, 42, 'bj714a-a2');           // 全空气（四向净空恒过）
    const p = new Player(310, 479, new Inventory());        // 盒中心=门A中心 (320,500)
    p.vx = 0; p.vy = 5;
    const c = mkCart(22, 999, 999);
    c.vx = 9;
    p.ridingCart = true; p.cart = c;
    const a = new Portal(320, 500, Math.PI / 2, 0);
    const b = new Portal(640, 500, Math.PI / 2, 1);         // num=2 桶:出口=左缘,法线 (-1,0)
    a.owner = 1; b.owner = 1;
    portalRegistry().push(a, b);
    const hooks = {
      world: w, player: p,
      migrateMinecartOnTeleport: () => migrate(c, p),
    } as unknown as GameHooks;
    a.fixedUpdate(1 / 60, hooks);
    expect(p.x).toBe(620);                                  // 穿越成立（出口=门B左缘,dist=0）
    expect(p.y).toBe(479);
    expect(p.vx).toBe(-5);                                  // 速度改向（保速率 5,法线向）
    expect(c.x).toBe(620);                                  // ★车随迁同落
    expect(c.y).toBe(479);
    expect(c.vx).toBe(-5);                                  // 镜像改向后速度
    expect(c.vy).toBe(0);
    expect(c.fallStart).toBe(Math.trunc(479 / TILE));
    expect(c.mounted).toBe(true);
    expect(a.cooldown).toBe(10);                            // 冷却面未受扰（:203）
    expect(b.cooldown).toBe(10);
  });
});

describe('BJ714-A §A 面3 微光脱困传送随迁（Teleport style12 :29095）', () => {
  // 高度 256:UnderworldLayer = h-200 = 56 须在池（行 33-39）之下（bj108 同构）
  function shimmerWorld(): World {
    const w = new World(60, 256, 11, 'bj714a-a3');
    const st = w.store;
    for (let x = 10; x < 30; x++) {
      st.setTile(x, 40, 1);
      for (let y = 33; y < 40; y++) st.setLiquid(x, y, 255, 4);
    }
    for (let x = 30; x < 46; x++) st.setTile(x, 40, 1);
    return w;
  }
  it('A3 全链（fixedUpdate 入微光→1200t+输入→Unstuck）:骑 Hell 车脱困传送成立且车随迁、vy 镜像 (0,0.0001)、保持骑乘——旧=脱困被拖回+timeShimmering 归零空转', () => {
    const w = shimmerWorld();
    const p = new Player(20 * TILE, 36 * TILE, new Inventory());
    const c = mkCart(22, 999, 999);
    c.vx = 6;
    p.ridingCart = true; p.cart = c;
    const cam = vi.fn();
    const hooks = {
      world: w, player: p,
      enemies: () => [], critters: () => [],
      spawnDrop: () => null, damagePlayer: (): number => 0,
      addDamageNumber: () => {}, cutTile: () => {},
      onEnemyKilled: () => {}, spawnEnemy: () => {},
      spawnParticles: () => {}, notifyInventoryChanged: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, showPickupLabel: () => {},
      startCameraTransitionForPlayerTeleport: cam,
      migrateMinecartOnTeleport: () => migrate(c, p),
    } as unknown as GameHooks;
    p.fixedUpdate(1 / 60, hooks);
    expect(p.shimmering).toBe(true);                        // 夹具有效性:骑乘态照入微光
    const beforeX = p.x, beforeY = p.y;
    p.timeShimmering = 1200;                                // ≥1200 且有输入 → Unstuck（:28378）
    p.inputX = 1;
    p.fixedUpdate(1 / 60, hooks);
    expect(p.shimmering).toBe(false);                       // 脱困传送完成
    expect(Math.hypot(p.x - beforeX, p.y - beforeY)).toBeGreaterThan(10);   // 传送确已发生
    expect(p.timeShimmering).toBe(0);                       // 计时清零（:29090）
    expect(c.x).toBe(p.x);                                  // ★车随迁同落
    expect(c.y).toBe(p.y);
    expect(c.vx).toBe(0);                                   // 镜像速度终值（Teleport 前置 (0,0.0001)）
    expect(c.vy).toBeCloseTo(0.0001, 10);
    expect(c.fallStart).toBe(Math.trunc(c.y / TILE));
    expect(c.mounted).toBe(true);
    expect(p.ridingCart).toBe(true);
  });
});

// =====================================================================
// §B P2 两件:BreathMeter 聚合 + 岩浆回充门 flag26
// =====================================================================
describe('BJ714-A §B1 BreathMeter 第四 lavaMax 消费位聚合（原版读 player.lavaMax 含坐骑面）', () => {
  /** 画布桩:只记 drawImage 次数 */
  function fakeDraw() {
    const calls: number[] = [];
    const ctx = {
      globalAlpha: 1,
      drawImage: () => { calls.push(1); },
    } as unknown as CanvasRenderingContext2D;
    const cam = { worldToScreen: () => [0, 0] } as never;
    const atlas = { vmisc: () => ({ img: {} as never, sx: 0, sy: 0, sw: 22, sh: 22 }) } as never;
    return { ctx, cam, atlas, calls };
  }
  const meter = new VanillaBreathMeter();
  const ride = (p: Player): void => {
    p.ridingCart = true;
    p.cart = mkCart(22, 0, 0);
  };

  it('B1 骑 Hell 车（+420）无护身符浸浆宽限 200 → 火焰条 10 槽全画（旧=equip 单读 0,条不显示）;getter 分档 420/840/420/0', () => {
    const p = new Player(0, 0, new Inventory());
    ride(p);
    p.cartLavaMaxBonus = 420;                               // Minecart 逐拍写产物（G34 B1）
    p.inLava = true; p.lavaImmuneTicks = 200; p.breath = p.breathMax;
    expect(p.lavaMaxTotal).toBe(420);                       // ★聚合读口
    const f = fakeDraw();
    meter.draw(f.ctx, p, f.cam, 600, f.atlas, false);
    expect(f.calls.length).toBe(10);                        // flameSlots(420)=10 槽（旧=0）
    // 帽上沿面:护身符 420+车 420=840,宽限 700 ∈ [420,840) → 条仍显示（旧单读 420 → 700<420 假=消失）
    const p2 = new Player(0, 0, new Inventory());
    p2.inv.armor[4] = { id: iid(906), stack: 1 };           // 熔岩护身符 420
    ride(p2);
    p2.cartLavaMaxBonus = 420;
    p2.inLava = true; p2.lavaImmuneTicks = 700; p2.breath = p2.breathMax;
    expect(p2.lavaMaxTotal).toBe(840);
    const f2 = fakeDraw();
    meter.draw(f2.ctx, p2, f2.cam, 600, f2.atlas, false);
    expect(f2.calls.length).toBe(10);
    // 纯配饰面（无车）等价 + 裸面 0（防幻影）
    const pCharm = new Player(0, 0, new Inventory());
    pCharm.inv.armor[4] = { id: iid(906), stack: 1 };
    expect(pCharm.lavaMaxTotal).toBe(420);
    expect(new Player(0, 0, new Inventory()).lavaMaxTotal).toBe(0);
    // dead 早退面（L42827）
    const pDead = new Player(0, 0, new Inventory());
    ride(pDead);
    pDead.cartLavaMaxBonus = 420;
    pDead.dead = true; pDead.inLava = true; pDead.lavaImmuneTicks = 200;
    const f3 = fakeDraw();
    meter.draw(f3.ctx, pDead, f3.cam, 600, f3.atlas, false);
    expect(f3.calls.length).toBe(0);
  });
});

describe('BJ714-A §B2 岩浆宽限回充门 flag26（!inLava||lavaImmune :27884-27926）', () => {
  /** 岩浆池世界（bj709g34 makeLavaPoolWorld 同款） */
  function lavaPoolWorld(): World {
    const w = new World(60, 220, 44, 'bj714a-b2');
    w.groundLevel = 200;
    for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, 137, 1, 0, 0);
    for (let y = 90; y < 137; y++) {
      for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.LAVA);
    }
    return w;
  }
  /** 真实 World 玩家钩桩（bj709g34 makeWorldHooks 同款;damagePlayer=spy） */
  function worldHooks(w: World) {
    return {
      world: w, player: null as unknown,
      enemies: () => [], critters: () => [], npcs: () => [],
      entities: { nextId: 1, add: () => {} },
      playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
      spawnParticles: () => {}, spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
      addDamageNumber: () => {}, spawnDrop: () => null,
      damagePlayer: vi.fn((): number => 0),
      notifyInventoryChanged: () => {}, onEnemyKilled: () => {},
      spawnEnemy: () => {}, cutTile: () => {},
    } as unknown as GameHooks & { damagePlayer: ReturnType<typeof vi.fn> };
  }
  afterEach(() => { vi.restoreAllMocks(); });

  it('B2 浸浆+免疫态（黑曜石皮）照回充 +1/tick 至聚合帽;零伤;无免疫浸浆仍耗宽限（G34 B3 域不破）', () => {
    const w = lavaPoolWorld();
    const game = worldHooks(w);
    const p = new Player(21 * TILE, 136 * TILE - 42, new Inventory());
    p.inv.armor[4] = { id: iid(906), stack: 1 };            // 护身符 420（lavaMax>0 门）
    p.buffs.apply(BuffType.ObsidianSkin, 3600);             // lavaImmune（:9573）
    p.lavaImmuneTicks = 100;
    p.fixedUpdate(1 / 60, game);
    expect(p.inLava).toBe(true);                            // 夹具有效性:确在岩浆中
    expect(p.lavaImmuneTicks).toBe(101);                    // ★浸浆但免疫态照回充（旧=冻结 100）
    expect(game.damagePlayer).not.toHaveBeenCalled();       // 免疫态零伤
    p.lavaImmuneTicks = 840;                                // 超帽残值（骑乘期聚合回满遗产）
    p.fixedUpdate(1 / 60, game);
    expect(p.lavaImmuneTicks).toBe(420);                    // 无条件钳到配饰面（:27930,回充不越帽）
    // 负控:同位无免疫浸浆 → 耗宽限不回充（门改不得破坏 G34 B3 相）
    const pNo = new Player(21 * TILE, 136 * TILE - 42, new Inventory());
    pNo.inv.armor[4] = { id: iid(906), stack: 1 };
    pNo.lavaImmuneTicks = 100;
    pNo.fixedUpdate(1 / 60, game);
    expect(pNo.inLava).toBe(true);
    expect(pNo.lavaImmuneTicks).toBe(99);                   // 浸浆未免疫=递减
  });
});

// =====================================================================
// §C 结构锁 + 基线守恒（bj713a 12 锁/bj709g34 16 锁钉面零扰动）
// =====================================================================
describe('BJ714-A §C 结构锁（钩暴露/三面接线/P2 字面）+ 基线守恒', () => {
  it('C1 钩暴露三面:GameHooks 可选钩+Game 公开单源（BJ108 同先例）+实体侧三消费面;四 Game 侧既有接线面不变', () => {
    expect(SRC.types).toContain('migrateMinecartOnTeleport?(): void;');
    expect(SRC.types).toContain('PortalHelper.cs:187');     // 判语锚（style4 定谳链）
    expect(SRC.types).toContain(':22937');                  // 判语锚（style10）
    expect(SRC.types).toContain(':29095');                  // 判语锚（style12）
    expect(SRC.game).toContain('migrateMinecartOnTeleport(): void {');        // 公开（BJ714-A 升格）
    expect(SRC.game).not.toContain('private migrateMinecartOnTeleport(): void {');
    expect((SRC.game.match(/this\.migrateMinecartOnTeleport\(\);/g) ?? []).length).toBe(4);   // BJ713-A 四汇线守恒
    expect((SRC.player.match(/game\.migrateMinecartOnTeleport\?\.\(\);/g) ?? []).length).toBe(2);   // 面1+面3
    expect(SRC.portal).toContain('game.migrateMinecartOnTeleport?.();');      // 面2
  });

  it('C2 P2 两件字面:聚合 getter + BreathMeter 消费 + 回充门 flag26 双腿', () => {
    expect(SRC.player).toContain('get lavaMaxTotal(): number { return this.equipStats.lavaMax + this.cartLavaMaxBonus; }');
    expect(SRC.breath).toContain('const lavaMax = p.lavaMaxTotal;');
    expect(SRC.player).toContain('} else if (!this.inLava || lavaTotalImmune) {');
    expect(SRC.player).toContain(':27884');                 // flag26 定谳锚
    expect(SRC.player).toContain(':27926');                 // 回充行锚
  });

  it('C3 基线守恒:bJ713-A/G34 钉面零扰动（聚合 const/Recall spawn 支/respawn equip 单读/旧内联退役保持）', () => {
    expect(SRC.player).toContain('const lavaMax = eqM.lavaMax + this.cartLavaMaxBonus;');
    expect((SRC.player.match(/const lavaMax = eqM\.lavaMax;/g) ?? []).length).toBe(0);
    expect(SRC.game).toContain("if (c.kind === 'spawn') p.lavaImmuneTicks = p.equipStats.lavaMax + p.cartLavaMaxBonus;");
    expect((SRC.game.match(/p\.lavaImmuneTicks = p\.equipStats\.lavaMax;/g) ?? []).length).toBe(1);
    expect((SRC.game.match(/p\.lavaImmuneTicks = [^;]+;/g) ?? []).length).toBe(2);
  });
});

// 变异恰红（开发期实测,M1-M5 盘还原 md5 复核）:
//  M1 doQueenSlimeHookTeleport 摘 game.migrateMinecartOnTeleport?.() → A1 红（c 留 999,999）
//  M2 Portal.fixedUpdate 摘同行 → A2 红
//  M3 shimmerUnstuck 摘同行 → A3 红
//  M4 BreathMeter 回退 p.equipStats.lavaMax 单读 → B1 红（0 槽/帽上沿 0 槽）
//  M5 回充门回退 !this.inLava 单腿 → B2 红（冻结 100）
