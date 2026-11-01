// 原版 .plr 角色档导入(2026-09-05)。
// 反编译标杆(唯一真值源):Terarria1457/Terraria/Player.cs
//   · InternalSavePlayerFile :55371 — Rijndael AES-128-ECB 加密,ENCRYPTION_KEY =
//     UTF-16LE("h3y_gUyZ")(:779),流头 int32 版本号(1.4.5.7=325)
//   · LoadPlayer :55713 — version≥135 带 FileMetadata(20B,:IO/FileMetadata.cs Read);
//     version>325 = LaterVersion 拒读;解密侧 Padding=None(密文尾部 PKCS7 垫余按
//     垃圾对待,字段流读不到即无影响)
//   · Deserialize :55787-56419 — 字段流唯一权威,本文件 reader 序 1:1 对齐。
//     支持域 version ∈ [124, 325](1.2,2013-10 起;更早档 armor/bank 布局与
//     字符串物品名表差异过大,概率≈0,直接拒)
//   · 读到 creativeTracker(≥218,定长)+临时物品槽(≥214)即停——其后 superCart/
//     Loadouts(≥262)/voice/_pendingRefunds(≥300)/oneTimeDialogues(≥310)对本仓
//     角色态无消费面(loadouts 是 1.4.5 三套装备方案,导入主装备即够),且
//     CreativePowerManager.LoadToPlayer 是变长注册表流,不读=不必移植
// 产物:Appearance + SaveData['player'](磁盘稳定 id 形——物品经 stableOf 原版
//   netId→稳定 id,vi_ 物品稳定 id≡原版 vid（域勘误见 stableOf 注）;buff
//   [vanillaId, 秒],plr 的 buffTime 为 tick,/60 换算。形态契约见
//   CharacterStore.getState 注)
import { BinaryReaderLE } from '../wld/BinaryReaderLE';
import {
  ITEM_STABLE_OF_INTERNAL,
  ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID,
} from '../data/items';
// ★IDG-1（2026-09-18）：写向文件禁加载向表——ITEM_INTERNAL_OF_STABLE/ITEM_DEFS 已随
//   netIdOf 等价改写摘除（见 netIdOf 头注）;stableOf 键链（vid→键→内部 id）不受影响。
import type { Appearance } from '../player/Appearance';
import type { SaveData } from './serialize';

// ---- AES-128-ECB 解密(纯 JS;WebCrypto 无 ECB)。仅解密路径,输出长度=输入长度 ----
// 正确性由 tests/plr-import.test.ts 与 node:crypto 同参对拍保证
const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
(() => {
  // FIPS-197 S 盒生成(幂元 ×3 + 仿射)
  const mul = (a: number, b: number) => {
    let p = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  };
  const INV = new Uint8Array(256);
  for (let i = 1; i < 256; i++) for (let j = 1; j < 256; j++) if (mul(i, j) === 1) { INV[i] = j; break; }
  for (let i = 0; i < 256; i++) {
    let x = INV[i];
    let s = x ^ 0x63;
    for (let k = 0; k < 4; k++) {
      x = ((x << 1) | (x >>> 7)) & 0xff;
      s ^= x;
    }
    SBOX[i] = s & 0xff;
  }
  for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
})();

/** xtime/mul 常量(逆 MixColumns 用 9/11/13/14) */
function gm(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

/** AES-128-ECB 解密(无填充剥离,块数=bytes/16)。输入必须 16 的倍数 */
export function aes128EcbDecrypt(input: Uint8Array): Uint8Array {
  if (input.length === 0 || input.length % 16 !== 0) throw new Error('plr: 密文长度非 16 字节对齐');
  const key = KEY16;
  // 逆轮密钥扩展(FIPS-197:44 word)
  const w = new Uint8Array(176);
  w.set(key);
  let rcon = 1;
  for (let i = 16; i < 176; i += 4) {
    let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
    if (i % 16 === 0) {
      const a0 = t0;
      t0 = SBOX[t1] ^ rcon; t1 = SBOX[t2]; t2 = SBOX[t3]; t3 = SBOX[a0];
      rcon = (rcon << 1) ^ ((rcon & 0x80) ? 0x1b : 0);
    }
    w[i] = w[i - 16] ^ t0; w[i + 1] = w[i - 15] ^ t1;
    w[i + 2] = w[i - 14] ^ t2; w[i + 3] = w[i - 13] ^ t3;
  }
  const out = new Uint8Array(input.length);
  const s = new Uint8Array(16);
  for (let off = 0; off < input.length; off += 16) {
    for (let i = 0; i < 16; i++) s[i] = input[off + i];
    // AddRoundKey(10)
    for (let i = 0; i < 16; i++) s[i] ^= w[160 + i];
    for (let round = 9; round >= 0; round--) {
      // InvShiftRows(状态列主序:s[r + 4c];行 r 左移 r → 逆右移 r)
      let t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;              // 行1 右移1
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;          // 行2 右移2
      t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;                 // 行3 右移3
      // InvSubBytes
      for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
      // AddRoundKey(round)
      for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i];
      if (round > 0) {
        // InvMixColumns(按列)
        for (let c = 0; c < 4; c++) {
          const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
          s[c * 4] = gm(a0, 14) ^ gm(a1, 11) ^ gm(a2, 13) ^ gm(a3, 9);
          s[c * 4 + 1] = gm(a0, 9) ^ gm(a1, 14) ^ gm(a2, 11) ^ gm(a3, 13);
          s[c * 4 + 2] = gm(a0, 13) ^ gm(a1, 9) ^ gm(a2, 14) ^ gm(a3, 11);
          s[c * 4 + 3] = gm(a0, 11) ^ gm(a1, 13) ^ gm(a2, 9) ^ gm(a3, 14);
        }
      }
    }
    out.set(s, off);
  }
  return out;
}
/** 原版 ENCRYPTION_KEY = new UnicodeEncoding().GetBytes("h3y_gUyZ")(Player.cs:779)
 *  = 8 字符 × UTF-16LE 2 字节 = 16 字节 AES-128 密钥 */
