// ★BJ749-A（issue#38「NPC 一致性审计 23 项」生成（Spawn）域 7 项 + 重锚顺刀 1 项）
// 行为锁（VanillaSpawner 直调合成夹具）+ Game.ts 结构锁 + 变异恰红（withMutation）。
//
// 逐项判语（锚 = Terarria1457 反编译；issue 行号系 1.4.5.8 第三方仓已重锚）：
//  ① Boss 存活停刷（高）：Game.ts `if (this.boss) return` 摘除——原版 SpawnNPC
//    （NPC.cs:290-302）无 boss 门，只按 CanSpawnEnemiesNear（:345-369：死亡/旅程
//    滑杆/月总核心 398 距离门 MoonLordFightingDistance=4500 :6036）拦截；WoF 战
//    地狱 ×0.3/×3（:666-670）补臂。结构锁 S1 + 行为锁 A1。
//  ② 城镇计数框 85/60→120/75 格（SceneMetrics.cs:18 TownNPCRectSize=(1920,1200)×2，
//    ScanNPCPositions :734-749）+ 只计 nPC.townNPC（:746）——bound/453 不入数。
//    结构锁 S2。
//  ③ 刷怪区域/深度分带用相机窗 → 恒 1920×1200 常量（NPC.cs:6791/6793；GetSpawnArea
//    :932-967；MaxWorldViewSize Main.cs:758）。结构锁 S3/S5。
//  ④ 水蜡烛+和平蜡烛互斥（NPC.cs:728-740）。行为锁 A3。
//  ⑤ 专家大城镇 1/30 敌怪轮（NPC.cs:916-919）。行为锁 A4。
//  ⑥ 天空支 openAir 自造门摘除（NPC.cs:981-989 无墙判定）。行为锁 A5。
//  ⑦ 史莱姆雨全世界 slots 求和 → nearbyActiveNPCs 盒内快照（CheckActive
//    NPC.cs:78705-78727 逐玩家记账）。结构锁 S4/S6。
//  ⑧（重锚顺刀）tresspassingDualDungeon getSpawnRate ×0.6/×1.3 臂（NPC.cs:661-665）
//    ——trespassDual 注入早已在位但本臂整缺。行为锁 A2。
//
// 变异恰红只打 VanillaSpawner.ts（本刀独占域）：Game.ts 有并行会话（BJ750 入住域）
// 在写，withMutation 的「捕 pristine→写变异→还原」窗会把并行落盘编辑整段回退
// （并行回写战争判例）——Game.ts 面以只读结构锁守卫，登记于 /tmp/recon/bj749a-ledger.md。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { World } from '../src/world/World';
import { VanillaSpawner } from '../src/world/spawn/VanillaSpawner';
import { RNG } from '../src/core/rng';
import { withMutation } from './mutation-guard';

const GAME = join(process.cwd(), 'src', 'core', 'Game.ts');
const SPAWNER = join(process.cwd(), 'src', 'world', 'spawn', 'VanillaSpawner.ts');

/** 源块抽取（起始标记 → 结束标记前） */
function block(src: string, startMark: string, endMark: string): string {
  const s = src.indexOf(startMark);
  expect(s, `块起点缺失: ${startMark}`).toBeGreaterThanOrEqual(0);
  const e = src.indexOf(endMark, s);
  expect(e, `块终点缺失: ${endMark}`).toBeGreaterThan(s);
  return src.slice(s, e);
}

// ===================== 夹具 =====================
/** 400×800 经典世界：groundLevel=60 / rockLevel=120（二阶梯中点 90）。
 *  SURFACE_Y=1280（ty=80：地表带 <2160px、二阶梯不进）；
 *  HELL_Y=10000（> (800-200)×16=9600 = UnderworldLayer×16）。 */
function makeWorld(difficulty = 0): World {
  const w = new World(400, 800, 42, 'bj749a');
  w.groundLevel = 60;
  w.rockLevel = 120;
  w.difficulty = difficulty;
  w.clock.timeOfDay = 12 / 24;   // 白天（深度链直读 w.clock.isDay）
  return w;
}
const HELL_Y = 10000;
const SURFACE_Y = 1280;
const stubRng = (sp: VanillaSpawner, v: number): void => {
  (sp as unknown as { rateRng: () => number }).rateRng = () => v;
};

