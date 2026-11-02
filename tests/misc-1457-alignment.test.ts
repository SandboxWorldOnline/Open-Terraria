// 1457 对齐杂项批（2026-08-23）——行为面调查点名的散件六件：
//   ① drawslots 提取器对 1457 重跑（tools/extract-acc-drawslots.mjs --ver/SW_VER，
//     新配饰 6145-6195 全族补入 + ArmorIDs 增量同步 vanillaAccDrawslots.ts）
//   ② 拴绳新小动物两族（TurtleLeashedCritter/AquaticWalkerLeashedCritter，1457
//     LeashedEntity.cs:118-142 注册序 21 型 + TECritterAnchor.cs:64-85 迁移）
//   ③ TeleporterGenerator（1457 Generation/TeleporterGenerator.cs 259 行，"beam me up"
//     种子旗放置臂；三阶段 None→ForceSupports→ClearTiles）
//   ④ ParticleOrchestrator 4 效果（SporeCloud 已有近似/FormatC·ArcSurge 登记/
//     SnappingStone 尘段 1:1 入 SnapStrike.snapStrikeDust）
//   ⑤ DigtoiseMapLayer（1457 Map/DigtoiseMapLayer.cs，Renderer.drawDigtoiseMapLayer）
//   ⑥ SetID 9+ 消费点逐个核（vanillaSets1457.ts 头注处置台账）
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
// ★C档可移植:仓库外依赖(game/ 兄弟目录,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
const EXT_MISSING = !['Terarria1457'].every((d) => existsSync(new URL(`../../${d}`, import.meta.url)));

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  accDrawSlotsOf, FACE_MASK_HELMET_HIDE, BACK_IS_ACAPE,
} from '../src/data/vanillaAccDrawslots';
import {
  PROTOTYPES, NPC_FAMILY, PROTOTYPE_REGISTER_ORDER, prototypeTypeOf,
  strayingYOf, leashedBubbleVisible, anchorStyleOfItem, ITEM_MAKE_NPC,
} from '../src/entities/LeashedCritter';
import { TileStore } from '../src/world/TileStore';
import { RNG } from '../src/core/rng';
import { newGenState } from '../src/world/gen/vanilla/GenState';
import { runTeleporterPass } from '../src/world/gen/vanilla/TeleporterPass';
import { TILE_DEFS } from '../src/data/tiles';
import {
  TILE_REMOVE_WHEN_UNDER_SPAWN, TILE_IS_A_PRESSURE_PLATE,
  ITEM_ACCESSORY_INCOMPATIBILITY_TYPE,
} from '../src/data/vanillaSets1457';
import { dollTargetSlot } from '../src/world/FurnitureItems';
import { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, ITEM_DEFS } from '../src/data/items';

const iid = (vid: number): number => ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[vid]];
const sheetId = (sheet: number): number => {
  for (let id = 0; id < TILE_DEFS.length; id++) {
    if (TILE_DEFS[id]?.vanilla?.sheet === sheet) return id;
  }
  return -1;
};

// ============================================================================
// ① drawslots 1457 再生
// ============================================================================