const KEY16 = (() => {
  const s = 'h3y_gUyZ';
  const k = new Uint8Array(16);
  for (let i = 0; i < 8; i++) { k[i * 2] = s.charCodeAt(i) & 0xff; k[i * 2 + 1] = s.charCodeAt(i) >> 8; }
  return k;
})();

// FileMetadata 魔数校验(:IO/FileMetadata.cs — u64 低 56 位恒 27981915666277746,
// 高 8 位=FileType;Player=3)。u64 读侧 20B:魔数 8 + Revision 4 + IsFavorite 8
const FILE_META_TOTAL = 20;
const META_MAGIC_LOW56 = 27981915666277746n;

export const PLR_VERSION_1457 = 325;
/** 支持域下限 = 1.2(2013-10):124 起字段序与 325 同构(armor20/dye10/inventory58) */
export const PLR_VERSION_MIN = 124;

export interface PlrImported {
  appearance: Appearance;
  /** SaveData['player'] 的磁盘稳定 id 形(x/y 留 0——原版 .plr 不存位置,
   *  进世界落点由世界 spawn 逻辑接管,与原版语义一致) */
  playerState: SaveData['player'];
  /** 文件版本号(诊断/审核用) */
  version: number;
}

type SavedItem = SaveData['player']['inventory'][number];

/** 原版 netId → 本仓稳定 id(未注册 id=0 空物品——与原版 netDefaults(0) 同归宿)。
 *  ★红蓝-L2②（2026-09-18 域勘误;★同日时间线改真——BJ146 旧叙事「历史导出=内部
 *  注册序错位域」被用户实证推翻）：真档 .plr 物品 id=原版 type/netID(vid) 域
 *  【直写正确】——外部实证=用户私有历史档 Vinlic.plr(2026-09-18 parsePlr 实测,
 *  用户私有不入仓,结论记于 tests/plr-import.test.ts 头注):armor[10-12]=5802/
 *  5803/5804 雪域家具套连续 vid(反编译 1457 ItemID.cs SnowCandle=5802 族同证)、
 *  inv[43]=6037 尖刺沙发、inv[5]=1293 蜥蜴电池、×1834 千级堆叠——全落合法 vid
 *  且成真实背包分布,非错位域。反编译真域证据不变（Player.cs Serialize
 *  :55467-55500 写 `.type`、LoadPlayer :55998-56010 `netDefaults(num)`,
 *  ≥ItemID.Count 归 0）,与 ITEM_DEFS 注册序【内部 id】完全无关
 *  （vi_109_mana_crystal=0 号位;实测 6177 个注册 vid 与 ITEM_STABLE_OF_INTERNAL
 *  裸下标重合率 0/6177）。错位面=【导出方向】netIdOf 的 ITEM_INTERNAL_OF_STABLE
 *  .get 映射（2026-09-06 b369a150 随 exportPlr 引入,至本修复前的窗口内导出才会
 *  错位;同型案=SW-BO1 WldExport 箱侧,见 WldExport.ts:430 勘误注「vid 4 铁阔剑
 *  内部=1327」）。旧实现 `ITEM_STABLE_OF_INTERNAL[netId]` 把 netId(=vid)当内部
 *  id 用=真档导入全量错件（netID 1 铁镐→稳定 1291 生命果）,自回环因
 *  stableOf∘netIdOf 恒等掩盖（夹具与断言同表同错）。现走 WldImport 箱读同构两步链
 *  （WldImport.ts:765-767）：vid→vi_ 键→内部 id→稳定 id;vi_ 物品=恒等回写,
 *  与历史 vid 直写行为等价（零回滚）;未注册 vid 归 0=宁缺不错（同 SaveFile.ts:263
 *  越界政策） */
function stableOf(netId: number): number {
  if (netId <= 0) return 0;
  const key = VANILLA_ITEM_KEY_BY_ID[netId];
  const internal = key !== undefined ? ITEM_BY_KEY[key] : undefined;
  return internal !== undefined ? (ITEM_STABLE_OF_INTERNAL[internal] ?? 0) : 0;
}

/** 读一个 Item 形并按稳定 id 形落地。
 *  ★两形并存(反编译 :55467-55483 写/:55998-56118 读核实):armor/dye/miscE/D =
 *  id+prefix[+fav]【无 stack】;inventory/bank×4 = id+stack+prefix[+fav]。
 *  曾全段复用带 stack 形 → 真实 .plr 在 armor 段错位 120B(生成器同错闭环掩盖,
 *  写侧 Serialize 全文核读才暴露——闭环测试抓不到"两边同错") */
function readItem(r: BinaryReaderLE, readFavorite: boolean, hasStack: boolean): SavedItem {
  const id = r.i32();
  const stack = hasStack ? r.i32() : 1;
  const prefix = r.byte();
  const favorited = readFavorite ? r.boolean() : false;
  const sid = stableOf(id);
  if (!sid) return null;
  return { id: sid, stack, favorited: favorited || undefined, prefix: prefix || undefined };
}

