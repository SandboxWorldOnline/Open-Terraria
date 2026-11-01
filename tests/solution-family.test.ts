// 环境转换器全族（L2）：WorldGen.Convert case 0/14-21 + convertArea 尺寸重载 +
// 溶液弹 aiStyle 31（SolutionProj）+ 圣/邪/血水投掷瓶（WaterSplashProj）+
// PickAmmo 溶液加法链与消耗门。数值/行为 1:1 对 Terarria1456：
//   Convert            WorldGen.cs:55113-56288（case 0 :55517-55692 / 14-21 :55972-56288）
//   尺寸重载           WorldGen.cs:55090-55109（菱形门 |dx|+|dy|<6 恒 6）
//   溶液弹 AI_031      Projectile.cs:25307-25375（SetDefaults :2071-2131/DefaultToSpray）
//   三瓶水 Kill        Projectile.cs:75011-75058 + :75610-75625
//   PickAmmo 溶液加法  Player.cs:52645-52647；消耗门 :52739（5134 三分免）/:52815
import { describe, it, expect, vi } from 'vitest';
import { RNG } from '../src/core/rng';
import { damageVarRoll } from '../src/stats/DamageVar';   // ★G37-A：DV 域锁（bj735a 判例形）
import { World } from '../src/world/World';
import { WorldEvolution, type EvolutionHost } from '../src/world/evolution/WorldEvolution';
import type { TileStore } from '../src/world/TileStore';
import { TILE_DEFS, TILE_BY_KEY } from '../src/data/tiles';
import { itemCombat, resolveAmmoProjId } from '../src/data/vanillaItemCombat';
import { SolutionProj, WaterSplashProj, SPRAY_PROJ, solutionConsumesThisShot } from '../src/entities/SolutionProj';
import type { GameHooks } from '../src/entities/types';

const S = (sheet: number): number => TILE_DEFS.findIndex((t) => t?.vanilla?.sheet === sheet);
const sheetOf = (id: number): number => TILE_DEFS[id]?.vanilla?.sheet ?? -1;
const TILE = 16;

/** 60×60 试验世界（worldSurface 20 / rockLevel 40）+ WorldEvolution 宿主 */
function evoWorld() {
  const w = new World(60, 60, 20260820, 'solution-family');
  const host: EvolutionHost = {
    store: w.store, worldSurface: 20, rockLevel: 40, dungeonX: 0, difficulty: 0,
    flags: w.flags, crimson: false, isDay: true, raining: false,
    maxRaining: 0, windSpeedCurrent: 0, playerTile: () => null,
  };
  return { w, st: w.store, evo: new WorldEvolution(host), host };
}
const wallAt = (st: TileStore, x: number, y: number) => st.wall[st.idx(x, y)];

/** SolutionProj/WaterSplashProj 的 GameHooks 试验台（转换回调直连真 WorldEvolution） */
function projWorld() {
  const { w, st, evo } = evoWorld();
  const hurtCalls: number[] = [];
  const hooks = {
    world: w,
    player: {},
    enemies: () => [] as unknown[],
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    playSfxAt: () => {},
  } as unknown as GameHooks & {
    enemies: () => unknown[];
  };
  const conv = (convType: number, i: number, j: number, size: number) =>
    evo.convertArea(i, j, convType, size);
  return { w, st, evo, hooks, conv, hurtCalls };
}

