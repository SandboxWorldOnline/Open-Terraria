// SW-FX35（2026-09-11）：wld-compat 第二刀——TileEntities 段 11 类全型 + 导入面三桶。
// 金标锚（Terarria1457 亲读 + TEdit Terraria-Map-Editor 互证）：
//   - TE ExtraData 逐型（TileEntitiesManager.RegisterAll 序 TileEntitiesManager.cs:26-39）：
//     0 假人 short npc（TETrainingDummy.cs:119-127）/ 1 物品框·4 武器架·6 食物盘·8 展示罐
//     三元组 (short,byte,short)（TEItemFrame.cs:40-53/TEWeaponsRack.cs:54-67/
//     TEFoodPlatter.cs:41-46/TEDeadCellsDisplayJar.cs:40-45）/ 2 传感器 byte+bool
//     （TELogicSensor.cs:381-395）/ 3 模特（TEDisplayDoll.cs:157-278）/ 5 帽架
//     （TEHatRack.cs:56-111）/ 7 晶塔无负载（TETeleportationPylon 无覆写）/
//     ★9/10 锚桩 short itemType（TELeashedEntityAnchorWithItem.cs:9-17 继承覆写；
//     TEdit TileEntity.cs:414-417 `case CritterAnchor: case KiteAnchor: NetId=ReadInt16()`
//     互证——旧注「7/9/10 无 ExtraData」对 9/10 不成立,旧版双向流错位/挂物丢失）。
//   - townManager（WF:3400-3404→TownRoomManager.cs:94-106）：i32 n + n×(i32,i32,i32)。
//   - bestiary（WF:3411-3416→BestiaryUnlocksTracker.cs:14-19）序 Kills→Sights→Chats：
//     Kills=i32 n+n×(string persistentId,i32)（NPCKillsTracker.cs:60-71）；
//     Sights/Chats=i32 n+n×string（NPCWasNearPlayerTracker.cs:65-76/NPCWasChatWithTracker.cs:54-65）。
//     ★空图鉴=12B——旧版写 4B,原版 LoadBestiary 读 Sights/Chats 越段 → LoadWorld_Version2
//     :1844-1847 Position!=positions[9] → BadSectionPointer【整档拒载】。
//   - creativePowers（WF:3427-3432→CreativePowerManager.cs:125-137）：per-world 六力
//     bool true+u16 id+负载 循环+bool false 终止（0 FreezeTime bool :1465-1468/
//     8 ModifyTimeRate f32 滑杆 :972-975·TargetTimeRate=round(Remap(c,0,1,1,24)) :876-878/
//     9 FreezeRain bool :1533-1536/10 FreezeWind bool :1499-1502/12 DifficultySlider f32
//     :1169-1172/13 StopBiomeSpread bool :1567-1570）。
//   - 段位/拒载面：SaveWorld_Version2 WF:1156-1174 段序；LoadWorld_Version2 段尾
//     Position 逐段硬校验（WF:1788-1862）。
// 判据：export→parse→export 全等（round-trip 主判据）+ 段字节长度锁 + 变异证红。
import { describe, it, expect } from 'vitest';
// ★BJ743-A（R24 SEV-2 族）：require('node:fs') 读形收编 ESM import（行为不变）。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exportWld } from '../src/wld/WldExport';
import { parseWld } from '../src/wld/WldParser';
import { parseWldToSave } from '../src/wld/WldImport';
import { bytesToB64, rleTiles, rlePairs, type SaveData } from '../src/save/SaveFile';
import { TILE_BY_KEY, TILE_STABLE_OF_INTERNAL } from '../src/data/tiles';
import { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, ITEM_STABLE_OF_INTERNAL } from '../src/data/items';

const W = 40, H = 16;

