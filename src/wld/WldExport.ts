// .wld 导出(自足版,2026-09-06):SaveData → 1.4.5.7(325) 世界文件字节。
// 反编译标杆:Terarria1457/Terraria.IO/WorldFile.cs(SaveWorld_Version2 :1156 段序/
// SaveFileFormatHeader :1184/SaveWorldTiles :1438/SaveChests :1613/SaveSigns :1685/
// SaveNPCs :1710/SaveFooter :1759/SaveTileEntities :3317)。
// ★形态:【全量台账版 v3(SW-FX33)】——header 段经 WldHeaderFields 台账(WF:1264-1437
//   逐字段定谳)全字段写出;wldSnap 快照优先(原版导入档零漂移)。tiles/chests/signs/
//   npcs/TE 与原版 1:1。SW-FX33 批:TempPartyCelebratingNPCs 写真值(save.events.
//   partyCelebratingNpcs,netId 域)/TreeTops 无数据自建世界按原版 CopyExistingWorldInfo
//   (WorldGen.cs:11370→TreeTopsInfo.cs:217-232)派生/tileFrameImportant[753] 金标勘误
//   (Main.cs:9950)。★SW-FX35(2026-09-11):TE 段扩 6/8/9/10 四类+锚桩 short itemType 勘误
//   +teSnap 三类透传(0 假人/2 传感器/7 晶塔);townManager/bestiary/creativePowers 三尾段
//   真写(bestiar 空桶=12B 修【原版拒载】级缺段)。★SW-FX43(2026-09-12) wld-compat P1:
//   wldSnap 快照通道生产者落地(WldImport 差量携行→serializeSave→loadSaveData→World)、
//   caveBackX 真值链(header.caveBackX 导入捕获/自建 worldgen 掷值/旧档 treeX 派生回退)、
//   footer worldId 与 header 同值(LoadFooter :3003-3015 BadFooter 门)、guid/manifest/
//   seedText/CreationTime/worldGenVersion/worldSurface/rockLayer 快照回写、jungleBG 键
//   补齐(TreeTopsInfo.cs:222 slot5)。已登记偏差: SavedOreTiers 三档 -1/四档 7/6/9/8 缺省、
//   ExtraSpawnPoint 写空、致动器/wire4/inActive 无态写 0、_tempCoinRain 恒 0(活态未建模)、
//   自建世界 bg 字节组按 seed 派生(缺省 0)。原版可读性=待 rig/TEdit 终验。
// 数据源映射:save.header(时间/尺寸/spawn/地层/地牢/树与背景样式/月相快照)/
//   save.flags(WldParser 命名键布尔旗)/save.weather/save.events/save.clock/
//   save.bannerKills/save.invasion;缺省值按读侧缺省语义补(矿层 -1=未锁定、
//   4 档铜铁银金 7/6/9/8=WldImport 注记缺省)。
import type { SaveData } from '../save/serialize';
import { TILE_INTERNAL_OF_STABLE, TILE_DEFS } from '../data/tiles';
// ★IDG-1（2026-09-18,BJ150 §6 处方 id 域守卫）：本文件=写向文件,禁引用加载向表
//   ITEM_INTERNAL_OF_STABLE——SW-BO1 勘误后箱/TE 侧稳定 id 直写（:487 附近）,该表
//   引用只剩本注释与 :433 勘误注;死 import 已摘（tools/id-domain-guard.mjs 锚定）。

import { BinaryWriterLE } from '../save/PlrImport';
import { HEADER_FLAGS, HEADER_PRE, fieldValue, type WldField, type WldVal } from './WldHeaderFields';
import { TOWN_NPC_KEY_BY_ID } from './WldImport';
import { isTowerId } from '../world/LunarEvent';   // ★SW-FX11：SavesAndLoads 段塔 id 判定（NPCID.cs:4807）
import { bytesToB64, rlePairs, rleTiles } from '../save/SaveFile';
import vanillaJson from '../../public/sprites/vanilla.json';

const TILE_COUNT = 754;   // TileID.Count(Terarria1457/Terraria.ID/TileID.cs:1945)

// ★SW-FX43（2026-09-12）：footer worldId 取值域锚（=HEADER_PRE.worldId 台账行,
//  快照优先取值走 fieldValue——与 writeHeader 同一取值链,保证 header/footer 同值）
const WORLD_ID_FIELD: WldField = HEADER_PRE.find((f) => f.name === 'worldId')!;

// ---- 自有 RLE 解压(varint run-1 + varint v;serialize.ts rlePairs/rleTiles 逆) ----
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function readVarint(b: Uint8Array, pos: { p: number }): number {
  let v = 0, shift = 0;
  for (;;) {
    const byte = b[pos.p++];
    v |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return v;
    shift += 7;
  }
}
function unrlePairs(b64: string | undefined, n: number, fallback = 0, wide = false): Uint16Array | Uint8Array {
  const out = wide ? new Uint16Array(n) : new Uint8Array(n);
  if (!b64) { if (fallback) out.fill(fallback); return out; }
  try {
    const b = b64ToBytes(b64);
    const pos = { p: 0 };
    let i = 0;
    while (pos.p < b.length && i < n) {
      const run = readVarint(b, pos) + 1;
      const v = readVarint(b, pos);
      if (v !== 0) out.fill(v, i, Math.min(n, i + run));
      i += run;
    }
  } catch { /* 损坏段按缺省 */ }
  return out;
}
function unrleTiles(b64: string, n: number): { type: Uint16Array; frameX: Uint16Array; frameY: Uint16Array } {
  const type = new Uint16Array(n), frameX = new Uint16Array(n), frameY = new Uint16Array(n);
  try {
    const b = b64ToBytes(b64);
    const pos = { p: 0 };
    let i = 0;
    while (pos.p < b.length && i < n) {
      const run = readVarint(b, pos) + 1;
      const t = readVarint(b, pos);
      let fx = 0, fy = 0;
      if (t !== 0) { fx = readVarint(b, pos); fy = readVarint(b, pos); }
      const end = Math.min(n, i + run);
      if (t !== 0) {
        for (; i < end; i++) { type[i] = t; frameX[i] = fx; frameY[i] = fy; }
      }
      i = end;
    }
  } catch { /* 损坏段=空世界 */ }
  return { type, frameX, frameY };
}