// ---------------------------------------------------------------------------
// ① Convert case 0（绿溶液纯净化，cs:55517-55692）
// ---------------------------------------------------------------------------
describe('Convert case 0 墙链（cs:55517-55652）', () => {
  it('邪恶/神圣草墙 69/70/81：地表 9/10 → 63、地下 → 64（cs:55523-55532）', () => {
    const rnd = vi.spyOn(RNG.prototype, 'next').mockReturnValue(0);
    try {
      const { st, evo } = evoWorld();
      st.setWallSilent(10, 10, 69);   // 地表（10 < worldSurface 20）
      st.setWallSilent(11, 10, 70);
      st.setWallSilent(12, 10, 81);
      st.setWallSilent(13, 30, 69);   // 地下
      evo.convert(10, 10, 0);
      evo.convert(11, 10, 0);
      evo.convert(12, 10, 0);
      evo.convert(13, 30, 0);
      expect(wallAt(st, 10, 10)).toBe(63);   // rand<0.9 → 63
      expect(wallAt(st, 11, 10)).toBe(63);
      expect(wallAt(st, 12, 10)).toBe(63);
      expect(wallAt(st, 13, 30)).toBe(64);
    } finally { rnd.mockRestore(); }
  });
  it('地表 1/10 → 65（cs:55528-55530）', () => {
    const rnd = vi.spyOn(RNG.prototype, 'next').mockReturnValue(0.95);
    try {
      const { st, evo } = evoWorld();
      st.setWallSilent(10, 10, 69);
      evo.convert(10, 10, 0);
      expect(wallAt(st, 10, 10)).toBe(65);
    } finally { rnd.mockRestore(); }
  });
  it('化石裂纹墙 262/274/292-295 → 自然化石 61/185/204-207；61/185/204-207 自身豁免', () => {
    const { st, evo } = evoWorld();
    const pairs: Array<[number, number]> = [[262, 61], [274, 185], [292, 204], [293, 205], [294, 206], [295, 207]];
    pairs.forEach(([from, to], k) => {
      st.setWallSilent(10 + k, 30, from);
      evo.convert(10 + k, 30, 0);
      expect(wallAt(st, 10 + k, 30)).toBe(to);
    });
    for (const keep of [61, 185, 204, 205, 206, 207]) {
      st.setWallSilent(30 + keep % 10, 30, keep);
      evo.convert(30 + keep % 10, 30, 0);
      expect(wallAt(st, 30 + keep % 10, 30)).toBe(keep);   // 空 case 豁免（cs:55686-55688）
    }
  });
  it('石墙 3 → 349、NewWall 188-191 → 212-215、硬化沙 217 → 216、砂岩 220 → 187', () => {
    const { st, evo } = evoWorld();
    const cases: Array<[number, number, number]> = [[3, 349, 349], [188, 212, 212], [189, 213, 213],
      [190, 214, 214], [191, 215, 215], [217, 216, 216], [220, 187, 187]];
    cases.forEach(([from, , to], k) => {
      st.setWallSilent(10 + k, 30, from);
      evo.convert(10 + k, 30, 0);
      expect(wallAt(st, 10 + k, 30)).toBe(to);
    });
  });
  it('蘑菇墙 80 深度带：地表带 → 土墙 15、中段 → 草墙 64、深岩下 → 15（cs:55638-55652）', () => {
    const rnd = vi.spyOn(RNG.prototype, 'next').mockReturnValue(0);   // Next(3)=0
    try {
      const { st, evo } = evoWorld();
      // 60 高/rockLevel 40：(60+40)/2-3+0 = 47；地表带 j < 20+4 = 24
      st.setWallSilent(10, 10, 80);   // j=10 < 24 → 15
      st.setWallSilent(11, 30, 80);   // 中段 → 64
      st.setWallSilent(12, 50, 80);   // j=50 > 47 → 15
      evo.convert(10, 10, 0);
      evo.convert(11, 30, 0);
      evo.convert(12, 50, 0);
      expect(wallAt(st, 10, 10)).toBe(15);
      expect(wallAt(st, 11, 30)).toBe(64);
      expect(wallAt(st, 12, 50)).toBe(15);
    } finally { rnd.mockRestore(); }
  });
});