describe.skipIf(EXT_MISSING)('① drawslots：1457 再生（extract-acc-drawslots --ver=1457）', () => {
  it('新配饰 6145-6195 族全量入表（抽查 1457 新增 16 条 vid 的槽位值）', () => {
    // 值 = tools/extract-acc-drawslots.mjs 对 Terarria1457/Terraria/Item.cs 的提取终态
    expect(accDrawSlotsOf(6156)).toMatchObject({ handOn: 27, handOff: 17 });
    expect(accDrawSlotsOf(6157)).toMatchObject({ handOn: 28 });
    expect(accDrawSlotsOf(6162)).toMatchObject({ handOn: 30 });
    expect(accDrawSlotsOf(6163)).toMatchObject({ handOn: 31, handOff: 18 });
    expect(accDrawSlotsOf(6177)).toMatchObject({ shield: 11 });
    expect(accDrawSlotsOf(6179)).toMatchObject({ handOn: 32 });
    expect(accDrawSlotsOf(6180)).toMatchObject({ neck: 14 });
    expect(accDrawSlotsOf(6181)).toMatchObject({ back: 40 });          // PhoenixQuiver
    expect(accDrawSlotsOf(6182)).toMatchObject({ handOn: 25, handOff: 16 });
    expect(accDrawSlotsOf(6183)).toMatchObject({ shield: 10 });
    expect(accDrawSlotsOf(6185)).toMatchObject({ handOn: 26 });
    expect(accDrawSlotsOf(6186)).toMatchObject({ back: 41, front: 17 }); // DruidicSerpentCloak
    expect(accDrawSlotsOf(6187)).toMatchObject({ neck: 13 });
    expect(accDrawSlotsOf(6188)).toMatchObject({ shield: 12 });
    expect(accDrawSlotsOf(6189)).toMatchObject({ waist: 17 });
    expect(accDrawSlotsOf(6141)).toMatchObject({ back: 39, front: 16 }); // 1456 末件不回归
  });

  it('提取器 --audit 对 1457 标杆零漂移（JSON 与 Item.cs 提取逐位一致）', () => {
    const out = execSync('node tools/extract-acc-drawslots.mjs --audit', { encoding: 'utf8' });
    expect(out).toContain('audit: identical');
  });

  it('ArmorIDs ★1457 增量：PreventFaceMaskDraw −102 / DrawFaceMaskUnderHead +203（并集 70 元换血）', () => {
    expect(FACE_MASK_HELMET_HIDE.has(203)).toBe(true);    // ArmorIDs.cs:20 尾增
    expect(FACE_MASK_HELMET_HIDE.has(102)).toBe(false);   // ArmorIDs.cs:24 移除
    expect(FACE_MASK_HELMET_HIDE.size).toBe(70);          // 48+22 无交集（1456 49+21）
  });

  it('ArmorIDs ★1457 增量：Back.Sets.IsACape +41 DruidicSerpentCloak（:1721）', () => {
    expect(BACK_IS_ACAPE.has(41)).toBe(true);
    expect(BACK_IS_ACAPE.size).toBe(12);
    expect(BACK_IS_ACAPE.has(40)).toBe(false);            // 40=PhoenixQuiver 非披风
  });
});

// ============================================================================
// ② 拴绳新小动物两族
// ============================================================================

