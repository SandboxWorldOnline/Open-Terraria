// SW-BJ37 2026-09-08：NPC 刷进墙里（用户实报游商 Bohemast 嵌岩石/黑暗区）——
// 生成落位有效性全链回归。四谓词语义族谱（1457 反编译定谳）：
//   · CanSpawnInTile（NPC.cs:5431）  = nactive && tileSolid            → 平台九件套=阻
//   · FindSpawnTile 落面（:977/:991）= nactive && tileSolid            → 平台=终止扫描（站平台顶）
//   · Collision.SolidTiles(:3494)   = active && !inActive && tileSolid && !tileSolidTop
//                                                                      → 平台=不阻
//   · WorldGen.SolidTile(:70650)    = 上式再加 !halfBrick && slope==0   → 平台/半砖/坡面=不阻
//   · SpawnTravelNPC 自由门(:5231)  = !active || !tileSolid || tileSolidTop → 平台=自由
// 修复面：
//   ①VanillaSpawner.hasTileSpawnSpace 旧裸 isSolid 漏平台九件套（原版 tileSolid[19]=true,
//     Main.cs:8031-8032）→ 可刷进平台格；+ InWorld(Rectangle) 边界逐字
//   ②FindSpawnTile 候选起点/落地面同谓词（旧裸 isSolid 穿平台 → 平台房地板下出生）
//   ③旅行商落位段 1:1 重写（WorldGen.cs:5188-5327）——旧 ±(30..80) 单列链无上方净空门
//     （实心体内 1-2 格窄缝整只嵌入=用户实报根因）+ Bottom 传 (ay+1)*TILE 嵌地 16px
//   ④骷髅商同款 +1 嵌地（NPC.cs:5009 落 spawnTileY*16 顶边）
import { describe, it, expect } from 'vitest';
// ★BJ743-A（R24 SEV-2）：src 读改 ESM import 形经 fs-guard-shim 守卫——字面
//   require('fs') 走 vite 注入原生 require,alias 不达=并行变异窗读盘竞态旁路面。
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import {
  VanillaSpawner, spawnTileSolid, solidTilesCell, worldSolidTile,
  vanillaTileSolidPure, VANILLA_TILE_SOLID_TOP,
} from '../src/world/spawn/VanillaSpawner';
import { TileStore } from '../src/world/TileStore';
import { RNG } from '../src/core/rng';
import { TILE_INTERNAL_BY_SHEET } from '../src/data/tiles';
import { TownNPC } from '../src/entities/TownNPC';

const SHEET = (id: number): number => { const t = TILE_INTERNAL_BY_SHEET.get(id); if (t === undefined) throw new Error(`sheet ${id} 未注册`); return t; };
const DIRT = SHEET(0), STONE = SHEET(1), PLATFORM = SHEET(19), TABLE = SHEET(14);

/** 合成世界：地面行 62 实心（x 10..149），上方全空，groundLevel=70 */
function embedWorld() {
  const w = new World(160, 90, 42, 'bj37-embed');
  w.groundLevel = 70; w.rockLevel = 80;
  const st = w.store;
  for (let x = 10; x < 150; x++) st.setTileSilent(x, 62, STONE);
  return { w, st };
}

function spawnerOf(w: World): { hasTileSpawnSpace(x: number, y: number): boolean } {
  const sp = new VanillaSpawner(w);
  sp.setPlayerFlags(false, false);
  return sp as unknown as { hasTileSpawnSpace(x: number, y: number): boolean };
}