// ===================== A. 行为锁（VanillaSpawner 直调） =====================
describe('BJ749-A 行为锁：getSpawnRate 修正臂', () => {
  it('A1 ① WoF 战地狱压制 ×0.3/×3（NPC.cs:666-670，序=双地牢臂后/nearby 阶梯前）', () => {
    const w = makeWorld();
    const sp = new VanillaSpawner(w);
    stubRng(sp, 0.99);
    // 地狱基线：600 →（地狱 max×2=10）→ 阶梯1 ×0.6=360 → 阶梯2（625>90）×0.7
    //  =⌊251.999…⌋=251（float64 截断,原版 (float)×0.7f 同向截断——本端口全链 float64
    //  既有约定,锚值以实现为准）
    const off = sp.getSpawnRate(HELL_Y, 0, false, 1200, 100 * 16);
    expect(off).toEqual({ spawnRate: 251, maxSpawns: 10 });
    // WoF 活体：max=⌊10×0.3⌋=3、rate=600×3=1800 → 阶梯1 ×0.6=1080 → 阶梯2 ×0.7=756
    (sp as unknown as { wofActive: boolean }).wofActive = true;
    const on = sp.getSpawnRate(HELL_Y, 0, false, 1200, 100 * 16);
    expect(on).toEqual({ spawnRate: 756, maxSpawns: 3 });
    // 地表（Y ≤ UnderworldLayer×16）不吃压制——只有地狱带
    const surf = sp.getSpawnRate(SURFACE_Y, 0, false, 1200, 100 * 16);
    expect(surf).toEqual({ spawnRate: 360, maxSpawns: 5 });
  });

  it('A2 ⑧ 双地牢越界 ×0.6/×1.3（NPC.cs:661-665，重锚补臂）', () => {
    const w = makeWorld();
    const sp = new VanillaSpawner(w);
    stubRng(sp, 0.99);
    (sp as unknown as { trespassDual: boolean }).trespassDual = true;
    // 地狱：max=10 → ×1.3=13；rate 600 → ×0.6=360 → 阶梯1 216 → 阶梯2 151
    const r = sp.getSpawnRate(HELL_Y, 0, false, 1200, 100 * 16);
    expect(r).toEqual({ spawnRate: 151, maxSpawns: 13 });
  });

  it('A3 ④ 水/和平蜡烛互斥——同在时双双不生效（NPC.cs:728-740）', () => {
    const w = makeWorld();
    const sp = new VanillaSpawner(w);
    stubRng(sp, 0.99);
    const g = (water: boolean, peace: boolean, py = SURFACE_Y) =>
      sp.getSpawnRate(py, 0, water, 1200, 100 * 16, peace);
    // 地表基线 360/5（阶梯1 ×0.6；ty=80<90 二阶梯不进）
    expect(g(false, false)).toEqual({ spawnRate: 360, maxSpawns: 5 });
    expect(g(true, false)).toEqual({ spawnRate: 270, maxSpawns: 7 });  // 仅水 ×0.75/×1.5
    expect(g(true, true)).toEqual({ spawnRate: 360, maxSpawns: 5 });   // ★双烛：两臂全跳过
    expect(g(false, true)).toEqual({ spawnRate: 468, maxSpawns: 3 });  // 仅和平 ×1.3/×0.7
    // 天空层（ty=15 < groundLevel×0.35=21）水蜡烛再 ×0.5 是【独立 if】（:737-740）
    // ——和平蜡烛在场不豁免（基线 360）
    expect(g(true, true, 15 * 16)).toEqual({ spawnRate: 180, maxSpawns: 5 });
    expect(g(true, false, 15 * 16)).toEqual({ spawnRate: 135, maxSpawns: 7 });
  });

  it('A4 ⑤ 专家大城镇 1/30 敌怪轮（NPC.cs:916-919 `!expertMode || Next(30)!=0`）', () => {
    // 经典：恒友好（掷骰短路不消费）
    const spC = new VanillaSpawner(makeWorld(0));
    stubRng(spC, 0.02);
    const rC = spC.getSpawnRate(SURFACE_Y, 0, false, 1200, 100 * 16, false, false, false, false, 3, true);
    expect(rC).toEqual({ spawnRate: 360, maxSpawns: 3 });               // ×0.6 无条件
    expect((spC as unknown as { spawnFriendlyCycle: boolean }).spawnFriendlyCycle).toBe(true);
    // 专家：29/30 友好、1/30 敌怪轮
    const spE = new VanillaSpawner(makeWorld(1));
    stubRng(spE, 0.02);   // 0.02 < 1/30 → 敌怪轮
    const rE = spE.getSpawnRate(SURFACE_Y, 0, false, 1200, 100 * 16, false, false, false, false, 3, true);
    expect(rE).toEqual({ spawnRate: 360, maxSpawns: 3 });
    expect((spE as unknown as { spawnFriendlyCycle: boolean }).spawnFriendlyCycle).toBe(false);
    stubRng(spE, 0.999);  // ≥ 1/30 → 友好
    spE.getSpawnRate(SURFACE_Y, 0, false, 1200, 100 * 16, false, false, false, false, 3, true);
    expect((spE as unknown as { spawnFriendlyCycle: boolean }).spawnFriendlyCycle).toBe(true);
  });
});