function mkSave(over?: Partial<SaveData>): SaveData {
  const n = W * H;
  const type = new Uint16Array(n);
  // TE 承载 tile（内部 id 域,rleTiles 经 TILE_STABLE_OF_INTERNAL 映稳定;锚帧 = style0 裸带 0）
  const put = (x: number, y: number, key: string) => { type[y * W + x] = TILE_BY_KEY[key]; };
  put(4, 2, 'v_520_plate');            // 食物盘 520（1×1）
  put(6, 2, 'v_698_item_flask');       // 展示罐 698（1×2,锚=上格）
  put(6, 3, 'v_698_item_flask');
  put(8, 2, 'v_723_kite_anchor');      // 风筝锚桩 723
  put(10, 2, 'v_724_critter_anchor');  // 小动物锚桩 724
  put(12, 2, 'v_395_item_frame');      // 物品框 395（2×2）
  put(13, 2, 'v_395_item_frame');
  put(12, 3, 'v_395_item_frame');
  put(13, 3, 'v_395_item_frame');
  return {
    format: 'sandboxworld.save', version: 5,
    header: {
      name: 'FX35回环', seed: 7, width: W, height: H,
      spawn: [8, 6], groundLevel: 6, rockLevel: 9,
      crimson: false, dungeonX: 2, dungeonY: 5,
      created: 1700000000000, playTimeMs: 0, difficulty: 0,
      journeyTimeRate: 1, journeyFreezeTime: false,
    },
    clock: { timeOfDay: 0.25, dayCount: 1, moonPhase: 0, bloodMoon: false, eclipse: false },
    invasion: { type: 0, size: 0, sizeStart: 0, x: 0, delay: 0 },
    events: { partyManual: false, lanternManual: false, lanternGenuine: false, lanternNext: false, lanternCooldown: 0 },
    player: { hp: 100, x: 0, y: 0, inventory: [], selected: 0 },
    tiles: bytesToB64(rleTiles({ type, frameX: new Uint16Array(n), frameY: new Uint16Array(n) }, TILE_STABLE_OF_INTERNAL)),
    walls: bytesToB64(rlePairs(new Uint16Array(n))),
    liquid: bytesToB64(rlePairs(new Uint16Array(n))),
    liquidType: bytesToB64(rlePairs(new Uint8Array(n))),
    wire: bytesToB64(rlePairs(new Uint16Array(n))),
    blocks: bytesToB64(rlePairs(new Uint8Array(n))),
    paint: bytesToB64(rlePairs(new Uint8Array(n))),
    paintWall: bytesToB64(rlePairs(new Uint8Array(n))),
    coat: bytesToB64(rlePairs(new Uint8Array(n))),
    chests: [], signs: [], npcs: [], flags: {},
    ...over,
  } as unknown as SaveData;
}

const vidStable = (vid: number): number => ITEM_STABLE_OF_INTERNAL[ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[vid]!]!];

const FULL_SAVE = (): SaveData => mkSave({
  furniture: [
    { x: 4, y: 2, kind: 'food_platter', slots: [vidStable(353) ? { id: vidStable(353), stack: 1 } : null] },
    { x: 6, y: 2, kind: 'display_jar', slots: [{ id: vidStable(37), stack: 1 }] },
    { x: 8, y: 2, kind: 'kite_anchor', slots: [{ id: vidStable(353), stack: 1 }] },
    { x: 10, y: 2, kind: 'critter_anchor', slots: [{ id: vidStable(4), stack: 1 }] },
    { x: 12, y: 2, kind: 'item_frame', slots: [{ id: vidStable(3509), stack: 1 }] },
  ],
  // 不建模三类透传（0 假人/2 传感器/7 晶塔）——npc=100/传感器 Day 档输出开/晶塔原值
  teSnap: [
    { type: 0, x: 20, y: 5, npc: 100 },
    { type: 2, x: 22, y: 5, logicCheck: 1, on: true },
    { type: 7, x: 24, y: 5 },
    { type: 7, x: 26, y: 5 },
  ],
  bestiary: { k: { Zombie: 137, TorchGod: 15 }, s: ['Slime', 'Guide'], c: ['Merchant'] },
  townRooms: [
    { npc: 17, x: 3189, y: 411 }, { npc: 22, x: 3193, y: 390 }, { npc: 369, x: 6096, y: 301 },
  ],
  header: {
    name: 'FX35回环', seed: 7, width: W, height: H,
    spawn: [8, 6], groundLevel: 6, rockLevel: 9, crimson: false, dungeonX: 2, dungeonY: 5,
    created: 1700000000000, playTimeMs: 0, difficulty: 3,
    journeyTimeRate: 24, journeyFreezeTime: true,
    journeyPowers: { freezeRain: true, freezeWind: true, stopBiomeSpread: true, difficultySlider: 0.33 },
  },
} as Partial<SaveData>);

