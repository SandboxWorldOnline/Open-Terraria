// 原版段流（msg10 TileSection）解码器 —— DecompressTileBlock_Inner 全量移植
//（NetMessage.cs:2272-2450 读侧为唯一权威；CompressTileBlock:1906 全载荷 raw deflate）。
// 落地约定镜像 wld/WldImport.ts（liquidType 域 1水2浆3蜜4以太 / slope 门
// tileSolid∪平台∪NonSolidSaveSlopes / wall 直拷(≥367 mod 域钳零) / framed 直拷帧）。
// 直写 store 数组绕过事件（同 decodeStrip 先例）——调用方负责整块标脏 chunk+小地图。
import { inflateRawSync, VReader } from './codec';
import { TILE_DEFS, PLATFORMS_SHEETS, NON_SOLID_SAVE_SLOPES_SHEETS } from '../../data/tiles';
import { mapVanillaTile } from '../../wld/WldImport';
import { TileStore } from '../../world/TileStore';

/**
 * ★原版 tileFrameImportant 权威表（wire 域,2026-10-24 提取自 Terarria1458 Main.cs）：
 * ①Main.cs 全部 `tileFrameImportant[N] = true` 字面量（398 处）②AddEchoFurnitureTile
 * 调用族 647-652/693/694/706（helper 变量形态赋值）③:10125 循环 435-439。
 * ⚠与引擎 TILE_DEFS[].framed 有 4 处差集（19 Platforms/380 PlanterBox 引擎漏、
 * 32 CorruptThorns/80 Cactus 引擎多——后者原版为渲染期随机帧非 wire 帧）：
 * wire 帧门必须用本表（差集任一位错=段流失步，rig 判例 32719/3991 消费超跑）。
 * 闸门：tests/vanilla-frameimportant.test.ts（从 Main.cs 再提取对账,漂移即爆红）。
 */
const VANILLA_FRAME_IMPORTANT_RANGES = ['3-5', '10-21', '24', '26-29', '31', '33-36', '42', '49-50', '55', '61', '71-74', '77-79', '81-106', '110', '113-114', '125-126', '128-129', '132-139', '141-144', '149', '165', '171-174', '178', '184-187', '201', '207', '209-210', '212', '215-220', '227-228', '231', '233', '235-247', '254', '269-271', '275-283', '285-310', '314', '316-320', '323-324', '334-335', '337-339', '349', '354-356', '358-364', '372-378', '380', '386-395', '405-406', '410-414', '419-420', '423-425', '427-429', '435-445', '452-457', '461-471', '475-476', '480', '484-491', '493-494', '497', '499', '505-506', '509-511', '518-527', '529-533', '538', '542-545', '547-556', '558-560', '564-565', '567-573', '579-617', '619-624', '629-632', '634', '637', '639-640', '642-654', '656-658', '660', '663-665', '693-696', '698-707', '709-716', '720-721', '723-726', '733', '751-753'];
export const VANILLA_FRAME_IMPORTANT = new Uint8Array(754);
for (const r of VANILLA_FRAME_IMPORTANT_RANGES) {
  const [a, b] = r.includes('-') ? r.split('-').map(Number) : [Number(r), Number(r)];
  for (let i = a; i <= b; i++) VANILLA_FRAME_IMPORTANT[i] = 1;
}

export interface SectionRect { x0: number; y0: number; w: number; h: number }
export interface SectionChest { idx: number; x: number; y: number; name: string }
export interface SectionSign { idx: number; x: number; y: number; text: string }
/** 解码一条 msg20 AreaTileChange 载荷直写 store（MessageBuffer case20 readerRaw 1:1,
 *  2026-10-25 P1）。与段流编码的差异：type/wall 恒 u16 直写（无压缩位链）、无 RLE、
 *  帧字段由 VANILLA_FRAME_IMPORTANT 权威表门控。返回落地区域（null=越界丢弃）。 */