describe.skipIf(EXT_MISSING)('② 拴绳：1457 注册序 + Turtle/AquaticWalker 两新族', () => {
  it('Registry.RegisterAll 注册序 21 型（LeashedEntity.cs:118-142；0=null/1=kite）', () => {
    expect(PROTOTYPE_REGISTER_ORDER).toHaveLength(20);
    const want: Array<[string, number]> = [
      ['walker', 2], ['aquaticWalker', 3], ['crawler', 4], ['snail', 5], ['turtle', 6],
      ['runner', 7], ['flyer', 8], ['normalButterfly', 9], ['empressButterfly', 10],
      ['hellButterfly', 11], ['firefly', 12], ['shimmerFly', 13], ['dragonfly', 14],
      ['crawlingFly', 15], ['bird', 16], ['waterfowl', 17], ['fish', 18], ['fairy', 19],
      ['jumper', 20], ['waterStrider', 21],
    ];
    for (const [fam, type] of want) expect(prototypeTypeOf(fam as never)).toBe(type);
  });

  it('TECritterAnchor 迁移（:76/:77/:79）：蛙 361/445+企鹅 148/149→AquaticWalker、龟 616/617→Turtle', () => {
    for (const id of [361, 445, 148, 149]) expect(NPC_FAMILY.get(id)).toBe('aquaticWalker');
    for (const id of [616, 617]) expect(NPC_FAMILY.get(id)).toBe('turtle');
    // Crawler 余部（:77）不含 616/617
    for (const id of [616, 617]) expect(NPC_FAMILY.get(id)).not.toBe('crawler');
    for (const id of [357, 448, 484, 485, 486, 487, 606]) expect(NPC_FAMILY.get(id)).toBe('crawler');
  });

  it('两新类行为 = 基类参数 + drawBubble=false（Turtle :7-11 / AquaticWalker :7-11）', () => {
    expect(PROTOTYPES.aquaticWalker).toMatchObject({
      move: 'walker', walkingPace: 0.8, straying: 3, anchorStyle: 0, drawBubble: false,
    });
    expect(PROTOTYPES.turtle).toMatchObject({
      move: 'walker', walkingPace: 0.4, straying: 3, anchorStyle: 1, drawBubble: false,
    });
    // WaterStrider 1457 也关气泡（:21）+ straying X/Y 分叉（:13-14 X=5 Y=12）
    expect(PROTOTYPES.waterStrider.drawBubble).toBe(false);
    expect(PROTOTYPES.waterStrider.straying).toBe(5);
    expect(strayingYOf(PROTOTYPES.waterStrider)).toBe(12);
    // 其余族旗缺省（=true）不误伤
    for (const p of Object.values(PROTOTYPES)) {
      if (p.family !== 'aquaticWalker' && p.family !== 'turtle' && p.family !== 'waterStrider') {
        expect(p.drawBubble, p.family).toBeUndefined();
      }
    }
    // 放置帧档随族迁移：龟物品 4464/4465 → 1（Crawler 档）、蛙 2121 → 0（Walker 档）
    expect(anchorStyleOfItem(4464)).toBe(1);
    expect(anchorStyleOfItem(4465)).toBe(1);
    expect(anchorStyleOfItem(2121)).toBe(0);
  });

  it('leashedBubbleVisible = 1457 ShouldDrawBubble 形态（:213-278，本格判定 + 坡/半砖邻扩）', () => {
    const st = new TileStore(16, 16);
    const DIRT = sheetId(1);
    const cx = (x: number) => x * 16, cy = (y: number) => y * 16;
    // 空气格：陆生干燥 false / 入液 true；水生满水 false / 非满水 true（TileRequiresBubble）
    expect(leashedBubbleVisible(st, cx(3), cy(3), false)).toBe(false);
    st.liquid[st.idx(4, 4)] = 80;
    expect(leashedBubbleVisible(st, cx(4), cy(4), false)).toBe(true);
    st.liquid[st.idx(5, 4)] = 255;
    expect(leashedBubbleVisible(st, cx(5), cy(4), true)).toBe(false);
    st.liquid[st.idx(6, 4)] = 200;
    expect(leashedBubbleVisible(st, cx(6), cy(4), true)).toBe(true);
    // 实心平放本格 → 恒 false（:227-230）；半砖 + 上邻有液 → true（:235/:256）
    const i = st.idx(8, 8);
    st.type[i] = DIRT; st.flags[i] = 1;
    expect(leashedBubbleVisible(st, cx(8), cy(8), false)).toBe(false);
    st.half[i] = 1;
    st.liquid[st.idx(8, 7)] = 255;
    expect(leashedBubbleVisible(st, cx(8), cy(8), false)).toBe(true);
  });

  it('straying Y 分量缺省 = X（未分叉族行为不变；仅 waterStrider 1457 分叉）', () => {
    for (const p of Object.values(PROTOTYPES)) {
      expect(strayingYOf(p)).toBe(p.family === 'waterStrider' ? 12 : p.straying);
    }
  });
});

// ============================================================================
// ③ TeleporterGenerator（"beam me up"）
// ============================================================================

/** 合成生成世界：w×h 泥土地板（floorY 起实心），可选全带液体覆盖 */
function mkGenWorld(w: number, h: number, floorY: number,
  liquid?: { type: number; depth: number }): TileStore {
  const st = new TileStore(w, h);
  const DIRT = sheetId(1);
  for (let x = 0; x < w; x++) {
    for (let y = floorY; y < h; y++) {
      const i = st.idx(x, y);
      st.type[i] = DIRT;
      st.flags[i] = 1;
    }
    if (liquid) {
      for (let y = floorY - liquid.depth; y < floorY; y++) {
        const i = st.idx(x, y);
        st.liquid[i] = 255;
        st.liquidType[i] = liquid.type;   // 本仓 +1 编码（WATER=1/LAVA=2）
      }
    }
  }
  return st;
}