// ---- 合成尾段拼接：以 exportWld(空存档) 为头,tail 自写并回钉 pointers[5..10] ----
class Writer {
  out: number[] = [];
  u8(v: number) { this.out.push(v & 0xff); return this; }
  u16(v: number) { return this.u8(v & 0xff).u8((v >> 8) & 0xff); }
  i16(v: number) { return this.u8(v).u8(v >> 8); }
  i32(v: number) { return this.i16(v).i16(v >> 16); }
  f32(v: number) { const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, v, true); for (let i = 0; i < 4; i++) this.u8(dv.getUint8(i)); return this; }
  bool(v: boolean) { return this.u8(v ? 1 : 0); }
  str(s: string) {
    const b = new TextEncoder().encode(s); let len = b.length;
    while (len >= 0x80) { this.u8((len & 0x7f) | 0x80); len >>>= 7; }
    this.u8(len); for (const c of b) this.u8(c); return this;
  }
  bytes(a: ArrayLike<number>) { for (let i = 0; i < a.length; i++) this.u8(a[i]); return this; }
  build(): Uint8Array { return Uint8Array.from(this.out); }
}

/** head（至 TE 段起 = pointers[5]）+ 自写尾（TE/压力板/townManager/bestiary/creativePowers/footer）。
 *  原版 pointers 语义（SaveWorld_Version2 :1156-1174）：pointers[i]=第 i 段【尾】=
 *  下一段起——head 截止点=旧 pointers[5]（TE 起）不动，marks[0..4]（各新段尾）回钉
 *  pointers[6..10]（LoadWorld_Version2 :1788-1862 逐段 Position 校验同构） */
function buildWldWithTail(writeTail: (w: Writer) => { marks: number[]; footer?: (w: Writer) => void }): Uint8Array {
  const base = exportWld(mkSave());
  const dv0 = new DataView(base.buffer);
  const ptr = (i: number) => dv0.getInt32(26 + i * 4, true);
  const head = base.slice(0, ptr(5));
  const w = new Writer();
  w.bytes(head);
  const { marks } = writeTail(w);
  // footer（WF:1759：true+name+worldId）
  w.bool(true).str('FX35回环').i32(12345);
  const bytes = w.build();
  const dv = new DataView(bytes.buffer);
  for (let i = 6; i <= 10; i++) dv.setInt32(26 + i * 4, marks[i - 6], true);
  return bytes;
}

type TeByte = { t: number; x: number; y: number; a?: number; b?: number; c?: number; d?: number };
const writeTe = (w: Writer, e: TeByte) => {
  w.u8(e.t).i32(0).i16(e.x).i16(e.y);
  switch (e.t) {
    case 0: w.i16(e.a ?? -1); break;                                   // short npc
    case 2: w.u8(e.a ?? 0).bool(!!e.b); break;                          // logicCheck+On
    case 9: case 10: w.i16(e.a ?? 0); break;                            // short itemType ★FX35
    case 1: case 4: case 6: case 8: w.i16(e.a ?? 0).u8(e.b ?? 0).i16(e.c ?? 0); break; // 三元组
  }
};