export function applyVanillaTileArea(store: TileStore, payload: Uint8Array):
  { x0: number; y0: number; w: number; h: number } | null {
  const r = new VReader(payload);
  const x0 = r.i16(), y0 = r.i16(), w = r.u8(), h = r.u8();
  r.u8(); // TileChangeType（客户端仅回调通知,无面消费）
  if (x0 < 0 || y0 < 0 || x0 + w > store.w || y0 + h > store.h) return null;
  for (let ix = x0; ix < x0 + w; ix++) {
    for (let iy = y0; iy < y0 + h; iy++) {
      const b19 = r.u8(), b20 = r.u8(), b21 = r.u8();
      const active = !!(b19 & 1);
      const wallPresent = !!(b19 & 4);
      const liquidPresent = !!(b19 & 8);
      let paint = 0, paintWall = 0;
      if (b20 & 4) paint = r.u8();
      if (b20 & 8) paintWall = r.u8();
      let type = 0, fx = 0, fy = 0, slope = 0, vanillaType = 0;
      if (active) {
        vanillaType = r.u16();
        const mapped = mapVanillaTile(vanillaType);
        type = mapped ? mapped.id : 0;
        if (VANILLA_FRAME_IMPORTANT[vanillaType] !== 0) { fx = r.i16() & 0xffff; fy = r.i16() & 0xffff; }
        // slope = b20[4..6] 三位和（0 平/1 半砖语义另走 half/2-4 斜面）
        slope = ((b20 & 0x10) ? 1 : 0) + ((b20 & 0x20) ? 2 : 0) + ((b20 & 0x40) ? 4 : 0);
      }
      let wall = 0;
      if (wallPresent) wall = r.u16();
      let liquid = 0, liquidType = 1;
      if (liquidPresent) { liquid = r.u8(); liquidType = r.u8(); }
      let wire = 0;
      if (b19 & 0x10) wire |= TileStore.WIRE_RED;
      if (b20 & 0x01) wire |= TileStore.WIRE_BLUE;
      if (b20 & 0x02) wire |= TileStore.WIRE_GREEN;
      if (b20 & 0x80) wire |= TileStore.WIRE_YELLOW;
      if (b19 & 0x40) wire |= TileStore.WIRE_ACTUATOR;
      if (b19 & 0x80) wire |= TileStore.WIRE_ACTUATED;
      let coat = 0;
      if (b21 & 1) coat |= TileStore.COAT_FULLBRIGHT_BLOCK;
      if (b21 & 2) coat |= TileStore.COAT_FULLBRIGHT_WALL;
      if (b21 & 4) coat |= TileStore.COAT_INVISIBLE_BLOCK;
      if (b21 & 8) coat |= TileStore.COAT_INVISIBLE_WALL;
      const i = iy * store.w + ix;
      store.type[i] = active ? type : 0;
      store.flags[i] = active ? 1 : 0;
      store.frameX[i] = active ? fx : 0;
      store.frameY[i] = active ? fy : 0;
      store.wall[i] = wall >= 367 ? 0 : wall; // mod 墙域钳零（同 writeTile 判例）
      store.liquid[i] = liquid;
      store.liquidType[i] = liquid > 0 ? liquidType : 0;
      store.wire[i] = wire;
      store.paint[i] = paint;
      store.paintWall[i] = paintWall;
      store.coat[i] = coat;
      store.half[i] = 0; store.slope[i] = 0;
      if (active && slope === 1) {
        const solid = TILE_DEFS[type]?.solid
          || PLATFORMS_SHEETS.has(vanillaType)
          || NON_SOLID_SAVE_SLOPES_SHEETS.has(vanillaType);
        if (solid) store.half[i] = 1;
      } else if (active && slope > 1) {
        const solid = TILE_DEFS[type]?.solid
          || PLATFORMS_SHEETS.has(vanillaType)
          || NON_SOLID_SAVE_SLOPES_SHEETS.has(vanillaType);
        if (solid) store.slope[i] = slope - 1;
      }
    }
  }
  return { x0, y0, w, h };
}

export interface DecodedSection {
  rect: SectionRect;
  chests: SectionChest[];
  signs: SectionSign[];
  /** TE 条数 + 实际解析数（已知型;3/4/7 变长体止损停读——TE 居段尾只损自身） */
  teCount: number;
  teParsed?: number;
  teTruncated?: boolean;
  /** 解码消耗的字节数（含尾段；≠inflate 长度即帧界异常,fail-loud 由调用方判） */
  consumed: number;
}