/** 解析 .plr 原始字节(密文)。失败抛 Error(消息面向用户展示) */
export function parsePlr(raw: Uint8Array): PlrImported {
  const plain = aes128EcbDecrypt(raw);
  const r = new BinaryReaderLE(plain);
  const version = r.i32();
  if (version > PLR_VERSION_1457) throw new Error('角色档版本比当前支持的更新(1.4.5.7)');
  if (version < PLR_VERSION_MIN) throw new Error('角色档过旧(仅支持 1.2 及以上)');
  if (version >= 135) {
    const meta = r.bytes(FILE_META_TOTAL);
    const dv = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
    const lo = dv.getBigUint64(0, true) & 0xFFFFFFFFFFFFFFn;   // 低 56 位(14×F)
    if (lo !== META_MAGIC_LOW56) throw new Error('非 Re-Logic 角色档(魔数不符)');
  }

  const name = r.string();
  // difficulty:≥17 byte;更早 boolean(硬核/软核)——支持域内恒 byte
  const difficulty = r.byte();
  if (version >= 138) r.i64();                       // playTime ticks
  let hair = r.i32();
  if (hair >= 228 || hair < 0) hair = 0;   // 原版读侧亦钳负值(红色对抗:负 hair→Player_Hair_-1 查表)
  const hairDye = version >= 82 ? r.byte() : 0;
  const team = version >= 283 ? r.byte() : 0;
  const hideVisible: boolean[] = new Array(10).fill(false);
  if (version >= 124) {
    const b1 = r.byte();
    for (let i = 0; i < 8; i++) hideVisible[i] = (b1 & (1 << i)) !== 0;
    const b2 = r.byte();
    for (let i = 0; i < 2; i++) hideVisible[i + 8] = (b2 & (1 << i)) !== 0;
  }
  if (version >= 119) r.byte();                      // hideMisc
  let skinVariant = r.byte();                        // ≥107(支持域内恒此路径)
  if (version < 161 && skinVariant === 7) skinVariant = 9;
  // ★SW-RB6c 2026-09-07：载入终钳（原版 LoadPlayer_LastMinuteFixes
  //  Player.cs:56486 `Clamp(skinVariant, 0, PlayerVariantID.Count-1)`=0..11,对
  //  全版本载入统一生效）——10/11 DisplayDoll 为原版合法域（渲染走 DisplayDoll
  //  别名表,见 PaperDoll.variantSheetName）,>11 损坏值钳 11;曾漏钳=损坏档直通
  skinVariant = Math.max(0, Math.min(11, skinVariant));
  const statLife = r.i32();
  let statLifeMax = r.i32();
  if (statLifeMax > 500) statLifeMax = 500;
  let statMana = r.i32();
  let statManaMax = r.i32();
  if (statManaMax > 200) statManaMax = 200;
  if (statMana > 400) statMana = 400;
  const extraAccessory = version >= 125 ? r.boolean() : false;
  let unlockedBiomeTorches = false, ateArtisanBread = false;
  let usedAegisCrystal = false, usedAegisFruit = false, usedArcaneCrystal = false,
    usedGalaxyPearl = false, usedGummyWorm = false, usedAmbrosia = false;
  if (version >= 229) {
    unlockedBiomeTorches = r.boolean();
    // UsingBiomeTorches(:55896)——原版是计算属性（Player.cs:3934-3941:读=
    // unlockedBiomeTorches ∧ builderAccStatus[11]==0,写=反写 builderAccStatus[11]）,
    // 落盘值进 [11] 位面;本仓 builderAccStatus 已全量持久化(下方 :56306 域),此处
    // 读后即弃不丢信息（写侧 w.bool(false) 同语义=重导会话态,见 exportPlr 注）
    r.boolean();                                     // UsingBiomeTorches(经 [11] 位面承载)
    if (version >= 256) ateArtisanBread = r.boolean();
    if (version >= 324) r.boolean();                 // 1.4.5 新增未命名旗
    if (version >= 260) {
      usedAegisCrystal = r.boolean(); usedAegisFruit = r.boolean();
      usedArcaneCrystal = r.boolean(); usedGalaxyPearl = r.boolean();
      usedGummyWorm = r.boolean(); usedAmbrosia = r.boolean();
    }
  }
  if (version >= 182) r.boolean();                   // downedDD2EventAnyDifficulty(世界域)
  const taxMoney = version >= 128 ? r.i32() : 0;
  const deathsPve = version >= 254 ? r.i32() : 0;
  const deathsPvp = version >= 254 ? r.i32() : 0;
  const rgb = () => { const rr = r.byte(); const gg = r.byte(); const bb = r.byte(); return { r: rr, g: gg, b: bb }; };
  const hairColor = rgb(), skinColor = rgb(), eyeColor = rgb(), shirtColor = rgb(),
    undershirtColor = rgb(), pantsColor = rgb(), shoeColor = rgb();

  // 装备/染料/背包/银行(≥124 布局:armor20+dye10;≥322 多读 favorited)
  const favEquip = version >= 322;
  const armor: SavedItem[] = [];
  for (let i = 0; i < 20; i++) armor.push(readItem(r, favEquip, false));
  const dye: SavedItem[] = [];
  for (let i = 0; i < 10; i++) dye.push(readItem(r, favEquip, false));
  const inventory: SavedItem[] = [];
  for (let i = 0; i < 58; i++) inventory.push(readItem(r, version >= 114, true));
  const miscEquips: SavedItem[] = [], miscDyes: SavedItem[] = [];
  if (version >= 117) {
    // ★miscE/D 全版本恒【槽内交错】(E[i] 后紧跟 D[i] 同循环)——读侧 :56091-56110
    //  与写侧 :55476-55483 对称核实(曾误读 ≥136 为两独立段,镜像仪两边同错假绿;
    //  后对写侧 Serialize 原文才定谳)。差异仅 <136:槽 1 整槽跳过(不写不读)
    for (let i = 0; i < 5; i++) {
      if (version < 136 && i === 1) { miscEquips.push(null); miscDyes.push(null); continue; }
      miscEquips.push(readItem(r, false, false));
      miscDyes.push(readItem(r, false, false));
    }
  }
  const banks: SavedItem[][] = [];
  for (let b = 0; b < 4; b++) {
    // bank1/2 ≥58(支持域内恒有);bank3 ≥182;bank4 ≥198(≥255 多 favorited)
    if (b === 2 && version < 182) { banks.push([]); continue; }
    if (b === 3 && version < 198) { banks.push([]); continue; }
    const items: SavedItem[] = [];
    for (let i = 0; i < 40; i++) items.push(readItem(r, b === 3 && version >= 255, true));
    banks.push(items);
  }
  if (version >= 199) r.byte();                      // voidVaultInfo

  // buffs(≥11;44 槽 ≥252):读到非零对为止,零对跳过继续(原版 :56222-56240 语义)
  const buffs: Array<[number, number]> = [];
  if (version >= 11) {
    let target = version >= 252 ? 44 : version < 74 ? 10 : 22;
    let got = 0;
    while (got < target) {
      const type = r.i32();
      const time = r.i32();
      if (type === 0) { target--; continue; }
      got++;
      // ★G39-A（bj742a D-⑥,2026-11-01）：保 tick 精度——旧 Math.round(time/60)
      // 整秒化,与 BJ742-A R21-⑥ Buffs.toSave 同病;.plr buffTime 为 Int32 tick 域
      // （Player.cs:56243-56252 读/:55518-55530 写）,tick 直除 60 = 1/60 网格浮点秒
      // 往返逐位无损;time>0 已滤 ⇒ ≥1t,Math.max(1/60,·) 为与 toSave 同式防御位。
      // 旧式 tick→秒→tick 双掷漂移 ≤30t（如 2400-4200 随机药水病档经导入系统性偏移）。
      if (time > 0) buffs.push([type, Math.max(1 / 60, time / 60)]);  // tick→秒
    }
  }
  // spawn 点列表(-1 终止;本仓不消费,流必须对齐)
  // ★SW-RB11d（2026-09-10）:曾内嵌调试探针（i<1 时 console.log 明文缓冲 2750..2775
  //  十六进制）——每次 .plr 导入都向控制台倾倒【解密后角色档字节】,取证期残留,
  //  与流对齐语义无关,整块删除（读序不变:首 i32=-1 终止,否则 i32+i32+string）。
  for (let i = 0; i < 200; i++) {
    const x = r.i32();
    if (x === -1) break;
    r.i32(); r.i32(); r.string();
  }
  if (version >= 16) r.boolean();                    // hbLocked
  const hideInfo: boolean[] | undefined = version >= 115
    ? Array.from({ length: 13 }, () => r.boolean())
    : undefined;
  const anglerQuestsFinished = version >= 98 ? r.i32() : 0;
  if (version >= 162) { r.i32(); r.i32(); r.i32(); r.i32(); }     // DpadRadial
  // builderAccStatus（PL:56306-56325：n 按版本 8/10/11/12——★SW-FX19 起[0..n) 位面
  //   真读入玩家态;旧读后即弃=装备开关位丢失。低版本档余位补 0,再按原版迁移 quirk：
  //   release<210 → [0]=1（:56310,标尺线旧档强制关）;release<249 且背包有 3611
  //   （Architect Gadget Pack）→ [1]=1（:56325,机械标尺旧档强制关））
  let builderAccStatus: number[] | undefined;
  if (version >= 164) {
    const n = version >= 230 ? 12 : version >= 197 ? 11 : version >= 167 ? 10 : 8;
    const ba = new Array<number>(12).fill(0);
    for (let i = 0; i < n; i++) ba[i] = r.i32();
    if (version < 210) ba[0] = 1;                    // PL:56310
    // release<249 背包含 3611（Architect Gadget Pack,稳定 id 经 stableOf 域）→ [1]=1
    const archStable = stableOf(3611);
    if (version < 249 && archStable && inventory.some((it) => it && it.id === archStable)) {
      ba[1] = 1;                                     // PL:56312-56325
    }
    builderAccStatus = ba;
  }
  if (version >= 181) r.i32();                       // bartenderQuestLog
  let dead = false, respawnTimer = 0;
  if (version >= 200) {
    dead = r.boolean();
    if (dead) respawnTimer = Math.min(60000, Math.max(0, r.i32()));
  }
  if (version >= 202) r.i64();                       // lastTimePlayerWasSaved
  const golferScoreAccumulated = version >= 206 ? r.i32() : 0;
  if (version >= 218) {
    // creativeTracker → ItemSacrifices.Load(:ItemsSacrificedUnlocksTracker.cs:171)
    if (version >= 282) r.boolean();
    const n = r.i32();
    for (let i = 0; i < n; i++) { r.string(); r.i32(); }
  }
  if (version >= 214) {
    // LoadTemporaryItemSlotContents:BitsByte 门 + 各门开时一个 Item(无 favorited)
    const bb = r.byte();
    for (let i = 0; i < 4; i++) if (bb & (1 << i)) { r.i32(); r.i32(); r.byte(); }
  }
  // —— 到此为止:其后 superCart/Loadouts/voice/pendingRefunds/dialogues 不读 ——

  // voiceVariant/voicePitchOffset 在流中位于停止点之后(280/281,夹在 Loadouts 与
  // _pendingRefunds 之间——本仓不读该段,≥280 存储值放弃=既登记差异),全版本按
  // 载入钳后变体的【性别】派生(原版 release<280 回退式 Player.cs:56390
  // `voiceVariant = (newPlayer.Male ? 1 : 2)`,Male = PlayerVariantID.Sets.Male
  // {0,1,2,3,8,10} 归属)。★SW-RB6c 2026-09-07:旧式按奇偶派生(偶男奇女)与
  // 原版性别表不符——v4/6/8(女,偶)被派成 1 男声、v1/3(男,奇)被派成 2 女声
  const appearance: Appearance = {
    name,
    hair,
    skinVariant,
    hairColor, skinColor, eyeColor, shirtColor, undershirtColor, pantsColor, shoeColor,
    difficulty: (difficulty === 0 || difficulty === 1 || difficulty === 2 || difficulty === 3) ? difficulty : 0,
    voiceVariant: ((skinVariant === 0 || skinVariant === 1 || skinVariant === 2
      || skinVariant === 3 || skinVariant === 8 || skinVariant === 10) ? 1 : 2),
    voicePitchOffset: 0,
  };

  const playerState: SaveData['player'] = {
    hp: Math.max(1, statLife), x: 0, y: 0,
    inventory,
    selected: 0,
    baseMaxHp: Math.max(100, statLifeMax),
    baseMaxMana: Math.max(20, statManaMax),
    mana: statMana,
    banks,
    armor, dye,
    miscEquips, miscDyes,
    buffs,
    taxMoney,
    golferScoreAccumulated,
    anglerQuestsFinished,
    hideInfo,
    builderAccStatus,
    hideVisibleAccessory: hideVisible,
    deathsPve, deathsPvp,
    team,
    dead, respawnTimer,
    hairDye,
    permanentUpgrades: {
      extraAccessory,
      usedAegisCrystal, usedAegisFruit, usedArcaneCrystal,
      usedGalaxyPearl, usedGummyWorm, usedAmbrosia,
    },
    // ★SW-FX38b（2026-09-15）：火把神恩宠解锁旗（Player.unlockedBiomeTorches,PL:55895
    //  读/:55430 写,version≥229 域单字节 bool,位置在 extraAccessory 后 ateArtisanBread
    //  前——曾读后即弃=导出恒写 false 登记债）。本仓在-session 权威落 world.flags
    //  （monotonic 解锁,mainFlow.applyPlayer 回灌）,此字段=角色随身态跨世界面
    unlockedBiomeTorches,
    // ★BJ285-②（S6,2026-09-22）：匠师面包吃旗（Player.ateArtisanBread,PL:55433 写/
    //  :55899 读 .plr≥256 单字节 bool,位置在 unlockedBiomeTorches 后——曾读后即弃=
    //  导出恒写 false 登记债随本刀清偿）。权威面/回灌同 unlockedBiomeTorches 惯例
    ateArtisanBread,
  };
  return { appearance, playerState, version };
}