describe('SW-FX35 TE 段全型解码（合成 .wld）', () => {
  const tail = (w: Writer) => {
    const marks: number[] = [];
    // TE 段：11 型全谱
    w.i32(10);
    const tes: TeByte[] = [
      { t: 0, x: 30, y: 4, a: 5 },                      // 假人 npc=5
      { t: 1, x: 12, y: 2, a: 353, b: 3, c: 1 },        // 物品框三元组
      { t: 2, x: 31, y: 4, a: 3, b: 1 },                // 传感器 PlayerAbove+On
      { t: 4, x: 32, y: 4, a: 3509, b: 0, c: 1 },       // 武器架
      { t: 6, x: 4, y: 2, a: 353, b: 0, c: 1 },         // 食物盘
      { t: 7, x: 33, y: 4 },                            // 晶塔（无负载）
      { t: 8, x: 6, y: 2, a: 37, b: 0, c: 1 },          // 展示罐
      { t: 9, x: 8, y: 2, a: 353 },                     // 风筝锚桩挂物
      { t: 10, x: 10, y: 2, a: 4 },                     // 小动物锚桩挂物
      { t: 5, x: 34, y: 4, a: 3, b: 1 },                // 帽架（bit0 hat0+bit2 dye0）
    ];
    // 帽架负载：位图（bit0=hat0+bit2=dye0）后按位序三元组（TEHatRack.cs:56-111）
    for (const e of tes) {
      if (e.t === 5) { writeTe(w, e); w.u8(5); w.i16(88).u8(0).i16(1); w.i16(4).u8(0).i16(1); continue; }
      writeTe(w, e);
    }
    marks.push(w.out.length);                            // [5] TE 尾
    w.i32(0); marks.push(w.out.length);                  // [6] 压力板尾
    w.i32(2).i32(17).i32(3189).i32(411).i32(22).i32(3193).i32(390);
    marks.push(w.out.length);                            // [7] townManager 尾
    w.i32(1).str('Zombie').i32(42).i32(1).str('Slime').i32(1).str('Guide');
    marks.push(w.out.length);                            // [8] bestiary 尾
    w.bool(true).u16(0).bool(true)
      .bool(true).u16(8).f32(0.5)
      .bool(true).u16(9).bool(true)
      .bool(true).u16(10).bool(false)
      .bool(true).u16(12).f32(0.33)
      .bool(true).u16(13).bool(true)
      .bool(false);
    marks.push(w.out.length);                            // [9] creativePowers 尾
    return { marks };
  };

  const buf = buildWldWithTail(tail);
  const wld = parseWld(buf);
  const { save } = parseWldToSave(buf);

  it('11 型全谱解码：0/2/6/7/8/9/10 负载逐字段落位', () => {
    const by = (t: number) => wld.tileEntities.filter((e) => e.type === t);
    expect(wld.teSkipped).toBe(0);
    expect(by(0)[0]?.dummy).toEqual({ npc: 5 });
    expect(by(1)[0]?.item).toEqual({ vid: 353, prefix: 3, stack: 1 });
    expect(by(2)[0]?.sensor).toEqual({ logicCheck: 3, on: true });
    expect(by(4)[0]?.item).toEqual({ vid: 3509, prefix: 0, stack: 1 });
    expect(by(6)[0]?.item).toEqual({ vid: 353, prefix: 0, stack: 1 });
    expect(by(7)).toHaveLength(1);
    expect(by(8)[0]?.item).toEqual({ vid: 37, prefix: 0, stack: 1 });
    expect(by(9)[0]?.item).toEqual({ vid: 353, prefix: 0, stack: 1 });   // 锚桩=short itemType
    expect(by(10)[0]?.item).toEqual({ vid: 4, prefix: 0, stack: 1 });
    expect(by(5)[0]?.hat?.hats[0]).toEqual({ vid: 88, prefix: 0, stack: 1 });
  });

  it('物化面：食物盘/展示罐/锚桩落 furniture（运行时 kind 全谱）+ 假人/传感器/晶塔落 teSnap', () => {
    const f = (kind: string) => (save.furniture ?? []).find((e) => e.kind === kind);
    expect(f('food_platter')?.slots[0]).toEqual({ id: vidStable(353), stack: 1 });
    expect(f('display_jar')?.slots[0]).toEqual({ id: vidStable(37), stack: 1 });
    expect(f('kite_anchor')?.slots[0]).toEqual({ id: vidStable(353), stack: 1 });
    expect(f('critter_anchor')?.slots[0]).toEqual({ id: vidStable(4), stack: 1 });
    expect(save.teSnap).toEqual([
      { type: 0, x: 30, y: 4, npc: 5 },
      { type: 2, x: 31, y: 4, logicCheck: 3, on: true },
      { type: 7, x: 33, y: 4 },
    ]);
  });

  it('三桶落地：townRooms/bestiary/journeyPowers（值域换算 rate=round(1+23·cache)）', () => {
    expect(save.townRooms).toEqual([{ npc: 17, x: 3189, y: 411 }, { npc: 22, x: 3193, y: 390 }]);
    expect(save.bestiary).toEqual({ k: { Zombie: 42 }, s: ['Slime'], c: ['Guide'] });
    expect(save.header.journeyFreezeTime).toBe(true);
    // difficultySlider 走 f32 落盘（vanilla Save 写 _sliderCurrentValueCache :1169-1172）——
    //  0.33 经 f32 量化为 0.33000001311302185，语义等价（ULP 容差备案判据）
    expect(save.header.journeyPowers?.freezeRain).toBe(true);
    expect(save.header.journeyPowers?.freezeWind).toBe(false);
    expect(save.header.journeyPowers?.stopBiomeSpread).toBe(true);
    expect(save.header.journeyPowers?.difficultySlider).toBeCloseTo(0.33, 6);
    // ModifyTimeRate：cache 0.5 → TargetTimeRate = round(1+23·0.5)=roundEven(12.5)=12
    // （CreativePowers.cs:876-878；.NET Math.Round 银行家舍入,中点取偶）
    expect(save.header.journeyTimeRate).toBe(12);
  });
});