describe('Convert case 0 块链（cs:55653-55692）', () => {
  it('高尔夫草 492 → 修剪草 477；邪恶草族 23/199 → 2；珍珠岩 117 → 1', () => {
    const { st, evo } = evoWorld();
    const cases: Array<[number, number]> = [[492, 477], [23, 2], [199, 2], [109, 2], [117, 1], [25, 1], [203, 1]];
    cases.forEach(([from, to], k) => {
      st.setTileSilent(10 + k, 30, S(from));
      evo.convert(10 + k, 30, 0);
      expect(sheetOf(st.type[st.idx(10 + k, 30)])).toBe(to);
    });
  });
  it('邪恶沙 112/234 → 53、硬化 398/399 → 397、砂岩 400/401 → 396、邪恶冰 163 → 161', () => {
    const { st, evo } = evoWorld();
    const cases: Array<[number, number]> = [[112, 53], [234, 53], [398, 397], [399, 397], [400, 396], [401, 396], [163, 161], [200, 161]];
    cases.forEach(([from, to], k) => {
      st.setTileSilent(10 + k, 30, S(from));
      evo.convert(10 + k, 30, 0);
      expect(sheetOf(st.type[st.idx(10 + k, 30)])).toBe(to);
    });
  });
  it('蘑菇草 70 → 丛林草 60（MushroomGrass 集 {70}）；丛林草 60 自身不动', () => {
    const { st, evo } = evoWorld();
    st.setTileSilent(10, 30, S(70));
    st.setTileSilent(11, 30, S(60));
    evo.convert(10, 30, 0);
    evo.convert(11, 30, 0);
    expect(sheetOf(st.type[st.idx(10, 30)])).toBe(60);
    expect(sheetOf(st.type[st.idx(11, 30)])).toBe(60);
  });
  it('邪恶荆棘 32/352 击杀；丛林棘 69 保留（cs:55689-55692 仅 32/352）', () => {
    const { st, evo } = evoWorld();
    st.setTileSilent(10, 30, S(32));
    st.setTileSilent(11, 30, S(352));
    st.setTileSilent(12, 30, S(69));
    evo.convert(10, 30, 0);
    evo.convert(11, 30, 0);
    evo.convert(12, 30, 0);
    expect(st.flags[st.idx(10, 30)]).toBe(0);
    expect(st.flags[st.idx(11, 30)]).toBe(0);
    expect(sheetOf(st.type[st.idx(12, 30)])).toBe(69);
  });
});