describe('【SW-BJ37】tileSolid 消费四谓词族谱（平台语义互反定谳锁）', () => {
  it('spawnTileSolid = nactive&&tileSolid：平台九件套=阻、幽灵/致动=放（CanSpawnInTile :5433）', () => {
    const st = new TileStore(16, 16);
    st.setTileSilent(3, 3, STONE);
    st.setTileSilent(4, 3, PLATFORM);                 // 平台 19：原版 tileSolid[19]=true
    st.setTileSilent(5, 3, TABLE);                    // 桌 14：tileSolidTop 家具,tileSolid=false
    st.setTileSilent(6, 3, STONE);
    st.flags[st.idx(6, 3)] = 0;                       // 幽灵格（flags=0,type≠0）
    st.setTileSilent(7, 3, STONE);
    st.setWireSilent(7, 3, TileStore.WIRE_ACTUATED);  // 致动实心
    expect(spawnTileSolid(st, 3, 3)).toBe(true);
    expect(spawnTileSolid(st, 4, 3)).toBe(true);      // ★SW-BJ37 核心：平台=tileSolid 阻
    expect(spawnTileSolid(st, 5, 3)).toBe(false);     // 家具 solidTop 非实心
    expect(spawnTileSolid(st, 6, 3)).toBe(false);     // 幽灵格 nactive=false
    expect(spawnTileSolid(st, 7, 3)).toBe(false);     // 致动 nactive=false
    expect(spawnTileSolid(st, 8, 3)).toBe(false);     // 空气
  });

  it('solidTilesCell = active&&!inActive&&tileSolid&&!tileSolidTop：平台=【不】阻（Collision.cs:3494）', () => {
    const st = new TileStore(16, 16);
    st.setTileSilent(3, 3, STONE);
    st.setTileSilent(4, 3, PLATFORM);
    st.setTileSilent(5, 3, STONE);
    st.setWireSilent(5, 3, TileStore.WIRE_ACTUATED);  // 致动实心：active()纯位真→!inActive()=false
    expect(solidTilesCell(st, 3, 3)).toBe(true);
    expect(solidTilesCell(st, 4, 3)).toBe(false);     // ★tileSolidTop 排除——与 CanSpawnInTile 互反
    expect(solidTilesCell(st, 5, 3)).toBe(false);     // 致动
    expect(solidTilesCell(st, 6, 3)).toBe(false);
  });

  it('worldSolidTile = SolidTile(i,j)（:70650）：再加 !halfBrick && slope==0', () => {
    const st = new TileStore(16, 16);
    st.setTileSilent(3, 3, STONE);
    st.setTileSilent(4, 3, STONE);
    st.setHalfBrick(4, 3, true);
    st.setTileSilent(5, 3, STONE);
    st.setSlope(5, 3, 2);
    st.setTileSilent(6, 3, PLATFORM);
    expect(worldSolidTile(st, 3, 3)).toBe(true);
    expect(worldSolidTile(st, 4, 3)).toBe(false);     // 半砖
    expect(worldSolidTile(st, 5, 3)).toBe(false);     // 坡面
    expect(worldSolidTile(st, 6, 3)).toBe(false);     // 平台（solidTop 排除）
  });

  it('vanillaTileSolidPure = tileSolid 纯表（无 active/致动门,SpawnTravelNPC 自由门消费）', () => {
    expect(vanillaTileSolidPure(STONE)).toBe(true);
    expect(vanillaTileSolidPure(PLATFORM)).toBe(true);  // tileSolid[19]=true 纯表含平台
    expect(vanillaTileSolidPure(TABLE)).toBe(false);    // 桌 tileSolid=false
  });

  it('VANILLA_TILE_SOLID_TOP = 1457 Main.cs tileSolidTop 静态表 84 件（经 sheet 映射,结构锁）', () => {
    // 1457 Main.cs 赋值面全量（435-439 团队平台五色 :10126-10136 for 批量支）
    const sheets = [14, 16, 18, 19, 87, 88, 101, 114, 134, 239, 275, 276, 277, 278,
      279, 280, 281, 285, 286, 296, 297, 298, 299, 309, 310, 339, 358, 359, 361,
      362, 363, 364, 376, 380, 391, 392, 393, 394, 405, 413, 414, 427, 435, 436,
      437, 438, 439, 469, 532, 533, 538, 542, 544, 550, 551, 553, 554, 555, 556,
      558, 559, 582, 599, 600, 601, 602, 603, 604, 605, 606, 607, 608, 609, 610,
      611, 612, 619, 629, 632, 640, 643, 644, 645, 710];
    const registered = sheets.map((s) => TILE_INTERNAL_BY_SHEET.get(s)).filter((v): v is number => v !== undefined);
    expect(registered.length).toBeGreaterThan(0);
    for (const t of registered) expect(VANILLA_TILE_SOLID_TOP.has(t)).toBe(true);
    expect(VANILLA_TILE_SOLID_TOP.size).toBe(registered.length);   // 映射过滤后一一对应
    // 平台九件套（tileSolid∩tileSolidTop 可达成员,TouchDamage TILE_SOLID_TOP_FAMILY 同源）
    for (const s of [19, 239, 380, 427, 435, 436, 437, 438, 439]) {
      expect(VANILLA_TILE_SOLID_TOP.has(SHEET(s))).toBe(true);
    }
    // 非成员：实心型（0/1/2）与未赋值型不入表
    expect(VANILLA_TILE_SOLID_TOP.has(STONE)).toBe(false);
    expect(VANILLA_TILE_SOLID_TOP.has(DIRT)).toBe(false);
    expect(VANILLA_TILE_SOLID_TOP.has(SHEET(2))).toBe(false);
  });
});