function countSheet(st: TileStore, sheet: number): number {
  const id = sheetId(sheet);
  let n = 0;
  for (let i = 0; i < st.type.length; i++) if (st.flags[i] && st.type[i] === id) n++;
  return n;
}

describe.skipIf(EXT_MISSING)('③ TeleporterPass（TeleporterGenerator.cs 1:1，"beam me up"）', () => {
  // ★h ≥ worldSurface+300：TryFindTeleporterSpot 掷点带 = [worldSurface, h-200-100]
  //  （:129 Main.UnderworldLayer = maxTilesY-200），h 过小则上界 < 下界
  // 掷点带 [SURF, h-300]、地板贴带下缘 → TryFindTeleporterSpot 下落扫描最短
  const W = 1300, H = 600, FLOOR = 310, SURF = 250;

  it('三阶段放置：成对传送门 + 压板 style4 + 同对同色导线（:40-67/:251-257/:102）', () => {
    const st = mkGenWorld(W, H, FLOOR);
    const gs = newGenState(W, H);
    gs.worldSurface = SURF;
    runTeleporterPass(st, new RNG(20260823), gs, {
      addTeleporters: true, spawnX: 0, spawnY: 0,
    });
    const TP = sheetId(235), PLATE = sheetId(135);
    const pads: Array<{ x: number; y: number; wire: number }> = [];
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const i = st.idx(x, y);
        if (st.flags[i] && st.type[i] === TP) {
          // 锚 = 3×1 左列（frameX%54/18==0，CanKillTile :62789 同式归一）
          if (st.frameX[i] % 54 === 0) {
            pads.push({ x, y, wire: st.wire[i] & 15 });
            // 压板 135 style4（frameX=72）在锚上一格
            const pi = st.idx(x, y - 1);
            expect(st.flags[pi]).toBe(1);
            expect(st.type[pi]).toBe(PLATE);
            // ★BJ753 TF-08 域勘正：压板颜色档在 frameY（原版 :254 PlaceTile →
            //  case 135 Place1x1 default 支 `frameY=18*style`,WorldGen.cs:45626-45629;
            //  旧钉 frameX=72 系 X 域错置,与放置面 default X 向同族病灶）
            expect(st.frameX[pi]).toBe(0);
            expect(st.frameY[pi]).toBe(72);
          }
        }
      }
    }
    // pairs = trunc(10×1300/4200) = 3 对 → 每对 2 垫 ×3 格（_totalPlaced 按对计 :103）
    expect(pads.length).toBe(6);
    // 同对同色导线（:102-108 蓝绿黄轮转）——3 对恰用蓝/绿/黄各一次,同色 = 同对
    const colors = pads.map((p) => p.wire);
    for (const c of colors) expect([2, 4, 8]).toContain(c);   // 蓝/绿/黄位（1=红不出现）
    const byColor = new Map<number, number[]>();
    pads.forEach((p, k) => {
      const arr = byColor.get(colors[k]) ?? [];
      arr.push(k);
      byColor.set(colors[k], arr);
    });
    expect(byColor.size).toBe(3);
    for (const [, idxs] of byColor) expect(idxs.length).toBe(2);
    // 跨对间距 ≥ 100（:179 IsTileNearby 门——阶段③ 收敛值;对内两端无此门：
    //   配对双端在放置前选定,门只对已放置的既有对生效）
    for (const [cA, idxsA] of byColor) {
      for (const [cB, idxsB] of byColor) {
        if (cA >= cB) continue;
        const a = pads[idxsA[0]], b = pads[idxsB[0]];
        expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(100);
      }
    }
  });

  it('水中允许（CanPutTeleporterHere :188 只拒 liquidType>0）——全带浅水仍放置', () => {
    const st = mkGenWorld(900, 600, 310, { type: 1, depth: 2 });   // WATER=1（本仓编码）
    const gs = newGenState(900, 600);
    gs.worldSurface = 250;
    runTeleporterPass(st, new RNG(7), gs, { addTeleporters: true, spawnX: 0, spawnY: 0 });
    expect(countSheet(st, 235)).toBeGreaterThanOrEqual(3);
  });

  it('岩浆拒放（:188-190 liquidType>0 → false）——全带熔岩零放置', () => {
    const st = mkGenWorld(900, 600, 310, { type: 2, depth: 2 });   // LAVA=2
    const gs = newGenState(900, 600);
    gs.worldSurface = 250;
    runTeleporterPass(st, new RNG(7), gs, { addTeleporters: true, spawnX: 0, spawnY: 0 });
    expect(countSheet(st, 235)).toBe(0);
  });

  it('ForceSupports 阶段补实支撑（:90-94/:212-239）——1 宽柱顶锚点支撑三格铺实', () => {
    const st = mkGenWorld(900, 600, 420);
    const DIRT = sheetId(1);
    // 每隔 6 格立 1 宽柱（顶 +1）：柱顶锚 = 阶段① 支撑不全拒、阶段② 强制铺实
    for (let x = 400; x < 500; x += 6) {
      const i = st.idx(x, FLOOR - 1);
      st.type[i] = DIRT;
      st.flags[i] = 1;
    }
    const gs = newGenState(900, 600);
    gs.worldSurface = 250;
    runTeleporterPass(st, new RNG(99), gs, { addTeleporters: true, spawnX: 0, spawnY: 0 });
    const TP = sheetId(235);
    let supportedPads = 0;
    for (let x = 1; x < 899; x++) {
      for (let y = 0; y < 600; y++) {
        const i = st.idx(x, y);
        if (st.flags[i] && st.type[i] === TP && st.frameX[i] % 54 === 0) {
          const l = st.idx(x - 1, y + 1), c = st.idx(x, y + 1), r = st.idx(x + 1, y + 1);
          if (st.flags[l] && st.flags[c] && st.flags[r]) supportedPads++;
        }
      }
    }
    expect(supportedPads).toBeGreaterThanOrEqual(1);
  });

  it('旗门：addTeleporters 缺席零掷零写（普通世界 :18128 门）', () => {
    const st = mkGenWorld(900, 600, 310);
    const gs = newGenState(900, 600);
    gs.worldSurface = 250;
    runTeleporterPass(st, new RNG(7), gs, { addTeleporters: false, spawnX: 0, spawnY: 0 });
    expect(countSheet(st, 235)).toBe(0);
    expect(countSheet(st, 135)).toBe(0);
  });
});