// ---------------------------------------------------------------------------
// ② Convert case 14-21（1.4.4 Forced*，cs:55972-56288）
// ---------------------------------------------------------------------------
describe('Convert case 14-21（Forced* 反转换）', () => {
  it('14 强制神圣：NewWall 188-191 → 200-203、其余墙 → 28；荆棘击杀、石 1 → 珍珠岩 117', () => {
    const { st, evo } = evoWorld();
    const wallPairs: Array<[number, number]> = [[188, 200], [189, 201], [190, 202], [191, 203], [3, 28], [2, 28]];
    wallPairs.forEach(([from, to], k) => {
      st.setWallSilent(10 + k, 30, from);
      evo.convert(10 + k, 30, 14);
      expect(wallAt(st, 10 + k, 30)).toBe(to);
    });
    st.setTileSilent(30, 30, S(1));
    st.setTileSilent(31, 30, S(32));
    const chest = TILE_BY_KEY['chest']!;
    st.setTileSilent(32, 30, chest);   // 重要帧物豁免
    evo.convert(30, 30, 14);
    evo.convert(31, 30, 14);
    evo.convert(32, 30, 14);
    expect(sheetOf(st.type[st.idx(30, 30)])).toBe(117);
    expect(st.flags[st.idx(31, 30)]).toBe(0);
    expect(st.type[st.idx(32, 30)]).toBe(chest);
  });
  it('15 强制蘑菇：任意墙 → 80；露天块 → 蘑菇草 70 / 埋藏块 → 泥 59；荆棘先杀不补放', () => {
    const { st, evo } = evoWorld();
    st.setWallSilent(10, 30, 3);
    evo.convert(10, 30, 15);
    expect(wallAt(st, 10, 30)).toBe(80);
    // 埋藏（四周实心泥 59）→ 59；露天单格 → 70
    for (let x = 20; x < 24; x++) for (let y = 29; y < 32; y++) st.setTileSilent(x, y, S(59));
    st.setTileSilent(22, 30, S(0));   // 中心换泥土 0（同处埋藏）
    evo.convert(22, 30, 15);
    expect(sheetOf(st.type[st.idx(22, 30)])).toBe(59);
    st.setTileSilent(40, 30, S(0));   // 孤立露天
    evo.convert(40, 30, 15);
    expect(sheetOf(st.type[st.idx(40, 30)])).toBe(70);
    st.setTileSilent(41, 30, S(32));  // 荆棘：Kill 后不补放（ActuallyConvertTile 现读 inactive）
    evo.convert(41, 30, 15);
    expect(st.flags[st.idx(41, 30)]).toBe(0);
  });
  it('16 强制沙漠：泥土 0 → 沙 53（下悬空 → 硬化沙 397）；石 1 → 砂岩 396；墙 2/3 → 216/187', () => {
    const { st, evo } = evoWorld();
    st.setWallSilent(10, 30, 2);
    st.setWallSilent(11, 30, 3);
    evo.convert(10, 30, 16);
    evo.convert(11, 30, 16);
    expect(wallAt(st, 10, 30)).toBe(216);
    expect(wallAt(st, 11, 30)).toBe(187);
    // 支撑住的沙（下方实心石）→ 53
    st.setTileSilent(20, 31, S(1));
    st.setTileSilent(20, 30, S(0));
    evo.convert(20, 30, 16);
    expect(sheetOf(st.type[st.idx(20, 30)])).toBe(53);
    // 下方悬空 → 397
    st.setTileSilent(30, 30, S(0));
    evo.convert(30, 30, 16);
    expect(sheetOf(st.type[st.idx(30, 30)])).toBe(397);
    st.setTileSilent(31, 30, S(1));
    evo.convert(31, 30, 16);
    expect(sheetOf(st.type[st.idx(31, 30)])).toBe(396);
  });
  it('17 强制雪原：泥土 0 → 雪 147、石 1 → 冰 161；墙 2 → 40、石墙 3 → 71', () => {
    const { st, evo } = evoWorld();
    st.setWallSilent(10, 30, 2);
    st.setWallSilent(11, 30, 3);
    evo.convert(10, 30, 17);
    evo.convert(11, 30, 17);
    expect(wallAt(st, 10, 30)).toBe(40);
    expect(wallAt(st, 11, 30)).toBe(71);
    st.setTileSilent(20, 30, S(0));
    st.setTileSilent(21, 30, S(1));
    evo.convert(20, 30, 17);
    evo.convert(21, 30, 17);
    expect(sheetOf(st.type[st.idx(20, 30)])).toBe(147);
    expect(sheetOf(st.type[st.idx(21, 30)])).toBe(161);
  });
  it('18 强制森林：沙 53 露天 → 2 / 埋藏 → 0；高尔夫草 492 → 477；黑檀石 25 → 1；墙 3 → 349、硬化沙 216 → 2', () => {
    const { st, evo } = evoWorld();
    st.setWallSilent(10, 30, 3);
    st.setWallSilent(11, 30, 216);
    evo.convert(10, 30, 18);
    evo.convert(11, 30, 18);
    expect(wallAt(st, 10, 30)).toBe(349);
    expect(wallAt(st, 11, 30)).toBe(2);
    st.setTileSilent(20, 30, S(53));   // 孤立露天沙 → 草 2
    evo.convert(20, 30, 18);
    expect(sheetOf(st.type[st.idx(20, 30)])).toBe(2);
    for (let x = 22; x < 26; x++) for (let y = 29; y < 32; y++) st.setTileSilent(x, y, S(1));
    st.setTileSilent(24, 30, S(53));   // 埋藏沙 → 泥 0
    evo.convert(24, 30, 18);
    expect(sheetOf(st.type[st.idx(24, 30)])).toBe(0);
    st.setTileSilent(30, 30, S(492));
    st.setTileSilent(31, 30, S(25));
    evo.convert(30, 30, 18);
    evo.convert(31, 30, 18);
    expect(sheetOf(st.type[st.idx(30, 30)])).toBe(477);
    expect(sheetOf(st.type[st.idx(31, 30)])).toBe(1);
  });
  it('19 强制丛林：草墙 63/69/70/81 → 64、他墙 → 15（15 自身豁免）；荆棘 32 → 丛林棘 69；露天泥 0 → 60', () => {
    const { st, evo } = evoWorld();
    for (const [from, to] of [[63, 64], [69, 64], [70, 64], [81, 64], [3, 15]] as Array<[number, number]>) {
      st.setWallSilent(from % 20 + 5, 30, from);
      evo.convert(from % 20 + 5, 30, 19);
      expect(wallAt(st, from % 20 + 5, 30)).toBe(to);
    }
    st.setWallSilent(40, 30, 15);
    evo.convert(40, 30, 19);
    expect(wallAt(st, 40, 30)).toBe(15);
    st.setTileSilent(41, 30, S(32));   // 荆棘先转 69（cs:56209-56211）再被独立 if
    evo.convert(41, 30, 19);           // 覆写（荆棘非重要帧 → 露天终态 60,cs:56212-56219）
    expect(sheetOf(st.type[st.idx(41, 30)])).toBe(60);
    st.setTileSilent(42, 30, S(0));    // 孤立露天泥 → 丛林草 60
    evo.convert(42, 30, 19);
    expect(sheetOf(st.type[st.idx(42, 30)])).toBe(60);
  });
  it('20 强制神庙：墙 → 87、非重要帧块 → 蜥蜴砖 226、荆棘 32 → 69', () => {
    const { st, evo } = evoWorld();
    st.setWallSilent(10, 30, 3);
    evo.convert(10, 30, 20);
    expect(wallAt(st, 10, 30)).toBe(87);
    st.setTileSilent(20, 30, S(1));
    st.setTileSilent(21, 30, S(32));
    evo.convert(20, 30, 20);
    evo.convert(21, 30, 20);
    expect(sheetOf(st.type[st.idx(20, 30)])).toBe(226);
    // 荆棘 32（非重要帧）→ 69 后仍被独立 if 转蜥蜴砖（ActuallyConvertTile 现读 69≠226）
    expect(sheetOf(st.type[st.idx(21, 30)])).toBe(226);
  });
  it('21 强制地牢：墙 → 17（运行时 GenVars 空兜底）、块 → 蓝砖 41、荆棘击杀不补放', () => {
    const { st, evo } = evoWorld();
    st.setWallSilent(10, 30, 3);
    evo.convert(10, 30, 21);
    expect(wallAt(st, 10, 30)).toBe(17);
    st.setTileSilent(20, 30, S(1));
    st.setTileSilent(21, 30, S(32));
    evo.convert(20, 30, 21);
    evo.convert(21, 30, 21);
    expect(sheetOf(st.type[st.idx(20, 30)])).toBe(41);
    expect(st.flags[st.idx(21, 30)]).toBe(0);   // Kill 后砖不补放
  });
});

