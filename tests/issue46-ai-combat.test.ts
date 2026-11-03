// issue #46 刀 B —— AI/战斗簇 10 项（N04/N05/N06/N07/N08/N09/N10/N14/N18/N19）。
//
// 纪律：先行号来自 1.4.5.8 第三方仓，本文件一律锚 **1457 反编译亲读**重锚行号
// （Terarria1457/Terraria/*.cs）。每项 = 正例 + 负控（不可达/反例证明），
// DoT 类按 N06 验收建议断言**前 1/4/20/30/40/60 帧**与多效果叠加，不用一秒均值。
//
// 1457 重锚表（issue 原行号 → 1457 实锚）：
//   N04 NPC.cs:110887-110899 → :91605-91618（!noTileCollide 分派）；:110862-110869
//       → :91580-91587（重力/落速帽只受 !noGravity 限定）
//   N05 :112466 → :92716（`if (!dontTakeDamage)` 包住整个 DOTTally 与扣血）
//   N06 :80-87 → :80-141（DOTTally 结构）；:112585-112626 → :92821-92878
//   N07 :80183-80193 → :67435-67446（RedHatSkeletronAdjustmentsEnabled）；
//       :95383-95386 → :82068-82071（防后 ×0.7f 截断保底）
//   N08 :50602-50612 → :44086-44094 + :91580-91587（AI 只设初速,通用重力后置）
//   N09 :50647-50657 → :44137-44140（身体不在实心内才清 noTileCollide）
//   N10 :26153-26160 → :21127-21134（getGood+24+AnyNPCs(113) 双速档）
//   N14 :72807-72814 → :61630-61637（IsAVoiceChangeItem → lifeMax×3 一次性门）
//   N18 :62603 → :53301-53312（DespawnEncouragement…IsDiscouraged）+ Main.cs:63782-63789
//   N19 :29711-29725 → :24592-24607（锥外传送带发射）
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { withMutation } from './mutation-guard';   // 跨套件按文件互斥/panic 还原/残留自检

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });   // 变异子进程（仓内习语）
import { Enemy } from '../src/entities/Enemy';
import { updateNpcLiquid, type NpcLiquidHost } from '../src/entities/npcLiquid';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TILE } from '../src/core/constants';
import { TILE_BY_KEY } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';

const W = 140, H = 140;
const FLOOR = 120;
const DIRT = TILE_BY_KEY['dirt']!;
const CONVEYOR_421 = TILE_BY_KEY['v_421_conveyorbeltleft']!;
const CONVEYOR_422 = TILE_BY_KEY['v_422_conveyor_belt_ccw']!;
const CHUNK = 120;                       // lifeRegenCount：120 单位 = 1 HP（NPC.cs:92848+）

type Fixture = {
  w: World; hooks: GameHooks; enemies: Enemy[]; player: Player;
  added: Array<{ kind: string; e: unknown }>;
};

/** 干世界夹具：地面铺满实心；groundLevel=0 → applyGravity 跳过高空衰减
 *  （Enemy.applyGravity :5135 `if (surf > 0)`，测试世界无地表线），重力恒 0.3。 */
function makeFixture(opts: {
  groundLevel?: number; rockLevel?: number; floor?: number; noFloor?: boolean;
} = {}): Fixture {
  const w = new World(W, H, 11, 'issue46-ai-combat');
  const st = w.store;
  w.groundLevel = opts.groundLevel ?? 0;
  w.rockLevel = opts.rockLevel ?? 0;
  if (!opts.noFloor) {
    const floor = opts.floor ?? FLOOR;
    for (let x = 0; x < W; x++) for (let y = floor; y < H; y++) st.setTile(x, y, DIRT);
  }
  const enemies: Enemy[] = [];
  const added: Array<{ kind: string; e: unknown }> = [];
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: string) => { added.push({ kind: bucket, e }); },
  };
  const player = new Player(W * TILE * 0.5, (FLOOR - 3) * TILE, new Inventory());
  const hooks = {
    world: w, player,
    enemies: () => enemies,
    critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    notifyInventoryChanged: () => {}, playSfx: () => {}, playSfxFiles: () => {},
    playSfxFile: () => {}, playSfxWav: () => {},
    showPickupLabel: () => {}, cutTile: () => {},
    dropContext: () => ({
      zoneHallow: false, zoneCorrupt: false, zoneCrimson: false, zoneJungle: false,
      zoneSnow: false, zoneDesert: false, zoneDungeon: false, zoneBeach: false,
      bloodMoon: false, halloween: false, xmas: false, windy: false,
    }),
    scene: { zoneHallow: false, zoneGraveyard: false },
    entities: em,
  } as unknown as GameHooks;
  return { w, hooks, enemies, player, added };
}

function spawn(f: Fixture, id: number, x: number, y: number): Enemy {
  const e = Enemy.fromVanilla(id, x, y)!;
  expect(e, `Enemy.fromVanilla(${id}) 在册`).toBeTruthy();
  e.id = f.enemies.length + 1;
  e.iframes = 0;
  f.enemies.push(e);
  return e;
}

/** DoT 时间线：逐 tick 推进，返回 frames 指定帧上的累计扣血（1 tick = 1/60s） */
function dotTimeline(e: Enemy, hooks: GameHooks, frames: number[]): number[] {
  const hp0 = e.hp;
  const out: number[] = [];
  const maxF = Math.max(...frames);
  for (let t = 1; t <= maxF; t++) {
    e.fixedUpdate(1 / 60, hooks);
    if (frames.includes(t)) out.push(hp0 - e.hp);
  }
  return out;
}