describe('BJ749-A 行为锁：findSpawnTile 天空支', () => {
  it('A5 ⑥ 天空支无墙判定（NPC.cs:981-989）——上方带墙候选照样出鸟妖', () => {
    const w = new World(400, 800, 42, 'bj749a-sky');
    w.groundLevel = 100;   // 天空带 ty<35；第二带 ty<45 需 hardMode（false 不进）
    w.clock.timeOfDay = 12 / 24;
    const st = w.store;
    // 玩家 (350,80)：spawnArea 纵 [28,132]、横 [266,397]（x>0.55×400=220 全带外）；
    // 天空带候选 ty∈[28,34]（hasTileSpawnSpace 需 ty≥3），safeArea |ty-80|≥39 不拒。
    // 墙铺 rows[0..33]×cols[250..398]（wall 7 = 自然石墙 ∉ WALL_HOUSE——循环头房屋墙
    // 守卫放行；旧 openAir 判据 wall[ty-1]/wall[ty-2] 全命中 → 天空支被整段压制）
    for (let x = 250; x <= 398; x++) {
      for (let y = 0; y <= 33; y++) st.wall[st.idx(x, y)] = 7;
    }
    const sp = new VanillaSpawner(w);
    sp.setPlayerFlags(false, false);
    let skySpawns = 0;
    for (let k = 0; k < 40; k++) {
      const r = sp.spawn(350 * 16 + 8, 80 * 16, new RNG(k * 7919 + 13), 60, 37.5);
      if (r) skySpawns++;
    }
    // 原版语义：墙上方天空候选照刷（鸟妖 48 兜底 / 686 1/25 掷）——世界无任何
    // 实心格，非天空候选的地面扫描全部落空 → 全部产出都是天空支
    expect(skySpawns).toBeGreaterThan(10);
  });
});

// ===================== S. 结构锁（Game.ts 只读；变异面见节首注） =====================
describe('BJ749-A 结构锁：Game.ts 生成域接线', () => {
  const gameSrc = (): string => readFileSync(GAME, 'utf8');

  it('S1 ① boss 门摘除 + CanSpawnEnemiesNear 月总距离门（NPC.cs:345-369/:6036）', () => {
    const fn = block(gameSrc(), 'private trySpawnEnemy()', 'private townNpcSpawnAllowed(');
    expect(fn).not.toContain('if (this.boss) return;');          // 自造停刷门复辟即红
    expect(fn).toContain('vanillaId === 398');
    expect(fn).toContain('Math.hypot(en.cx - p.cx, en.cy - p.cy) < 4500');
  });

  it('S2 ② 城镇计数框 ±120×±75 格 + bound/453 不入数（SceneMetrics.cs:18/:746）', () => {
    const fn = block(gameSrc(), 'private trySpawnEnemy()', 'private townNpcSpawnAllowed(');
    expect(fn).toContain('< 120 * TILE');
    expect(fn).toContain('< 75 * TILE');
    expect(fn).not.toContain('85 * TILE');
    expect(fn).toContain('!tn.bound');
    expect(fn).toContain("tn.npcKey !== 'skeleton_merchant'");
  });

  it('S3 ③ 深度分带/刷怪区域常量化（sHeight=1200 / 半屏 60×37.5）', () => {
    const fn = block(gameSrc(), 'private trySpawnEnemy()', 'private townNpcSpawnAllowed(');
    expect(fn).toContain('const sHeightPx = 1200;');
    expect(fn).toContain('const viewHalfW = 1920 / 2 / TILE;');
    expect(fn).toContain('const viewHalfH = 1200 / 2 / TILE;');
    expect(fn).not.toContain('this.camera.viewH / (this.camera.zoom || 1)');
    // 入侵深度门同源常量化（ShouldSpawnInvasionEnemies NPC.cs:447 sHeight）
    expect(fn).toContain('shouldSpawnInvasionEnemies(w, p.cx, p.cy, 1200,');
  });

  it('S4 ⑦ 史莱姆雨盒内快照 + MaxWorldViewSize 常量窗（Main.cs:758）', () => {
    const src = gameSrc();
    const fn = block(src, 'if (this.world.weather.slimeRain) {', 'this.trySpawnEnemy();');
    expect(fn).toContain('this.nearbyActiveNpcSlots()');
    expect(fn).toContain('const vw = 1920, vh = 1200;');
    expect(fn).not.toContain('this.camera.viewW');
    // 旧全世界求和面（远处怪群跨屏压制）复辟即红
    expect(fn).not.toContain("reduce((s, e) => s + ((e as Enemy).vanilla?.npcSlots ?? 1), 0)");
  });

  it('S5 ③ Faelings 生成窗常量化（SpawnFaelings NPC.cs:5969 经 GetSpawnArea）', () => {
    const src = gameSrc();
    const fn = block(src, '// ---- [NPC域-微光之灵]', 'this._wasInShimmerZone = !!this.scene?.zoneShimmer;');
    expect(fn).toContain('const viewHalfW = 1920 / 2 / TILE;');
    expect(fn).toContain('const viewHalfH = 1200 / 2 / TILE;');
    expect(fn).not.toContain('this.camera.viewW');
  });

  it('S6 ① wofActive 注入 + ⑦ nearbyActiveNpcSlots 单源（bound=1/453=7 臂）', () => {
    const src = gameSrc();
    expect(src).toContain('this.vanillaSpawner.wofActive = this.entities.enemies.some(');
    const fn = block(src, 'private nearbyActiveNpcSlots(): number', 'private trySpawnEnemy()');
    expect(fn).toContain("tn.npcKey === 'skeleton_merchant' ? 7 : 1");
    expect(fn).toContain('CHECK_ACTIVE_HALF_X');
  });
});

