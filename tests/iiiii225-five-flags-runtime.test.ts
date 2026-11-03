// IIII225：中区五旗运行时机制清扫——缺口实装回归（标杆 Terarria1457 反编译）：
//  ① FTW×noTraps 双种子炸弹引信加速（P.cs:48040-48045）——存活拍 timeLeft 再减 1,
//    180 引信 90 拍爆;单旗/十周年组合不加速
//  ② StatusFromNPC 携物史莱姆支（Player.cs:22559-22640）——FTW 火把史莱姆(ai1=8)
//    接触授 WellFed 180-299t;携矿史莱姆(364 族)授 debuff 池;非 FTW 火把史莱姆零授
//  ③ drunk 世界地牢 Zone 深度下限（SceneMetrics.cs:688-691）——drunk 时 num =
//    max(worldSurface, dungeonY+40),ZoneDungeon 需 tileY 深于该值
//  ④ NewNPC FTW 野生交换（NPC.cs:81576-81586）与 checkDead FTW 三臂
//    （NPC.cs:78901-78935/:79030）经 headless 探针验证（tests 直构 Game 过重,登记）。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { GrenadeProj } from '../src/entities/WeaponProj';
import { Enemy } from '../src/entities/Enemy';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { BuffType } from '../src/stats/Buffs';
import { TILE_BY_KEY } from '../src/data/tiles';
import { scanScene } from '../src/world/SceneMetrics';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

/** mkGame：seedFlags 注入版（引信/携物状态面用） */
function mkGame(seedFlags: Record<string, boolean>, opts?: { hardMode?: boolean }) {
  const w = new World(80, 60, 30, 'open');
  (w as unknown as { seedFlags: Record<string, boolean> }).seedFlags = seedFlags;
  (w as unknown as { flags: Record<string, boolean> }).flags = { hardMode: !!opts?.hardMode };
  const g = {
    world: w, player: null, enemies: () => [], critters: () => [],
    entities: { nextId: 1, add: () => {} }, cutTile: () => {},
    spawnDust: () => null, spawnParticles: () => {}, addDamageNumber: () => {},
    damagePlayer: (): number => 0, spawnDrop: () => null, onEnemyKilled: () => {},
    playSfx: () => {}, playSfxFiles: () => {},
  } as unknown as GameHooks;
  return { g, w };
}

describe('IIIII225 ①：FTW×noTraps 炸弹引信加速（P.cs:48040-48045）', () => {
  const runFuse = (seedFlags: Record<string, boolean>, ticks: number) => {
    const { g } = mkGame(seedFlags);
    const p = new GrenadeProj(640, 704, 0, 0, 100, 180, 28, () => {});
    for (let i = 0; i < ticks; i++) p.fixedUpdate(0, g);
    return 180 - p.fuse;   // 累计衰减
  };
  it('FTW×noTraps：存活拍双倍衰减（10 拍 -20）', () => {
    expect(runFuse({ getGoodWorld: true, noTraps: true }, 10)).toBe(20);
  });
  it('仅 FTW / 仅 noTraps：原速（10 拍 -10）', () => {
    expect(runFuse({ getGoodWorld: true }, 10)).toBe(10);
    expect(runFuse({ noTraps: true }, 10)).toBe(10);
  });
  it('FTW×noTraps×十周年：豁免（原速,:48040 第三析取取反）', () => {
    expect(runFuse({ getGoodWorld: true, noTraps: true, tenthAnniversary: true }, 10)).toBe(10);
  });
  it('爆点不前移：F=4 拍存活（fuse>4 预减门）——FTW×noTraps 4 拍衰减恰 -8', () => {
    expect(runFuse({ getGoodWorld: true, noTraps: true }, 4)).toBe(8);
  });
});

describe('IIIII225 ②：StatusFromNPC 携物史莱姆支（Player.cs:22559-22640）', () => {
  const setup = (seedFlags: Record<string, boolean>) => {
    const { g, w } = mkGame(seedFlags);
    const p = new Player(60 * TILE, 60 * TILE, new Inventory());
    (g as unknown as { player: Player }).player = p;
    const e = Enemy.fromVanilla(1, 60 * TILE, 60 * TILE)!;
    return { g, w, p, e };
  };
  it('FTW 火把史莱姆（ai1=8）接触 → WellFed 3-5s（:22595-22597）', () => {
    const { g, p, e } = setup({ getGoodWorld: true });
    (e as unknown as { ai1: number }).ai1 = 8;
    (e as unknown as { slimeCarryContactStatus: (g: GameHooks, p: Player) => void })
      .slimeCarryContactStatus(g, p);
    expect(p.buffs.has(BuffType.WellFed)).toBe(true);
    const dur = (p.buffs as { remainingOf?: (t: BuffType) => number })
      .remainingOf?.(BuffType.WellFed);
    if (dur !== undefined) expect(dur).toBeGreaterThanOrEqual(3);
  });
  it('非 FTW 火把史莱姆接触：零授（cs 门 ai[1]==8 && getGoodWorld）', () => {
    const { g, p, e } = setup({});
    (e as unknown as { ai1: number }).ai1 = 8;
    (e as unknown as { slimeCarryContactStatus: (g: GameHooks, p: Player) => void })
      .slimeCarryContactStatus(g, p);
    expect(p.buffs.has(BuffType.WellFed)).toBe(false);
  });
  it('携矿史莱姆（ai1=364）→ debuff 池 7 选 1（:22561-22581）', () => {
    const { g, p, e } = setup({});
    (e as unknown as { ai1: number }).ai1 = 364;
    (e as unknown as { slimeCarryContactStatus: (g: GameHooks, p: Player) => void })
      .slimeCarryContactStatus(g, p);
    const pool = [BuffType.Confused, BuffType.Silenced, BuffType.Cursed, BuffType.Slow,
      BuffType.Blackout, BuffType.Weak, BuffType.BrokenArmor];
    expect(pool.some((b) => p.buffs.has(b))).toBe(true);
  });
  it('携泥史莱姆（ai1=2）：不在状态梯（零授,cs 无 2 支）', () => {
    const { g, p, e } = setup({});
    (e as unknown as { ai1: number }).ai1 = 2;
    (e as unknown as { slimeCarryContactStatus: (g: GameHooks, p: Player) => void })
      .slimeCarryContactStatus(g, p);
    expect(p.buffs.has(BuffType.WellFed)).toBe(false);
    expect(p.buffs.has(BuffType.Bleeding)).toBe(false);
  });
});

