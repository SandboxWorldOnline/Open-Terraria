// ★G41-A（2026-11-02）遗留债 A 组清偿刀判别锁。
//  销案复核段（G36-G40/R25-R30 已修原台账未标）经各既有锁复跑承载（g36a 三件套/
//  bj738a/bj739a×3/bj740a×2/bj741a/bj745a/bj746a/g39a/g40a×2——见台账回归矩阵）,
//  本文件锁【本刀真修面】：
//   F1 克盾冲刺 TimerCrit（g39a D-G39-②,Player.cs:21262-21264）+ 日曜冲撞 R25-2
//      懒惰链勘正（:21328-21332——已掷中 crit 也照消费,G37 判例）
//   F5 蜜蜂套成就双通道定谳（g39a D-G39-① 翻案:ArmorSetBonuses.cs:19-30 真
//      锚=蜜蜂套+蜂枪挥动;入夜 eclipse→NotifyProgressionEvent(3) 只点 KILL_THE_SUN
//      prog(3),Main.cs:66221-24——两通道数字撞号非同一张表;eclipse 夜面早接线
//      world/Eclipse.ts）+ 套装读 effective 归位（QueryContext :20-24 同族）
//   F3 bj749a D-3 scene 侧城镇计数排 bound/453 + D-2 生成域玩家锚顶/心分立
//      （getSpawnRate 深度带=position.Y/:802 deep 门=Center.Y/slimeRain 深度门=
//      position.Y+窗口=Center/入侵=position 双坐标/spawnArea=position.ToTileCoordinates
//      /SetSpawnFlags pX/pY 与屏外检查=Center——六面分锚,原版亲读全锚）
//   F4 bj751a D1+D2 flag5 谓词族（头行=SolidTileNoPlatforms 窄集/脚行=raw
//      tileSolid 含平台九件套含半砖顶坡/跳梯 1-3 级=SolidTileNoPlatforms）
//  变异恰红 M1-M5（withMutation 子进程隔离,G41A_MUT_SKIP 守卫）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Enemy } from '../src/entities/Enemy';
import { Achievements } from '../src/core/Achievements';
import { VanillaSpawner } from '../src/world/spawn/VanillaSpawner';
import { endEclipseAtDusk } from '../src/world/Eclipse';
import { solidTileNoPlatforms } from '../src/world/BoulderMech';
import { TILE_BY_KEY } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';
import type { RNG } from '../src/core/rng';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');

// ---- 通用夹具（bj538 F11 同源:真 World+真 Player+spy 敌桶） ----
const W = 200, H = 120;
interface SpyEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; vanillaId: number;
  calls: Array<{ d: number; crit: boolean }>;
  hurt(d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean): boolean;
}
function mkEnemy(id: number, cx: number, cy: number, w = 38, h = 38): SpyEnemy {
  const e: SpyEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, iframes: 0, vanillaId: 0, calls: [],
    hurt(d, _kx, _ky, _g, _pen = 0, crit = false) {
      e.calls.push({ d, crit });
      return true;
    },
  };
  return e;
}
function makeHooks(enemies: SpyEnemy[] = []): { hooks: GameHooks; player: Player } {
  const world = new World(W, H, 7, 'g41a-dash');
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) world.store.setTile(x, y, 1);
  world.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const hooks: GameHooks = {
    world: world as never,
    player: player as never,
    enemies: () => enemies,
    npcs: () => [],
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    cutTilesBox: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    entities: { add: () => undefined, projectiles: [] } as never,
  } as unknown as GameHooks;
  return { hooks, player };
}
afterEach(() => { vi.restoreAllMocks(); });

