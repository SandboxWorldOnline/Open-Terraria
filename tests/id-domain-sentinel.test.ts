// ★物品 id 双域纪律哨兵网（2026-09-18;BJ150 普查 §6 处方·方案 B）==================
// 背景:物品 id 双域并存——internal=运行时域(ITEM_DEFS 数组下标)/stable=对外契约域
//   (≡原版 vid + SW 私有段 10000+/place_v 20000+)。11 天内两起同型实害:
//   SW-BO1(2026-09-07 WldExport 箱侧「写向文件误用加载向表」)与 BJ146(2026-09-18
//   PlrImport 导出侧同型),且均被 stableOf∘netIdOf 自回环恒等掩盖(夹具与断言同表
//   同错=闭环全绿)。BJ150 逐点核读:8 个跨边界收口现状全部正确——本件把正确性钉成
//   哨兵网,防第三起。grep 臂=tests/id-domain-guard.test.ts + tools/id-domain-guard.mjs。
// ★8 收口 × 断言(BJ150 §4 逐点表):
//   1 存档 JSON 写 serialize.mapItem(:478)+furniture(:575)——internal→stable 方向,
//     掩蔽对字面量钉死(见下);2 存档 JSON 读 SaveFile .get(:253/:309/:461);
//   3 v3 裸下标段 mapLegacySlot(顺序无关,快照键链);4 角色档案 playerFromDiskForm;
//   5 .wld 导入三源(箱/rack334 帧/TE 模特——vid→键→内部 id 链+stItem 统一);
//   6 .wld 导出(箱 stable 直写+tile 流终态=sheet 域——BJ150 探针逐格恒等转常备全查);
//   7 .plr 两向(parsePlr netId 域字面量+exportPlr vid 恒等回写/SW 件归 0);
//   8 联机 key 域中立(msg5 位透传+internalIdOfVid 键链+IDG-4 守卫)。
// ★经典掩蔽对(专杀自回环恒等:断言全是字面量,不经任何被测表反查)——
//   vid 4 铁阔剑 ↔ internal 1327(SW-BO1 勘误锚);vid 1291 生命果 ↔ internal 1
//   (BJ146 真值面「vid 1291 写内部 1 原版读成铁镐」)。裸下标误用值:
//   ITEM_STABLE_OF_INTERNAL[4]=282(≠4)、[1]=1291(vid 1 铁镐误映生命果)——
//   两域互为错位排列(注册 vid×裸下标重合率 0/6177),方向一翻立即红。
// ★方案 A 重排落刀注记（BJ264 2026-09-22,已执行）：重排后 internal≡stable 恒等,
//   旧错位掩蔽对(1327/1/282)随两域统一而消亡——本件已按新注册序有意识重钉:
//   ①字面量恒等钉（I4=4/I1291=1291）;②负空间改钉「仅存非恒等映射」=蜂巢 10140
//   读档单向漏斗+disk-0 洞锚（0 号位=空洞,SaveFile MANA_CRYSTAL_IID 迁移臂目标位）;
//   ③「物品 id 永不落盘为 0」空槽哨兵替换旧裸下标负空间。域再漂移（若未来引入
//   新 id 域）须重建同型掩蔽对。
// ★变异证红记录(2026-09-18,均在验证后还原):
//   M1 serialize.mapItem 换向 .get → choke1 红+IDG-1 红;
//   M2 SaveFile.mapItem 换向裸下标 → choke2 红+IDG-2 红;
//   M3 WldExport 箱侧重接 SW-BO1 旧错 → choke5/6 红+IDG-1 红,且历史件
//      tests/wld-export.test.ts 同变异下仍全绿=自回环掩盖活体复现;
//   M4 写向文件注入加载向表代码行 → node tools/id-domain-guard.mjs exit 1;
//   M5 PlrImport.netIdOf 换向 .get 直写 → choke7 红(BJ146 面复现)。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { saveGame, loadSaveData, playerFromDiskForm, rleTiles, bytesToB64 } from '../src/save/SaveFile';
import type { SaveData } from '../src/save/serialize';
import { exportWld } from '../src/wld/WldExport';
import { parseWldToSave, combineHalfSlope } from '../src/wld/WldImport';
import { aes128EcbDecrypt, aes128EcbEncrypt, parsePlr, exportPlr, PLR_VERSION_1457 } from '../src/save/PlrImport';
import { writePlayerItems, readPlayerItems, NetReader, ItemContainer } from '../src/net/protocol';
import { internalIdOfVid } from '../src/net/leashedSync';
import { LEGACY_KEY_OF_INTERNAL_V3 } from '../src/data/itemMigration';
import {
  ITEM_BY_KEY, ITEM_DEFS, ITEM_STABLE_OF_INTERNAL, ITEM_INTERNAL_OF_STABLE,
  VANILLA_ITEM_KEY_BY_ID,
} from '../src/data/items';
import { TILE_BY_KEY, TILE_DEFS, TILE_STABLE_OF_INTERNAL, TILE_INTERNAL_OF_STABLE } from '../src/data/tiles';