// ---------------------------------------------------------------------------
// ③ convertArea 尺寸重载（cs:55090-55109：菱形门 |dx|+|dy|<6 恒 6）
// ---------------------------------------------------------------------------
describe('convertArea 菱形门', () => {
  it('size 2：方形窗 ±2 ∩ 菱形 |dx|+|dy|<6 内转换、窗外不动（cs:55098-55105）', () => {
    const { st, evo } = evoWorld();
    for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) {
      st.setTileSilent(30 + dx, 30 + dy, S(25));
    }
    evo.convertArea(30, 30, 0, 2);   // 纯净：黑檀石 25 → 石 1
    for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) {
      const inWindow = Math.abs(dx) <= 2 && Math.abs(dy) <= 2 && Math.abs(dx) + Math.abs(dy) < 6;
      const got = sheetOf(st.type[st.idx(30 + dx, 30 + dy)]);
      expect(got).toBe(inWindow ? 1 : 25);
    }
  });
  it('tiles=false 只转墙（cs:55092 短路门）', () => {
    const { st, evo } = evoWorld();
    st.setTileSilent(30, 30, S(25));
    st.setWallSilent(30, 30, 3);
    evo.convertArea(30, 30, 0, 2, false, true);
    expect(sheetOf(st.type[st.idx(30, 30)])).toBe(25);
    expect(wallAt(st, 30, 30)).toBe(349);
  });
});