// ================= 导出侧(自有角色 → 原版 325 .plr 字节) =================
// 写侧唯一真值源 = Serialize :55406-55585(逐段核对,含 armor/dye/miscE/D 无
// stack 形、miscE/D 槽内交错、buffs 恒 44 对、spawn -1 终止、SaveToPlayer 空流
// =单 false、临时槽空=单 byte、refunds/dialogues 写 0)。产物供原版 LoadPlayer
// 读取;往返正确性由 exportPlr→parsePlr 闭环+node:crypto 加密对拍双验。

/** .NET BinaryWriter(LE)最小写侧 */
export class BinaryWriterLE {
  chunks: number[] = [];
  byte(v: number): this { this.chunks.push(v & 0xff); return this; }
  bool(v: boolean): this { return this.byte(v ? 1 : 0); }
  i32(v: number): this { const b = v | 0; this.chunks.push(b & 0xff, (b >>> 8) & 0xff, (b >>> 16) & 0xff, (b >>> 24) & 0xff); return this; }
  i64(v: number | bigint): this {
    const big = BigInt(v);
    return this.i32(Number(big & 0xffffffffn)).i32(Number((big >> 32n) & 0xffffffffn));
  }
  i16(v: number): this { const b = v | 0; this.chunks.push(b & 0xff, (b >>> 8) & 0xff); return this; }
  u16(v: number): this { const b = v & 0xffff; this.chunks.push(b & 0xff, (b >>> 8) & 0xff); return this; }
  u32(v: number): this { const b = v >>> 0; this.chunks.push(b & 0xff, (b >>> 8) & 0xff, (b >>> 16) & 0xff, (b >>> 24) & 0xff); return this; }
  f64(v: number): this {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, v, true);
    for (let i = 0; i < 8; i++) this.chunks.push(dv.getUint8(i));
    return this;
  }
  f32(v: number): this {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, v, true);
    for (let i = 0; i < 4; i++) this.chunks.push(dv.getUint8(i));
    return this;
  }
  /** .NET BinaryWriter.WriteString:7bit 长度前缀 + UTF-8 */
  str(s: string): this {
    const bytes = Array.from(new TextEncoder().encode(s));
    let len = bytes.length;
    for (;;) {
      if (len < 0x80) { this.chunks.push(len); break; }
      this.chunks.push((len & 0x7f) | 0x80);
      len >>= 7;
    }
    this.chunks.push(...bytes);
    return this;
  }
  build(): Uint8Array { return new Uint8Array(this.chunks); }
}