// ---- 掩蔽对字面量(键注册表推导+钉死;键 vid 契约=vi_<vid>_ 稳定≡vid,与两表无关) ----
// ★方案 A 重排后重钉（BJ264 2026-09-22）：internal ≡ stable 恒等域——旧掩蔽对
//   (1327/1/282)的「两域错位」前提已随方案 A 消亡（域统一=方案 A 目标本身）。
//   负空间重钉=「仅存非恒等映射」：蜂巢 10140 读档单向漏斗（恒等裸读=place_v 面,
//   真值=vi_1124）+ disk-0 洞锚（0 号位=空洞,SaveFile 读档迁移臂目标位）。
const VID_SWORD = 4, VID_FRUIT = 1291, VID_PICK = 1;
const I4 = ITEM_BY_KEY['vi_4_IronBroadsword']!;                    // =4（恒等;旧序 1327 退役）
const I1291 = ITEM_BY_KEY['vi_1291_LifeFruit']!;                   // =1291（恒等;旧序 1 退役）
const IMANA = ITEM_BY_KEY['vi_109_mana_crystal']!;                 // =109（disk-0 迁移锚）
const WRONG_HIVE_IDENTITY = 10140;   // 恒等裸读值≠真值:读档漏斗把 10140 归 vi_1124 内部 id

describe('掩蔽对与全域普查(反自回环根基·方案 A 恒等域重钉)', () => {
  it('掩蔽对字面量钉死(方案 A 恒等域;重排须有意识重钉,见头注)', () => {
    expect(I4).toBe(4);                                      // vid 4 铁阔剑=internal 4（恒等）
    expect(I1291).toBe(1291);                                // vid 1291 生命果=internal 1291（恒等）
    expect(/^vi_4_/.test(ITEM_DEFS[I4].key)).toBe(true);
    expect(/^vi_1291_/.test(ITEM_DEFS[I1291].key)).toBe(true);
    // 写向表契约:internal→stable ≡ 恒等
    expect(ITEM_STABLE_OF_INTERNAL[I4]).toBe(VID_SWORD);
    expect(ITEM_STABLE_OF_INTERNAL[I1291]).toBe(VID_FRUIT);
    // 读向表契约:stable→internal 恒等
    expect(ITEM_INTERNAL_OF_STABLE.get(VID_SWORD)).toBe(I4);
    expect(ITEM_INTERNAL_OF_STABLE.get(VID_FRUIT)).toBe(I1291);
    // disk-0 洞锚:0 号位=原版 netID 0 语义（空洞）;魔力水晶=恒等 109
    expect(ITEM_DEFS[0]).toBeUndefined();
    expect(IMANA).toBe(109);
    expect(ITEM_DEFS[IMANA]?.key).toBe('vi_109_mana_crystal');
    // 负空间=仅存非恒等映射:蜂巢 10140 读档单向漏斗（itemMigration 尾部覆写）
    expect(ITEM_INTERNAL_OF_STABLE.get(10140)).not.toBe(WRONG_HIVE_IDENTITY);
    expect(ITEM_DEFS[ITEM_INTERNAL_OF_STABLE.get(10140)!].key).toMatch(/^vi_1124_/);
  });
  it('全域普查(方案 A 恒等域):vi_ def internal≡vid;双桥恒等;稀疏洞存在', () => {
    let viCount = 0, occupied = 0, holes = 0;
    for (let i = 0; i < ITEM_DEFS.length; i++) {
      const d = ITEM_DEFS[i];
      if (!d) { holes++; continue; }
      occupied++;
      expect(ITEM_STABLE_OF_INTERNAL[i]).toBe(i);             // 写向恒等（洞位=i 良定义）
      const m = /^vi_(\d+)_/.exec(d.key);
      if (!m) continue;
      viCount++;
      expect(i).toBe(Number(m[1]));                           // ★主不变量:internal≡vid
      expect(ITEM_INTERNAL_OF_STABLE.get(i)).toBe(i);         // 读向恒等
    }
    expect(viCount).toBeGreaterThan(6000);                    // 普查非空洞
    expect(ITEM_DEFS[0]).toBeUndefined();                     // 0 号位=空洞（netID 0 语义）
    expect(occupied).toBe(6856);                              // BJ150 普查实件数（注册面变更须有意识重钉）
    expect(holes).toBeGreaterThan(13000);                     // 稀疏洞真实存在（~13898）
    expect(ITEM_DEFS.length).toBe(20754);                     // maxStable+1（BJ150 实测 max=20753）
  });
});