/** 克盾冲撞直驱（bj538 driveEoC 同式） */
const driveEoC = (player: Player, hooks: GameHooks): void => {
  (player as unknown as { dashMovement: (g: GameHooks, eq: unknown, ix: number, spd: number, db: boolean, slow: number) => void })
    .dashMovement(hooks, { dash: 2, runSlowMul: 1, moveMult: 1, kbGlove: false }, 0, 1, false, 1);
};
/** 日曜冲撞直驱（bj538 11c 同式） */
const driveSolar = (player: Player, hooks: GameHooks): void => {
  (player as unknown as { dashMovement: (g: GameHooks, eq: unknown, ix: number, spd: number, db: boolean, slow: number) => void })
    .dashMovement(hooks, { dash: 0, runSlowMul: 1, moveMult: 1 }, 0, 1, false, 1);
};
/** 6170 蓄能暴击装备面注入（equipStats getter 覆写,bj746a 同式） */
function armTimerCrit(player: Player, charge: number): void {
  Object.defineProperty(player, 'equipStats', {
    value: Object.freeze({ ...player.equipStats, accTimerCrit: true }),
    configurable: true,
  });
  player.accTimerCritCharge = charge;
}
/** 计数假 RNG（恒返下界;记录 int 调用界） */
function countingRng(sink?: Array<[number, number]>): RNG {
  return {
    int(a: number, b: number) { sink?.push([a, b]); return a; },
    next: () => 0, nextInt: () => 0, chance: () => true,
    range: (a: number) => a, pick: <T,>(xs: T[]) => xs[0],
  } as unknown as RNG;
}

// ===========================================================================
// F1 克盾冲刺 TimerCrit（g39a D-G39-②,Player.cs:21262-21264）
// ===========================================================================
describe('F1 克盾冲刺 TimerCrit（:21264 类掷后紧跟消费）', () => {
  it('1a 满蓄 6170：类掷不中（rnd 0.99）→ TimerCrit 强暴 + charge 置 −15', () => {
    const e = mkEnemy(1, 975, 1450, 20, 20);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 类掷恒不中（尘 20×NextFloat 同源 0.99）
    armTimerCrit(player, 1000);
    player.eocDash = 15; player.dashLatched = 2; player.vx = 14.5;
    driveEoC(player, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);              // TimerCrit 强暴（旧缺=必 false）
    expect(player.accTimerCritCharge).toBe(-15);      // :21264 消费置 −15（15t 连暴窗）
  });
  it('1b 懒惰链判别（G37 双病判例）：类掷已中（rnd 0.0）→ 消费照达 charge=−15（短路形=留 1000 必红）', () => {
    const e = mkEnemy(2, 975, 1450, 20, 20);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.0);    // 类掷 0<4 已中
    armTimerCrit(player, 1000);
    player.eocDash = 15; player.dashLatched = 2; player.vx = 14.5;
    driveEoC(player, hooks);
    expect(e.calls[0]!.crit).toBe(true);
    expect(player.accTimerCritCharge).toBe(-15);      // ★已掷中也照消费（R25-2 旧 || 短路形必红）
  });
  it('1c 负控：无 6170 → charge 不动 + crit=false', () => {
    const e = mkEnemy(3, 975, 1450, 20, 20);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    player.accTimerCritCharge = 1000;                 // 有量无门（equipStats 无 accTimerCrit）
    player.eocDash = 15; player.dashLatched = 2; player.vx = 14.5;
    driveEoC(player, hooks);
    expect(e.calls[0]!.crit).toBe(false);
    expect(player.accTimerCritCharge).toBe(1000);     // 未消费
  });
  it('1d 日曜冲撞懒惰链（R25-2 勘正）：类掷已中 → 直击消费照达（双编排 40 尘）', () => {
    const e = mkEnemy(4, 975, 1450, 20, 20);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    armTimerCrit(player, 1000);
    let dustN = 0;
    (hooks as unknown as { spawnDust: () => unknown }).spawnDust
      = () => { dustN++; return { vx: 0, vy: 0, scale: 1 }; };
    player.solarDashing = true; player.dashDelay = -1; player.dashLatched = 3;
    player.solarShields = 1; player.vx = 21.9;
    driveSolar(player, hooks);
    expect(e.calls.length).toBeGreaterThanOrEqual(1); // 直击 + 608 爆闪（A22 双吃）
    expect(e.calls[0]!.crit).toBe(true);              // 直击强暴
    expect(player.accTimerCritCharge).toBe(-15);
    // ★双消费判别（M2 靶）：直击(:21332)+608 AoE(:12928)各一次编排=2×20 尘;
    //   R25-2 短路形直击吞消费 → 恰 20 尘（charge 由 608 面置 −15 同值,唯尘数可判）
    expect(dustN).toBe(40);
  });
});