// ---- frameImportant 位图(vanilla.json tiles[x].framed;753 键覆盖全 754 id) ----
const FRAME_IMPORTANT: boolean[] = (() => {
  const out = new Array<boolean>(TILE_COUNT).fill(false);
  const tiles = (vanillaJson as { tiles?: Record<string, { framed?: boolean }> }).tiles ?? {};
  for (const [k, v] of Object.entries(tiles)) {
    const id = Number(k);
    if (id >= 0 && id < TILE_COUNT) out[id] = !!v.framed;
  }
  return out;
})();
// ★SW-FX33（2026-09-11）tileFrameImportant 金标勘误:vanilla.json tiles[753].framed=false
//  与反编译金标不符——Main.cs:9950 `tileFrameImportant[753] = true`（Giant Tiki 多格件）。
//  该位错一位=双杀:①FileFormatHeader 位图 753 位写 0,原版读侧 Main.tileFrameImportant[753]
//  =true 恒期待帧数据;②encodeTiles 对 753 活格不写 frameX/frameY 4 字节 → 原版
//  LoadWorldTiles 按位图消费帧数据 → 该格起全流错位 → BadSectionPointer 整档拒载。
//  （完整金标=Main.cs 直写赋值 + :10125-10134 循环 435-439 + :8551-8559
//  AddEchoFurnitureTile 九件;全 754 位对拍守卫=tests/sw-fx33-frameimportant-golden.test.ts）
for (const fiFix of [753]) FRAME_IMPORTANT[fiFix] = true;