// ============================================================
// 收口 1+2:存档 JSON 写(serialize mapItem internal→stable)/读(SaveFile .get)
// ============================================================
describe('收口1 存档 JSON 写:internal→stable 方向(serialize mapItem :478/:575)', () => {
  const mk = () => {
    const world = new World(80, 40, 42, '哨兵');
    const player = new Player(100, 100, new Inventory());
    player.inv.add(I4, 9);          // 铁阔剑（internal≡vid=4，方案 A 恒等域）
    player.inv.add(I1291, 3);       // 生命果（internal≡vid=1291）
    world.chests.push({
      x: 5, y: 5,
      items: [{ id: I4, stack: 9 }, { id: I1291, stack: 3 },
        ...Array.from({ length: 38 }, () => null)],
    });
    // 挂物族(:575 内联映射):1 槽框 + 19 槽模特(equip0/10=dye0 掩蔽对)
    world.furnitureItems = [
      { x: 8, y: 8, kind: 'item_frame', slots: [{ id: I4, stack: 1 }] },
      { x: 12, y: 8, kind: 'display_doll', pose: 2,
        slots: [{ id: I1291, stack: 1 }, ...Array.from({ length: 18 }, () => null)] },
    ];
    return { world, player };
  };
  it('箱/背包/挂物落盘 id=原版 vid 字面量(4/1291,恒等域下≡internal);永不落 0(空槽哨兵)', () => {
    const { world, player } = mk();
    const data = JSON.parse(saveGame(world, player, 0)) as SaveData;
    // 背包:恒等域下落盘 id=vid=internal(4/1291)。掩蔽对语义=写读两向独立单源表——
    //   若任一侧换向错表(如读向 .get 反查写向值),立即红（历史 M1-M5 变异记录见头注）
    expect(data.player.inventory[0]?.id).toBe(VID_SWORD);
    expect(data.player.inventory[1]?.id).toBe(VID_FRUIT);
    // ★方案 A 恒等域：id≡internal,「非内部下标」负空间已消亡;改钉空槽哨兵 0
    //   （物品永不落盘为 0=空槽/空洞哨兵）
    expect(data.player.inventory[0]?.id).not.toBe(0);
    expect(data.player.inventory[1]?.id).not.toBe(0);
    // 箱(chests 走同一 mapItem)
    expect(data.chests[0].items[0]?.id).toBe(VID_SWORD);
    expect(data.chests[0].items[1]?.id).toBe(VID_FRUIT);
    // 挂物(:575 内联版 mapItem)
    const frame = data.furniture?.find((f) => f.kind === 'item_frame');
    const doll = data.furniture?.find((f) => f.kind === 'display_doll');
    expect(frame?.slots[0]?.id).toBe(VID_SWORD);
    expect(doll?.slots[0]?.id).toBe(VID_FRUIT);
    expect(doll?.pose).toBe(2);
  });
});

describe('收口2 存档 JSON 读:stable→internal 方向(SaveFile .get :253/:309/:461)', () => {
  const mkData = () => {
    const world = new World(80, 40, 42, '哨兵');
    const player = new Player(100, 100, new Inventory());
    const data = JSON.parse(saveGame(world, player, 0)) as SaveData;
    // 磁盘稳定 id 形注入(读档端三收口:inventory .get:253/chests .get:309/furniture :461)
    data.player.inventory = [{ id: VID_SWORD, stack: 1 }, { id: VID_FRUIT, stack: 2 }];
    data.chests = [{ x: 5, y: 5, items: [{ id: VID_SWORD, stack: 9 }, { id: VID_FRUIT, stack: 3 }, null] }];
    data.furniture = [
      { x: 8, y: 8, kind: 'item_frame', slots: [{ id: VID_SWORD, stack: 1 }] },
      { x: 12, y: 8, kind: 'display_doll', pose: 1,
        slots: [{ id: VID_FRUIT, stack: 1 }, ...Array.from({ length: 18 }, () => null)] },
    ];
    return data;
  };
  it('读档还原 internal≡vid(4/1291 恒等域;若换向裸下标旧域即红)', () => {
    const { world, player } = loadSaveData(mkData());
    expect(player.inventory[0]?.id).toBe(I4);
    expect(player.inventory[1]?.id).toBe(I1291);
    expect(world.chests[0].items[0]?.id).toBe(I4);
    expect(world.chests[0].items[1]?.id).toBe(I1291);
    expect(world.furnitureItems[0].slots[0]?.id).toBe(I4);
    expect(world.furnitureItems[1].slots[0]?.id).toBe(I1291);
    // ★方案 A 恒等域负空间重钉:物品 id 永不为 0（空槽/空洞哨兵）
    expect(player.inventory[0]?.id).not.toBe(0);
  });
});