describe('【SW-BJ37】HasTileSpawnSpace 净空矩阵（NPC.cs:5406-5442,spawnSpace 2×3 固定窗）', () => {
  it('平地净空足=过；净空窗内悬空实心/岩浆=拒', () => {
    const { w, st } = embedWorld();
    const sp = spawnerOf(w);
    expect(sp.hasTileSpawnSpace(80, 62)).toBe(true);          // 窗=行 59,60,61 全空
    st.setTileSilent(80, 60, STONE);                          // 悬空块压落脚面上方 2 格
    expect(sp.hasTileSpawnSpace(80, 62)).toBe(false);         // 窗含行 60
    expect(sp.hasTileSpawnSpace(79, 62)).toBe(true);          // 邻列（窗只查列 79,80?——列 tx-1,tx=78,79）
    st.setTileSilent(80, 60, 0);
    st.setLiquid(80, 61, 255, 2);                             // 岩浆在窗内（anyLava :5437）
    expect(sp.hasTileSpawnSpace(80, 62)).toBe(false);
    st.setLiquid(80, 61, 255, 1);                             // 水不拒（原版只拒 lava）
    expect(sp.hasTileSpawnSpace(80, 62)).toBe(true);
  });

  it('★净空窗内平台格=拒（旧裸 isSolid 漏判 → 刷进平台格）', () => {
    const { w, st } = embedWorld();
    const sp = spawnerOf(w);
    st.setTileSilent(80, 60, PLATFORM);
    expect(sp.hasTileSpawnSpace(80, 62)).toBe(false);         // tileSolid[19] 阻（窗行 59-61 含 60）
    st.setTileSilent(80, 60, 0);
    st.setTileSilent(80, 56, PLATFORM);                       // 平台在窗上方（行 56 < 59）
    expect(sp.hasTileSpawnSpace(80, 62)).toBe(true);
  });

  it('窗不含地面行本身（NPC 站地面顶）；墙不阻（原版净空不查墙）', () => {
    const { w, st } = embedWorld();
    const sp = spawnerOf(w);
    expect(sp.hasTileSpawnSpace(80, 62)).toBe(true);          // 行 62=地面,不在窗（59-61）
    for (let y = 56; y < 62; y++) st.wall[st.idx(80, y)] = 1; // 自然墙（墙后空间）
    expect(sp.hasTileSpawnSpace(80, 62)).toBe(true);          // CanSpawnInTile 不读 wall
  });

  it('WorldGen.InWorld(Rectangle) 边界逐字（X+W>=w / Y+H>=h / X<0 / Y<0）', () => {
    const { w } = embedWorld();
    const sp = spawnerOf(w);
    expect(sp.hasTileSpawnSpace(159, 40)).toBe(false);        // X+W=160>=w（tx=w-1 拒,旧版放）
    expect(sp.hasTileSpawnSpace(158, 40)).toBe(true);         // X+W=159<w ✓
    expect(sp.hasTileSpawnSpace(0, 40)).toBe(false);          // X=-1<0
    expect(sp.hasTileSpawnSpace(1, 40)).toBe(true);
    expect(sp.hasTileSpawnSpace(80, 2)).toBe(false);          // Y=-1<0（ty-3<0）
    expect(sp.hasTileSpawnSpace(80, 3)).toBe(true);           // 行 0,1,2
    expect(sp.hasTileSpawnSpace(80, 90)).toBe(false);         // Y+H=90>=h
  });
});