describe('SW-FX35 导出段字节锁 + round-trip 全等', () => {
  it('空桶字节面：bestiary 空=12B（★旧版 4B=原版 BadSectionPointer 拒载）/townManager=4B/creativePowers=31B', () => {
    const dv = new DataView(exportWld(mkSave()).buffer);
    const p = (i: number) => dv.getInt32(26 + i * 4, true);
    expect(p(9) - p(8)).toBe(12);      // Kills0+Sights0+Chats0 = 3×i32
    expect(p(8) - p(7)).toBe(4);       // 空房间表 = i32(0)
    expect(p(10) - p(9)).toBe(31);     // 6 力（4+7+4+4+7+4）+ 终止 bool = 31
  });

  it('锚桩 TE 字节锁：type 9/10 各归其位 + short itemType 随档（旧版裸占位/9-10 混写双债）', () => {
    const bytes = exportWld(FULL_SAVE());
    const dv = new DataView(bytes.buffer);
    const p5 = dv.getInt32(26 + 5 * 4, true);   // TE 段起
    const n = dv.getInt32(p5, true);
    let pos = p5 + 4;
    const kinds: Array<{ t: number; item: number }> = [];
    for (let i = 0; i < n; i++) {
      const t = bytes[pos];
      const x = dv.getInt16(pos + 5, true);
      const y = dv.getInt16(pos + 7, true);
      let item = -1;
      if (t === 9 || t === 10) item = dv.getInt16(pos + 9, true);
      if (t === 9 || t === 10 || t === 6 || t === 8 || t === 1 || t === 4) kinds.push({ t, item });
      // TE 总长 = 头 9（type1+id4+x2+y2）+ ExtraData：三元组 5/锚桩·假人·传感器 2/晶塔 0
      const len = t === 1 || t === 4 || t === 6 || t === 8 ? 14
        : t === 0 || t === 2 || t === 9 || t === 10 ? 11
        : t === 7 ? 9 : 0;
      expect(len).toBeGreaterThan(0);
      void x; void y;
      pos += len;
    }
    expect(kinds).toContainEqual({ t: 9, item: vidStable(353) });
    expect(kinds).toContainEqual({ t: 10, item: vidStable(4) });
  });

  it('round-trip：export→import→export 字节全等（TE 全型+三桶+旅程力）', () => {
    const save = FULL_SAVE();
    const b1 = exportWld(save);
    const back = parseWldToSave(b1).save;
    // 字段级断言（再导出前锁定语义）
    expect(back.furniture).toHaveLength(5);
    expect(back.teSnap).toEqual([{ type: 0, x: 20, y: 5, npc: 100 }, { type: 2, x: 22, y: 5, logicCheck: 1, on: true }, { type: 7, x: 24, y: 5 }, { type: 7, x: 26, y: 5 }]);
    expect(back.bestiary).toEqual({ k: { Zombie: 137, TorchGod: 15 }, s: ['Slime', 'Guide'], c: ['Merchant'] });
    expect(back.townRooms).toEqual([{ npc: 17, x: 3189, y: 411 }, { npc: 22, x: 3193, y: 390 }, { npc: 369, x: 6096, y: 301 }]);
    expect(back.header.journeyFreezeTime).toBe(true);
    expect(back.header.journeyTimeRate).toBe(24);
    expect(back.header.journeyPowers?.freezeRain).toBe(true);
    expect(back.header.journeyPowers?.freezeWind).toBe(true);
    expect(back.header.journeyPowers?.stopBiomeSpread).toBe(true);
    expect(back.header.journeyPowers?.difficultySlider).toBeCloseTo(0.33, 6);
    const b2 = exportWld(back);
    // 全等比较自 pointers[2]（tiles 段起）——header 内 worldId/lastSavedTime 为
    // 导入侧 created=Date.now()（WldImport 既有行为）与导出侧 Date.now() 派生的
    // 【设计内非确定位】（WldHeaderFields :39/:61）,与 TE/三桶无关。
    const dv1 = new DataView(b1.buffer);
    const start = dv1.getInt32(26 + 2 * 4, true);
    expect(Buffer.from(b2.subarray(start)).equals(Buffer.from(b1.subarray(start)))).toBe(true);
  });

  it('变异证红：锚桩 itemType 短字节翻改 → 导入挂物随变（字段敏感）', () => {
    const save = FULL_SAVE();
    save.furniture = [{ x: 8, y: 2, kind: 'kite_anchor', slots: [{ id: vidStable(353), stack: 1 }] }];
    save.teSnap = undefined; save.bestiary = undefined; save.townRooms = undefined;
    const bytes = exportWld(save);
    const dv = new DataView(bytes.buffer);
    const p5 = dv.getInt32(26 + 5 * 4, true);
    // TE 计数 i32 @p5，首 TE 起 @p5+4：type@+4, id@+5..8, x@+9..10, y@+11..12, itemType@+13..14
    expect(bytes[p5 + 4]).toBe(9);
    dv.setInt16(p5 + 13, 88, true);
    const rec = parseWldToSave(bytes).save;
    expect(rec.furniture?.[0]?.slots[0]?.id).toBe(vidStable(88));
  });

  it('变异证红：假人 npc/传感器负载翻改 → teSnap 透传随变', () => {
    const save = mkSave({ teSnap: [{ type: 0, x: 1, y: 1, npc: 100 }, { type: 2, x: 2, y: 1, logicCheck: 4, on: false }] });
    const bytes = exportWld(save);
    const dv = new DataView(bytes.buffer);
    const p5 = dv.getInt32(26 + 5 * 4, true);
    // 首条=假人 TE：type@p5+4，npc short@p5+13..14；假人 TE 长 11 → 传感器 TE 起 @p5+15
    expect(bytes[p5 + 4]).toBe(0);
    dv.setInt16(p5 + 13, 7, true);                      // npc 100→7
    const p2 = p5 + 4 + 11;                             // 传感器 TE 起
    expect(bytes[p2]).toBe(2);
    bytes[p2 + 9] = 6;                                   // logicCheck 4→6(Liquid)
    bytes[p2 + 10] = 1;                                  // On false→true
    const rec = parseWldToSave(bytes).save;
    expect(rec.teSnap).toEqual([{ type: 0, x: 1, y: 1, npc: 7 }, { type: 2, x: 2, y: 1, logicCheck: 6, on: true }]);
  });
});