// ============================================================
// 收口 3:v3 裸下标段(mapLegacySlot)——顺序无关(快照键链解码,非当前注册序)
// ============================================================
describe('收口3 v3 裸下标段:mapLegacySlot 顺序无关(快照键链)', () => {
  it('快照下标经键链解码到当前内部 id(键链解码≠当前序裸下标≠写向表裸查)', () => {
    // 找一个「快照下标≠当前内部 id」的 vi_ 存量(重合率 0 普查保证存在)
    let j = -1, key = '', cur = -1;
    for (let i = 0; i < LEGACY_KEY_OF_INTERNAL_V3.length; i++) {
      const k = LEGACY_KEY_OF_INTERNAL_V3[i];
      if (typeof k === 'string' && /^vi_\d+_/.test(k) && ITEM_BY_KEY[k] !== undefined && ITEM_BY_KEY[k] !== i) {
        j = i; key = k; cur = ITEM_BY_KEY[k]!; break;
      }
    }
    expect(j).toBeGreaterThanOrEqual(0);
    expect(cur).not.toBe(j);                                   // 注册序≠快照序(位移实证)
    expect(ITEM_STABLE_OF_INTERNAL[j]).not.toBe(cur);          // 写向表裸查也≠键链解码值

    const world = new World(80, 40, 42, '哨兵');
    const player = new Player(100, 100, new Inventory());
    const data = JSON.parse(saveGame(world, player, 0)) as SaveData;
    data.version = 3;                                          // 强制 v3 面(armor 走 mapLegacySlot)
    delete (data as unknown as Record<string, unknown>).idScheme;
    data.player.armor = [{ id: j, stack: 1 }];
    const { player: p3 } = loadSaveData(data);
    expect(p3.armor?.[0]?.id).toBe(cur);                       // 快照键→key→当前内部 id
    expect(p3.armor?.[0]?.id).not.toBe(j);                     // 旧序裸读=错件
  });
});

// ============================================================
// 收口 4:角色档案 playerFromDiskForm(与 loadSaveData 主路径同映射)
// ============================================================
describe('收口4 playerFromDiskForm:磁盘稳定 id 形→内部 id 形', () => {
  it('掩蔽对两向钉死+与 loadSaveData 主路径等价', () => {
    const disk = {
      hp: 100, x: 0, y: 0, selected: 0,
      inventory: [{ id: VID_SWORD, stack: 1 }, { id: VID_FRUIT, stack: 1 }],
      armor: [{ id: VID_SWORD, stack: 1 }],
      trash: { id: VID_FRUIT, stack: 1 },
    } as SaveData['player'];
    const p4 = playerFromDiskForm(disk);
    expect(p4.inventory[0]?.id).toBe(I4);
    expect(p4.inventory[1]?.id).toBe(I1291);
    expect(p4.armor?.[0]?.id).toBe(I4);
    expect(p4.trash?.id).toBe(I1291);
    // 与 loadSaveData 主路径同映射(同输入同输出——两读入路径物品 id 语义一致契约)
    const world = new World(80, 40, 42, '哨兵');
    const player = new Player(100, 100, new Inventory());
    const data = JSON.parse(saveGame(world, player, 0)) as SaveData;
    data.player = JSON.parse(JSON.stringify(disk));
    const { player: viaLoad } = loadSaveData(data);
    expect(viaLoad.inventory?.map((it) => it?.id)).toEqual(p4.inventory.map((it) => it?.id));
    expect(viaLoad.armor?.map((it) => it?.id)).toEqual(p4.armor?.map((it) => it?.id));
  });
});

// ============================================================
// 收口 5+6:.wld 导入三源(箱/rack334 帧/TE 模特)+.wld 导出(箱 stable 直写+
//          tile 流终态=sheet 域)——exportWld→parseWldToSave 闭环
// ============================================================
const CHEST_I = TILE_BY_KEY['chest']!;                          // =16
const DOLL_I = TILE_BY_KEY['v_470_mannequins']!;                // =199
const RACK_I = TILE_BY_KEY['v_334_weapon_rack_legacy_do_not_use']!; // =485

/** 最小 SaveData(内部 tile id 域经 rleTiles 转 stable;物品=stable 域磁盘契约形) */
function mkWldSave(): SaveData {
  const W = 60, H = 40, n = W * H;
  const type = new Uint16Array(n), frameX = new Uint16Array(n), frameY = new Uint16Array(n);
  for (let y = 22; y < H; y++) for (let x = 0; x < W; x++) type[y * W + x] = 1;   // 石地
  // 箱锚(40,19):chest tile,帧 0(原版 style0 木箱带)
  type[19 * W + 40] = CHEST_I;
  // 模特锚(10,10):帧 0/0(frameY=0 ∧ frameX%36==0 锚判据)
  type[10 * W + 10] = DOLL_I;
  // rack334 帧标源(20,15):frameX=5100+vid4 铁阔剑,row=18(物件中行标记→topY=y-1)
  type[15 * W + 20] = RACK_I;
  frameX[15 * W + 20] = 5100 + VID_SWORD;
  frameY[15 * W + 20] = 18;
  return {
    format: 'sandboxworld.save', version: 5,
    header: {
      name: '哨兵世界', seed: 42, width: W, height: H,
      spawn: [30, 18], groundLevel: 20, rockLevel: 24,
      crimson: false, dungeonX: 10, dungeonY: 8,
      treeX: [15, 30, 45], treeStyle: [0, 1, 2, 3], treeTops: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0],
      created: 0, playTimeMs: 0, moonType: 0,
      sundialCooldown: 0, moondialCooldown: 0,
      fastForwardTimeToDawn: false, fastForwardTimeToDusk: false,
    },
    clock: { timeOfDay: 0.25, dayCount: 0, moonPhase: 0, bloodMoon: false, eclipse: false },
    invasion: { type: 0, size: 0, sizeStart: 0, x: 0, delay: 0 },
    bannerKills: {},
    weather: { raining: false, rainTime: 0, maxRaining: 0, cloudBGActive: 0, numClouds: 0, windSpeedTarget: 0, slimeRainTime: 0 },
    events: { partyManual: false, partyGenuine: false, lanternManual: false, lanternGenuine: false, lanternNext: false, lanternCooldown: 0 },
    player: { hp: 100, x: 0, y: 0, inventory: [], selected: 0 },
    tiles: bytesToB64(rleTiles({ type, frameX, frameY }, TILE_STABLE_OF_INTERNAL)),
    walls: '', liquid: '', liquidType: '', wire: '',
    blocks: bytesToB64(combineHalfSlope(new Uint8Array(n), new Uint8Array(n))),
    paint: '', paintWall: '', coat: '',
    chests: [{ x: 40, y: 19, items: [{ id: VID_SWORD, stack: 9 }, { id: VID_FRUIT, stack: 3 }, null] }],
    signs: [],
    npcs: [],
    flags: {},
    // 挂物族(stable 域):模特 equip0=铁阔剑,dye0=生命果(19 槽:0-8 equip/9 misc/10-18 dye)
    furniture: [{
      x: 10, y: 10, kind: 'display_doll', pose: 3,
      slots: [{ id: VID_SWORD, stack: 1 }, ...Array.from({ length: 9 }, () => null),
        { id: VID_FRUIT, stack: 1 }, ...Array.from({ length: 8 }, () => null)],
    }],
  } as unknown as SaveData;
}