// ---------------------------------------------------------------------------
// ④ 溶液弹 SolutionProj（AI_031，cs:25307-25375）
// ---------------------------------------------------------------------------
describe('SolutionProj 溶液弹', () => {
  it('型号表：145→conv0 … 1017→conv7（cs:25319-25345 switch + BiomeConversionID）', () => {
    expect(SPRAY_PROJ[145]).toEqual([0, 110]);
    expect(SPRAY_PROJ[146]).toEqual([2, 111]);
    expect(SPRAY_PROJ[147]).toEqual([1, 112]);
    expect(SPRAY_PROJ[148]).toEqual([3, 113]);
    expect(SPRAY_PROJ[149]).toEqual([4, 114]);
    expect(SPRAY_PROJ[1015]).toEqual([5, 311]);
    expect(SPRAY_PROJ[1016]).toEqual([6, 312]);
    expect(SPRAY_PROJ[1017]).toEqual([7, 313]);
  });
  it('绿溶液 145 沿弹道逐子步转净（黑檀石 25 → 石 1），弹心菱形 size2', () => {
    const { st, hooks, conv } = projWorld();
    for (let x = 10; x < 40; x++) for (let y = 20; y < 28; y++) st.setTileSilent(x, y, S(25));
    const spray = new SolutionProj(10 * TILE + 8, 24 * TILE + 8, 7, 0, 145, false, conv);
    for (let t = 0; t < 10 && !spray.dead; t++) spray.fixedUpdate(1 / 60, hooks);
    // 弹心 y=24 行沿途已被转净（|dy|≤1 也在菱形内）
    let converted = 0;
    for (let x = 10; x < 40; x++) {
      if (sheetOf(st.type[st.idx(x, 24)]) === 1) converted++;
    }
    expect(converted).toBeGreaterThan(5);
  });
  it('紫溶液 147 → 腐化：石 1 → 黑檀石 25（AI conv 1）', () => {
    const { st, hooks, conv } = projWorld();
    for (let x = 10; x < 40; x++) for (let y = 20; y < 28; y++) st.setTileSilent(x, y, S(1));
    const spray = new SolutionProj(10 * TILE + 8, 24 * TILE + 8, 7, 0, 147, false, conv);
    for (let t = 0; t < 6 && !spray.dead; t++) spray.fixedUpdate(1 / 60, hooks);
    expect(sheetOf(st.type[st.idx(20, 24)])).toBe(25);
  });
  it('Terraformer 5134（flag13）→ size 3；寿命 133 子步后消亡（cs:25362-25370）', () => {
    const { hooks, conv } = projWorld();
    const spray = new SolutionProj(10 * TILE, 30 * TILE, 11, 0, 145, true, conv);
    let ticks = 0;
    while (!spray.dead && ticks < 100) { spray.fixedUpdate(1 / 60, hooks); ticks++; }
    // extraUpdates=2 → 每tick 3 子步：133 子步 = 44⅓ tick → 第 45 tick 亡
    expect(ticks).toBe(45);
  });
  it('不伤敌（Damage_CanDealDamage :11782 豁免表含 aiStyle 31）', () => {
    const { hooks, conv } = projWorld();
    const hurt = vi.fn();
    (hooks.enemies as unknown as () => unknown[]) = () => [{
      x: 12 * TILE, y: 30 * TILE, w: 16, h: 16, dead: false, cx: 12 * TILE + 8, cy: 30 * TILE + 8,
      hurt,
      def: {}, vanillaId: 3, ai1: 0,
    }];
    const spray = new SolutionProj(10 * TILE, 30 * TILE + 8, 7, 0, 145, false, conv);
    for (let t = 0; t < 3; t++) spray.fixedUpdate(1 / 60, hooks);
    expect(hurt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ⑤ 圣/邪/血水 WaterSplashProj（:21853-21859 物理 + Kill :75610-75625）
// ---------------------------------------------------------------------------
describe('WaterSplashProj 三瓶水', () => {
  it('物理：前 10t 平飞，之后 vy+0.25/t、vx×0.99、终端 32（cs:21853-21859/:21970）', () => {
    const { hooks, conv } = projWorld();
    const p = new WaterSplashProj(30 * TILE, 10 * TILE, 9, -1, 69, 20, 3, conv);
    p.w = 14; p.h = 14;
    // 空场世界（无实心块、无敌）——直接驱动速度链：临时禁用撞块（世界全空即不撞）
    for (let t = 0; t < 9; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.vy).toBeCloseTo(-1, 5);   // 9t 内无重力
    p.fixedUpdate(1 / 60, hooks);      // 第 10t（ai0=10）：vy += 0.25
    expect(p.vy).toBeCloseTo(-1 + 0.25, 5);
    const vx0 = p.vx;
    p.fixedUpdate(1 / 60, hooks);
    expect(p.vx).toBeCloseTo(vx0 * 0.99, 5);
  });
  it('圣水 69 Kill → 神圣 conv2：泥土 2 → 神圣草 109，弹心 size4 菱形', () => {
    const { st, hooks, conv } = projWorld();
    for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
      st.setTileSilent(30 + dx, 29 + dy, S(2));
      st.setTileSilent(30 + dx, 30 + dy, S(2));
    }
    // 落点上方悬空、下方实心：弹心 (30.5, 30.5) 格 → 撞 31 行
    const p = new WaterSplashProj(30 * TILE + 1, 29 * TILE + 1, 0, 1, 69, 20, 3, conv);
    let t = 0;
    while (!p.dead && t++ < 60) p.fixedUpdate(1 / 60, hooks);
    expect(p.dead).toBe(true);
    // 弹心格 j = floor(cy/TILE)：y≈29 格 + 半盒 → 命中行
    let conv109 = 0;
    for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
      if (sheetOf(st.type[st.idx(30 + dx, 29 + dy)]) === 109) conv109++;
    }
    expect(conv109).toBeGreaterThan(20);   // size4 菱形覆盖 61 格
  });
  it('邪水 70 → 腐化 conv1；血水 621 → 猩红 conv4（cs:75617-75624）', () => {
    const { st, hooks, conv } = projWorld();
    // 弹心落在地板上方空格——转换靠 size4 菱形覆盖下方地板格（cs:75612 弹心语义）
    st.setTileSilent(30, 31, S(2));
    const unholy = new WaterSplashProj(30 * TILE + 1, 30 * TILE + 1, 0, 1, 70, 20, 3, conv);
    let t = 0;
    while (!unholy.dead && t++ < 60) unholy.fixedUpdate(1 / 60, hooks);
    expect(unholy.dead).toBe(true);
    expect(sheetOf(st.type[st.idx(30, 31)])).toBe(23);   // 地板泥 → 腐化草
    st.setTileSilent(22, 31, S(2));
    const blood = new WaterSplashProj(22 * TILE + 1, 30 * TILE + 1, 0, 1, 621, 20, 3, conv);
    t = 0;
    while (!blood.dead && t++ < 60) blood.fixedUpdate(1 / 60, hooks);
    expect(blood.dead).toBe(true);
    expect(sheetOf(st.type[st.idx(22, 31)])).toBe(199);  // 地板泥 → 猩红草
  });
  it('命中敌 → 伤害 + Kill 转换（penetrate 1）', () => {
    const { st, hooks, conv } = projWorld();
    const hurt = vi.fn((dmg: number, _kb: number) => true);   // 原版 hurt(dmg,kb) 双参——mock.calls 元组含 kb
    (hooks.enemies as unknown as () => unknown[]) = () => [{
      x: 30 * TILE, y: 30 * TILE, w: 16, h: 16, dead: false, cx: 30 * TILE + 8, cy: 30 * TILE + 8,
      hurt,
      def: {}, vanillaId: 3, ai1: 0,
    }];
    st.setTileSilent(30, 31, S(2));   // 地板（弹道格留空——撞块先于敌命中）
    const p = new WaterSplashProj(29 * TILE + 8, 30 * TILE, 3, 0, 69, 20, 3, conv);
    let t = 0;
    while (!p.dead && t++ < 30) p.fixedUpdate(1 / 60, hooks);
    expect(hurt).toHaveBeenCalled();
    const [dmg, kb] = hurt.mock.calls[0];
    // ★G37-A（D6,2026-10-31）改判史：69/70/621 敌臂补 DV :12970 逐靶掷（BJ729-A
    //  登记债清偿）→ 旧平值钉 20 改 31 档 DV 域锁（bj735a 判例形,luck=0 单掷域）。
    const dvDomainSol = new Set<number>();
    for (let i = 0; i < 31; i++) dvDomainSol.add(damageVarRoll(20, 0, () => i / 31));
    expect(dvDomainSol.has(dmg)).toBe(true);
    expect(kb).toBe(3);   // Math.sign(vx)>0 → +kb
    expect(p.dead).toBe(true);
    expect(sheetOf(st.type[st.idx(30, 31)])).toBe(109);   // Kill 转换照跑（菱形盖地板）
  });
});

// ---------------------------------------------------------------------------
// ⑥ PickAmmo 溶液加法链 + 消耗门 + useAmmo 门（Player.cs:52645-52647/:52739/:52815）
// ---------------------------------------------------------------------------
describe('PickAmmo 溶液链与消耗门', () => {
  it('resolveAmmoProjId：溶液族加法（发射器 145 + 弹药 shoot,cs:52645-52647）', () => {
    expect(resolveAmmoProjId(779, 780, 780, 145, 0)).toBe(145);    // 绿 → 纯净
    expect(resolveAmmoProjId(779, 781, 780, 145, 1)).toBe(146);    // 蓝 → 神圣
    expect(resolveAmmoProjId(779, 782, 780, 145, 2)).toBe(147);    // 紫 → 腐化
    expect(resolveAmmoProjId(779, 783, 780, 145, 3)).toBe(148);    // 深蓝 → 蘑菇
    expect(resolveAmmoProjId(779, 784, 780, 145, 4)).toBe(149);    // 红 → 猩红
    expect(resolveAmmoProjId(5134, 5392, 780, 145, 870)).toBe(1015); // 黄 → 沙
    expect(resolveAmmoProjId(5134, 5393, 780, 145, 871)).toBe(1016); // 白 → 雪
    expect(resolveAmmoProjId(5134, 5394, 780, 145, 872)).toBe(1017); // 棕 → 泥
  });
  it('数据面：779/5134 useAmmo=780；1.4.4 三溶液 DefaultToSolution 回填（Item.cs:42744-42752）', () => {
    expect(itemCombat(779)).toMatchObject({ useAmmo: 780, shoot: 145, useTime: 5, useAnimation: 30, shootSpeed: 7 });
    expect(itemCombat(5134)).toMatchObject({ useAmmo: 780, shoot: 145, shootSpeed: 11 });
    expect(itemCombat(5392)).toMatchObject({ shoot: 870, ammo: 780, consumable: true });
    expect(itemCombat(5393)).toMatchObject({ shoot: 871, ammo: 780, consumable: true });
    expect(itemCombat(5394)).toMatchObject({ shoot: 872, ammo: 780, consumable: true });
    for (const vid of [780, 781, 782, 783, 784, 5392, 5393, 5394]) {
      expect(itemCombat(vid)?.ammo).toBe(780);
    }
  });
  it('消耗门 :52815：每 useAnimation 轮仅前段扣（30/5 → 前两发扣、其余免）', () => {
    const id = 7;
    // 首发无 swing → 扣
    expect(solutionConsumesThisShot(779, 5, null, id)).toBe(true);
    // 动画首轮（t=dur-5=26 ≥ 26）→ 扣；后续 21/16/6 → 免
    const dur = 31;
    expect(solutionConsumesThisShot(779, 5, { item: id, t: dur, dur }, id)).toBe(true);
    expect(solutionConsumesThisShot(779, 5, { item: id, t: 26, dur }, id)).toBe(true);
    expect(solutionConsumesThisShot(779, 5, { item: id, t: 21, dur }, id)).toBe(false);
    expect(solutionConsumesThisShot(779, 5, { item: id, t: 16, dur }, id)).toBe(false);
    expect(solutionConsumesThisShot(779, 5, { item: id, t: 6, dur }, id)).toBe(false);
    // 异物品 swing（切枪）→ 视作首发扣
    expect(solutionConsumesThisShot(779, 5, { item: id + 1, t: 6, dur }, id)).toBe(true);
  });
  it('消耗门 :52739：Terraformer 5134 三分免（Next(3)==0 免,复审 R1 P1 修正）', () => {
    const id = 7;
    const swing = { item: id, t: 26, dur: 31 };
    const rndFree = () => 0;      // Next(3)=0 → 免耗（原版 :52739-52742 flag2）
    const rndTrue = () => 0.5;    // Next(3)=1 → 不免 → 走动画门（26≥26 扣）
    expect(solutionConsumesThisShot(5134, 5, swing, id, rndFree)).toBe(false);
    expect(solutionConsumesThisShot(5134, 5, swing, id, rndTrue)).toBe(true);
    expect(solutionConsumesThisShot(5134, 5, null, id, rndFree)).toBe(false);
  });
  it('useAmmo 门：背包无 ammo==780 的物品 → 扫描不命中（不发射）', () => {
    // Game 远程分派弹药扫描语义（ammoOf(d)===useAmmo）：箭 40 / 子弹族 / 手里剑
    // 等非溶液物品 ammo ≠ 780 → 拿 Clentaminator 不装溶液不发射（静默,原版 canShoot=false）
    const ammoOfVid = (vid: number) => itemCombat(vid)?.ammo ?? 0;
    expect(ammoOfVid(47)).not.toBe(780);   // 手里剑（投掷物,无 ammo）
    expect(ammoOfVid(158)).not.toBe(780);  // Musketeer 类子弹族外样本（老式枪弹=97 族）
    // 溶液族全部命中 780（含 1.4.4 三溶液回填）
    for (const vid of [780, 781, 782, 783, 784, 5392, 5393, 5394]) {
      expect(ammoOfVid(vid)).toBe(780);
    }
    // 空背包两段扫描（54-57 → 0-53）：无溶液 → 无弹型解析（resolveAmmoProjId 不可达）
    const slots: Array<{ vid: number }> = [{ vid: 47 }, { vid: 158 }, { vid: 167 }];
    expect(slots.some((s) => ammoOfVid(s.vid) === 780)).toBe(false);
  });
});
