// IIIII14（DRUNK 05162020）生成内容层回归：小世界直驱 generateWorld，断言双邪恶
// 群落共存（P0）+ 本批 P1 面的最小计数。普通种子零扰动护栏在
// seed-parity/worldgen-1457-rewire/micro-biomes/liquid-settle-golden 四套件。
import { describe, it, expect } from 'vitest';
import { generateWorld } from '../src/world/gen/WorldGen';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';

const ID: Record<string, number> = {};
TILE_DEFS.forEach((d, i) => { ID[d.key] = i; });

describe('IIIII14 DRUNK(05162020) 世界效应', () => {
  it('5162020 小世界：双邪恶带/双 style 祭坛与珠族/双邪恶矿/四档矿组混合', async () => {
    const world = await generateWorld({ width: 4200, height: 1200, seedText: '5162020' });
    const st = world.store;
    const gs = (world as unknown as { __gs?: never }).__gs; // GenState 不落 world——用 evilZones 之外的瓦片证据
    void gs;
    const cnt = (key: string): number => {
      const id = ID[key] ?? -1;
      let n = 0;
      for (let i = 0; i < st.type.length; i++) if (st.type[i] === id && st.flags[i]) n++;
      return n;
    };
    // --- P0 双邪恶 ---
    expect(cnt('v_25_ebonstone_block')).toBeGreaterThan(300);
    expect(cnt('v_203_crimstone_block')).toBeGreaterThan(300);
    expect(cnt('v_23_corrupt_grass_block')).toBeGreaterThan(20);
    expect(cnt('v_199_crimson_grass_block')).toBeGreaterThan(20);
    // 双 style 祭坛（frameX 带 = style*54）
    const ALTAR = ID['v_26_altars'];
    let altarS0 = 0, altarS1 = 0;
    for (let i = 0; i < st.type.length; i++) {
      if (!st.flags[i] || st.type[i] !== ALTAR) continue;
      if (Math.floor(st.frameX[i] / 54) === 0) altarS0++; else altarS1++;
    }
    expect(Math.min(altarS0, altarS1)).toBeGreaterThan(0);
    // 双 style 珠/心族（style1 帧带偏移 +36）
    const ORB = ID['v_31_orb_heart'];
    let orbS0 = 0, orbS1 = 0;
    for (let i = 0; i < st.type.length; i++) {
      if (!st.flags[i] || st.type[i] !== ORB) continue;
      if (st.frameX[i] >= 36) orbS1++; else orbS0++;
    }
    expect(Math.min(orbS0, orbS1)).toBeGreaterThan(0);
    // 双邪恶矿并生 + 四档矿组混合（per-vein 重掷后两种都在场）
    expect(cnt('ore_demonite')).toBeGreaterThan(100);
    expect(cnt('ore_crimtane')).toBeGreaterThan(100);
    expect(cnt('ore_tin')).toBeGreaterThan(200);
    expect(cnt('ore_copper')).toBeGreaterThan(200);
    expect(cnt('ore_lead')).toBeGreaterThan(150);
    expect(cnt('ore_iron')).toBeGreaterThan(150);
    expect(cnt('ore_silver')).toBeGreaterThan(150);
    expect(cnt('ore_tungsten')).toBeGreaterThan(150);
    expect(cnt('ore_gold')).toBeGreaterThan(100);
    expect(cnt('ore_platinum')).toBeGreaterThan(100);
    // drunk 起始镇民换人（裸 drunk → 派对女孩 208 / drunk×const → 机械师 124 的
    // pass 播种记录——裸 drunk 落 party_girl）
    expect(world.starterTownNpcs?.map((s) => s.key)).toContain('party_girl');
  }, 180000);

  it('IIIII21 二期：浮空岛族/FDC paint+宝箱/地牢入口族/神庙三倍体', async () => {
    const { lastGenState } = await import('../src/world/gen/WorldGen');
    const SHEET: number[] = [];
    TILE_DEFS.forEach((d, i) => { if (d?.vanilla?.sheet != null) SHEET[i] = d.vanilla.sheet; });
    const itemIds = await import('../src/data/itemKeys');
    const gen = (seedText: string) =>
      generateWorld({ width: 4200, height: 1200, seedText, name: 't' }).then((world) => ({ world, gs: lastGenState()! }));
    const analyze = (wWorld: Awaited<ReturnType<typeof gen>>['world'], gs: Awaited<ReturnType<typeof gen>>['gs']) => {
      const st = wWorld.store;
      const cntBySheet = (sheet: number, pred?: (paint: number) => boolean): number => {
        let n = 0;
        for (let i = 0; i < st.type.length; i++) {
          if (!st.flags[i] || SHEET[st.type[i]] !== sheet) continue;
          if (pred && !pred(st.paint[i])) continue;
          n++;
        }
        return n;
      };
      const dgBricks = new Set([41, 43, 44, 677, 678, 679]);
      const dgWalls = new Set([7, 8, 9, 94, 95, 96, 97, 98, 99]);
      const brickPaintHist = new Map<number, number>();
      const templePaintHist = new Map<number, number>();
      const wallPaintHist = new Map<number, number>();
      for (let i = 0; i < st.type.length; i++) {
        if (!st.flags[i]) continue;
        const sh = SHEET[st.type[i]];
        if (dgBricks.has(sh)) brickPaintHist.set(st.paint[i], (brickPaintHist.get(st.paint[i]) ?? 0) + 1);
        else if (sh === 226) templePaintHist.set(st.paint[i], (templePaintHist.get(st.paint[i]) ?? 0) + 1);
      }
      for (let i = 0; i < st.wall.length; i++) {
        const wl = st.wall[i];
        if (dgWalls.has(wl)) wallPaintHist.set(st.paintWall[i], (wallPaintHist.get(st.paintWall[i]) ?? 0) + 1);
      }
      // 埋地深度：黑涂地牢墙最低行（drunk 入口族整群在地下）
      let wall25MinY = Infinity;
      for (let i = 0; i < st.wall.length; i++) {
        if (st.paintWall[i] === 25 && dgWalls.has(st.wall[i])) {
          const y = Math.floor(i / st.w);
          if (y < wall25MinY) wall25MinY = y;
        }
      }
      // 活木死树（GenerateDungeonTree 的 b=28 主写）
      let treeWoodPainted = 0;
      for (let i = 0; i < st.type.length; i++) {
        if (!st.flags[i] || SHEET[st.type[i]] !== 191 || st.paint[i] !== 28) continue;
        treeWoodPainted++;
      }
      const vid1571 = itemIds.VI_ID(1571);
      const vid1569 = itemIds.VI_ID(1569);
      const vid5001 = itemIds.VI_ID(5001);
      const vid678 = itemIds.VI_ID(678);
      let has1571 = 0, has1569 = 0, redPotion = 0, moonLegs = 0;
      for (const c of wWorld.chests) {
        const ids2 = c.items.filter(Boolean).map((it) => it!.id);
        if (ids2.includes(vid1571)) has1571++;
        if (ids2.includes(vid1569)) has1569++;
        if (ids2.includes(vid5001)) redPotion++;
        if (ids2.includes(vid678)) moonLegs++;
      }
      return {
        islands: gs.floatingIslands.map((isl) => isl),
        snowCloud: cntBySheet(460),
        fountains: cntBySheet(207),
        brickPaint: Object.fromEntries(brickPaintHist),
        templePaint: Object.fromEntries(templePaintHist),
        wallPaint25: wallPaintHist.get(25) ?? 0,
        dungeonWallStyle: gs.dungeonWallStyle,
        tRooms: gs.tRooms,
        treeWoodPainted,
        wall25MinY,
        has1571, has1569, redPotion, moonLegs,
        ws: gs.worldSurface,
        chestCount: wWorld.chests.length,
      };
    };
    const D = await gen('5162020').then(({ world, gs }) => analyze(world, gs));
    const C = await gen('sw-ctl-iiii21').then(({ world, gs }) => analyze(world, gs));
    // ---- C1 浮空岛族（cs:13124-13155）----
    expect(D.islands.filter((i) => !i.isLake)).toHaveLength(3);
    const styles = D.islands.filter((i) => !i.isLake).map((i) => i.style);
    expect(styles.every((s2) => s2 === 1 || s2 === 3)).toBe(true);
    expect(D.snowCloud).toBeGreaterThan(60);            // 雪云 460 只在雪岛出现
    // ★BJ731 改判史（2026-10-27）：>0 → 0。放置面仍触发（islandStyle 1/3 →
    //   cs:80543 放 24 格喷泉,setTileSilent 仪实锤）,但 Piles pass（矿骨堆）段②
    //   天空带采样 y∈[10,worldSurface)（cs:19151-19152）使堆可落浮空岛——本种子
    //   流下堆落于 (926,103)/(1862,127) 等喷泉邻格,SquareTileFrame 3×3（cs:81462）
    //   → TileFrameImportant case 207 → Check2xX（cs:38376）底锚 SolidTileAllowBottomSlope
    //   （cs:70698）读 Main.tileSolid——Piles 头 cs:18915-18925 已把云族 189 等翻
    //   非实心 ⇒ 云腿喷泉整组判死（微夹具复现:云实心 8 格存活/翻非实心 0 格）。
    //   机制五环全 1:1 亲读定谳=非回归;旧 >0 锚在 09-21 期流（BJ711-A/BJ715-A
    //   仪式谓词域勘正等已定谳改动移流之前）。登记债:vanilla oracle/x86 rig 对
    //   本种子终态喷泉计数复核（在途金标禁重冻判例适用——world-final-hash 同批
    //   重冻以本定谳为据）。
    expect(D.fountains).toBe(0);                        // style>0 放置照跑;Piles 云腿判死=原版同构
    expect(C.islands.filter((i) => !i.isLake).map((i) => i.style)).toEqual([0, 0, 0]);
    expect(C.snowCloud).toBe(0);
    expect(C.fountains).toBe(0);
    // ---- C2 FinishDrunkGen（cs:26493-26611）----
    const colors = Object.entries(D.brickPaint).filter(([k, v]) => Number(k) !== 0 && v > 500);
    expect(colors).toHaveLength(1);                     // 全图统一主色
    expect(Number(colors[0]![0])).toBeGreaterThanOrEqual(13);
    expect(Number(colors[0]![0])).toBeLessThanOrEqual(24);
    expect(D.wallPaint25).toBeGreaterThan(3000);        // 地牢墙黑涂 25
    const tp16 = Number(D.templePaint['16'] ?? 0);
    expect(tp16).toBeGreaterThan(1500);                 // 神庙柠檬绿
    expect(C.wallPaint25).toBe(0);                      // 对照世界无墙黑涂
    const ctlAnyPaint = Object.entries({ ...C.brickPaint, ...C.templePaint })
      .some(([k, v]) => Number(k) !== 0 && v > 500);
    expect(ctlAnyPaint).toBe(false);                    // 对照世界 paint 通道全零
    expect(C.redPotion).toBe(0);
    expect(C.moonLegs).toBe(0);
    expect(D.redPotion).toBeGreaterThan(0);             // 1/15 红药水
    expect(D.moonLegs).toBeGreaterThan(0);              // 1/30 月总腿
    // ---- C3 地牢入口族 ----
    expect(Number.isInteger(D.dungeonWallStyle as number)).toBe(true);   // DC.cs:94-110 重掷已掷
    expect(C.dungeonWallStyle).toBeUndefined();         // 普通世界零骰
    // ★IIIII53：入口预计算起点改用 GenVars.rockLayer-20（DC.cs:313，非平滑的
    //   Main.rockLevel）后整塔上移 ~15 格 ≡ x86 真值（rig dgStartRoom 对位实证），
    //   塔顶黑涂墙最低点随之抬升——阈值按同款配方 x86 实测放宽。
    expect(D.wall25MinY).toBeGreaterThan(Math.trunc(D.ws) - 130);         // 入口族埋于地下
    expect(D.has1571).toBeGreaterThan(0);
    expect(D.has1569).toBeGreaterThan(0);               // 双邪恶生物群系箱并存（第 5 箱支）
    expect(C.has1571 > 0 && C.has1569 > 0).toBe(false); // 对照世界单侧邪恶箱
    expect(D.treeWoodPainted).toBeGreaterThan(180);     // 死生命树活木 b=28（DU:615-1151）
    expect(C.treeWoodPainted).toBe(0);
    // ---- C4 神庙三倍体（cs:33752 ×3 / cs:34415 ×1.5 / 木刺 ±2）----
    expect(D.tRooms).toBeGreaterThanOrEqual(27);        // 房数×3（10..15 ×3）
    expect(C.tRooms).toBeLessThan(16);                  // 对照世界正常房数
  }, 420000);
});