/** AES-128-ECB 加密 + PKCS7 垫(原版 RijndaelManaged 默认 Padding=PKCS7,
 *  写侧 FlushFinalBlock :55394)。node:crypto 同参对拍验证(测试) */
export function aes128EcbEncrypt(input: Uint8Array): Uint8Array {
  const pad = 16 - (input.length % 16);
  const padded = new Uint8Array(input.length + pad);
  padded.set(input);
  padded.fill(pad, input.length);
  // 正向密钥扩展(FIPS-197:44 word)
  const w = new Uint8Array(176);
  w.set(KEY16);
  let rcon = 1;
  for (let i = 16; i < 176; i += 4) {
    let t0 = w[i - 4], t1 = w[i - 3], t2 = w[i - 2], t3 = w[i - 1];
    if (i % 16 === 0) {
      const a0 = t0;
      t0 = SBOX[t1] ^ rcon; t1 = SBOX[t2]; t2 = SBOX[t3]; t3 = SBOX[a0];
      rcon = (rcon << 1) ^ ((rcon & 0x80) ? 0x1b : 0);
    }
    w[i] = w[i - 16] ^ t0; w[i + 1] = w[i - 15] ^ t1;
    w[i + 2] = w[i - 14] ^ t2; w[i + 3] = w[i - 13] ^ t3;
  }
  const out = new Uint8Array(padded.length);
  const s = new Uint8Array(16);
  for (let off = 0; off < padded.length; off += 16) {
    for (let i = 0; i < 16; i++) s[i] = padded[off + i];
    for (let i = 0; i < 16; i++) s[i] ^= w[i];               // AddRoundKey(0)
    for (let round = 1; round <= 10; round++) {
      for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];        // SubBytes
      // ShiftRows(行 r 左移 r;行 1/3 各移 1,行 2 移 2)
      let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
      t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
      t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
      if (round < 10) {
        for (let c = 0; c < 4; c++) {                        // MixColumns
          const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
          s[c * 4] = gm(a0, 2) ^ gm(a1, 3) ^ a2 ^ a3;
          s[c * 4 + 1] = a0 ^ gm(a1, 2) ^ gm(a2, 3) ^ a3;
          s[c * 4 + 2] = a0 ^ a1 ^ gm(a2, 2) ^ gm(a3, 3);
          s[c * 4 + 3] = gm(a0, 3) ^ a1 ^ a2 ^ gm(a3, 2);
        }
      }
      for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i];   // AddRoundKey
    }
    out.set(s, off);
  }
  return out;
}