// ===================== M. 变异恰红（withMutation，仅 VanillaSpawner.ts） =====================
describe.skipIf(process.env.SW_BJ749_MUT)('BJ749-A 变异恰红', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj749a-spawn-domain.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, SW_BJ749_MUT: '1' },
    });
  const mutate = (trigger: string, replacement: string, filter: string): void => {
    withMutation(SPAWNER, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, { label: `BJ749-A ${filter}` });
  };

  it('M1 ① WoF 压制臂摘除 → A1 红', () => {
    mutate(
      'if (this.wofActive && playerYpx > underworldY) {\n      maxSpawns = Math.floor(maxSpawns * 0.3);\n      spawnRate *= 3;\n    }',
      'if (this.wofActive && playerYpx > underworldY) {\n      /* ★BJ749 M1 变异：压制臂摘除 */\n    }',
      'A1 ① WoF 战地狱压制',
    );
  });

  it('M2 ④ 蜡烛互斥摘除（!peaceCandle→true）→ A3 红', () => {
    mutate(
      'if (waterCandle) {\n      if (!peaceCandle) {\n        spawnRate = Math.floor(spawnRate * 0.75);',
      'if (waterCandle) {\n      if (true) {\n        spawnRate = Math.floor(spawnRate * 0.75); // ★BJ749 M2 变异',
      'A3 ④ 水/和平蜡烛互斥',
    );
  });

  it('M3 ⑤ 专家 1/30 摘除（恒 friendly）→ A4 红', () => {
    mutate(
      'if (!mainExpertMode(w) || this.rateRng() >= 1 / 30) this.friendlyHit();',
      'this.friendlyHit(); // ★BJ749 M3 变异：专家例外轮摘除',
      'A4 ⑤ 专家大城镇 1/30',
    );
  });

  it('M4 ⑥ openAir 自造门复辟 → A5 红', () => {
    mutate(
      'if (!this.invaders && !this.spawnFriendlyCycle && ty < this.world.groundLevel * 0.35\n        && (tx < st.w * 0.45 || tx > st.w * 0.55 || this.world.flags.hardMode)) {',
      'const openAirM = st.wall[st.idx(tx, ty - 1)] === 0 && st.wall[st.idx(tx, ty - 2)] === 0; // ★BJ749 M4 变异\n      if (!this.invaders && !this.spawnFriendlyCycle && ty < this.world.groundLevel * 0.35 && openAirM\n        && (tx < st.w * 0.45 || tx > st.w * 0.55 || this.world.flags.hardMode)) {',
      'A5 ⑥ 天空支无墙判定',
    );
  });

  it('M5 ⑧ 双地牢压制臂摘除 → A2 红', () => {
    mutate(
      'if (this.trespassDual) {\n      spawnRate = Math.floor(spawnRate * 0.6);\n      maxSpawns = Math.floor(maxSpawns * 1.3);\n    }',
      'if (this.trespassDual) {\n      /* ★BJ749 M5 变异：双地牢压制臂摘除 */\n    }',
      'A2 ⑧ 双地牢越界',
    );
  });
});