// ---- 原版 tile 编码(WF:1438-1511 逐位) ----
function encodeTiles(w: BinaryWriterLE, save: SaveData): void {
  const width = save.header.width, height = save.header.height;
  const n = width * height;
  // ★行主序(i=y*width+x,与 WldImport 读侧 chest anchor=y*w+x 同构)。
  // ★存档 tiles 是稳定 id 形(serializeSave :443 经 TILE_STABLE_OF_INTERNAL),
  //   写原版流前必须反映射为 netId(ITEM_INTERNAL_OF_STABLE;未注册=0 空气)
  const tRaw = unrleTiles(save.tiles, n);
  const t = { type: new Uint16Array(n), frameX: tRaw.frameX, frameY: tRaw.frameY };
  let modTileClamped = 0;
  for (let i = 0; i < n; i++) {
    const sRaw = tRaw.type[i];
    // ★R-C-F8:mod tile 域(1030+)钳零(与墙同语义;.wld=vanilla 互操作格式)
    if (sRaw >= 1030) { t.type[i] = 0; modTileClamped++; continue; }
    t.type[i] = sRaw === 0 ? 0 : (TILE_INTERNAL_OF_STABLE[sRaw] ?? 0);
  }
  const walls = unrlePairs(save.walls, n, 0, true) as Uint16Array;   // ★P1-4:墙 id 0-366,曾 Uint8 截断(Echo 墙 300→44)
  // ★R-C-F8(2026-10-14):mod 墙域(367+)钳零——.wld 导出=vanilla 互操作格式,
  //  mod 墙 id 写入原版流会被 TEdit/原版别名成 Echo 墙域(367 起恰为原版墙面域
  //  未定义区,读侧行为不可预期)。SW↔SW 完整回环走自有 json 档(teMods/mod 全)。
  let modWallClamped = 0;
  for (let i = 0; i < n; i++) { if (walls[i] >= 367) { walls[i] = 0; modWallClamped++; } }
  if (modWallClamped + modTileClamped > 0) {
    console.warn(`[wld-export] mod 域钳零: walls=${modWallClamped} tiles=${modTileClamped}(vanilla 互操作格式不承载 mod 内容;SW↔SW 完整回环走自有 json 档)`);
  }
  const liquid = unrlePairs(save.liquid, n);
  const liquidType = unrlePairs(save.liquidType, n);
  const wire = unrlePairs(save.wire, n);
  const blocks = unrlePairs(save.blocks, n);   // half?1:(slope+1)
  const paint = unrlePairs(save.paint, n);
  const paintWall = unrlePairs(save.paintWall, n);
  const coat = unrlePairs(save.coat, n);
  // 幽灵位差分(v5 tileActive):act = ((d&1)===1) === (type≠0);缺省=type≠0
  const actDiff = save.tileActive ? unrlePairs(save.tileActive, n) : null;

  const same = (i: number, j: number): boolean => {
    if (t.type[i] !== t.type[j] || t.frameX[i] !== t.frameX[j] || t.frameY[i] !== t.frameY[j]) return false;
    if (walls[i] !== walls[j] || liquid[i] !== liquid[j] || liquidType[i] !== liquidType[j]) return false;
    if (wire[i] !== wire[j] || blocks[i] !== blocks[j]) return false;
    if (paint[i] !== paint[j] || paintWall[i] !== paintWall[j] || coat[i] !== coat[j]) return false;
    if (actDiff && actDiff[i] !== actDiff[j]) return false;
    return true;
  };

  // ★.wld tile 流=列主序(x 外层 y 内层,decodeTiles :688 同构);数组索引=y*width+x
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      const type = t.type[i];
      // ★tileActive 差分还原=XOR(2026-09-07 勘误,用户存档→导出 256 万格丢失实证):
      //  v=(flags&1) XOR (type≠0)(serialize.ts rleTileActiveDiff)→ 还原 active=
      //  (type≠0) XOR (v===1)。旧写 `((v&1)===1)===(type!==0)` 把语义写反——
      //  正常 active 格(v=0)全被判 inactive → type payload 不写 → wld 整片空洞。
      //  ★此前回环测试全绿的盲区:parse 产物不带 tileActive 段(actDiff=null),
      //  只有「v5 存档→导出」链触雷。
      const isActive = actDiff ? ((type !== 0) !== ((actDiff[i] & 1) === 1)) : type !== 0;
      const wall = walls[i], liq = liquid[i], liqType = liquidType[i];
      const blk = blocks[i], half = blk === 1, slope = blk >= 2 && blk <= 5 ? blk - 1 : 0;
      const c = coat[i];
      const wl = paintWall[i];
      let b = 0, b2 = 0, b3 = 0, b4 = 0;
      const payload: number[] = [];
      // ★幽灵格丢弃(2026-09-07 四修,语义以用户定谳为准):本仓幽灵(inactive+
      //  type≠0)是「完全不可见、不碰撞」的私有状态——不是原版致动器(虚化位
      //  在本仓渲染=半透明,转正=实体,两者都会显形,用户两轮实报)。wld 流无法
      //  表达「不可见的物块」,而丢弃后视觉零差异(幽灵本来就画不出来)——导出
      //  时跳过。parse 侧反向链保留:原版致动虚化格(active+inActive)导入时
      //  经 tileActive 差分还原为本仓幽灵,语义对齐。
      const writeType = isActive && type !== 0;
      if (writeType) {
        // ★写流域=原版 sheet 域(WF:1444 tile.type 直写):t.type 是 internal
        //  (encodeTiles 头 stable→internal 反映射产物),须转回 sheet;曾直写
        //  internal → 回环 parse 二读类型错位(6400×1800 实测 t1=263→t2=354)。
        //  FRAME_IMPORTANT 键域同为 sheet(vanilla.json tiles 表)。
        const sheet = TILE_DEFS[type]?.vanilla?.sheet ?? 0;
        b |= 2;
        payload.push(sheet & 0xff);
        if (sheet > 255) { b |= 0x20; payload.push((sheet >> 8) & 0xff); }
        if (FRAME_IMPORTANT[sheet]) {
          payload.push(t.frameX[i] & 0xff, (t.frameX[i] >> 8) & 0xff, t.frameY[i] & 0xff, (t.frameY[i] >> 8) & 0xff);
        }
        if (paint[i] !== 0) { b3 |= 8; payload.push(paint[i]); }
        // ★致动虚化位(WF:1533 inActive→b3|=4):源世界的真实致动格
        //  (flags=1+wire bit5,v5 差分 v=0)位随档保真——曾漏写=致动格实体化
        //  (用户实报隐藏层消失)。幽灵格不进本块(writeType 门,丢弃方案)。
        //  ★P1-5 勘误:上次注释清理误删本行——无此行时 wld 流无 inActive 位,
        //  parser 无法重建 wire bit5 → 致动格再导入恒实体(致动器机制失效)
        if (wire[i] & 0x20) b3 |= 4;
      }
      if (wall !== 0) {
        b |= 4;
        payload.push(wall & 0xff);
        if (wl !== 0) { b3 |= 0x10; payload.push(wl); }
      }
      // ★P2-6 补:header4 涂层四位(WF:1546-1560 invisibleBlock|2/invisibleWall|4/
      //  fullbrightBlock|8/fullbrightWall|0x10 = coat 位域同构)——曾死存储(Echo
      //  涂层整域不导出,与 Echo 墙 id 截断叠加=Echo 墙标配全灭)
      if (c & 30) b4 = c & 30;
      // ★P2-7 补:致动器安装位(WF:1528-1530 actuator→b3|=2;内部 wire bit4)——
      //  曾漏写:导入后信号无法翻转这些格(Wiring 消费 bit4)
      if (wire[i] & 0x10) b3 |= 2;
      // ★SW-RB14c 复核勘误:墙高字节流位=liquid payload **之后**(写侧 WF:1540-1545
      //  `if (tile.wall > 255)` 在 liquid 块尾追加 num3;读侧 cs:2663-2665 同位)——
      //  本行此前仍挂在 liquid 前(注/码背离,P1-4 勘误未真正落码):wall>255∧liquid>0
      //  同格(Echo 墙水景)流序互换,回环 wall|=(液量<<8)→≥367 钳 0(墙整格丢失)+
      //  液量=墙高字节(200→1)。回归:tests/wld-export.test.ts RB14c 组。
      if (wall > 255) b3 |= 0x40;
      if (liq !== 0) {
        // ★液体类型位 1:1 原版(WF:1500-1513,2026-09-07 勘误:旧写整体错一位——
        //  内部 1 水 误写 0x10=岩浆位、2 岩浆→0x18=蜂蜜、3 蜂蜜→微光,回环
        //  liquidType diff 57.8 万格实证「岩浆全变蜂蜜」):水=bit3(8)、
        //  岩浆=bit4(0x10)、蜂蜜=bit3|bit4(0x18)、微光=bit3+b3[7](0x80)
        if (liqType === 2) b |= 0x10;
        else if (liqType === 3) b |= 0x18;
        else if (liqType === 4) { b3 |= 0x80; b |= 8; }
        else b |= 8;
        payload.push(liq);
      }
      // ★SW-RB14c:墙高字节实体 push 在 liquid 之后(WF:1540-1545 num3 流水尾同位)
      if (wall > 255) payload.push((wall >> 8) & 0xff);
      if (wire[i] & 1) b2 |= 2;
      if (wire[i] & 2) b2 |= 4;
      if (wire[i] & 4) b2 |= 8;
      if (wire[i] & 8) b3 |= 0x20;   // ★黄线(wire4,WF:1534 b3|=0x20;parser header3&0x20→内部 bit3)——曾漏写
      b2 |= half ? 16 : (slope !== 0 ? (slope + 1) << 4 : 0);
      // 扩展头链(b4→b3→b2 前插;actuator/inActive/wire4 均已按位导出,见上)
      if (b4 !== 0) { b3 |= 1; payload.unshift(b4); }
      if (b3 !== 0) { b2 |= 1; payload.unshift(b3); }
      if (b2 !== 0) { b |= 1; payload.unshift(b2); }
      // RLE 沿列(y)前视同形游程(读侧按 header 位展开,不查压缩白名单)
      let run = 0;
      while (y + 1 + run < height && same(i, (y + 1 + run) * width + x)) run++;
      y += run;
      if (run > 0) {
        payload.push(run & 0xff);
        if (run > 255) { b |= 0x80; payload.push((run >> 8) & 0xff); }
        else b |= 0x40;
      }
      w.byte(b);
      for (const v of payload) w.byte(v);
    }
  }
}