describe('【SW-BJ37】FindSpawnTile 落地面平台支（原版站平台顶,非穿平台）', () => {
  /** 选点行为面：直调 findSpawnTile（免池/roll 门,纯落点几何）。
   *  全图上方铺自然墙(dirt wall=1)压 skyMob openAir 门（NPC.cs:981 的
   *  `wall==0` 判据——有墙即不露天）；玩家格 (110,35) → 采样窗 tx∈[77,143]、ty∈[16,54] */
  function seedWorld(hook: (st: TileStore, w: World) => void, name: string) {
    const w = new World(220, 90, 42, name);
    w.groundLevel = 30; w.rockLevel = 80;
    const st = w.store;
    for (let x = 0; x < 220; x++) for (let y = 0; y < 60; y++) st.wall[st.idx(x, y)] = 3;
    hook(st, w);
    return { w, st };
  }

  function rollFind(w: World, rounds: number): number[] {
    const sp = new VanillaSpawner(w);
    sp.setPlayerFlags(false, false);
    const vs = sp as unknown as {
      findSpawnTile(rng: RNG, vw: number, vh: number): boolean;
      pX: number; pY: number; spawnTileY: number;
    };
    vs.pX = 110; vs.pY = 35;
    const hits: number[] = [];
    for (let k = 0; k < rounds; k++) {
      vs.spawnTileY = -1;
      if (vs.findSpawnTile(new RNG(k * 7919 + 13), 24, 14)) hits.push(vs.spawnTileY);
    }
    return hits;
  }

  it('平台行=落地面：扫描止于平台（tileSolid[19]），落脚格=平台行', () => {
    const { w } = seedWorld((st) => {
      for (let x = 30; x < 190; x++) st.setTileSilent(x, 40, PLATFORM);
    }, 'bj37-platform');
    const hits = rollFind(w, 600);
    expect(hits.length).toBeGreaterThan(0);
    for (const sy of hits) expect(sy).toBe(40);   // 站平台顶（旧裸 isSolid 会穿到更深处）
  });

  it('对照：平台下方的实心地面=合法落点（候选点在平台下时扫描停该实心）', () => {
    const { w } = seedWorld((st) => {
      for (let x = 30; x < 190; x++) { st.setTileSilent(x, 40, PLATFORM); st.setTileSilent(x, 45, STONE); }
    }, 'bj37-under');
    const hits = rollFind(w, 600);
    expect(hits.length).toBeGreaterThan(0);
    // 平台上（40,原版扫描止于平台）与平台下（45,候选点恰在平台下方）两解均合法,
    // 落点行必属这两者——★旧裸 isSolid 无 40 解（穿平台）,40 出现即新语义判据
    expect(hits.filter((sy) => sy === 40).length).toBeGreaterThan(0);
    for (const sy of hits) expect(sy === 40 || sy === 45).toBe(true);
  });

  it('★净空窗内平台格：落点=平台顶行（旧码穿平台 → 身体与平台格重叠=刷进平台）', () => {
    // 平台 44 悬在实心地面 45 上：首个实心=44（tileSolid[19]）→ 站 44 顶;
    // 旧裸 isSolid 穿 44 → 停 45 → 窗 42,43,44（旧码不判平台）→ NPC 占 42-44,
    // 与 44 平台格重叠 = 刷进平台（用户可见的"嵌在东西里"）
    const { w } = seedWorld((st) => {
      for (let x = 30; x < 190; x++) { st.setTileSilent(x, 44, PLATFORM); st.setTileSilent(x, 45, STONE); }
    }, 'bj37-overlap');
    const hits = rollFind(w, 600);
    expect(hits.length).toBeGreaterThan(0);
    for (const sy of hits) expect(sy).toBe(44);
  });
});

describe('【SW-BJ37】旅行商/骷髅商 Bottom 落位几何（原版=地面格顶边 spawnTileY*16）', () => {
  it('TownNPC 构造 y 参 = Bottom（TownNPC.ts y-h 语义,NewNPC NPC.cs:81594 同构）', () => {
    const tm = new TownNPC('travelling_merchant', 50 * 16, 40 * 16);
    expect(tm.vanillaId).toBe(368);
    expect(tm.y + tm.h).toBe(40 * 16);        // bottom = y 参（原版 :5314 NewNPC(num7*16,num8*16)）
    expect(tm.x).toBe(50 * 16);               // 原版 X 不加 8：身体跨 sx-1/sx 两列
    const sm = new TownNPC('skeleton_merchant', 100 * 16, 40 * 16);
    expect(sm.vanillaId).toBe(453);
    expect(sm.y + sm.h).toBe(40 * 16);        // 骷髅商同语义（NPC.cs:5009 落 spawnTileY*16）
  });

  it('结构锁：旅行商落位段按 SpawnTravelNPC 1:1（防回退到 ±(30..80) 单列链/+1 嵌地）', () => {
    const src = readFileSync('src/core/Game.ts', 'utf8');   // ★BJ743-A:ESM 形经守卫
    expect(src).toContain("new TownNPC('travelling_merchant', sx * TILE, sy * TILE)");
    expect(src).toContain('anchor.home!.y + 1');                    // homeTileY 口径=脚下地面格
    expect(src).toContain('worldSolidTile(st, x, y) || VANILLA_TILE_SOLID_TOP.has(tp)');
    expect(src).toContain('solidTilesCell(st, sx + dx, sy + dy)');  // 螺旋 3×3 净空（Collision.cs:3494）
    expect(src).toContain("new TownNPC('skeleton_merchant', this.vanillaSpawner.currentSpawnX * TILE + 8, this.vanillaSpawner.currentSpawnY * TILE)");
    expect(src).not.toContain("'travelling_merchant', ax * TILE + 8"); // 旧随机单列链已退役
    expect(src).not.toContain('(this.vanillaSpawner.currentSpawnY + 1) * TILE'); // 旧 +1 嵌地已死
  });
});