/** 稳定 id → 原版 netId(未注册/派生件写 0=空气,与原版 netDefaults(0) 同归宿)。
 *  ★红蓝-L2②（2026-09-18 域勘误,与 stableOf 同案）：vi_ 物品稳定 id≡原版 vid
 *  （items.ts 稳定表按 vi_<id>_ 前缀直取）,导出 .plr 须写回该 vid;SW 自创/派生件
 *  （PRIV 10000+/place_v 20000+）无原版对应=0。旧实现
 *  `ITEM_INTERNAL_OF_STABLE.get()` 返回【内部 id】直写文件——该错映射 2026-09-06
 *  （b369a150）随 exportPlr 导出面出生即接（git 考古:同提交新增 netIdOf/
 *  writeEquip/writeItem,SW 导出无 vid 直写历史期）,至本修复前窗口内导出的档
 *  才有错位风险;真档域=vid 直写（用户私有历史档实证,详见 stableOf 头注）。
 *  SW-BO1 已在 WldExport 箱侧定谳的同型反向误用（「加载方向」表用于写盘）,此处系
 *  幸存孪生;自回环恒等掩盖（写内部 id→读回同表反演=原 stable,字节不漂）。
 *  真值面:vid 50 写内部 18、vid 1291 写内部 1（原版读成铁镐）。判据=def 键
 *  vi_<vid>_ 且 vid≡stable 才回写——修复后与 vid 直写等价（历史正确行为,零回滚）。
 *  ★IDG-1（2026-09-18,BJ150 §6 处方 id 域守卫,tools/id-domain-guard.mjs）：本文件
 *  是写向文件,代码禁引用加载向表 ITEM_INTERNAL_OF_STABLE——原「get(stable)→def→
 *  vi_ 门」实现等价改写为「vid 注册表→键→def→写向表恒等门」：VANILLA_ITEM_KEY_BY_ID
 *  是 vid→键权威（items.ts :1100),vi_ def 的 ITEM_STABLE_OF_INTERNAL[internal]≡vid
 *  由稳定表构建式保证,故恒等门 `=== stableId` 与旧 `/^vi_(\d+)_/` 门逐值同判:
 *  · vid 有 vi_ def → 旧 get 命中首 def 且门过 → vid;新链命中同一 vid 的键 → 门过
 *    → vid（同 vid 多 def（snake 桥接+camel 权威双注册族）两实现均判 vid,输出同）;
 *  · 未注册 vid/SW 私有 10000+/place_v 20000+ → 两实现均 0;
 *  · 退役漏斗灌入项（itemMigration.ts 旧稳定号→vi_ 内部 id,如 10140 蜂巢块）→
 *    旧 get 命中但门 vid≠旧号失败 → 0;新 VANILLA_ITEM_KEY_BY_ID[旧号] 缺 → 0。 */