// ---- header 段(WldHeaderFields 台账表驱动;P0 定谳 WF:1230-1437 逐字段) ----
function writeHeader(w: BinaryWriterLE, save: SaveData): void {
  const snap = (save as { wldSnap?: Record<string, WldVal> }).wldSnap;
  const get = (f: WldField): WldVal => (snap && snap[f.name] !== undefined ? snap[f.name] : fieldValue(save, f));
  const put = (f: WldField): void => {
    const v = get(f);
    switch (f.type) {
      case 'i32': w.i32(Number(v)); break;
      case 'u8': w.byte(Number(v)); break;
      case 'u32': w.u32(Number(v)); break;
      case 'i16': w.i16(Number(v)); break;
      case 'f64': w.f64(Number(v)); break;
      case 'f32': w.f32(Number(v)); break;
      case 'bool': w.bool(!!v); break;
      // ★SW-FX43：i64 快照字符串域（CreationTime .NET ticks ~6.4e17 > 2^53——
      //  Number 化即失真;十进制数字串直 BigInt 精确回写,wldSnap 携行域）
      case 'i64': w.i64(typeof v === 'bigint' ? v
        : (typeof v === 'string' && /^-?\d+$/.test(v) ? BigInt(v) : BigInt(Math.round(Number(v))))); break;
      case 'str': w.str(String(v)); break;
    }
  };
  const idx = (name: string): number => {
    const i = HEADER_FLAGS.findIndex((f) => f.name === name);
    if (i < 0) throw new Error(`WldHeaderFields 缺锚点 ${name}`);
    return i;
  };
  // [pre] title..maxTilesX(guid=16B 特例嵌在 PRE 里,按 name 分流)
  for (const f of HEADER_PRE) {
    if (f.name === 'guid') {
      // ★SW-FX43：guid 快照回写（WldImport 捕获 16B hex → wldSnap.guid;曾恒写 16
      //  零字节=GUID.Zero 合法但导入档漂移）。非 32 位 hex 脏值防御性回退零字节
      const g = typeof snap?.guid === 'string' && /^[0-9a-f]{32}$/.test(snap.guid) ? snap.guid : '';
      for (let i = 0; i < 16; i++) w.byte(g ? parseInt(g.slice(i * 2, i * 2 + 2), 16) : 0);
      continue;
    }
    put(f);
  }
  // [flags 1] GameMode..windSpeedTarget
  for (let i = 0; i <= idx('windSpeedTarget'); i++) put(HEADER_FLAGS[i]);
  // [特例] anglerWhoFinishedToday list(i32 n+n×str)
  // ★P2-10:SW 原生档数据在 save.angler.whoFinishedToday(曾读不存在的 wldSnapAngler
  //  键恒空=当日交付名单丢失可重复领奖);wldSnapAngler(原版导入快照)优先兼容
  const snapAngler = (save as { wldSnapAngler?: string[] }).wldSnapAngler;
  const angler = snapAngler ?? (save as { angler?: { whoFinishedToday?: string[] } }).angler?.whoFinishedToday ?? [];
  w.i32(angler.length);
  for (const a of angler) w.str(a);
  // [flags 2] savedAngler.._tempCultistDelay
  for (let i = idx('savedAngler'); i <= idx('_tempCultistDelay'); i++) put(HEADER_FLAGS[i]);
  // [特例] banners(i16 n + n×i32 kills;[≥289]i16 m + m×u16 claimable 空)——
  // ★原版写全表(MaxBannerTypes=293,n 恒 293;实机 BadSectionPointer 对账定谳:
  // orig header 有 1168B banners 块=2+293×4+2;截断 n 会错位后续全部)
  const bk = save.bannerKills ?? {};
  w.i16(293);
  for (let i = 0; i < 293; i++) w.i32(bk[i] ?? 0);
  w.i16(293);
  for (let i = 0; i < 293; i++) w.u16(0);   // claimable 全表(本仓不建模,写 0)
  // [flags 3] fastForwardTimeToDawn..teamBasedSpawnsSeed(中插 Celebrating list 与 ExtraSpawn 特例)
  const iFFDawn = idx('fastForwardTimeToDawn');
  const iPartyCooldown = idx('_tempPartyCooldown');
  const iSand = idx('_tempSandstormHappening');
  // ★P1-3 勘误(2026-09-07 红队):TreeTops 注入点=lantern 四件套之后(WF:1391,
  //  _tempLanternNight* 键位),曾错挂在 sandstorm 键 → 导出头 TreeTops 块恰落
  //  parse 侧 sandstormHappening 槽,导出档连自家解析器都越界(29 字节错位)
  const iLantern = idx('_tempLanternNightNextNightIsGenuine');
  const iTeam = idx('teamBasedSpawnsSeed');
  const iDual = idx('dualDungeonsSeed');
  for (let i = iFFDawn; i <= iTeam; i++) {
    put(HEADER_FLAGS[i]);
    if (i === iPartyCooldown) {
      // ★SW-FX33（2026-09-11）：TempPartyCelebratingNPCs 名单写真值（WF:1370-1374
      //  Save——i32 n + n×i32;WorldFile.cs:1056-1057 SaveHeader 快照
      //  BirthdayParty.CelebratingNPCs/:168 Load 尾回灌）。值域=原版 netId
      //  （存档侧 Game.eventsForSave key→netId;导入侧 WldParser.party.celebrating
      //  原值透传——两路同域）。曾恒写空=派对名单导出即丢
      const celebrating = save.events?.partyCelebratingNpcs ?? [];
      w.i32(celebrating.length);
      for (const id of celebrating) w.i32(id);
    }
    if (i === iLantern) {
      // ★TreeTops.Save(WorldGen.TreeTopsInfo :40:恒 13 项;Load :任 n≤13 逐项读)——
      // 原版位置=lantern 四件套之后、force ForToday 之前(WF:1391)
      // ★SW-FX33：无 treeTops 数据的自建世界按原版世界生成同款派生——原版建世界时
      // WorldGen.cs:11370 调 CopyExistingWorldInfoForWorldGeneration → TreeTopsInfo.cs:
      // 217-232 按 header treeStyle[0..3]+corrupt/jungle/snow/hallow/crimson/desert/
      // ocean/mushroom/underworldBG 填 13 区变体(曾全 0=树冠变体全默认)。
      // jungleBG 在 SaveData 无键(WldHeaderFields :129 登记偏差)落 0。
      const bg = save.header.bgStyles;
      const ts = save.header.treeStyle;
      const ts4 = ts && ts.length >= 4 ? ts : [0, 0, 0, 0];
      const tt = save.header.treeTops?.length ? save.header.treeTops : [
        ts4[0], ts4[1], ts4[2], ts4[3],
        // ★SW-FX43：slot5=jungleBG（TreeTopsInfo.cs:222 `_variations[5] = WorldGen.jungleBG`）
        //  ——BgStylesSave.jungleBG 键补齐后写真值;自建世界缺省仍落 0（旧派生语义）
        bg?.corrupt ?? 0, bg?.jungleBG ?? 0, bg?.snow ?? 0, bg?.hallow ?? 0, bg?.crimson ?? 0,
        bg?.desert ?? 0, bg?.ocean ?? 0, bg?.mushroom ?? 0, bg?.underworld ?? 0,
      ];
      w.i32(13);
      for (let k = 0; k < 13; k++) w.i32(tt[k] ?? 0);
    }
  }
  // [特例] ExtraSpawnPoint(u8 0)——原版位置 teamBasedSpawnsSeed 与 dualDungeons 之间
  w.byte(0);
  // [flags 4] dualDungeonsSeed..manifest(尾)
  for (let i = iDual; i < HEADER_FLAGS.length; i++) put(HEADER_FLAGS[i]);
}