// ===========================================================================
// F5 蜜蜂套成就双通道（g39a D-G39-① 定谳翻案）
// ===========================================================================
describe('F5 蜜蜂套成就双通道（NOT_THE_BEES=蜜蜂套+蜂枪 / KILL_THE_SUN=eclipse 夜）', () => {
  it('5a HandleSpecialEvent(3)（special 通道）→ NOT_THE_BEES Use 旗完成', () => {
    const a = new Achievements(null);
    a.handleSpecialEvent(3, { statLifeMax: 100, statManaMax: 40 });
    expect(a.defOf('NOT_THE_BEES')).toBeTruthy();
    expect(a.isCompleted('NOT_THE_BEES')).toBe(true);   // ArmorSetBonuses.cs:19-30 唯一触发
  });
  it('5b NotifyProgressionEvent(3)（progression 通道）→ KILL_THE_SUN prog(3) 完成', () => {
    const a = new Achievements(null);
    a.notifyProgressionEvent(3);
    expect(a.isCompleted('KILL_THE_SUN')).toBe(true);   // Main.cs:66221-24 入夜 eclipse
    expect(a.isCompleted('NOT_THE_BEES')).toBe(false);  // ★两通道分表:数字撞号不串扰
  });
  it('5c endEclipseAtDusk → host.notifyProgressionEvent(3) 先于清旗（:64722-25）', () => {
    const w = new World(100, 100, 7, 'g41a-eclipse');
    w.clock.eclipse = true;
    const calls: number[] = [];
    const clearedAfter: boolean[] = [];
    const host = {
      broadcast: () => {},
      notifyProgressionEvent: (n: number) => { calls.push(n); clearedAfter.push(!w.clock.eclipse); },
    };
    expect(endEclipseAtDusk(w, host)).toBe(true);
    expect(calls).toEqual([3]);
    expect(clearedAfter).toEqual([false]);              // 旗在求值时仍 true（先通知后清）
    expect(w.clock.eclipse).toBe(false);
  });
  it('5d 结构锁：Game 蜜蜂套触发读 effective 三槽（裸 inv.armor[0-2] 必红）', () => {
    const s = SRC('core/Game.ts');
    const i = s.indexOf('critVid === 1121');
    expect(i).toBeGreaterThanOrEqual(0);
    const block = s.slice(i, i + 1400);
    expect(block).toContain('getEffectiveArmor(0)');
    expect(block).toContain('getEffectiveArmor(1)');
    expect(block).toContain('getEffectiveArmor(2)');
    expect(block).toContain('handleSpecialEvent(3');
    expect(block).not.toContain('this.player.inv.armor[0]');
  });
});