// ============================================================================
// ⑥ SetID 9+ 消费点定谳（处置台账 = vanillaSets1457.ts 头注）
// ============================================================================

describe.skipIf(EXT_MISSING)('⑥ SetID 9+：小件接线与定谳', () => {
  it('AccessoryIncompatibilityType 已接：模特配饰冲突槽（TEDisplayDoll.cs:747-752 + ItemSlot.cs:3482-3486）', () => {
    expect(ITEM_ACCESSORY_INCOMPATIBILITY_TYPE).toMatchObject({
      6168: 6168, 6169: 6168, 6193: 6168, 6194: 6168,
    });
    const rec: import('../src/world/FurnitureItems').FurnitureItemRecord = {
      x: 0, y: 0, kind: 'display_doll', slots: new Array(19).fill(null),
    };
    rec.slots[4] = { id: iid(6169), stack: 1 };
    expect(dollTargetSlot(rec, 6168)).toBe(4);      // 同组 → 冲突槽（TryFitting 交换）
    expect(dollTargetSlot(rec, 49)).toBe(3);        // 异组 → 首空
    // 同 id 冲突（槽内内部 id 经 slotVid 归一后比对——原跨 id 空间恒假死分支已修）
    const rec2: import('../src/world/FurnitureItems').FurnitureItemRecord = {
      x: 0, y: 0, kind: 'display_doll', slots: new Array(19).fill(null),
    };
    rec2.slots[6] = { id: iid(49), stack: 1 };
    expect(dollTargetSlot(rec2, 49)).toBe(6);
  });

  it('IsAPressurePlate 定谳：1457 全库零消费点（仅 TileID.cs:325 声明,tML 预留）', () => {
    const tileIdCs = resolve(process.cwd(), '../Terarria1457/Terraria.ID/TileID.cs');
    expect(existsSync(tileIdCs)).toBe(true);
    const src = readFileSync(tileIdCs, 'utf8');
    expect(src).toMatch(/IsAPressurePlate = Factory\.CreateBoolSet\(false, 135, 442, 428\)/);
    // 全树（ID.cs 外）无引用
    const hits = execSync(
      `grep -rl "IsAPressurePlate" ../Terarria1457 --include='*.cs' | grep -v 'Terraria.ID/TileID.cs' | wc -l`,
      { encoding: 'utf8' },
    ).trim();
    expect(hits).toBe('0');
    expect(TILE_IS_A_PRESSURE_PLATE).toEqual([135, 442, 428]);   // 登记表保持
  });

  it('RemoveWhenUnderSpawn 已接：vampireSeedFinishPass 出生点竖带清障（WorldGen.cs:25229-25263）', () => {
    expect(TILE_REMOVE_WHEN_UNDER_SPAWN).toEqual([135, 442, 428, 48, 443]);
    // ★2026-09-02 重构随迁:该节自 vampireSeedFinishPass 原位外提至 SecretSeedDoEndsPass
    //   (SecretSeedDoEndsPass.ts:1771 外提注),钉值文件随之
    const doEnds = readFileSync(resolve(process.cwd(), 'src/world/gen/vanilla/SecretSeedDoEndsPass.ts'), 'utf8');
    expect(doEnds).toContain('RemoveSpecificTilesUnderSpawn');
    expect(doEnds).toContain('TILE_REMOVE_WHEN_UNDER_SPAWN');
  });

  it('ParticleOrchestrator 4 效果处置：SnappingStone 尘段已接 / SporeCloud 已有近似 / FormatC·ArcSurge 登记', () => {
    const snap = readFileSync(resolve(process.cwd(), 'src/stats/SnapStrike.ts'), 'utf8');
    expect(snap).toContain('snapStrikeDust');
    expect(snap).toContain('Spawn_SnappingStone{,Melee,Summon}');
    const enemy = readFileSync(resolve(process.cwd(), 'src/entities/Enemy.ts'), 'utf8');
    expect(enemy).toMatch(/SporeCloud 1\/60/);            // 孢子云近似（:92878 锚）
    // FormatC/ArcSurge 宿主缺口登记（562 crit +25% 分支 / LightningGenerator 族未移植）
    const weapon = readFileSync(resolve(process.cwd(), 'src/entities/WeaponProj.ts'), 'utf8');
    expect(weapon).toContain('562: 320');                 // FormatC 弹在册（数值表）
    expect(weapon).not.toMatch(/case 562/);               // crit 加成分支未移植（登记态）
  });

  it('DigtoiseMapLayer 已接：Renderer 层 + Extra_305 素材 + UI.Digtoise 双语键', () => {
    const renderer = readFileSync(resolve(process.cwd(), 'src/render/Renderer.ts'), 'utf8');
    expect(renderer).toContain('drawDigtoiseMapLayer');
    expect(renderer).toContain('DigtoiseMapLayer.cs:9-29');
    expect(existsSync(resolve(process.cwd(), 'public/sprites/vanilla/Extra_305.png'))).toBe(true);
    for (const loc of ['en-US', 'zh-Hans']) {
      const l10n = JSON.parse(readFileSync(resolve(process.cwd(), `public/l10n/${loc}.json`), 'utf8'));
      const val = l10n.Mods?.['SandboxWorld.UI.Digtoise'];
      expect(val, loc).toBeTruthy();
    }
  });

  it('ITEM_MAKE_NPC 龟/蛙物品链不回归（拴绳放置入口）', () => {
    expect(ITEM_MAKE_NPC[4464]).toBe(616);
    expect(ITEM_MAKE_NPC[4465]).toBe(617);
    expect(ITEM_MAKE_NPC[2121]).toBe(361);
    expect(ITEM_DEFS[iid(4464)]).toBeTruthy();
  });
});