// ---- TE 段(save.furniture 挂物族八类 + save.teSnap 三类透传) ----
function writeTileEntities(w: BinaryWriterLE, save: SaveData): void {
  const list = save.furniture ?? [];
  // ★SW-RB14c：teSnap 与活态家具同位冲突 → 丢弃透传残影。原版 LoadTileEntities
  //  (WF:3339-3342) 按【流序】后写覆盖前写——若不滤,同一格先写家具后写 snap 残影
  //  → 残影胜出、活态家具整件丢失（场景：会话内拆晶塔/假人后原格放挂物家具——
  //  teSnap 载入侧淘汰只在 loadSaveData 边界,同会话不刷新）。
  const livePos = new Set(list.map((f) => `${f.x},${f.y}`));
  const snap = (save.teSnap ?? []).filter((t) => !livePos.has(`${t.x},${t.y}`));
  w.i32(list.length + snap.length);
  for (const f of list) {
    // kind → TEType(TileEntitiesManager.RegisterAll 序,TileEntitiesManager.cs:26-39):
    // 1 物品框/3 模特/4 武器架/5 帽架/6 食物盘/8 展示罐/9 风筝桩/10 小动物桩
    // （均有运行时实体;0 假人/2 传感器/7 晶塔本仓不建模,走 teSnap 透传）
    const teType = f.kind === 'item_frame' ? 1 : f.kind === 'display_doll' ? 3
      : f.kind === 'weapon_rack' ? 4 : f.kind === 'hat_rack' ? 5
      : f.kind === 'food_platter' ? 6 : f.kind === 'display_jar' ? 8
      : f.kind === 'kite_anchor' ? 9 : f.kind === 'critter_anchor' ? 10 : 0;
    // ★SW-FX35 定谳勘误：锚桩 9/10 ExtraData = short itemType（继承
    //  TELeashedEntityAnchorWithItem.WriteExtraData,TELeashedEntityAnchorWithItem.cs:9-12;
    //  TEdit TileEntity.cs:414-417 互证）——旧版写 type 9 裸占位（无 short）：
    //  原版读侧流错位（后续 TE 全体错读/BadSectionPointer）+ 本仓挂物丢失;
    //  critter_anchor 亦曾误写 9（vanilla 按 9 校验 tile 723 → TE 被淘汰）
    if (f.kind === 'kite_anchor' || f.kind === 'critter_anchor') {
      const hung = f.slots?.[0];
      w.byte(teType).i32(0).i16(f.x).i16(f.y).i16(hung && hung.id > 0 ? hung.id : 0);
      continue;
    }
    w.byte(teType).i32(0).i16(f.x).i16(f.y);
    const slot = (s: { id: number; stack: number; prefix?: number } | null | undefined) =>
      w.i16(s ? s.id : 0).byte(s?.prefix ?? 0).i16(s ? Math.max(1, s.stack ?? 1) : 0);   // 稳定 id=原版 netId(★SW-BO1 勘误);★P3:stack 钳 ≥1(原版 vanilla 钳,stack=0 曾被 parse 按空槽丢)
    if (teType === 1 || teType === 4 || teType === 6 || teType === 8) { slot(f.slots?.[0]); }
    else if (teType === 3) {
      // 模特（TEDisplayDoll.WriteExtraData TEDisplayDoll.cs:166-217 v325 逐字）：
      //   位图1(equip 0-7)/位图2(dye 0-7)/pose(v307+)/位图3(misc[0]@bit0,equip[8]@bit1,
      //   dye[8]@bit2,v308+)/三元组×N —— N 按位图【逐位门控】读（ReadExtraData :246-277
      //   只对置位槽读三元组）。★SW-BO1 2026-09-07（SW-BL1 P1）重写：
      //   ① pose 回写真值（此前恒 0,导入丢姿态同债）;
      //   ② 三元组改按位图门控写（旧实现无条件全写+equip[8] 前置,与读侧位图门控
      //      必失步——读侧按置位数消费,余量字节滞留流内=后续 TE 全体错位）;
      //   ③ 槽位映射修正：misc=slots[9]/dyes=slots[10..18]（FurnitureItems.ts 布局,
      //      旧 dy=slots[9+i] 把 misc 当 dye0 且 dye7(slots[18]) 截丢）。
      const eq = Array.from({ length: 9 }, (_, i) => f.slots?.[i] ?? null);
      const dy = Array.from({ length: 9 }, (_, i) => f.slots?.[10 + i] ?? null);
      const misc = f.slots?.[9] ?? null;
      const bits = (arr: Array<unknown>, n: number) => { let b = 0; for (let i = 0; i < n; i++) if (arr[i]) b |= 1 << i; return b; };
      w.byte(bits(eq, 8));
      w.byte(bits(dy, 8));
      w.byte(Math.max(0, Math.min(255, Math.floor(f.pose ?? 0))));   // pose(v307+)
      const b3 = (misc ? 1 : 0) | (eq[8] ? 2 : 0) | (dy[8] ? 4 : 0);
      w.byte(b3);                                    // misc/equip[8]/dye[8] 位图(v308+)
      for (let i = 0; i < 9; i++) if (i === 8 ? eq[8] : !!eq[i]) slot(eq[i]);    // equip 0-8 位序
      for (let i = 0; i < 9; i++) if (i === 8 ? dy[8] : !!dy[i]) slot(dy[i]);    // dye 0-8 位序
      if (misc) slot(misc);                          // misc[0]（_misc 单槽,WriteExtraData :202-211）
    } else if (teType === 5) {
      // 帽架:位图(bit0-1=hat,bit2-3=dye)+三元组×N
      const hat = [f.slots?.[0], f.slots?.[1]], dye = [f.slots?.[2], f.slots?.[3]];
      let bits = 0;
      if (hat[0]) bits |= 1; if (hat[1]) bits |= 2;
      if (dye[0]) bits |= 4; if (dye[1]) bits |= 8;
      w.byte(bits);
      const n = (bits & 3) + ((bits >> 2) & 3);
      for (let i = 0; i < 2; i++) if (bits & (1 << i)) slot(hat[i]);
      for (let i = 0; i < 2; i++) if (bits & (4 << i)) slot(dye[i]);
      void n;
    }
  }
  // ★SW-FX35：不建模三类透传回写（WldImport teSnap 存底）——
  //  0 假人 short npc（TETrainingDummy.cs:119-127）/ 2 传感器 byte+bool
  //  （TELogicSensor.cs:381-395）/ 7 晶塔 无负载（TETeleportationPylon 无覆写）。
  //  ID 恒写 0（原版 Load 侧 :3337 重编号 tileEntity.ID=num2++）
  for (const t of snap) {
    if (t.type === 0) {
      w.byte(0).i32(0).i16(t.x).i16(t.y).i16(t.npc ?? -1);
    } else if (t.type === 2) {
      w.byte(2).i32(0).i16(t.x).i16(t.y).byte(t.logicCheck ?? 0).bool(!!t.on);
    } else if (t.type === 7) {
      w.byte(7).i32(0).i16(t.x).i16(t.y);
    }
  }
}
// ★SW-BO1 2026-09-07 勘误（wld-export 回环测试实证）：.wld 物品 id 域 = 原版 netId。
//  SaveData 载荷里的物品 id 已是【稳定 id】域（serializeSave 统一过 ITEM_STABLE_OF_INTERNAL），
//  而 vi_* 物品的稳定 id = 其原版 netId（items.ts 稳定 id 表 `/^vi_(\d+)_/ → Number` 同源），
//  故写回 .wld 直接落稳定 id 即可。旧实现经 ITEM_INTERNAL_OF_STABLE 反查成【内部 id】
//  （如 vid 4 铁阔剑内部=1327;原注「铁短剑」名误——铁短剑=vid 6→内部 1329）——
//  写出的 .wld 物品 id 全域错位（原版读档物品乱套/本仓 parseWld 二读 vid 越表丢失）,
//  且方向恰为「加载方向」的反向误用。
//  ★2026-09-18 时间线补注（L2② 同批,git 考古）：箱/TE 错映射随本文件 2026-09-06
//  （2c8e0bcb）诞生即接,SW-BO1 次日（09-07）修复——箱侧自始无 vid 直写历史期,
//  与 .plr 侧「真档=vid 域外部实证」（PlrImport.ts stableOf 注,Vinlic.plr 实测）
//  不同源,勿套同一叙事。