describe('SW-FX35 真实档回归（Starter_World v279）：三桶导入→导出→自解析', () => {
  it('teSnap/townRooms/bestiary/powers 全量进 SaveData 并零漂移回写', () => {
    // ★BJ743-A:require 读形收编顶部 ESM import(守卫域外 .wld,行为不变)
    const REAL = join(__dirname, '..', 'Starter_World Master.wld');
    if (!existsSync(REAL)) return;
    const buf = new Uint8Array(readFileSync(REAL));
    const { save } = parseWldToSave(buf);
    expect(save.teSnap?.filter((t) => t.type === 7)).toHaveLength(8);
    expect(save.teSnap?.find((t) => t.type === 0)).toEqual({ type: 0, x: 3242, y: 348, npc: 100 });
    expect(save.townRooms).toHaveLength(13);
    expect(save.bestiary?.k).toEqual({ TorchGod: 15 });
    // 导出→自解析：三桶逐值全等（round-trip 主判据）
    const wld2 = parseWld(exportWld(save));
    expect(wld2.townRooms).toEqual(save.townRooms);
    expect(wld2.bestiary).toEqual(save.bestiary!);
    expect(wld2.creativePowers).toEqual([{ id: 0, bool: false }, { id: 8, num: 0 }, { id: 9, bool: false }, { id: 10, bool: false }, { id: 12, num: 0 }, { id: 13, bool: false }]);
    expect(wld2.tileEntities.filter((t) => t.type === 7)).toHaveLength(8);
    expect(wld2.tileEntities.filter((t) => t.type === 0).map((t) => t.dummy?.npc)).toEqual([100]);
  });
});