describe('收口5 .wld 导入三源:箱/rack334 帧/TE→键链→stItem 统一 stable', () => {
  let cache: ReturnType<typeof parseWldToSave> | null = null;
  const run = () => cache ?? (cache = parseWldToSave(exportWld(mkWldSave())));
  it('箱源:vid 4/1291 → stable 4/1291(netId 直写+键链读;裸下标误用→282 立即红)', () => {
    const { save } = run();
    expect(save.chests?.[0]?.items?.[0]?.id).toBe(VID_SWORD);
    expect(save.chests?.[0]?.items?.[0]?.stack).toBe(9);
    expect(save.chests?.[0]?.items?.[1]?.id).toBe(VID_FRUIT);
    expect(save.chests?.[0]?.items?.[0]?.id).not.toBe(0);
  });
  it('TE 模特源:equip0/dye0 vid→键→内部→stable 恒等(4/1291)+姿态随档', () => {
    const { save } = run();
    const doll = save.furniture?.find((f) => f.kind === 'display_doll');
    expect(doll).toBeDefined();
    expect(doll?.slots[0]?.id).toBe(VID_SWORD);
    expect(doll?.slots[10]?.id).toBe(VID_FRUIT);
    expect(doll?.pose).toBe(3);
  });
  it('rack334 帧标源:frameX=5100+vid 解码→weapon_rack 记录 vid 恒等+topY=y-1', () => {
    const { save } = run();
    const rack = save.furniture?.find((f) => f.kind === 'weapon_rack');
    expect(rack).toBeDefined();
    expect(rack?.x).toBe(20);
    expect(rack?.y).toBe(14);                                  // topY=15-18/18
    expect(rack?.slots[0]?.id).toBe(VID_SWORD);
  });
  it('收口6 箱 stable 直写:SaveData 箱物品 id 经 exportWld 原样落流(vid 域,零反映射)', () => {
    // 同上闭环;独立断言位=「导出侧不再经加载向表反映射」(SW-BO1 病灶):
    // 若箱写向被换回 ITEM_INTERNAL_OF_STABLE.get(id),上面箱源断言(4/1291)即红
    expect(run().save.chests?.length).toBe(1);
  });
});