// ---- ★BJ734-A 尾注段(战争迷雾携行;格式与互通安全定谳见 exportWld 尾注) ----

/** explored b64 RLE 里是否存在任一已探索格——serialize 恒写段(全零=1 游程 ~7B),
 *  全零世界不追加尾注(导出字节与旧版逐位同,金标/回环零扰动)。走 varint 对游程
 *  扫描,任一 value 游程非零即真;坏 b64 容错=按无探索处理(不追加)。 */
function swExtTailFogHasExplored(b64: string): boolean {
  try {
    const bin = atob(b64);
    let p = 0;
    while (p < bin.length) {
      let s = 0;
      for (;;) { const b = bin.charCodeAt(p++); if (!(b & 0x80)) break; s += 7; }
      let v = 0; s = 0;
      for (;;) {
        const b = bin.charCodeAt(p++);
        v |= (b & 0x7f) << s;
        if (!(b & 0x80)) break;
        s += 7;
      }
      if (v !== 0) return true;
    }
    return false;
  } catch { return false; }
}

// ---- 主出口 ----
/** SaveData → 自足 .wld 字节(325 格式;本仓 parseWld 可读,原版不保证——见文件头注) */
export function exportWld(save: SaveData): Uint8Array {
  const w = new BinaryWriterLE();
  // FileFormatHeader(WF:1184):325+meta20B+short 11+11×i32 占位+u16 count+位图
  w.i32(325);
  // .wld 头(WF57:1913 读序,与 .plr 的 20B meta 不同!):7B 'relogic'+byte fileType
  // (World=2)+u32 revision+u64 favorites
  for (const ch of 'relogic') w.byte(ch.charCodeAt(0));
  w.byte(2);
  w.u32(1).i64(0n);
  w.i16(11);
  for (let i = 0; i < 11; i++) w.i32(0);            // 指针占位(尾段回写)
  w.u16(TILE_COUNT);
  let bit = 1, acc = 0;   // 原版 b2 初值 1(位掩码)
  for (let i = 0; i < TILE_COUNT; i++) {
    if (FRAME_IMPORTANT[i]) acc |= bit;
    if (bit === 128) { w.byte(acc); acc = 0; bit = 1; }
    else bit <<= 1;
  }
  if (bit !== 1) w.byte(acc);

  // 指针 = 各 section 尾位置(=下一 section 起点;原版 SaveWorld_Version2 :1158-1170:
  // pointers[0]=FileFormatHeader 尾、[1]=header 尾、[2]=tiles 尾……[10]=creativePowers 尾)
  // ★红蓝-L2①（2026-09-18 拆雷,RB15c 段表错位误读的根因 trap）：下方 mark() 逐段
  //  推入 p0..p11——**推入序=槽位真值**,行内注释 [N] 必须随推入序对齐（曾自 [3]
  //  chests 尾起整体偏一,BJ143 只修了测试未拆雷）。原版表恒 11 槽,p11（footer 尾）
  //  不入表（:601 回写恒 i<11）;结构锁=tests/wld-export.test.ts「mark() 注释槽位结构锁」
  const pointers: number[] = [];
  const mark = (): void => { pointers.push(w.chunks.length); };
  mark();                                                 // [0] FFH 尾=header 起点
  writeHeader(w, save); mark();                     // [1] header 尾
  encodeTiles(w, save); mark();                     // [2] tiles 尾
  // chests(WF:1613):short count+逐箱(x+y+name+maxItems+items(short stack[+type+prefix]))
  const chests = save.chests ?? [];
  w.i16(chests.length);
  for (const c of chests) {
    // ★SW-FX11（2026-09-10）：箱名写真值（WF:1660 `writer.Write(chest.name)`——曾恒 '',
    //  SaveData.chests[].name 自本批携带,导入→存档→导出环零漂移）
    w.i32(c.x).i32(c.y).str(c.name ?? '');
    const items = c.items ?? [];
    w.i32(40);                                      // maxItems(≥294 i32,WF:1633)
    for (let i = 0; i < 40; i++) {
      const it = items[i];
      if (!it || (it.id === 0)) { w.i16(0); continue; }
      const netId = it.id;   // 稳定 id=原版 netId（★SW-BO1 勘误,见 netIdOfStable 删除注）
      // ★R-C-F8:mod 物品域(30000+)钳零(.wld=vanilla 互操作格式;写 30000+ 越域=
      //  原版读侧未定义)
      if (netId >= 30000) { w.i16(0); continue; }
      if (!netId) { w.i16(0); continue; }
      w.i16(Math.max(1, it.stack ?? 1)).i32(netId).byte(0);   // chests 元素无 prefix 形;★P3:stack 钳 ≥1(红队半裁项)
    }
  }
  mark();                                           // [3] chests 尾
  // signs(WF:1685):short count+逐条(text+x+y)
  const signs = save.signs ?? [];
  w.i16(signs.length);
  for (const s of signs) w.str(s.text ?? '').i32(s.x).i32(s.y);
  mark();                                           // [4] signs 尾
  // npcs(WF:1710):shimmered 名单+镇 NPC 循环+false+SavesAndLoads 段(四塔)+false
  // ★SW-FX11（2026-09-10）：ShimmeredTownNPCs 写真值（WF:1712-1720 Save——i32 数量 ×
  //  i32 NPC type id;曾恒 i32(0),微光城镇化导出即丢）。type id 取镇 NPC 段同款反查
  const npcs = save.npcs ?? [];
  const shimmeredIds: number[] = [];
  for (const n of npcs) {
    if (!n.shimmered) continue;
    const netId = Number(Object.entries(TOWN_NPC_KEY_BY_ID).find(([, v]) => v.key === n.key)?.[0] ?? 0);
    if (netId) shimmeredIds.push(netId);
  }
  w.i32(shimmeredIds.length);
  for (const id of shimmeredIds) w.i32(id);
  for (const n of npcs) {
    // TOWN_NPC_KEY_BY_ID:netId→{key,bound}(WldImport 表);反查取 id
    const netId = Number(Object.entries(TOWN_NPC_KEY_BY_ID).find(([, v]) => v.key === n.key)?.[0] ?? 0);
    if (!netId) continue;                           // 无映射键(旧档残留)跳过
    w.bool(true);                                   // active
    w.i32(netId);                                   // netID
    w.str(n.givenName ?? '');
    w.f32(n.x).f32(n.y);                            // position(SaveData 存像素,WldImport :884)
    w.bool(!n.home);                                // homeless
    w.i32(n.home ? n.home[0] : -1).i32(n.home ? n.home[1] : -1);
    // ≥213 flag 位图:写 0(本仓读侧消费 flag&1→多读 i32;置 1 会错位)
    w.byte(0);
    // ≥315 homelessDespawn（WorldFile.cs:1741 写/:2932 读）——★SW-BO1 起写真值
    //  （此前恒 false,导出世界流浪 NPC 夜间清场链失效）
    w.bool(!!n.homelessDespawn);
  }
  w.bool(false);
  // ★SW-FX11（2026-09-10）：SavesAndLoads 尾段写真值（WF:1744-1755 Save——bool active +
  //  i32 netID + f32×2 position(左上角像素);集合=天界四塔 NPCID.cs:4807。曾恒 false,
  //  天界入侵中途档导出→再导入塔实体消失）
  for (const pn of save.pillarNpcs ?? []) {
    if (!pn || !isTowerId(pn.id)) continue;
    w.bool(true).i32(pn.id).f32(pn.x).f32(pn.y);
  }
  w.bool(false);
  mark();                                           // [5] npcs 尾
  writeTileEntities(w, save); mark();               // [6] TE 尾
  // ★SW-FX11（2026-09-10）：按压压力板段写真值（WF:3374-3386 Save——i32 数量 ×
  //  (i32 x, i32 y);曾恒 i32(0),存档点恰站压力板的机关重触发位丢失）
  {
    const plates = save.pressurePlates ?? [];
    w.i32(plates.length);
    for (const pp of plates) w.i32(pp.x).i32(pp.y);
    mark();                                         // [7] pressurePlates 尾
  }
  // townManager（★SW-FX35：WF:3400-3404 SaveTownManager → TownRoomManager.Save,
  //  TownRoomManager.cs:94-106——i32 n + n×(i32 npcType,i32 roomX,i32 roomY)。
  //  save.townRooms=WldImport 自原版档透传的房间预留表;自建世界写空表 i32(0)=4B）
  {
    const rooms = save.townRooms ?? [];
    w.i32(rooms.length);
    for (const r of rooms) w.i32(r.npc).i32(r.x).i32(r.y);
    mark();                                         // [8] townManager 尾
  }
  // bestiary（★SW-FX35：WF:3411-3416 SaveBestiary → BestiaryUnlocksTracker.Save,
  //  BestiaryUnlocksTracker.cs:14-19 序 Kills→Sights→Chats——
  //  Kills=i32 n+n×(string persistentId,i32 count)（NPCKillsTracker.cs:60-71）/
  //  Sights=i32 n+n×string（NPCWasNearPlayerTracker.cs:65-76）/ Chats 同。
  //  persistentId 键域=save.bestiary creditId（== vanilla NPCID.Search.GetName 域）。
  //  ★勘误：空图鉴=3×i32(0) 共 12B——旧版只写 4B,原版 LoadBestiary 读 Sights/Chats
  //  越段 → LoadWorld_Version2 :1844-1847 Position!=positions[9] → BadSectionPointer
  //  【整文件拒载】）
  {
    const bk = save.bestiary?.k ?? {};
    const kKeys = Object.keys(bk).filter((key) => typeof bk[key] === 'number' && bk[key] > 0);
    const bs = save.bestiary?.s ?? [];
    const bc = save.bestiary?.c ?? [];
    w.i32(kKeys.length);
    for (const key of kKeys) w.str(key).i32(bk[key]);
    w.i32(bs.length);
    for (const id of bs) w.str(id);
    w.i32(bc.length);
    for (const id of bc) w.str(id);
    mark();                                         // [9] bestiary 尾
  }
  // creativePowers（★SW-FX35：WF:3427-3432 SaveCreativePowers → CreativePowerManager.
  //  SaveToWorld,CreativePowerManager.cs:125-137——每 IPersistentPerWorldContent 力
  //  bool true+u16 id+负载,bool false 终止。原版六力恒全写（世界段,与游戏模式无关）：
  //   0 FreezeTime bool（CreativePowers.cs:1465-1468）/ 8 ModifyTimeRate f32 滑杆缓存
  //   0-1（:972-975）/ 9 FreezeRain bool（:1533-1536）/ 10 FreezeWind bool（:1499-1502）/
  //   12 DifficultySlider f32（:1169-1172）/ 13 StopBiomeSpread bool（:1567-1570）。
  //   id 8 值域换算：TargetTimeRate=round(Remap(cache,0,1,1,24))（:876-878）→
  //   cache=(rate-1)/23。per-player 力（5/11/14）落 .plr,按键力 1-4 无持久态）
  {
    const jp = save.header.journeyPowers;
    const cache = Math.min(1, Math.max(0, ((save.header.journeyTimeRate ?? 1) - 1) / 23));
    const dSlider = Math.min(1, Math.max(0, jp?.difficultySlider ?? 0));
    w.bool(true).u16(0).bool(!!save.header.journeyFreezeTime);
    w.bool(true).u16(8).f32(cache);
    w.bool(true).u16(9).bool(!!jp?.freezeRain);
    w.bool(true).u16(10).bool(!!jp?.freezeWind);
    w.bool(true).u16(12).f32(dSlider);
    w.bool(true).u16(13).bool(!!jp?.stopBiomeSpread);
    w.bool(false);
    mark();                                         // [10] creativePowers 尾
  }
  // footer(WF:1759):true+name+worldId——★SW-FX43（2026-09-12）：worldId 与 header
  //  同值（LoadFooter :3003-3015 读回比对 Main.ActiveWorldFileData.WorldId=header
  //  载入值,不符=BadFooter【整档拒载】;曾恒写 12345=潜拒载雷）。取值链=快照优先→
  //  header.worldId（自建=WorldGen.cs:11364 掷值/导入=原值）→ created-XOR 派生
  w.bool(true).str(save.header.name || 'World').i32(Number(fieldValue(save, WORLD_ID_FIELD)));
  mark();                                           // [11] footer 尾(11 槽表外,仅流末标记不回写)
  // (2026-09-07 终版:幽灵格净化方案落地——存档在读档/生成边界已无幽灵,
  //  actDiff 恒空,无需任何私有附加段。历史:本日曾三易其稿(丢弃/转正/虚化/
  //  SBWGH 附加段),最终以「存读边界净化+inActive 位自然随档」对齐原版定稿)
  // SaveHeaderPointers(WF:1208):pos0 写 325,pos+20 后 short 11+11×i32
  const bytes = w.build();
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, 325, true);
  dv.setUint16(24, 11, true);
  for (let i = 0; i < 11; i++) dv.setInt32(26 + i * 4, pointers[i] ?? pointers[pointers.length - 1], true);
  // ★BJ734-A 尾注段（2026-10-27 用户令,尾注方案）：战争迷雾随 .wld 携行。
  //   原版定谳：.wld 本体不含探索数据（探索按玩家目录存 <世界>.map 伴档,
  //   MapHelper.cs:3055 亲读）——纯原版 round-trip 必丢;SW↔SW 经尾部私有段恢复。
  //   互通安全定谳：原版 LoadWorld_Version2（WF:1767-1859）逐段+LoadFooter（:3003-3018）
  //   后即返回 Ok,**无 EOF/流长校验**——尾注被真客户端与一切按段指针的工具忽略。
  //   格式：'SWEXT1'(6B) + u32 payloadLen + JSON {v,w,h,ex}——ex=SaveData.explored
  //   同源 b64 RLE,导入侧零新编解码器直接回填既有解码链。无 explored（原版导入档/
  //   旧存档）= 不追加,字节与旧版逐位同。
  const ex = save.explored;
  if (ex && swExtTailFogHasExplored(ex)) {
    const enc = new TextEncoder();
    const payload = enc.encode(JSON.stringify({ v: 1, w: save.header.width, h: save.header.height, ex }));
    const out = new Uint8Array(bytes.length + 10 + payload.length);
    out.set(bytes, 0);
    out.set(enc.encode('SWEXT1'), bytes.length);
    new DataView(out.buffer).setUint32(bytes.length + 6, payload.length, true);
    out.set(payload, bytes.length + 10);
    return out;
  }
  return bytes;
}