function netIdOf(stableId: number): number {
  if (stableId <= 0) return 0;
  const key = VANILLA_ITEM_KEY_BY_ID[stableId];
  const internal = key !== undefined ? ITEM_BY_KEY[key] : undefined;
  return internal !== undefined && ITEM_STABLE_OF_INTERNAL[internal] === stableId ? stableId : 0;
}

interface PlrItem { id: number; stack: number; favorited?: boolean; prefix?: number }
/** 装备形写(type+prefix+fav;无 stack——PL:55467-55483) */
function writeEquip(w: BinaryWriterLE, it: PlrItem | null | undefined, fav: boolean): void {
  w.i32(it ? netIdOf(it.id) : 0).byte(it?.prefix ?? 0);
  if (fav) w.bool(!!it?.favorited);
}
/** 物品形写(type+stack+prefix[+fav]) */
function writeItem(w: BinaryWriterLE, it: PlrItem | null | undefined, fav: boolean): void {
  w.i32(it ? netIdOf(it.id) : 0).i32(it?.stack ?? 0).byte(it?.prefix ?? 0);
  if (fav) w.bool(!!it?.favorited);
}

/** 空载具三件套形(loadout 缺省) */
const EMPTY_LOADOUT_ITEMS = (): Array<PlrItem | null> => new Array(20).fill(null);

/** 自有角色 → 原版 .plr 字节(325 格式;原版 LoadPlayer 可直接读)。
 *  携带面:外观+随身态全部(背包/装备/染料/储物×4/buff/统计/永久升级)。
 *  不携带:旅程研究(creativeTracker 写空表——键型转换链 netId↔persistentId
 *  成本高收益低,登记偏差)、三套 Loadouts(缺省写空套,主装备照常)、
 *  spawn 列表(原版进世界落点由世界定)。 */