/** 直接驱动 NPC 液体段（unit 面：只测 updateNpcLiquid 的分支语义） */
function liquidHost(w: World, over: Record<string, unknown> = {}) {
  const dmg: number[] = [];
  const host: NpcLiquidHost = {
    x: 40 * TILE, y: 60 * TILE, w: 20, h: 20, vx: 0, vy: 16,
    cx: 40 * TILE + 10, cy: 60 * TILE + 10,
    vanillaId: 3, vanilla: { aiStyle: 3 }, ai0: 0,
    wet: false, wetCount: 0, honeyWet: false, shimmerWet: false, lavaWet: false,
    lavaCd: 0, onFireT: 0, onFire3T: 0, stinkyT: 0, inWater: false, liqFactor: 1,
    def: {},
    hurt: (n: number) => { dmg.push(n); },
    ...(over as Partial<NpcLiquidHost>),
  } as NpcLiquidHost;
  const game = {
    player: null, world: w, spawnParticles: () => {}, playSfxWav: () => {},
  } as unknown as GameHooks;
  return { host, game, dmg };
}

// ══════════════════════════════════════════════════════════════════════════
// N04 — 穿墙 NPC 错走液体碰撞（1457 NPC.cs:91605-91618 / :91580-91587）
// ══════════════════════════════════════════════════════════════════════════
describe('N04 穿墙 NPC 液体分流（NPC.cs:91605-91618）', () => {
  const LAVA_ROW = 60;
  function lavaWorld(): World {
    const f = makeFixture({ noFloor: true });
    for (let x = 20; x < 60; x++) for (let y = 55; y < 70; y++) f.w.store.setLiquid(x, y, 255, 2);
    return f.w;
  }

  it('正例：noTileCollide 族入岩浆 = 无直伤/不上火/不掉速（UpdateCollision 整块跳过）', () => {
    const w = lavaWorld();
    const { host, game, dmg } = liquidHost(w);
    updateNpcLiquid(host, game, w.store, true);
    expect(dmg).toEqual([]);                       // 岩浆 50 直伤不触发
    expect(host.onFireT).toBe(0);                  // AddBuff(24,420) 不触发
    expect(host.vy).toBe(16);                      // wet 落速帽 7 不触发（猪鲨冲刺 vy=16）
    expect(host.liqFactor).toBe(1);                // 无 MoveWhileWet ⇒ 不缩位移
    expect(host.wet).toBe(false);
    expect(host.lavaWet).toBe(false);
  });

  it('负控：同一环境非穿墙族照吃岩浆（50 直伤 + 7s 火 + wet 落速帽 7 + liqFactor 0.5）', () => {
    const w = lavaWorld();
    const { host, game, dmg } = liquidHost(w);
    updateNpcLiquid(host, game, w.store, false);
    expect(dmg).toEqual([50]);
    expect(host.onFireT).toBe(7);
    expect(host.lavaWet).toBe(true);
    expect(host.wet).toBe(true);
    expect(host.vy).toBe(7);
    expect(host.liqFactor).toBe(0.5);
  });

  it('穿墙支仍执行可水灭效果（WetCollision → TryRemovingWaterPerishableEffects(false)）', () => {
    const f = makeFixture({ noFloor: true });
    for (let x = 30; x < 50; x++) for (let y = 55; y < 70; y++) f.w.store.setLiquid(x, y, 255, 1);
    const { host, game } = liquidHost(f.w, { onFireT: 7, onFire3T: 5, stinkyT: 3, lavaCd: 7 });
    updateNpcLiquid(host, game, f.w.store, true);
    expect(host.onFireT).toBe(0);
    expect(host.onFire3T).toBe(0);
    expect(host.stinkyT).toBe(0);
    expect(host.lavaCd).toBe(7);                   // 穿墙支不递减 immune[255]（UpdateCollision 跳过）
    // 负控：干处不熄火
    const dry = liquidHost(f.w, { onFireT: 7 });
    dry.host.y = 0; dry.host.x = 0;                // 移到无液体角
    updateNpcLiquid(dry.host, dry.game, f.w.store, true);
    expect(dry.host.onFireT).toBe(7);
  });

  it('有效口径单源：静态 vanilla.noTileCollide ∪ 运行期实例位（phasing getter）', () => {
    const f = makeFixture();
    const duke = spawn(f, 370, 20 * TILE, 60 * TILE);      // 静态 noTileCollide+noGravity
    expect(duke.phasing).toBe(true);
    const zombie = spawn(f, 3, 25 * TILE, 60 * TILE);
    expect(zombie.phasing).toBe(false);
    zombie.noTileCollide = true;                          // 运行期实例位（fairyAI/690 跃起态）
    expect(zombie.phasing).toBe(true);
  });

  it('端到端：猪鲨 370 泡岩浆 5 拍零扣血（旧实现 50/30 拍 + wet 限速）', () => {
    const f = makeFixture({ noFloor: true });
    for (let x = 10; x < 60; x++) for (let y = 50; y < 75; y++) f.w.store.setLiquid(x, y, 255, 2);
    const e = spawn(f, 370, 25 * TILE, 58 * TILE);
    e.hp = 1000; e.maxHp = 1000;
    for (let i = 0; i < 5; i++) e.fixedUpdate(1 / 60, f.hooks);
    expect(e.hp).toBe(1000);
    expect(e.lavaWet).toBe(false);
  });

  it('端到端负控：同池普通僵尸照吃岩浆直伤', () => {
    const f = makeFixture({ noFloor: true });
    for (let x = 10; x < 60; x++) for (let y = 50; y < 75; y++) f.w.store.setLiquid(x, y, 255, 2);
    const e = spawn(f, 3, 25 * TILE, 58 * TILE);
    e.hp = 1000; e.maxHp = 1000;
    e.fixedUpdate(1 / 60, f.hooks);
    // StrikeNPCNoInteraction(50) 照走 CalculateDamageNPCsTake（50 − def×0.5，保底 1）
    expect(1000 - e.hp).toBe(Math.max(1, Math.trunc(50 - (e.def.defense ?? 0) * 0.5)));
    expect(e.lavaWet).toBe(true);
    expect(e.wet).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// N05 — DoT 绕过 dontTakeDamage（1457 NPC.cs:92716）
// ══════════════════════════════════════════════════════════════════════════
describe('N05 无敌旗拦截 DoT（NPC.cs:92716 `if (!dontTakeDamage)`）', () => {
  it('正例：dontTakeDamage 期间 onFire3 零扣血且账面不累加（连 lifeRegenCount 都停）', () => {
    const f = makeFixture();
    const e = spawn(f, 3, 20 * TILE, (FLOOR - 3) * TILE);
    e.hp = e.maxHp = 100000; e.def.defense = 0;
    e.onFire3T = 10;
    e.dontTakeDamage = true;
    expect(dotTimeline(e, f.hooks, [60])[0]).toBe(0);
    expect(e.lifeRegenCount).toBe(0);              // 整块跳过 = 账面零累加
    // 负控：解除无敌后同剩余计时照常批次扣血（20 帧一批 5 点）
    e.dontTakeDamage = false;
    expect(dotTimeline(e, f.hooks, [20])[0]).toBe(5);
  });

  it('受伤→无敌→再受伤：无敌窗口内暂停，恢复后不补扣（史莱姆王缩没语义）', () => {
    const f = makeFixture();
    const e = spawn(f, 3, 20 * TILE, (FLOOR - 3) * TILE);
    e.hp = e.maxHp = 100000; e.def.defense = 0;
    e.onFire3T = 2;                                 // 120 帧
    const a = dotTimeline(e, f.hooks, [20])[0];     // 第 20 帧首批 5
    expect(a).toBe(5);
    e.dontTakeDamage = true;
    const b = dotTimeline(e, f.hooks, [20])[0];     // 无敌 20 帧
    expect(b).toBe(0);
    e.dontTakeDamage = false;
    const c = dotTimeline(e, f.hooks, [20])[0];     // 恢复后 20 帧 = 恰一批 5（不补无敌期）
    expect(c).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// N06 — DoT 批次/时点（1457 NPC.cs:80-141 / :92821-92878）
// ══════════════════════════════════════════════════════════════════════════
describe('N06 DoT 统一批次（DOTTally + lifeRegenCount）', () => {
  const mk = () => {
    const f = makeFixture();
    const e = spawn(f, 3, 20 * TILE, (FLOOR - 3) * TILE);
    e.hp = e.maxHp = 100000; e.def.defense = 0;
    return { f, e };
  };

  it('onFire3T：第 1/4 帧 0，第 20 帧 5，30 帧 5，40 帧 10，60 帧 15（30/t → 600 门槛）', () => {
    const { f, e } = mk();
    e.onFire3T = 10;
    expect(dotTimeline(e, f.hooks, [1, 4, 20, 30, 40, 60])).toEqual([0, 0, 5, 5, 10, 15]);
  });

  it('venomT：30 帧首批 15（60/t → 1800 门槛），60 帧 30', () => {
    const { f, e } = mk();
    e.venomT = 10;
    expect(dotTimeline(e, f.hooks, [1, 4, 20, 30, 40, 60])).toEqual([0, 0, 0, 15, 15, 30]);
  });

  it('potentAcidT / chlorophyteSporeT：40 帧首批 60（180/t → 7200 门槛），60 帧 60', () => {
    for (const key of ['potentAcidT', 'chlorophyteSporeT'] as const) {
      const { f, e } = mk();
      e[key] = 10;
      expect(dotTimeline(e, f.hooks, [1, 4, 20, 30, 40, 60]), key).toEqual([0, 0, 0, 0, 60, 60]);
    }
  });

  it('bleedT：20 帧首批 4（24/t → 480 门槛），60 帧 12', () => {
    const { f, e } = mk();
    e.bleedT = 10;
    expect(dotTimeline(e, f.hooks, [1, 4, 20, 30, 40, 60])).toEqual([0, 0, 4, 4, 8, 12]);
  });

  it('onFireT（无批次档 num=0）：15 帧首批 1（8/t → 120 门槛），60 帧 4', () => {
    const { f, e } = mk();
    e.onFireT = 10;
    expect(dotTimeline(e, f.hooks, [1, 4, 20, 30, 40, 60])).toEqual([0, 0, 1, 2, 2, 4]);
  });

  it('多效果叠加共享余量：onFire(8)+venom(60) → batch=max(0,15)，68/t → 27 帧首批 15', () => {
    const { f, e } = mk();
    e.onFireT = 10; e.venomT = 10;
    expect(dotTimeline(e, f.hooks, [1, 4, 20, 26, 27, 30, 60])).toEqual([0, 0, 0, 0, 15, 15, 30]);
  });

  it('不同 debuff 的批次取最大（onFire3 5 + potentAcid 60 → 60 档，210/t → 35 帧）', () => {
    const { f, e } = mk();
    e.onFire3T = 10; e.potentAcidT = 10;
    // 门槛 7200 / 210 = 34.3 → 第 35 帧整批 60；下一批要到 69 帧
    expect(dotTimeline(e, f.hooks, [34, 35, 60])).toEqual([0, 60, 60]);
  });

  it('398 毒素加速只乘 SupportAcceleration 池（oiled/eelWhip 裸 Add 不乘）', () => {
    const { f, e } = mk();
    e.potentAcidT = 10; e.oiledT = 10; e.onFireT = 10;
    // 加速：potentAcid 180→360,onFire 8→16（可加速池）；oiled 50 不变 → 426/t
    // batch = 60（potentAcid 的 ExpectedDamagePerSecond）→ 门槛 7200 → 第 17 帧
    e.acceleratePoisonsT = 10;
    expect(dotTimeline(e, f.hooks, [1, 16, 17])).toEqual([0, 0, 60]);
  });

  it('负控：无 debuff 账面恒 0，不产生任何扣血与飘字', () => {
    const { f, e } = mk();
    const nums: number[] = [];
    (f.hooks as unknown as { addDamageNumber: (x: number, y: number, n: number) => void })
      .addDamageNumber = (_x, _y, n) => { nums.push(n); };
    expect(dotTimeline(e, f.hooks, [1, 20, 60])).toEqual([0, 0, 0]);
    expect(nums).toEqual([]);
    expect(e.lifeRegenCount).toBe(0);
  });

  it('批次飘字=一次整批（不是逐点）：potentAcid 40 帧内只出 1 次「60」', () => {
    const { f, e } = mk();
    const nums: number[] = [];
    (f.hooks as unknown as { addDamageNumber: (x: number, y: number, n: number) => void })
      .addDamageNumber = (_x, _y, n) => { nums.push(n); };
    e.potentAcidT = 10;
    dotTimeline(e, f.hooks, [60]);
    expect(nums).toEqual([60]);                    // 旧实现 60 次「1」
  });
});

// ══════════════════════════════════════════════════════════════════════════
// N07 — 红帽骷髅王族承伤 ×0.7（1457 NPC.cs:67435-67446 / :82068-82071）
// ══════════════════════════════════════════════════════════════════════════
describe('N07 RedHat 承伤 ×0.7（防后/crit 后/trunc 保底 1）', () => {
  const hit = (id: number, defense: number, mark: (e: Enemy) => void, crit: boolean): number => {
    const f = makeFixture();
    const e = spawn(f, id, 20 * TILE, (FLOOR - 3) * TILE);
    e.maxHp = e.hp = 100000;
    e.def.defense = defense;
    e.iframes = 0;
    mark(e);
    e.hurt(100, 0, 0, f.hooks, 0, crit, 1);        // pierce=1：无视免疫窗
    return 100000 - e.hp;
  };

  it('35 骷髅王头（def 10）：未标记 95/190；ai[3]=1 标记 66/133', () => {
    expect(hit(35, 10, () => {}, false)).toBe(95);
    expect(hit(35, 10, () => {}, true)).toBe(190);
    expect(hit(35, 10, (e) => { e.ai3 = 1; }, false)).toBe(66);
    expect(hit(35, 10, (e) => { e.ai3 = 1; }, true)).toBe(133);
  });

  it('36 骷髅王手（def 14）：未标记 93/186；localAI[3]=1 标记 65/130', () => {
    expect(hit(36, 14, () => {}, false)).toBe(93);
    expect(hit(36, 14, () => {}, true)).toBe(186);
    expect(hit(36, 14, (e) => { e.lai3 = 1; }, false)).toBe(65);
    expect(hit(36, 14, (e) => { e.lai3 = 1; }, true)).toBe(130);
  });

  it('32 黑暗法师（def 4）：未标记 98/196；localAI[3]=1 标记 68/137', () => {
    expect(hit(32, 4, () => {}, false)).toBe(98);
    expect(hit(32, 4, () => {}, true)).toBe(196);
    expect(hit(32, 4, (e) => { e.lai3 = 1; }, false)).toBe(68);
    expect(hit(32, 4, (e) => { e.lai3 = 1; }, true)).toBe(137);
  });

  it('33 混沌球（def 0）：未标记 100/200；ai[3]=1 标记 70/140', () => {
    expect(hit(33, 0, () => {}, false)).toBe(100);
    expect(hit(33, 0, () => {}, true)).toBe(200);
    expect(hit(33, 0, (e) => { e.ai3 = 1; }, false)).toBe(70);
    expect(hit(33, 0, (e) => { e.ai3 = 1; }, true)).toBe(140);
  });

  it('负控：标记写到错误字段/错类型不生效（36 写 ai3、35 写 lai3、别的怪写两者）', () => {
    expect(hit(36, 14, (e) => { e.ai3 = 1; }, false)).toBe(93);
    expect(hit(35, 10, (e) => { e.lai3 = 1; }, false)).toBe(95);
    expect(hit(3, 0, (e) => { e.ai3 = 1; e.lai3 = 1; }, false)).toBe(100);
  });

  it('序：防御 → 暴击 → RedHat → takenDamageMultiplier（419 旋刃 ×3 在 0.7 之后）', () => {
    const f = makeFixture();
    const e = spawn(f, 35, 20 * TILE, (FLOOR - 3) * TILE);
    e.maxHp = e.hp = 100000;
    e.def.defense = 10; e.iframes = 0;
    e.ai3 = 1; e.takenDamageMultiplier = 3;
    e.hurt(100, 0, 0, f.hooks, 0, false, 1);
    // 95 → ×0.7f = 66 → ×3 = 198（若序反：95×3=285 → ×0.7=199.499 截 199）
    expect(100000 - e.hp).toBe(198);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// N08 — 雕像宝箱怪上升段缺通用重力（1457 :44086-44094 + :91580-91587）
// ══════════════════════════════════════════════════════════════════════════
describe('N08 雕像宝箱怪跃起后吃通用重力', () => {
  function mkMimic(f: Fixture) {
    const e = spawn(f, 690, 30 * TILE, (FLOOR - 3) * TILE);
    e.y = (FLOOR - 3) * TILE;  // fromVanilla 会按中心锚调 y：显式指定
    e.x = 30 * TILE;
    e.ai0 = 1;                 // 显身态
    e.immortal = false;
    e.dontTakeDamage = false;
    e.aiInit = true;
    e.ai2 = 1;                 // 地面节奏：本拍 --ai2 → 0 → jump
    e.vy = 0;
    e.vx = 0;
    e.noTileCollide = false;
    f.player.x = 20 * TILE;    // 左下方远处（不触发 flag3 俯冲）
    f.player.y = (FLOOR - 3) * TILE;
    f.player.dead = false;
    return e;
  }

  it('正例：首拍 vy = -9.01 + 0.3 = -8.71（旧实现恒 -9.01 匀速上升）', () => {
    const f = makeFixture();
    const e = mkMimic(f);
    (e as unknown as { statueMimicAI: (g: GameHooks, p: Player | null) => void })
      .statueMimicAI(f.hooks, f.player);
    expect(e.vy).toBeCloseTo(-8.71, 6);
    expect(e.noTileCollide).toBe(true);            // 跃起支置穿墙（:44084）
    const y1 = e.y;
    expect(y1).toBeLessThan((FLOOR - 3) * TILE);   // 已位移
  });

  it('正例：空中过程逐拍 +0.3 减速，~30 拍过顶点（不再是 60 帧匀速上升 540px）', () => {
    const f = makeFixture();
    const e = mkMimic(f);
    (e as unknown as { statueMimicAI: (g: GameHooks, p: Player | null) => void })
      .statueMimicAI(f.hooks, f.player);
    const v: number[] = [e.vy];
    // 直接驱动 AI（世界无地板交互需求：只验竖直速度演化）
    for (let i = 0; i < 40; i++) {
      (e as unknown as { statueMimicAI: (g: GameHooks, p: Player | null) => void })
        .statueMimicAI(f.hooks, f.player);
      v.push(e.vy);
    }
    // 单调递增 0.3/拍（上升段只吃通用重力）
    for (let i = 1; i <= 10; i++) expect(v[i] - v[i - 1]).toBeCloseTo(0.3, 6);
    expect(v.some((y) => y > 0)).toBe(true);       // 已过顶点进入下落（瞬时速度转正）
  });

  it('负控：一次跃起后 60 拍位移不再是原实现的 -9.01×60（会因减速显著缩短）', () => {
    const f = makeFixture();
    const e = mkMimic(f);
    const y0 = e.y;
    for (let i = 0; i < 60; i++) {
      (e as unknown as { statueMimicAI: (g: GameHooks, p: Player | null) => void })
        .statueMimicAI(f.hooks, f.player);
    }
    expect(Math.abs(e.y - y0)).toBeLessThan(540.6 * 0.75);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// N09 — 雕像宝箱怪下落碰撞布尔反（1457 :44137-44140）
// ══════════════════════════════════════════════════════════════════════════
describe('N09 下落碰撞选择（!SolidCollision 才清 noTileCollide）', () => {
  it('正例：脚底恰在地板顶 vy=2 → 正常碰撞落地（旧实现穿入地板 2.3px）', () => {
    const f = makeFixture();
    const e = spawn(f, 690, 30 * TILE, FLOOR * TILE - 38);
    e.y = FLOOR * TILE - e.h;                       // fromVanilla 会改锚点：显式脚底贴地板顶
    e.x = 30 * TILE;
    e.ai0 = 1; e.immortal = false; e.dontTakeDamage = false; e.aiInit = true;
    e.vy = 2; e.vx = 0; e.noTileCollide = false;
    f.player.x = 10 * TILE; f.player.y = (FLOOR - 3) * TILE;   // 远处：无水平重叠
    (e as unknown as { statueMimicAI: (g: GameHooks, p: Player | null) => void })
      .statueMimicAI(f.hooks, f.player);
    expect(e.y + e.h).toBeLessThanOrEqual(FLOOR * TILE + 1e-6);
    expect(e.vy).toBe(0);
    expect(e.onGround).toBe(true);
    expect(e.noTileCollide).toBe(false);
  });

  it('正例：身体陷实心 → 维持上一拍穿墙位（原版 else-if 链不赋值，防卡墙）', () => {
    const f = makeFixture();
    const e = spawn(f, 690, 30 * TILE, FLOOR * TILE - 10);     // 下半身嵌在地板里
    e.y = FLOOR * TILE - 10; e.x = 30 * TILE;
    e.ai0 = 1; e.immortal = false; e.dontTakeDamage = false; e.aiInit = true;
    e.vy = 2; e.vx = 0; e.noTileCollide = true;                // 上一拍已在穿墙态
    f.player.x = 10 * TILE; f.player.y = (FLOOR - 3) * TILE;
    const y0 = e.y;
    (e as unknown as { statueMimicAI: (g: GameHooks, p: Player | null) => void })
      .statueMimicAI(f.hooks, f.player);
    expect(e.noTileCollide).toBe(true);
    expect(e.y).toBeGreaterThan(y0);                            // 穿墙直积分照走
  });

  it('负控：上升支仍穿墙（vy<0 无条件 noTileCollide=true）', () => {
    const f = makeFixture();
    const e = spawn(f, 690, 30 * TILE, (FLOOR - 5) * TILE);
    e.y = (FLOOR - 5) * TILE; e.x = 30 * TILE;
    e.ai0 = 1; e.immortal = false; e.dontTakeDamage = false; e.aiInit = true;
    e.vy = -1; e.vx = 0; e.noTileCollide = false;
    f.player.x = 10 * TILE; f.player.y = (FLOOR - 3) * TILE;
    (e as unknown as { statueMimicAI: (g: GameHooks, p: Player | null) => void })
      .statueMimicAI(f.hooks, f.player);
    expect(e.noTileCollide).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// N10 — FTW + 肉山：火焰小鬼双速计时（1457 NPC.cs:21127-21134）
// ══════════════════════════════════════════════════════════════════════════
describe('N10 FTW + 肉山在场：火焰小鬼 24 计时双速', () => {
  function mk(f: Fixture, getGood: boolean, wof: boolean) {
    f.w.seedFlags.getGoodWorld = getGood;
    const e = spawn(f, 24, 40 * TILE, 40 * TILE);
    e.aiInit = true;                 // 跳过 AI_008 头段 ai0=500 重置
    e.ai0 = 60; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0; e.lai3 = 0;
    if (wof) {
      const w = spawn(f, 113, 60 * TILE, 40 * TILE);
      w.dead = false;
    }
    return e;
  }
  const step = (f: Fixture, e: Enemy, n: number) => {
    for (let i = 0; i < n; i++) e.fixedUpdate(1 / 60, f.hooks);
  };

  it('正例：FTW + 在场肉山 113 → 10 帧后 ai0 80（净 +2/t）', () => {
    const f = makeFixture();
    const e = mk(f, true, true);
    step(f, e, 10);
    expect(e.ai0).toBe(80);
  });

  it('负控①：普通世界无肉山 → 70', () => {
    const f = makeFixture();
    const e = mk(f, false, true);
    step(f, e, 10);
    expect(e.ai0).toBe(70);
  });

  it('负控②：FTW 但无肉山 → 70', () => {
    const f = makeFixture();
    const e = mk(f, true, false);
    step(f, e, 10);
    expect(e.ai0).toBe(70);
  });

  it('负控③：非 FTW 无肉山 → 70', () => {
    const f = makeFixture();
    const e = mk(f, false, false);
    step(f, e, 10);
    expect(e.ai0).toBe(70);
  });

  it('双档同真不叠加：两块的「+1 后奇数回退」都归偶,第二块作用在偶值 = no-op（仍 80）', () => {
    const f = makeFixture();
    const e = mk(f, true, true);
    e.lai3 = 1;
    step(f, e, 10);
    expect(e.ai0).toBe(80);
  });

  it('负控④：死的肉山不计入 AnyNPCs(113)', () => {
    const f = makeFixture();
    const e = mk(f, true, true);
    f.enemies.find((n) => n.vanillaId === 113)!.dead = true;
    step(f, e, 10);
    expect(e.ai0).toBe(70);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// N14 — 声音道具史莱姆 ×3 血量（1457 NPC.cs:61630-61637）
// ══════════════════════════════════════════════════════════════════════════
describe('N14 声音道具史莱姆 lifeMax×3（一次性门）', () => {
  const VOICE = [5507, 5502, 5485, 5484, 5506, 5503, 5534, 5499, 5500, 5505, 5501, 5504, 5508, 5509, 215];

  function mkSlime(f: Fixture, hp: number, maxHp: number) {
    const e = spawn(f, 1, 20 * TILE, (FLOOR - 3) * TILE);
    e.aiInit = true;
    e.maxHp = maxHp; e.hp = hp;
    return e;
  }

  it('正例：携声音道具 + 满血 → hp/maxHp 双双 ×3（全集 15 项）', () => {
    for (const item of VOICE) {
      const f = makeFixture();
      const e = mkSlime(f, 0, 0);
      const base = e.def.hp;
      e.hp = base; e.maxHp = base;
      e.ai1 = item;
      e.fixedUpdate(1 / 60, f.hooks);
      expect(e.maxHp, `item ${item}`).toBe(base * 3);
      expect(e.hp, `item ${item}`).toBe(base * 3);
    }
  });

  it('正例：受伤态只扩 lifeMax，当前血量保留', () => {
    const f = makeFixture();
    const e = mkSlime(f, 0, 0);
    const base = e.def.hp;
    e.maxHp = base; e.hp = Math.trunc(base / 3);
    e.ai1 = 5499;
    e.fixedUpdate(1 / 60, f.hooks);
    expect(e.maxHp).toBe(base * 3);
    expect(e.hp).toBe(Math.trunc(base / 3));
  });

  it('一次性门：后续每帧不再重复 ×3（lifeMax != defLifeMax 后不再进）', () => {
    const f = makeFixture();
    const e = mkSlime(f, 0, 0);
    const base = e.def.hp;
    e.maxHp = base; e.hp = base;
    e.ai1 = 5499;
    for (let i = 0; i < 10; i++) e.fixedUpdate(1 / 60, f.hooks);
    expect(e.maxHp).toBe(base * 3);
  });

  it('负控：非声音道具（木 9 / 传送带 3609）不触发 ×3', () => {
    for (const item of [9, 3609]) {
      const f = makeFixture();
      const e = mkSlime(f, 0, 0);
      const base = e.def.hp;
      e.maxHp = base; e.hp = base;
      e.ai1 = item;
      e.fixedUpdate(1 / 60, f.hooks);
      expect(e.maxHp, `item ${item}`).toBe(base);
    }
  });

  it('自然携物链可达：lowTiles 地下蓝史莱姆自然掷出 5499 并即刻 ×3', () => {
    const f = makeFixture({ groundLevel: 20, rockLevel: 60 });
    f.w.skyblockLowTiles = true;
    const e = mkSlime(f, 0, 0);
    const base = e.def.hp;
    e.maxHp = base; e.hp = base;
    e.ai1 = 0;                                     // 未掷
    e.y = 30 * TILE;                               // surface(20) < y(30) ≤ rockLevel(60)
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);   // 1000 门与 14 选池均命中
    try {
      e.fixedUpdate(1 / 60, f.hooks);
    } finally {
      rnd.mockRestore();
    }
    expect(e.ai1).toBe(5499);
    expect(e.maxHp).toBe(base * 3);
    expect(e.hp).toBe(base * 3);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// N18 — Remix 恶魔眼日间驱散（1457 NPC.cs:53301-53312 + Main.cs:63782-63789）
// ══════════════════════════════════════════════════════════════════════════
describe('N18 Remix 不进入日间驱散（Main.IsItDay 语义）', () => {
  function mkEye(f: Fixture) {
    f.w.groundLevel = 30;                            // 地表线（tile）
    const e = spawn(f, 2, 40 * TILE, 20 * TILE);     // 地表线以上（y=320 ≤ 30*16）
    f.player.x = 40 * TILE; f.player.y = 40 * TILE;  // 玩家在下方
    f.player.dead = false;
    e.aiInit = true;
    e.despawnTimer = 750;
    e.despawnEncouraged = false;
    e.dirY = 1;
    return e;
  }
  // 直调 AI（绕过 fixedUpdate 共享尾的屏内 despawnTimer 重置——原版 Encouraged 位
  // 在屏内同样被 CheckActive 清，故只在 AI 出口处可观测）
  const runAI = (f: Fixture, e: Enemy) => {
    (e as unknown as { floatEyeAI: (g: GameHooks, p: Player | null) => void })
      .floatEyeAI(f.hooks, f.player);
  };

  it('普通白天：驱散（dirY=-1 + EncourageDespawn(10)）', () => {
    const f = makeFixture();
    f.w.seedFlags.remix = false;
    f.w.clock.timeOfDay = 0.5;                       // 正午
    const e = mkEye(f);
    runAI(f, e);
    expect(e.dirY).toBe(-1);
    expect(e.despawnEncouraged).toBe(true);
    expect(e.despawnTimer).toBeLessThanOrEqual(10);   // EncourageDespawn(10) = min 封顶
  });

  it('普通夜间：正常追击（dirY=+1，不驱散）', () => {
    const f = makeFixture();
    f.w.seedFlags.remix = false;
    f.w.clock.timeOfDay = 0.95;                      // 深夜
    const e = mkEye(f);
    runAI(f, e);
    expect(e.dirY).toBe(1);
    expect(e.despawnEncouraged).toBe(false);
  });

  it('正例：Remix + 原始钟白天 → isItDay 恒 false，继续向下追击（旧实现错误上飞）', () => {
    const f = makeFixture();
    f.w.seedFlags.remix = true;
    f.w.clock.timeOfDay = 0.5;
    expect(f.w.clock.isDay).toBe(true);              // 原始钟确实是白天
    expect(f.w.isItDay).toBe(false);                 // 语义口径（Main.IsItDay remix 恒 false）
    const e = mkEye(f);
    runAI(f, e);
    expect(e.dirY).toBe(1);
    expect(e.despawnEncouraged).toBe(false);
  });

  it('Remix + 原始钟夜间：同样是正常追击', () => {
    const f = makeFixture();
    f.w.seedFlags.remix = true;
    f.w.clock.timeOfDay = 0.95;
    const e = mkEye(f);
    runAI(f, e);
    expect(e.dirY).toBe(1);
    expect(e.despawnEncouraged).toBe(false);
  });

  it('墓地豁免（目标玩家）：本地快照 zoneGraveyard 时普通白天不驱散', () => {
    const f = makeFixture();
    f.w.seedFlags.remix = false;
    f.w.clock.timeOfDay = 0.5;
    (f.w as unknown as { scene: { zoneGraveyard: boolean } }).scene = { zoneGraveyard: true };
    const e = mkEye(f);
    runAI(f, e);
    expect(e.despawnEncouraged).toBe(false);
    expect(e.dirY).toBe(1);
  });

  it('负控：墓地豁免看【目标玩家】自带 scene（有则优先于本地快照）', () => {
    const f = makeFixture();
    f.w.seedFlags.remix = false;
    f.w.clock.timeOfDay = 0.5;
    (f.w as unknown as { scene: { zoneGraveyard: boolean } }).scene = { zoneGraveyard: false };
    (f.player as unknown as { scene?: { zoneGraveyard: boolean } }).scene = { zoneGraveyard: true };
    const e = mkEye(f);
    runAI(f, e);
    expect(e.dirY).toBe(1);
    expect(e.despawnEncouraged).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// N19 — 蚁狮传送带锥外发射（1457 NPC.cs:24592-24607）
// ══════════════════════════════════════════════════════════════════════════
describe('N19 蚁狮站 421/422 传送带上的锥外发射', () => {
  const ROW = FLOOR - 1;          // 蚁狮站的行（脚底 = FLOOR*16）
  function mkAntlion(f: Fixture, conveyor: number | null, playerAbove: boolean) {
    const e = spawn(f, 69, 30 * TILE, ROW * TILE - 24);
    e.aiInit = true;
    e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.ai3 = 0;
    e.visAngle = 0;
    e.vx = 0; e.vy = 0;
    if (conveyor !== null) {
      // 原版探针 = (int)((Bottom.Y+8)/16)：按实体实际 y 落地行铺带
      const probeRow = Math.floor((e.y + e.h + 8) / TILE);
      f.w.store.setTile(Math.floor(e.cx / TILE), probeRow, conveyor);
    }
    // 玩家：上方 = 同列高一格（锥内）；下方 = 同列低三格
    f.player.x = 30 * TILE;
    f.player.y = playerAbove ? (ROW - 4) * TILE : (ROW + 3) * TILE;
    f.player.dead = false;
    e.def.damage = 10;
    const fired: Array<{ vx: number; vy: number; proj: number; dmg: number }> = [];
    (e as unknown as {
      shootDart: (g: GameHooks, ox: number, oy: number, tx: number, ty: number,
        spd: number, dmg: number, proj: number) => void;
    }).shootDart = (_g, _ox, _oy, tx, ty, spd, dmg, proj) => {
      const d = Math.hypot(tx, ty) || 1;
      fired.push({ vx: (tx / d) * spd, vy: (ty / d) * spd, proj, dmg });
    };
    return { e, fired };
  }

  it('负控①：泥土 / 玩家在下 → 0 发、冷却保持 0', () => {
    const f = makeFixture();
    const { e, fired } = mkAntlion(f, null, false);
    e.fixedUpdate(1 / 60, f.hooks);
    expect(fired.length).toBe(0);
    expect(e.ai0).toBe(0);
  });

  it('正例②：泥土 / 玩家在上 → 1 发（锥内正常支）', () => {
    const f = makeFixture();
    const { e, fired } = mkAntlion(f, null, true);
    e.fixedUpdate(1 / 60, f.hooks);
    expect(fired.length).toBe(1);
    expect(fired[0].proj).toBe(31);
    expect(e.ai0).toBe(199);       // 装填 200 后同拍倒数（本仓既有相位）
  });

  it('正例③：421 传送带 / 玩家在上 → 1 发（锥内支，与地面一致）', () => {
    const f = makeFixture();
    const { e, fired } = mkAntlion(f, CONVEYOR_421, true);
    e.fixedUpdate(1 / 60, f.hooks);
    expect(fired.length).toBe(1);
    expect(fired[0].proj).toBe(31);
  });

  it('正例④：421 传送带 / 玩家在下 → 锥外支照发（旧实现 0 发且冷却 0）', () => {
    const f = makeFixture();
    const { e, fired } = mkAntlion(f, CONVEYOR_421, false);
    e.fixedUpdate(1 / 60, f.hooks);
    expect(fired.length).toBe(1);
    expect(fired[0].proj).toBe(31);
    expect(fired[0].dmg).toBe(10);
    expect(e.ai0).toBe(199);                        // 装填 200 生效
    // 方向 = rotation-1.57：visAngle=0 → (cos(-1.57), sin(-1.57)) ≈ (-0.0008, -1) 向上
    expect(fired[0].vy).toBeCloseTo(-12, 3);
    expect(Math.abs(fired[0].vx)).toBeLessThan(0.02);
  });

  it('正例⑤：422 反向传送带同享该支', () => {
    const f = makeFixture();
    const { e, fired } = mkAntlion(f, CONVEYOR_422, false);
    e.fixedUpdate(1 / 60, f.hooks);
    expect(fired.length).toBe(1);
    expect(e.ai0).toBe(199);
  });

  it('负控⑥：锥外发射受 ai[0]>0 冷却门约束（装填中不连发）', () => {
    const f = makeFixture();
    const { e, fired } = mkAntlion(f, CONVEYOR_421, false);
    e.ai0 = 100;
    e.fixedUpdate(1 / 60, f.hooks);
    expect(fired.length).toBe(0);
    expect(e.ai0).toBe(99);
  });

  it('负控⑥b：锥门为真但超射程（AI_GlobalFiringDistanceCheck 假）→ 整拍不射，不落传送带支', () => {
    // 原版 else-if 分层：flag28 真即不进 else（传送带）支——即便射程/视线门失败
    const f = makeFixture();
    const { e, fired } = mkAntlion(f, CONVEYOR_421, true);
    f.player.y = (ROW - 120) * TILE;               // 玩家正上方但远超 ±549px 视域门
    e.fixedUpdate(1 / 60, f.hooks);
    expect(fired.length).toBe(0);
    expect(e.ai0).toBe(0);
  });

  it('负控⑦：脚下 8px 探针取的是 Bottom.Y+8（非 Center/非脚底行本身）', () => {
    const f = makeFixture();
    const { e, fired } = mkAntlion(f, null, false);
    // 传送带放在 Center 所在行（远离 Bottom+8）→ 不触发
    f.w.store.setTile(Math.floor(e.cx / TILE), Math.floor(e.cy / TILE) - 3, CONVEYOR_421);
    e.fixedUpdate(1 / 60, f.hooks);
    expect(fired.length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 变异自证（每条关键修复 1+ 发，恰红 + 逐字节还原；仅打本刀独占文件）
// 过滤串纪律：目标测试名独有片段 + 零正则元字符（vitest -t 是正则）
// ══════════════════════════════════════════════════════════════════════════
describe.skipIf(process.env.SW_ISSUE46_MUT)('issue#46 刀B 变异自证', () => {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const ENEMY = join(process.cwd(), 'src', 'entities', 'Enemy.ts');
  const LIQ = join(process.cwd(), 'src', 'entities', 'npcLiquid.ts');
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/issue46-ai-combat.test.ts', '--no-file-parallelism', '-t', filter],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 300_000, env: { ...process.env, SW_ISSUE46_MUT: '1' } },
  );
  const mutate = (file: string, trigger: string, repl: string, filter: string, label: string): void => {
    withMutation(file, trigger, repl, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${label} ← ${repl}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, { label: `issue46-B ${label}` });
  };

  it('M1 N04 穿墙族仍走完整液体（call 点回落第4参 false）→ 猪鲨岩浆直伤回归', () => {
    mutate(ENEMY,
      'updateNpcLiquid(this, game, game.world.store, this.phasing);',
      'updateNpcLiquid(this, game, game.world.store, false);   // M1',
      'N04 穿墙 NPC 液体分流', 'M1');
  });

  it('M1b N04 液体穿墙支条件反转（if noTileCollide → if !noTileCollide）→ 双面红', () => {
    mutate(LIQ,
      'if (noTileCollide) {',
      'if (!noTileCollide) {   // M1b',
      'N04 穿墙 NPC 液体分流', 'M1b');
  });

  it('M2 N05 无敌门回落 immortal-only → dontTakeDamage 期照扣', () => {
    mutate(ENEMY,
      'if (!this.dontTakeDamage) {',
      'if (!this.immortal) {   // M2',
      'N05 无敌旗拦截 DoT', 'M2');
  });

  it('M3 N06 批次回落逐点（applyDoT(dotBatch) → applyDoT(1)）→ 帧时点/整批飘字红', () => {
    mutate(ENEMY,
      'this.applyDoT(dotBatch, game);',
      'this.applyDoT(1, game);   // M3',
      'N06 DoT 统一批次', 'M3');
  });

  it('M4 N07 RedHat 乘数回落 1.0 → 四型标记组红', () => {
    mutate(ENEMY,
      'Math.fround(0.7)',
      'Math.fround(1)',
      'N07 RedHat 承伤', 'M4');
  });

  it('M5 N08 跃起支摘通用重力 → 首拍 -9.01 匀速上升红', () => {
    mutate(ENEMY,
      '      this.applyGravity(game);\n      this.x += this.vx;\n      this.y += this.vy;\n      return;\n    }',
      '      this.x += this.vx;\n      this.y += this.vy;\n      return;\n    }   // M5',
      'N08 雕像宝箱怪跃起后吃通用重力', 'M5');
  });

  it('M6 N09 下落碰撞布尔回退（phase = !inSolid）→ 穿地板红', () => {
    mutate(ENEMY,
      'phase = inSolid ? this.noTileCollide : false;',
      'phase = !inSolid;   // M6',
      'N09 下落碰撞选择', 'M6');
  });

  it('M7 N10 FTW 肉山档摘除（vid 24 → 23）→ 80 期望红', () => {
    mutate(ENEMY,
      'if (vid === 24 && game.world.seedFlags?.getGoodWorld) {',
      'if (vid === 23 && game.world.seedFlags?.getGoodWorld) {   // M7',
      'N10 FTW', 'M7');
  });

  it('M8 N14 声音道具 ×3 回落 ×2 → 满血/受伤两例红', () => {
    mutate(ENEMY,
      '        if (this.hp === this.maxHp) this.hp = base.hp * 3;\n        this.maxHp = base.hp * 3;',
      '        if (this.hp === this.maxHp) this.hp = base.hp * 2;\n        this.maxHp = base.hp * 2;   // M8',
      'N14 声音道具史莱姆', 'M8');
  });

  it('M9 N18 日间门回落原始钟（isItDay → clock.isDay）→ Remix 白天红', () => {
    mutate(ENEMY,
      'const day = game.world.isItDay && !graveyard;',
      'const day = game.world.clock.isDay && !graveyard;   // M9',
      'N18 Remix 不进入日间驱散', 'M9');
  });

  it('M10 N19 探针行回落中心行（Bottom+8 → cy）→ 传送带锥外支红', () => {
    mutate(ENEMY,
      'const convY = Math.floor((this.y + this.h + 8) / TILE);',
      'const convY = Math.floor(this.cy / TILE);   // M10',
      'N19 蚁狮站', 'M10');
  });
});