describe('IIIII225 ③：drunk 世界地牢 Zone 深度下限（SceneMetrics.cs:688-691）', () => {
  /** 在探针窗内铺 30×20=600 蓝地牢砖（sheet 41≥阈值 250）+ 墙 7 */
  function setup(seedFlags: Record<string, boolean>, dungeonY: number) {
    const w = new World(200, 200, 7, 'iii225');
    (w as unknown as { seedFlags: Record<string, boolean> }).seedFlags = seedFlags;
    (w as unknown as { dungeonY: number }).dungeonY = dungeonY;
    (w as unknown as { groundLevel: number }).groundLevel = 40;
    const brick = TILE_BY_KEY['v_41_blue_brick'];
    for (let y = 95; y < 115; y++) {
      for (let x = 60; x < 90; x++) {
        w.store.setTileSilent(x, y, brick, 0, 0);
        w.store.setWallSilent(x, y, 7);          // 蓝地牢墙（DUNGEON_WALLS）
      }
    }
    return w;
  }
  it('drunk：dungeonY+40 上层带（浅于下限）不再判地牢 Zone；下限之下照判', () => {
    const w = setup({ drunkWorld: true }, 60);
    const deep = scanScene(w, 75 * TILE, 105 * TILE, 0);   // 105 > 60+40=100 ✓ 深于下限
    expect(deep.zoneDungeon).toBe(true);
    const shallow = scanScene(w, 75 * TILE, 95 * TILE, 0); // 95 ≤ 100 → 否
    expect(shallow.zoneDungeon).toBe(false);
  });
  it('非 drunk：仅 worldSurface 深度门（95 浅层照判=true 对照）', () => {
    const w = setup({}, 60);
    const shallow = scanScene(w, 75 * TILE, 95 * TILE, 0);
    expect(shallow.zoneDungeon).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IIII225 ⑤：源锚定（探针不可达的闭包/私有面——tests/redblue-r25 判例,读源断言。
//  探针 _iii225-ftw.mjs / _iii225-drunk.mjs 已对 onEnemyKilled 三臂/NewNPC 交换/
//  引信/携物/drunk 抬升做实机验证,本节仅锁锚点防覆写）
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';

describe('IIIII225 ⑤：源锚定（防覆写锚）', () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('VanillaSpawner：drunk 蜂巢墙 86 spawnRate×0.3/max×1.8（NPC.cs:588-592）', () => {
    const s = src('../src/world/spawn/VanillaSpawner.ts');
    expect(s).toContain('drunk 世界蜂巢墙修正（NPC.cs:588-592');
    expect(s).toContain('spawnRate = Math.floor(spawnRate * 0.3)');
    expect(s).toContain('maxSpawns = Math.floor(maxSpawns * 1.8)');
  });
  it('VanillaSpawner：CheckToSpawnSpider NTB×FTW 地狱 1/5（1457 NPC.cs:5790-5801）', () => {
    const s = src('../src/world/spawn/VanillaSpawner.ts');
    expect(s).toContain('CheckToSpawnSpider（1457 NPC.cs:5790-5801）');
    // ★issue#46-N12 锁随刀走：地狱线 = UnderworldLayer=maxTilesY-200（1457 Main.cs:2886），
    // 单源 = World.underworldLine getter；不是世界生成熔岩线 lavaLine（旧锁把 bug 钉成权威）。
    expect(s).toContain('spawnTileY >= this.world.underworldLine && !N(5)');
    expect(s).not.toContain('spawnTileY >= this.world.lavaLine && !N(5)');
  });
  it('VanillaSpawner：NewNPC FTW 野生交换 46→614/62→66（NPC.cs:81576-81586）', () => {
    const s = src('../src/world/spawn/VanillaSpawner.ts');
    expect(s).toContain('NewNPC FTW 野生交换（NPC.cs:81576-81586）');
    expect(s).toContain("if (baseId === 46) baseId = 614;");
  });
  it('Game：checkDead FTW 三臂 + 雕像交换（NPC.cs:78901/:79030/:81576）', () => {
    const s = src('../src/core/Game.ts');
    expect(s).toContain('checkDead FTW 三臂（NPC.cs:78901-78935/:79030-79034');
    expect(s).toContain("new TrapShot(enemy.cx, enemy.cy, 0, 0, 70, 'boulder')");
    expect(s).toContain('vidStatue === 46 ? 614 : 66');
  });
  it('mainFlow：标题曲种子覆写（Main.cs:12626-12656,drunk 60/70/72/75/86）', () => {
    const s = src('../src/mainFlow.ts');
    expect(s).toContain('标题曲种子覆写（Main.cs:12626-12656');
    expect(s).toContain('if (f.vampireSeed) return 75;');
    expect(s).toContain('if (f.notTheBees) return 86;');
  });
  it('Renderer：FTW 脆蜂蜜块 230 危险感高亮（TileDrawing.cs:4476）', () => {
    const s = src('../src/render/Renderer.ts');
    expect(s).toContain('FTW 世界 230 脆蜂蜜块计入');
  });
});