/** 解码一条 msg10 载荷（msgId 之后的全量字节 = raw deflate 流）直写 store。 */
export function decodeVanillaSection(store: TileStore, payload: Uint8Array): DecodedSection | null {
  const raw = inflateRawSync(payload);
  const r = new VReader(raw);
  const x0 = r.i32(), y0 = r.i32(), w = r.i16(), h = r.i16();
  if (x0 < 0 || y0 < 0 || x0 + w > store.w || y0 + h > store.h) return null; // 越界段丢弃（同 decodeStrip 判例）

  const idx = (x: number, y: number) => y * store.w + x;
  // RLE 上一 tile 的落地状态（CopyFrom 语义）：解出后直接重放写入
  let run = 0;
  let lastX = -1, lastY = -1;
  const writeTile = (x: number, y: number, t: {
    active: boolean; type: number; fx: number; fy: number; wall: number;
    liquid: number; liquidType: number; wire: number; half: number; slope: number;
    paint: number; paintWall: number; coat: number; vanillaType?: number;
  }) => {
    const i = idx(x, y);
    store.type[i] = t.active ? t.type : 0;
    store.flags[i] = t.active ? 1 : 0; // bit0=active（TileStore 约定）
    store.frameX[i] = t.active ? t.fx : 0;
    store.frameY[i] = t.active ? t.fy : 0;
    store.wall[i] = t.wall >= 367 ? 0 : t.wall; // mod 墙域钳零（WldImport 同判例）
    store.liquid[i] = t.liquid;
    store.liquidType[i] = t.liquid > 0 ? t.liquidType : 0;
    store.wire[i] = t.wire;
    store.paint[i] = t.paint;
    store.paintWall[i] = t.paintWall;
    store.coat[i] = t.coat;
    store.half[i] = 0; store.slope[i] = 0;
    if (t.half || t.slope) {
      // slope 门 = 原版域 tileSolid ∪ 平台 ∪ NonSolidSaveSlopes（WorldFile.cs:2623/2637
      // 读侧同门;杂波 bits 不落地防切条裁剪——WldImport 同源判例）
      const solid = TILE_DEFS[store.type[i]]?.solid
        || PLATFORMS_SHEETS.has(t.vanillaType ?? -1)
        || NON_SOLID_SAVE_SLOPES_SHEETS.has(t.vanillaType ?? -1);
      if (solid) { store.half[i] = t.half; store.slope[i] = t.slope; }
    }
  };

  let tile: {
    active: boolean; type: number; fx: number; fy: number; wall: number;
    liquid: number; liquidType: number; wire: number; half: number; slope: number;
    paint: number; paintWall: number; coat: number; vanillaType?: number;
  } | null = null;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (run > 0) {
        run--;
        if (tile && !(x === lastX && y === lastY)) writeTile(x, y, tile);
        continue;
      }
      // ---- 标志链：b4 → [b] → [b2] → [b3]（NetMessage.cs:2297-2310）----
      const b4 = r.u8();
      let b = 0, b2 = 0, b3 = 0;
      if (b4 & 1) {
        b = r.u8();
        if (b & 1) {
          b2 = r.u8();
          if (b2 & 1) b3 = r.u8();
        }
      }
      const t: Parameters<typeof writeTile>[2] & { vanillaType?: number } = {
        active: false, type: 0, fx: 0, fy: 0, wall: 0,
        liquid: 0, liquidType: 1, wire: 0, half: 0, slope: 0,
        paint: 0, paintWall: 0, coat: 0,
      };
      if (b4 & 2) { // active
        t.active = true;
        let wt = r.u8();
        if (b4 & 0x20) wt |= r.u8() << 8; // 高字节在后（读侧 :2318-2324 lo 先读）
        t.vanillaType = wt;
        const mapped = mapVanillaTile(wt);
        t.type = mapped ? mapped.id : 0;
        // tileFrameImportant：wire 携帧 ⇔ 原版权威表（VANILLA_FRAME_IMPORTANT,非引擎
        // TILE_DEFS.framed——两者有 4 处差集,差集任一位错=段流失步,rig 判例在档）；
        // 非 framed 的 active tile 原版置 frame=-1（=「未定帧」哨兵）→ 本仓 U16 域记 0
        if (VANILLA_FRAME_IMPORTANT[wt] !== 0) { t.fx = r.i16() & 0xffff; t.fy = r.i16() & 0xffff; }
        if (b2 & 8) t.paint = r.u8();
      }
      if (b4 & 4) { // wall（+wallColor）
        t.wall = r.u8();
        if (b2 & 0x10) t.paintWall = r.u8();
      }
      const lqSel = (b4 & 0x18) >> 3; // 1水 2岩浆 3蜂蜜
      if (lqSel !== 0) {
        t.liquid = r.u8();
        t.liquidType = (b2 & 0x80) ? 4 /* shimmer */ : lqSel;
      }
      if (b > 1) { // wire1-3 + slope 半字节（无额外字节）
        let wire = 0;
        if (b & 2) wire |= TileStore.WIRE_RED;
        if (b & 4) wire |= TileStore.WIRE_BLUE;
        if (b & 8) wire |= TileStore.WIRE_GREEN;
        const sl = (b & 0x70) >> 4;
        if (sl === 1) t.half = 1;
        else if (sl > 1) t.slope = sl - 1;
        t.wire = wire;
      }
      if (b2 > 1) { // actuator/inActive/wire4/wall 高字节
        if (b2 & 2) t.wire |= TileStore.WIRE_ACTUATOR;
        if (b2 & 4) t.wire |= TileStore.WIRE_ACTUATED;
        if (b2 & 0x20) t.wire |= TileStore.WIRE_YELLOW;
        if (b2 & 0x40) t.wall |= r.u8() << 8;
      }
      if (b3 > 1) { // 涂层四位（本仓 coat 单字节编码=存档 header4 位域）
        let coat = 0;
        if (b3 & 2) coat |= TileStore.COAT_INVISIBLE_BLOCK;
        if (b3 & 4) coat |= TileStore.COAT_INVISIBLE_WALL;
        if (b3 & 8) coat |= TileStore.COAT_FULLBRIGHT_BLOCK;
        if (b3 & 0x10) coat |= TileStore.COAT_FULLBRIGHT_WALL;
        t.coat = coat;
      }
      writeTile(x, y, t);
      tile = t; lastX = x; lastY = y;
      // RLE 计数在 tile 条目末尾（:2432-2439）：0x40→u8 短游程,0x80/0xC0→i16 长游程
      const sel = (b4 & 0xc0) >> 6;
      if (sel === 1) run = r.u8();
      else if (sel >= 2) run = r.u16();
    }
  }
  // ---- 尾段：箱 → 告示牌 → TE（全在 inflate 流内;TE 体 P3 域仅计条数）----
  const chests: SectionChest[] = [];
  const chestCount = r.i16();
  for (let k = 0; k < chestCount; k++) {
    const idx2 = r.i16(), cx = r.i16(), cy = r.i16();
    const name = r.str();
    chests.push({ idx: idx2, x: cx, y: cy, name });
  }
  const signs: SectionSign[] = [];
  const signCount = r.i16();
  for (let k = 0; k < signCount; k++) {
    const idx2 = r.i16(), sx = r.i16(), sy = r.i16();
    const text = r.str();
    signs.push({ idx: idx2, x: sx, y: sy, text });
  }
  const teCount = r.i16();
  // ---- TE 段尾（CompressTileBlock :2250-2255:TileEntity.Write networkSend=FALSE）----
  // [u8 type][i32 ID][i16 x][i16 y]+变长 extra。已知型消费;DisplayDoll(3) 变长
  // （bits×3+逐位物品）与未知型【止损停读】——TE 居段尾,错读只损 TE 不伤 tiles
  // （consumed≠长度由调用方按 teTruncated 容忍,判例 2026-10-25）。
  let teParsed = 0;
  let teTruncated = false;
  for (let k = 0; k < teCount; k++) {
    const type = r.u8();
    r.i32();   // ID（networkSend=false 携带）
    r.i16(); r.i16(); // x, y
    switch (type) {
      case 0: r.i16(); break;                    // TrainingDummy: npc
      case 1: r.i16(); r.u8(); r.i16(); break;   // ItemFrame: vid/prefix/stack
      case 2: r.u8(); r.u8(); break;             // LogicSensor: check+on（非 networkSend 面）
      case 6: r.i16(); r.u8(); r.i16(); break;   // FoodPlatter: vid/prefix/stack
      case 5: {                                   // HatRack: bits+2 条件物品
        const b = r.u8();
        for (let i = 0; i < 2; i++) if (b & (1 << i)) { r.i16(); r.u8(); r.i16(); }
        break;
      }
      default:
        // 3 DisplayDoll/4 WeaponRack/7 Pylon…: 变长或未提取——止损（剩余字节弃读）
        teTruncated = true;
        return { rect: { x0, y0, w, h }, chests, signs, teCount, teParsed, teTruncated, consumed: r.p };
    }
    teParsed++;
  }
  return { rect: { x0, y0, w, h }, chests, signs, teCount, teParsed, teTruncated: false, consumed: r.p };
}