// ---- ★SW-RB14c（2026-09-12）：teSnap 残影与活态家具同位冲突守卫 ----
describe('SW-RB14c：teSnap 同位冲突 → 活态家具胜出（WF:3339-3342 后写覆盖语义反置）', () => {
  it('同位 (4,2)：teSnap 假人残影被滤,food_platter 全量回写', () => {
    const save = mkSave({
      furniture: [{ x: 4, y: 2, kind: 'food_platter', slots: [{ id: vidStable(353), stack: 1 }] } as never],
      teSnap: [{ type: 0, x: 4, y: 2, npc: 100 }],
    });
    const bytes = exportWld(save);
    const rec = parseWldToSave(bytes).save;
    // 活态家具胜出（修复前:snap 残影后写 → vanilla/本仓解析双双只留假人,挂物丢失）
    expect(rec.furniture?.length).toBe(1);
    expect(rec.furniture?.[0]?.kind).toBe('food_platter');
    expect(rec.teSnap?.length ?? 0).toBe(0);
  });
  it('异位共存：非冲突 teSnap 照常透传（守卫零误伤）', () => {
    const save = mkSave({
      furniture: [{ x: 4, y: 2, kind: 'food_platter', slots: [{ id: vidStable(353), stack: 1 }] } as never],
      teSnap: [{ type: 0, x: 20, y: 5, npc: -1 }, { type: 7, x: 26, y: 5 }],
    });
    const rec = parseWldToSave(exportWld(save)).save;
    expect(rec.furniture?.length).toBe(1);
    expect(rec.furniture?.[0]?.slots[0]?.id).toBe(vidStable(353));
    expect(rec.teSnap?.map((t) => t.type)).toEqual([0, 7]);   // 异位两件全透传
  });
});