// ===========================================================================
// F3 bj749a D-3 scene 侧计数 + D-2 生成域顶/心分锚
// ===========================================================================
describe('F3 bj749a D-3/D-2 生成域锚定谳', () => {
  it('3a 结构锁：scene 侧 townNPCCount 排 bound/453（与刷怪侧同口径）', () => {
    const s = SRC('core/Game.ts');
    const i = s.indexOf('const townNPCCount = this.entities.npcs.filter');
    expect(i).toBeGreaterThanOrEqual(0);
    const block = s.slice(i, i + 700);
    expect(block).toContain('tn instanceof TownNPC && !tn.dead && !tn.bound');
    expect(block).toContain("tn.npcKey !== 'skeleton_merchant'");
  });
  it('3b 结构锁：getSpawnRate 调用 p.y 顶边 + centerYpx=p.cy（:802 Center 读）', () => {
    const s = SRC('core/Game.ts');
    // ★issue#46-N01：生产调用迁具名入口（位置参数尾部三布尔错位根治）——
    // 锁随刀走：锚仍是「playerYpx=p.y 顶边 / centerYpx=p.cy Center」，只是通道改具名。
    expect(s).toMatch(/getSpawnRateNamed\(\{[\s\S]{0,1200}?playerYpx: p\.y,/);
    expect(s).toMatch(/zoneShadowCandle: this\.scene\?\.zoneShadowCandle \?\? false,[\s\S]{0,200}?centerYpx: p\.cy,/);
    expect(s).not.toMatch(/getSpawnRate\(\s*p\.cy, /);
    expect(s).not.toMatch(/getSpawnRate\(\s*p\.y, /);   // 位置参数入口退役
  });
  it('3c 结构锁：spawn/spawnFaelings/slimeRain/入侵四调用面分锚', () => {
    const s = SRC('core/Game.ts');
    expect(s).toContain('this.vanillaSpawner.spawn(p.cx, p.cy, rng, viewHalfW, viewHalfH,\n      p.x, p.y)');
    expect(s).toContain('shouldSpawnInvasionEnemies(w, p.x, p.y, 1200,');
    expect(s).toMatch(/slimeRainSpawns\(player\.cx, player\.cy,[\s\S]{0,240}player\.y\)/);
    expect(s).toMatch(/spawnFaelings\(\s*player\.cx, player\.cy, viewHalfW, viewHalfH,[\s\S]{0,600}player\.x, player\.y,/);
  });
  it('3d 行为锁：getSpawnRate 深度带读顶边（顶在带上方/心在带下方 → 不入地狱 ×2 档）', () => {
    // H=400 → UnderworldLayer=200 → underworldY=3200。顶 3199（带上方）/心 3215（带下方）
    const w = new World(200, 400, 7, 'g41a-rate');
    w.groundLevel = 15; w.rockLevel = 30;              // 岩层带门=30*16+1200=1680（顶 3199 落岩层档）
    const sp = new VanillaSpawner(w);
    const args = (y: number, c: number) => [
      y, 0, false, 1200, 100 * 16, false, false, false, false, 0, true,
      false, false, false, false, false, c,
    ] as const;
    const rTop = sp.getSpawnRate(...args(3199, 3215));
    const rBoth = sp.getSpawnRate(...args(3215, 3215));
    expect(rTop.maxSpawns).toBe(9);                    // 岩层 ×1.9（floor(5*1.9)）——顶边读不入地狱
    expect(rBoth.maxSpawns).toBe(10);                  // 地狱 ×2——旧心锚读顶也 10（=M5 判别）
  });
  it('3e 行为锁：slimeRainSpawns 深度门读 topYpx（顶在门外/心在门内 → 照掷;旧单锚=零掷必红）', () => {
    const w = new World(300, 300, 7, 'g41a-slime');
    w.groundLevel = 200;                               // worldSurface*16=3200;门=3200+600=3800
    const sp = new VanillaSpawner(w);
    const draws1: Array<[number, number]> = [];
    // 顶 3789（≤3800 门过）/心 3810（>3800 旧单锚即 null 零掷）;px=100 → tx<10 早退（3 掷后返）
    sp.slimeRainSpawns(100, 3810, 0, 1920, 1200, countingRng(draws1), false, 3789);
    expect(draws1.length).toBe(3);                     // 门掷+tx+ty（旧单锚=0 掷）
    const draws2: Array<[number, number]> = [];
    sp.slimeRainSpawns(100, 3810, 0, 1920, 1200, countingRng(draws2), false, 3810);
    expect(draws2.length).toBe(0);                     // 顶=心=3810 → 门拒
  });
  it('3f 行为锁：spawn() 区域锚=position 顶边左格（rng.int 界=areaX/16±rangeX 非 center）', () => {
    const w = new World(300, 300, 7, 'g41a-area');     // 空世界:50 尝试全落空 → 只看掷界
    const sp = new VanillaSpawner(w);
    const intCalls: Array<[number, number]> = [];
    // center=(160.6,100.3)格 / area=顶边左(159,98)（半身差 1-2 格）
    sp.spawn(160.6 * 16, 100.3 * 16, countingRng(intCalls), 60, 37.5, 159 * 16, 98 * 16);
    expect(intCalls.length).toBeGreaterThanOrEqual(2);
    expect(intCalls[0]![0]).toBe(75);                  // areaL=159−84（area 锚）;旧 center 锚=160−84=76
    expect(intCalls[1]![0]).toBe(46);                  // areaT=98−52
  });
});

// ===========================================================================
// F4 bj751a D1/D2 flag5 谓词族（NPC.cs:60443/:60444/:60692-60724）
//  僵尸 3：w=18/h=40——脚行=FLOOR、头行=FLOOR−4、前探列 42（bj751a ⑲⑳ 同源）
// ===========================================================================
const FW = 140, FH = 90, FLOOR = 60;
function flagWorld(): World {
  const w = new World(FW, FH, 11, 'g41a-flag5');
  const st = w.store;
  w.groundLevel = 24;
  for (let x = 0; x < FW; x++) {
    st.setTile(x, FLOOR, 1);
    st.setTile(x, FLOOR + 1, 1);
  }
  w.clock.timeOfDay = 0.9;
  return w;
}
function flagHooks(w: World) {
  const enemies: Enemy[] = [];
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: 'enemies' | 'projectiles') => {
      const ent = e as { id: number };
      ent.id = em.nextId++;
      if (bucket === 'enemies') enemies.push(e as Enemy);
    },
  };
  const player = new Player(70 * TILE, (FLOOR - 3) * TILE, new Inventory());
  const hooks = {
    world: w, player,
    enemies: () => enemies,
    critters: () => [], npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
    playSfxFiles: () => {}, showPickupLabel: () => {}, cutTile: () => {},
    scene: { zoneGraveyard: false },
    entities: em,
  } as unknown as GameHooks;
  return { hooks, enemies, em };
}
function flagLadderWorld() {
  const w = flagWorld();
  const h = flagHooks(w);
  const e = Enemy.fromVanilla(3, 41 * TILE, (FLOOR - 2) * TILE)!;
  e.id = h.em.nextId++;
  h.enemies.push(e);
  for (let i = 0; i < 200; i++) {
    e.fixedUpdate(1 / 60, h.hooks);
    if (i >= 5 && e.vy === 0 && e.onGround) break;
  }
  e.x = 41 * TILE;
  e.y = FLOOR * TILE - e.h;               // h=40 → 脚行 FLOOR、头行 FLOOR−4
  e.vx = 1; e.vy = 0; e.facing = 1;
  return { w, h, e };
}
const flagDrive = (e: Enemy, h: ReturnType<typeof flagHooks>) =>
  (e as unknown as Record<string, (g: GameHooks, p: unknown) => void>)
    .fighterAI.call(e, h.hooks, h.hooks.player);

describe('F4 flag5 谓词族（D1①头行/D2脚行/D1②跳梯）', () => {
  it('4a D1②：脚前 1 格【矿条 239】= SolidTileNoPlatforms 墙 → vy=−6（旧 isSolid 放行必红）', () => {
    const { w, h, e } = flagLadderWorld();
    w.store.setTile(42, FLOOR - 2, TILE_BY_KEY['v_239_ore_bars']);   // fy−1=FLOOR−2（level-2 探针）
    flagDrive(e, h);
    expect(e.vy).toBe(-6);              // :60705 −6 档（非平台 solidTop 算墙）
  });
  it('4b D1②：脚前 1 格【平台】= 不算墙 → 非 −6 档（窄集排除,与 4a 分立）', () => {
    const { w, h, e } = flagLadderWorld();
    w.store.setTile(42, FLOOR - 2, TILE_BY_KEY['platform']);         // fy−1=FLOOR−2
    flagDrive(e, h);
    expect(e.vy).not.toBe(-6);          // 平台檐:落 level-3/悬崖支（旧 isSolid 同不触发=回归护栏）
  });
  it('4c D1②：胸口前 2 格矿条（h=40≥32）→ −7 档（:60692 SolidTileNoPlatforms）', () => {
    const { w, h, e } = flagLadderWorld();
    w.store.setTile(42, FLOOR - 3, TILE_BY_KEY['v_239_ore_bars']);   // fy−2=FLOOR−3（level-1 探针,h=40≥32）
    flagDrive(e, h);
    expect(e.vy).toBe(-7);              // fy−3（FLOOR−4）空 → −7 档
  });
  it('4d D2：站【半砖】→ raw tileSolid=地 → flag5=true 照跳（旧 AllowBottomSlope 拒半砖必红）', () => {
    const { w, h, e } = flagLadderWorld();
    w.store.setHalfBrick(41, FLOOR, true);            // 脚下地板行半砖
    w.store.setTile(42, FLOOR - 2, 1);                // 前方整砖墙（level-2 探针位）
    flagDrive(e, h);
    expect(e.vy).toBe(-6);              // :60444 tileSolid[1]=true——半砖可跳（旧近似=不跳）
  });
  it('4e D2 负控：站【工作台 18】= solidTop-only 非 tileSolid → flag5=false 不跳（旧近似=跳必红）', () => {
    const { w, h, e } = flagLadderWorld();
    w.store.setTile(41, FLOOR, TILE_BY_KEY['workbench']);   // 脚行=工作台行
    w.store.setTile(42, FLOOR - 2, 1);
    flagDrive(e, h);
    expect(e.vy).toBe(0);               // :60444 tileSolid[18]=false——站桌子不跳（旧=跳）
  });
  it('4f D1①：头顶【平台】≠ 封顶 → flag5 保持 true 照跳（旧宽集误封顶必红）', () => {
    const { w, h, e } = flagLadderWorld();
    w.store.setTile(41, FLOOR - 4, TILE_BY_KEY['platform']);  // 头行（y−9 → FLOOR−4）
    w.store.setTile(42, FLOOR - 4, TILE_BY_KEY['platform']);
    w.store.setTile(42, FLOOR - 2, 1);                // 前方整砖墙（level-2 探针位）
    flagDrive(e, h);
    expect(e.vy).toBe(-6);              // 平台在头上不封顶（旧 (solid||platform) 误判墙=不跳）
  });
  it('4g D1① 负控：头顶【石头】= 封顶 → flag5=false 不跳（回归护栏）', () => {
    const { w, h, e } = flagLadderWorld();
    w.store.setTile(41, FLOOR - 4, 1);
    w.store.setTile(42, FLOOR - 4, 1);
    w.store.setTile(42, FLOOR - 2, 1);
    flagDrive(e, h);
    expect(e.vy).toBe(0);
  });
  it('4h 单源钉值：solidTileNoPlatforms 谓词表（窄集/solidTop/致动/幽灵/界外）', () => {
    const w = flagWorld();
    const st = w.store;
    const put = (tx: number, ty: number, key: string) => st.setTile(tx, ty, TILE_BY_KEY[key]);
    put(10, 10, 'platform');
    expect(solidTileNoPlatforms(st, 10, 10)).toBe(false);        // 窄集 Platforms{19,427,435-439}
    put(11, 10, 'v_239_ore_bars');
    expect(solidTileNoPlatforms(st, 11, 10)).toBe(true);         // 非平台 solidTop=墙
    put(12, 10, 'v_380_planter_boxes');
    expect(solidTileNoPlatforms(st, 12, 10)).toBe(true);
    put(13, 10, 'workbench');
    expect(solidTileNoPlatforms(st, 13, 10)).toBe(true);         // 头行算墙/脚行不算地（分谓词）
    st.setTile(14, 10, 1);
    expect(solidTileNoPlatforms(st, 14, 10)).toBe(true);         // 普通实心
    st.setActuated(14, 10, true);
    expect(solidTileNoPlatforms(st, 14, 10)).toBe(false);        // 致动
    st.setTile(15, 10, 1); st.flags[st.idx(15, 10)] = 0;         // 幽灵格
    expect(solidTileNoPlatforms(st, 15, 10)).toBe(false);
    expect(solidTileNoPlatforms(st, -1, 10)).toBe(true);         // !InWorld → true（界外算墙）
    expect(solidTileNoPlatforms(st, 10, -1)).toBe(true);
  });
});

// ===========================================================================
// 变异恰红（M1-M5,G41A_MUT_SKIP 守卫;子进程隔离还原纯净）
// ===========================================================================
describe('G41-A 变异恰红', () => {
  const MUT = process.env.G41A_MUT_SKIP ? describe.skip : describe;
  MUT('M1-M5', () => {
    const SRC_DIR = join(HERE, '..', 'src');
    const mut = (rel: string, from: string, to: string) => {
      const abs = join(SRC_DIR, rel);
      const orig = readFileSync(abs, 'utf8');
      if (!orig.includes(from)) throw new Error(`mutation anchor missing in ${rel}: ${from.slice(0, 60)}`);
      writeFileSync(abs, orig.replace(from, to), 'utf8');
      return () => writeFileSync(abs, orig, 'utf8');
    };
    const runGreen = (): boolean => {
      try {
        execFileSync('npx', ['vitest', 'run', join(HERE, 'g41a-debt-clearance.test.ts')],
          { cwd: join(HERE, '..'), env: { ...process.env, G41A_MUT_SKIP: '1' },
            stdio: ['ignore', 'ignore', 'ignore'], timeout: 420_000 });
        return true;
      } catch { return false; }
    };
    const expectRedThenGreen = (label: string, restore: () => void) => {
      try {
        if (runGreen()) throw new Error(`MUTATION NOT RED: ${label}`);
      } finally { restore(); }
      if (!runGreen()) throw new Error(`RESTORE NOT GREEN: ${label}`);
    };

    it('M1 克盾 TimerCrit 摘除 → 1a/1b 红', () => {
      const restore = mut('entities/Player.ts',
        'const critTimer = this.tryConsumingTimerCrit(game,',
        'const critTimer = false && this.tryConsumingTimerCrit(game,');
      expectRedThenGreen('M1', restore);
    });
    it('M2 日曜懒惰链复辟（短路吞消费）→ 1d 红', () => {
      const restore = mut('entities/Player.ts',
        'const crit3Timer = this.tryConsumingTimerCrit(game,',
        'const crit3Timer = crit3Rolled ? false : this.tryConsumingTimerCrit(game,');
      expectRedThenGreen('M2', restore);
    });
    it('M3 蜜蜂套裸 armor[] 读复辟 → 5d 红', () => {
      const restore = mut('core/Game.ts',
        'const b0 = statOfInternal(this.player.inv.getEffectiveArmor(0)?.id ?? -1);',
        'const b0 = statOfInternal(this.player.inv.armor[0]?.id ?? -1);');
      expectRedThenGreen('M3', restore);
    });
    it('M4 scene 计数 bound/453 排除摘除 → 3a 红', () => {
      const restore = mut('core/Game.ts',
        "return tn instanceof TownNPC && !tn.dead && !tn.bound && tn.npcKey !== 'skeleton_merchant'",
        'return !!(tn as TownNPC) && !tn.dead');
      expectRedThenGreen('M4', restore);
    });
    it('M5 getSpawnRate 调用回退心锚 → 3d 红', () => {
      // ★issue#46-N01：调用迁具名入口——变异锚随之迁到具名字段（语义不变：顶边→中心）
      const restore = mut('core/Game.ts',
        'playerYpx: p.y,',
        'playerYpx: p.cy,');
      expectRedThenGreen('M5', restore);
    });
  });
});