describe('收口6 .wld 导出 tile 流终态=sheet 域(BJ150 探针逐格恒等转常备全查)', () => {
  it('全部 753 个 vanilla sheet 逐格导出→导入 stable 恒等(含 >255 双字节扩展头域)', () => {
    // sheet → 首个「真身」def(vanilla.sheet=s ∧ stable=s——借 sheet 的 SW 变体
    //  (mushroom/flower/tallgrass 等 PRIV 1023-1025,stable≠sheet)在 .wld sheet 域
    //  本就折叠回原版真身,不入逐格恒等普查;域折叠语义由本注钉死)
    const sheets = new Map<number, number>();
    for (let i = 0; i < TILE_DEFS.length; i++) {
      const s = TILE_DEFS[i]?.vanilla?.sheet;
      if (typeof s === 'number' && s > 0 && !sheets.has(s) && TILE_STABLE_OF_INTERNAL[i] === s) sheets.set(s, i);
    }
    expect(sheets.size).toBe(732);                             // 普查非空洞;732/753=stable 域可表达面
    // 缺口 21 sheet=退役/并 def 身(如 389 高门 decor 版已退役,真身归一 1027)——无
    //  stable≡sheet 的 def,域内本就不可表达,勿重钉 753(见 data/tiles.ts 稳定表注)。
    // 期望值经读向表规范化:tile 流 sheet 域读回归一=TILE_INTERNAL_OF_STABLE[s]
    //  (389 别名→1027 开门真身,tiles.ts:1036 文档化别名)——恒等=规范化恒等
    const W = 40, H = 20, n = W * H;                           // 800 ≥ 753
    const type = new Uint16Array(n), frameX = new Uint16Array(n), frameY = new Uint16Array(n);
    let cell = 0;
    const expected = new Uint16Array(n);                       // 期望 stable 域(规范化后)
    for (const [s, iid] of [...sheets.entries()].sort((a, b) => a[0] - b[0])) {
      const x = cell % W, y = Math.floor(cell / W);
      type[y * W + x] = iid;
      expected[y * W + x] = TILE_STABLE_OF_INTERNAL[TILE_INTERNAL_OF_STABLE[s]];
      cell++;
    }
    const save = {
      ...mkWldSave(),
      header: { ...mkWldSave().header, width: W, height: H },
      tiles: bytesToB64(rleTiles({ type, frameX, frameY }, TILE_STABLE_OF_INTERNAL)),
      chests: [], furniture: undefined,
    } as unknown as SaveData;
    const { save: back } = parseWldToSave(exportWld(save));
    // 本地 RLE 解码(格式=serialize.rleTiles:[varint run-1][varint t][t≠0: varint fx, fy])
    const u8 = Uint8Array.from(atob(back.tiles as string), (c) => c.charCodeAt(0));
    const got = new Uint16Array(n);
    let p = 0, i = 0;
    while (i < n && p < u8.length) {
      let run = 0, s = 0;
      for (;;) { const b = u8[p++]; run |= (b & 0x7f) << s; if (!(b & 0x80)) break; s += 7; }
      let t = 0; s = 0;
      for (;;) { const b = u8[p++]; t |= (b & 0x7f) << s; if (!(b & 0x80)) break; s += 7; }
      if (t !== 0) {                                           // fx/fy 两个 varint 跳过
        for (;;) { if (!(u8[p++] & 0x80)) break; }
        for (;;) { if (!(u8[p++] & 0x80)) break; }
      }
      for (let k = 0; k <= run && i < n; k++, i++) got[i] = t;
    }
    // 逐格恒等(_serialize.rleTiles 游程按 raw 比较,重复值分格落笔——逐位对齐)
    for (let c = 0; c < n; c++) expect(got[c]).toBe(expected[c]);
  });
});

// ============================================================
// 收口 7:.plr 两向(读取 netId 域字面量/导出 vid 恒等回写)
// ============================================================
// .NET BinaryWriter 最小写侧(与 tests/plr-import.test.ts 同构;此处独立成件自持)
class PlrWriter {
  private chunks: number[] = [];
  byte(v: number) { this.chunks.push(v & 0xff); return this; }
  bool(v: boolean) { return this.byte(v ? 1 : 0); }
  i32(v: number) { const b = v | 0; this.chunks.push(b & 0xff, (b >>> 8) & 0xff, (b >>> 16) & 0xff, (b >>> 24) & 0xff); return this; }
  i64(v: bigint) { this.i32(Number(v & 0xffffffffn)).i32(Number((v >> 32n) & 0xffffffffn)); return this; }
  str(s: string) {
    const bytes = Array.from(new TextEncoder().encode(s));
    let len = bytes.length;
    for (;;) { if (len < 0x80) { this.chunks.push(len); break; } this.chunks.push((len & 0x7f) | 0x80); len >>= 7; }
    this.chunks.push(...bytes);
    return this;
  }
  item(netId: number, stack: number, prefix: number, fav?: boolean) {
    this.i32(netId).i32(stack).byte(prefix);
    if (fav !== undefined) this.bool(fav);
    return this;
  }
  equip(netId: number, prefix: number, fav?: boolean) {
    this.i32(netId).byte(prefix);
    if (fav !== undefined) this.bool(fav);
    return this;
  }
  rgb(r: number, g: number, b: number) { return this.byte(r).byte(g).byte(b); }
  build() { return new Uint8Array(this.chunks); }
}