export function exportPlr(a: Appearance, playerState: SaveData['player']): Uint8Array {
  const w = new BinaryWriterLE();
  w.i32(PLR_VERSION_1457);
  // FileMetadata.Write(:IO/FileMetadata.cs):u64(magic|Type<<56)+u32 Revision+u64 favorites
  const magic = META_MAGIC_LOW56 | (3n << 56n);
  w.i64(magic).i32(1).i64(0n);

  w.str(a.name || 'Terraria Player');
  w.byte(a.difficulty ?? 0);
  w.i64(0n);                                  // playTime ticks(本仓角色元数据无此项)
  w.i32(Math.min(227, a.hair ?? 0));
  const st = playerState;
  w.byte(st.hairDye ?? 0);
  w.byte(st.team ?? 0);
  const hv = st.hideVisibleAccessory ?? new Array(10).fill(false);
  let b1 = 0, b2 = 0;
  for (let i = 0; i < 8; i++) if (hv[i]) b1 |= 1 << i;
  for (let i = 0; i < 2; i++) if (hv[i + 8]) b2 |= 1 << i;
  w.byte(b1).byte(b2);
  w.byte(0);                                  // hideMisc
  // ★SW-RB6c 2026-09-07：原版 SavePlayer 原值写出（Player.cs:55425
  //  `fileIO.Write((byte)newPlayer.skinVariant)` 无钳）——载入侧已钳 0..11
  //  （LastMinuteFixes :56486）,导出再钳 0..9 会把合法 10/11 DisplayDoll 档
  //  静默改写成 9（数据变异）;NaN/undefined 由 ?? 0 兜底
  w.byte(a.skinVariant ?? 0);
  w.i32(Math.max(1, st.hp ?? 100));
  w.i32(Math.min(500, Math.max(100, st.baseMaxHp ?? 100)));
  w.i32(Math.min(400, st.mana ?? 20));
  w.i32(Math.min(200, Math.max(20, st.baseMaxMana ?? 20)));
  const up = st.permanentUpgrades ?? {};
  w.bool(!!up.extraAccessory);
  // ★SW-FX38b：unlockedBiomeTorches 写真值（PL:55430 `fileIO.Write(newPlayer
  //  .unlockedBiomeTorches)`;本仓曾恒写 false=解锁旗不出档）。源=playerState 字段
  //  （parsePlr 落 / doSave 快照 SaveFile.buildSave 从 world.flags 回填）
  w.bool(!!st.unlockedBiomeTorches);          // unlockedBiomeTorches(PL:55430)
  w.bool(false);                              // UsingBiomeTorches(PL:55431,会话态)——
  //  原版写的是计算属性值（Player.cs:3934-3941）,但其读侧 setter 反写
  //  builderAccStatus[11] 后,:56306 的 builderAccStatus 数组读紧随覆写 [11] →
  //  该字节对载入结果是死数据,恒 false 无损
  w.bool(!!st.ateArtisanBread);               // ★BJ285-②:ateArtisanBread 写真值(PL:55433)——旧恒 false 债清偿
  w.bool(false);                              // ≥324 未命名旗
  w.bool(!!up.usedAegisCrystal).bool(!!up.usedAegisFruit).bool(!!up.usedArcaneCrystal);
  w.bool(!!up.usedGalaxyPearl).bool(!!up.usedGummyWorm).bool(!!up.usedAmbrosia);
  w.bool(false);                              // downedDD2(世界域)
  w.i32(st.taxMoney ?? 0);
  w.i32(st.deathsPve ?? 0).i32(st.deathsPvp ?? 0);
  const c = a.hairColor, sc = a.skinColor, ec = a.eyeColor, shc = a.shirtColor,
    usc = a.undershirtColor, pc = a.pantsColor, shoc = a.shoeColor;
  for (const col of [c, sc, ec, shc, usc, pc, shoc]) {
    w.byte(col?.r ?? 255).byte(col?.g ?? 255).byte(col?.b ?? 255);
  }
  const armor = st.armor ?? [], dye = st.dye ?? [];
  for (let i = 0; i < 20; i++) writeEquip(w, armor[i], true);
  for (let i = 0; i < 10; i++) writeEquip(w, dye[i], true);
  const inv = st.inventory ?? [];
  for (let i = 0; i < 58; i++) writeItem(w, inv[i], true);
  // miscE/D 槽内交错(与读侧对称)
  const me = st.miscEquips ?? [], md = st.miscDyes ?? [];
  for (let i = 0; i < 5; i++) { writeEquip(w, me[i], false); writeEquip(w, md[i], false); }
  const banks = st.banks ?? [];
  for (let b = 0; b < 4; b++) {
    const items = banks[b] ?? [];
    for (let i = 0; i < 40; i++) writeItem(w, items[i], b === 3);
  }
  w.byte(0);                                  // voidVaultInfo
  // buffs 恒 44 对:([vanillaId,秒]→tick=秒×60;缺省补 0)
  // ★G39-A（bj742a D-⑥）：导出 round 回 tick 语义保持（原版写 Int32 tick 域,
  //  运行时浮点秒经 60Hz 递减非整格,round 取最近格点）;导入侧已改 tick 直除
  //  （见读侧 ★G39 注）⇒ tick→秒→tick 往返逐位无损,旧双掷 ≤30t 漂移消除。
  const buffs = st.buffs ?? [];
  for (let i = 0; i < 44; i++) {
    const bf = buffs[i];
    if (bf && bf[0] > 0) w.i32(bf[0]).i32(Math.max(1, Math.round((bf[1] ?? 1) * 60)));
    else w.i32(0).i32(0);
  }
  w.i32(-1);                                  // spawn 列表空(-1 终止)
  // ★SW-RB11e 2026-09-10：hbLocked 写真值（PL:55546 写/:56271 读,playerState 已有域）
  w.bool(st.hbLocked ?? false);
  const hi = st.hideInfo ?? new Array(13).fill(false);
  for (let i = 0; i < 13; i++) w.bool(!!hi[i]);
  w.i32(st.anglerQuestsFinished ?? 0);
  for (let i = 0; i < 4; i++) w.i32(0);       // DpadRadial
  // builderAccStatus[12]（PL:55553-55555 写全数组——★SW-FX19 起写真值,旧写 0 面）
  {
    const src = st.builderAccStatus;
    for (let i = 0; i < 12; i++) w.i32(src?.[i] ?? (i === 0 ? 1 : 0));
  }
  w.i32(0);                                   // bartenderQuestLog
  const dead = !!st.dead;
  w.bool(dead);
  if (dead) w.i32(Math.max(0, Math.min(60000, st.respawnTimer ?? 0)));
  // ★BJ694（BJ691b 债①清偿）：lastTimePlayerWasSaved = DateTime.UtcNow.ToBinary()
  //（Player.cs:55563 亲读）——.NET DateTime 二进制 = 0001-01-01 纪元 ticks + Kind 位
  //（Utc=2 <<62;FromBinary 读侧掩码解码）。旧式裸 Date.now()×10000 缺 621355968000000000
  // 纪元基 → 原版 FromBinary 解得公元 0057 年（排序恒垫底/显示离谱,BJ691b 登记）。
  w.i64(621355968000000000n + BigInt(Date.now()) * 10000n + (2n << 62n));
  w.i32(st.golferScoreAccumulated ?? 0);
  // creativeTracker:≥282 标记(false)+空献祭表(研究不导出,登记偏差)
  w.bool(false).i32(0);
  w.byte(0);                                  // 临时槽 bits(全空)
  w.byte(0);                                  // SaveToPlayer 空流(单 false)
  // ★SW-RB11e 2026-09-10：superCart bits 位[1]=enabledSuperCart 写真值
  //  （PL:55572-55576 BitsByte{[0]=unlockedSuperCart,[1]=enabledSuperCart}——
  //  位[0] 解锁面在本仓属世界旗 world.flags.superCart,playerState 视图不可达=
  //  导出恒 0 登记债）。repo 读侧 :328 不消费该字节,改写不影响自家回环。
  w.byte((st.enabledSuperCart ?? true) ? 2 : 0);
  // Loadouts:3 套(armor20+prefix+fav / dye10 同 / hide 10 bool);缺省空套
  const loadouts = st.loadouts ?? [];
  w.i32(Math.max(0, Math.min(2, st.currentLoadout ?? 0)));
  for (let i = 0; i < 3; i++) {
    const lo = loadouts[i];
    const la = lo?.armor ?? [], ld = lo?.dye ?? [], lh = lo?.hide ?? [];
    for (let k = 0; k < 20; k++) writeEquip(w, la[k] ?? EMPTY_LOADOUT_ITEMS()[k], true);
    for (let k = 0; k < 10; k++) writeEquip(w, ld[k] ?? null, true);
    for (let k = 0; k < 10; k++) w.bool(!!lh[k]);
  }
  w.byte(Math.max(1, Math.min(3, a.voiceVariant ?? 1)));
  w.f32(a.voicePitchOffset ?? 0);
  w.i32(0);                                   // refunds(会话态恒 0)
  w.i32(0);                                   // oneTimeDialoguesSeen 空
  return aes128EcbEncrypt(w.build());
}