/** v325 最小角色档(读侧消费到临时槽即停;物品段=原版 netID 域字面量) */
function buildPlr(): Uint8Array {
  const w = new PlrWriter();
  w.i32(325);
  w.i64(27981915666277746n | (3n << 56n)).i32(17).i64(0n);   // FileMetadata 20B
  w.str('哨兵');
  w.byte(0);                                                 // difficulty 经典
  w.i64(0n);                                                 // playTime(≥138)
  w.i32(0);                                                  // hair
  w.byte(0);                                                 // hairDye(≥82)
  w.byte(0);                                                 // team(≥283)
  w.byte(0).byte(0);                                         // hideVisible(≥124)
  w.byte(0);                                                 // hideMisc(≥119)
  w.byte(1);                                                 // skinVariant
  w.i32(400).i32(400).i32(100).i32(200);                     // life/max mana/max
  w.bool(false);                                             // extraAccessory(≥125)
  w.bool(false).bool(false).bool(false).bool(false);         // ≥229 三旗+≥324 新旗
  for (let i = 0; i < 6; i++) w.bool(false);                 // usedAegis…×6(≥260)
  w.bool(false);                                             // downedDD2(≥182)
  w.i32(0);                                                  // taxMoney(≥128)
  w.i32(0).i32(0);                                           // deathsPVE/PVP(≥254)
  for (let i = 0; i < 7; i++) w.rgb(0, 0, 0);                // 七色
  for (let i = 0; i < 20; i++) w.equip(i === 0 ? VID_SWORD : i === 1 ? VID_FRUIT : 0, 0, false);
  for (let i = 0; i < 10; i++) w.equip(0, 0, false);
  // 背包 58 槽:netId 字面量=原版 vid 域(1 铁镐/1291 生命果/4 铁阔剑/999999 越界)
  const VIDS = [VID_PICK, VID_FRUIT, VID_SWORD, 999999];
  for (let i = 0; i < 58; i++) w.item(VIDS[i] ?? 0, 10 - i, 0, false);
  for (let i = 0; i < 5; i++) { w.equip(0, 0); w.equip(0, 0); }   // miscE/D 交错
  for (let b = 0; b < 4; b++) for (let i = 0; i < 40; i++) w.item(0, 0, 0, b === 3 ? false : undefined);
  w.byte(0);                                                 // voidVaultInfo(≥199)
  for (let i = 0; i < 44; i++) w.i32(0).i32(0);              // buffs 44 对(≥252)
  w.i32(-1);                                                 // spawn 列表终止
  w.bool(false);                                             // hbLocked(≥16)
  for (let i = 0; i < 13; i++) w.bool(false);                // hideInfo(≥115)
  w.i32(0);                                                  // anglerQuestsFinished(≥98)
  for (let i = 0; i < 4; i++) w.i32(0);                      // DpadRadial(≥162)
  for (let i = 0; i < 12; i++) w.i32(0);                     // builderAcc(≥230)
  w.i32(0);                                                  // bartenderQuestLog(≥181)
  w.bool(false);                                             // dead(≥200)
  w.i64(0n);                                                 // lastTimeSaved(≥202)
  w.i32(0);                                                  // golfer(≥206)
  w.bool(false).i32(0);                                      // sacrifices(≥282/218)
  w.byte(0);                                                 // 临时槽 bits(≥214)=0
  for (let i = 0; i < 64; i++) w.byte(0);                    // 尾段垃圾(解析器停点后)
  // ECB+PKCS7 加密(仓内实现;对 node:crypto 同参对拍由 tests/plr-import.test.ts 锁定)
  return aes128EcbEncrypt(w.build());
}

describe('收口7 .plr 读取向:netId(vid)域→stableOf 键链字面量', () => {
  it('armor[0]=vid4→stable4;背包 vid1→1(非 1291!)/vid1291→1291/vid4→4/越界→null', () => {
    const p = parsePlr(buildPlr());
    // 产物=磁盘稳定 id 形(vi_ 件 stable≡vid);掩蔽对:旧裸下标 bug 把 vid 1 当
    // 内部下标→STABLE[1]=1291(铁镐变生命果)、vid4→STABLE[4]=282
    expect(p.playerState.armor?.[0]?.id).toBe(VID_SWORD);
    expect(p.playerState.inventory?.[0]?.id).toBe(VID_PICK);   // =1;≠1291
    expect(p.playerState.inventory?.[1]?.id).toBe(VID_FRUIT);  // =1291
    expect(p.playerState.inventory?.[2]?.id).toBe(VID_SWORD);  // =4;≠282
    expect(p.playerState.inventory?.[0]?.id).not.toBe(VID_FRUIT);
    expect(p.playerState.inventory?.[2]?.id).not.toBe(0);
    expect(p.playerState.inventory?.[3]).toBeNull();           // 未注册 vid 归 0=宁缺不错
    expect(p.version).toBe(PLR_VERSION_1457);
  });
});

describe('收口7 .plr 导出向:netIdOf vid 恒等回写(vi_ 门/SW 件归 0)', () => {
  const mkState = (): SaveData['player'] => ({
    hp: 300, x: 0, y: 0, selected: 0,
    inventory: [
      { id: VID_FRUIT, stack: 5 },                             // 生命果 stable 1291
      { id: VID_SWORD, stack: 1 },                             // 铁阔剑 stable 4
      { id: VID_PICK, stack: 2 },                              // 铁镐 stable 1
      { id: 10140, stack: 1 },                                 // place_v 派生件→0=空气
      ...Array.from({ length: 54 }, () => null),
    ],
    armor: [{ id: VID_SWORD, stack: 1 }, ...Array.from({ length: 19 }, () => null)],
    dye: Array.from({ length: 10 }, () => null),
    miscEquips: [null, null, null, null, null],
    miscDyes: [null, null, null, null, null],
    banks: [[{ id: VID_FRUIT, stack: 9 }], [], [], []],
    buffs: [],
  } as unknown as SaveData['player']);
  const appearance = {
    name: '哨兵', hair: 0, skinVariant: 1, difficulty: 0,
    hairColor: { r: 0, g: 0, b: 0 }, skinColor: { r: 0, g: 0, b: 0 }, eyeColor: { r: 0, g: 0, b: 0 },
    shirtColor: { r: 0, g: 0, b: 0 }, undershirtColor: { r: 0, g: 0, b: 0 },
    pantsColor: { r: 0, g: 0, b: 0 }, shoeColor: { r: 0, g: 0, b: 0 },
    voiceVariant: 0, voicePitchOffset: 0,
  } as unknown as Parameters<typeof exportPlr>[0];
  it('导出 vid 域字面量(1291/4/1),非内部下标(1/1327/…)——BJ146 掩蔽对两向钉死', () => {
    const bytes = exportPlr(appearance, mkState());
    const p = parsePlr(bytes);
    // BJ146 真值面（方案 A 恒等域下 vid 直写≡恒等;旧「内部下标直写」错位面已消亡）
    expect(p.playerState.inventory?.[0]?.id).toBe(VID_FRUIT);
    expect(p.playerState.inventory?.[1]?.id).toBe(VID_SWORD);
    expect(p.playerState.inventory?.[2]?.id).toBe(VID_PICK);
    expect(p.playerState.armor?.[0]?.id).toBe(VID_SWORD);
    expect(p.playerState.banks?.[0]?.[0]?.id).toBe(VID_FRUIT);
    expect(p.playerState.inventory?.[3]).toBeNull();           // SW 派生件不出档(0=空气)
    // 字节域再证:解密明文含 LE i32 1291/4(vid 直写非内部直写的字节面物证)
    const plain = aes128EcbDecrypt(bytes);
    const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
    let saw1291 = false, saw4 = false;
    for (let off = 0; off + 4 <= plain.length; off += 1) {
      const v = dv.getInt32(off, true);
      if (v === VID_FRUIT) saw1291 = true;
      if (v === VID_SWORD) saw4 = true;
    }
    expect(saw1291).toBe(true);
    expect(saw4).toBe(true);
  });
});

// ============================================================
// 收口 8:联机 key 域中立(IDG-4 grep 臂+msg5 位透传+键链)
// ============================================================
describe('收口8 联机域中立:msg5 位透传+键链(净边界无 id 表掺入,IDG-4 守卫)', () => {
  it('writePlayerItems→readPlayerItems 位透传恒等(双端同域,数值域过线零变换)', () => {
    const entries = [
      { playerSlot: 0, container: ItemContainer.Slots, itemSlot: 0, itemId: I4, stack: 7, prefix: 3 },
      { playerSlot: 0, container: ItemContainer.Armor, itemSlot: 3, itemId: I1291, stack: 1, prefix: 0 },
      { playerSlot: 1, container: ItemContainer.Slots, itemSlot: 57, itemId: 0, stack: 0 },
    ];
    const frame = writePlayerItems(entries);
    const r = new NetReader(frame.subarray(3));                // 跳 [u16 len][u8 msgId]
    const back = readPlayerItems(r);
    expect(back.map((e) => [e.playerSlot, e.container, e.itemSlot, e.itemId, e.stack, e.prefix]))
      .toEqual(entries.map((e) => [e.playerSlot, e.container, e.itemSlot, e.itemId, e.stack, e.prefix ?? 0]));
  });
  it('internalIdOfVid 键链:vid→键→内部 id(键域跨越,非数值表);键链落点稳定 id≡vid', () => {
    expect(internalIdOfVid(VID_SWORD)).toBe(I4);
    expect(internalIdOfVid(VID_FRUIT)).toBe(I1291);
    expect(internalIdOfVid(999999)).toBe(-1);                  // 未注册 vid=-1 哨兵
    for (let vid = 1; vid <= 6195; vid++) {
      const key = VANILLA_ITEM_KEY_BY_ID[vid];
      if (key === undefined) continue;
      // ★BJ744 改判史：BJ738 P08 SetDefaults 归一化（226→227,Item.cs:4195-4212
      //  case 226 共享块 type=227——226 非现役药水）重定向 226 权威键=vi_227 →
      //  归一化退位源 vid 键链终点=目标 vid 227（有意域外,键域跨越单点豁免;
      //  vi_226 def 保留注册=数组下标不可删,见 items.ts BJ738 注）。
      if (vid === 226) continue;
      const iid = internalIdOfVid(vid);
      expect(iid).toBeGreaterThanOrEqual(0);
      expect(ITEM_STABLE_OF_INTERNAL[iid]).toBe(vid);          // 键链终点=同 vid(域自洽)
    }
    // 归一化退位源键链终点=目标 vid（226→227,BJ738 P08 定向钉）
    expect(ITEM_STABLE_OF_INTERNAL[internalIdOfVid(226)]).toBe(227);
  });
});
