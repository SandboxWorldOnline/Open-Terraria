// 原版 1.4.5.8 网络编解码（vanilla interop 战役，2026-10-24）。
// 唯一权威 = tests/golden/net-protocol-1458.json（recon-net-1458.mjs 从 Terarria1458
// 反编译机械提取，DRIFT 闸门锁定）。
// ★帧语义定谳（NetMessage.cs CheckBytes:2548-2570，rig 实弹复核 2026-10-24）：
//   [u16 frameLen LE][u8 msgId][payload]——frameLen=全帧字节数【含 2B len 头自身】，
//   整帧推进 len 字节，len<3 非法。读侧 BinaryReader 不按帧定界（len 写短会串帧）。
//   ⚠ SW 自有协议（net/protocol.ts）len=body 语义不同——互操作禁止照搬（判例在档）。
// 字符串 = .NET BinaryWriter 7bit 变长前缀 + UTF-8；Vector2 = 2×f32；一律小端。
import { inflateSync } from 'fflate';

export const VANILLA_RELEASE = 326; // curRelease（Main.cs:222）；1457=325 旧服回退未实现（登记债）

/** MessageID 子集（全 163 表见金标；此处只收本模块已消费/即将消费的号） */
export const MsgId = {
  Hello: 1, Kick: 2, PlayerInfo: 3, SyncPlayer: 4, SyncEquipment: 5,
  RequestWorldData: 6, WorldData: 7, SpawnTileData: 8, StatusText: 9, TileSection: 10,
  PlayerSpawn: 12, PlayerControls: 13, PlayerActive: 14, PlayerLifeMana: 16,
  AreaTileChange: 20, SyncItem: 21, SyncNpc: 23, SyncChestItem: 32,
  InitialSpawn: 49, PlayerMana: 42, PlayerBuffs: 50, ClientUuid: 68, NetModules: 82,
  SyncProjectile: 27, KillProjectile: 29, PlayerHurtV2: 117, PlayerDeathV2: 118,
  TileManipulation: 17, SyncItemDespawn: 151,
  FinishedConnectingToServer: 129, SyncCavernMonsterType: 136, SyncLoadout: 147,
  ExtraSpawnSectionLoaded: 158, RequestSection: 159, HostToken: 161, DamageNPCAck: 162,
} as const;

/** 段尺寸（Netplay.GetSectionX/GetSectionY 语义：section = 200×150 tile） */
export const SECTION_W = 200, SECTION_H = 150;

export class VWriter {
  private b: number[] = [];
  u8(v: number): this { this.b.push(v & 0xff); return this; }
  /** 变长 u8 序（RGB 三元组等） */
  u8n(...vs: number[]): this { for (const v of vs) this.b.push(v & 0xff); return this; }
  i8(v: number): this { return this.u8(v < 0 ? v + 0x100 : v); }
  u16(v: number): this { this.b.push(v & 0xff, (v >> 8) & 0xff); return this; }
  i16(v: number): this { return this.u16(v < 0 ? v + 0x10000 : v); }
  i32(v: number): this {
    const u = v < 0 ? v + 0x100000000 : v;
    this.b.push(u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, (u >>> 24) & 0xff);
    return this;
  }
  u32(v: number): this {
    const u = v >>> 0;
    this.b.push(u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, (u >>> 24) & 0xff);
    return this;
  }
  u64(v: bigint): this {
    this.i32(Number(v & 0xffffffffn));
    this.i32(Number((v >> 32n) & 0xffffffffn));
    return this;
  }
  f32(v: number): this {
    const b = new DataView(new ArrayBuffer(4));
    b.setFloat32(0, v, true);
    for (let i = 0; i < 4; i++) this.b.push(b.getUint8(i));
    return this;
  }
  /** .NET BinaryWriter.Write(string)：7bit 变长前缀（本仓协议域字符串均 <128B，超长即抛） */
  str(s: string): this {
    const e = new TextEncoder().encode(s);
    if (e.length >= 128) throw new Error(`VWriter.str 超 7bit 单节域(${e.length}B): ${s.slice(0, 32)}`);
    this.b.push(e.length, ...e);
    return this;
  }
  raw(bytes: Uint8Array): this { for (const x of bytes) this.b.push(x); return this; }
  get length(): number { return this.b.length; }
  get buf(): Uint8Array { return new Uint8Array(this.b); }
  /** 封帧：[u16 frameLen=含头][msgId][payload] */
  finish(msgId: number): Uint8Array {
    const body = new Uint8Array(this.b.length + 1);
    body[0] = msgId;
    body.set(this.buf, 1);
    const out = new Uint8Array(body.length + 2);
    new DataView(out.buffer).setUint16(0, out.length, true); // frameLen=全帧长含头（CheckBytes 定谳）
    out.set(body, 2);
    return out;
  }
}

export class VReader {
  p = 0;
  constructor(readonly buf: Uint8Array, public start = 0) { this.p = start; }
  u8(): number { return this.buf[this.p++]; }
  i8(): number { const v = this.u8(); return v >= 128 ? v - 256 : v; }
  u16(): number { const v = this.buf[this.p] | (this.buf[this.p + 1] << 8); this.p += 2; return v; }
  i16(): number { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  i32(): number { const d = new DataView(this.buf.buffer, this.buf.byteOffset + this.p, 4); this.p += 4; return d.getInt32(0, true); }
  u64(): bigint { const d = new DataView(this.buf.buffer, this.buf.byteOffset + this.p, 8); this.p += 8; return d.getBigUint64(0, true); }
  f32(): number { const d = new DataView(this.buf.buffer, this.buf.byteOffset + this.p, 4); this.p += 4; return d.getFloat32(0, true); }
  str(): string {
    let len = 0, shift = 0;
    for (;;) { const b = this.u8(); len |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7; }
    const s = new TextDecoder().decode(this.buf.subarray(this.p, this.p + len));
    this.p += len;
    return s;
  }
  bytes(n: number): Uint8Array { const v = this.buf.subarray(this.p, this.p + n); this.p += n; return v; }
  get remaining(): number { return this.buf.length - this.p; }
}

/** raw deflate 解压（Ionic DeflateStream 兼容；msg10 段流全载荷） */
export function inflateRawSync(bytes: Uint8Array): Uint8Array {
  return inflateSync(bytes);
}

/**
 * 帧装配器：喂原始 TCP/WS 字节流，按 [u16 frameLen 含头] 切帧回调。
 * 半帧跨包缓冲；len<3 或超 65535 即坏流（fail-loud，不静默重同步——原版服务器不会发）。
 */
export class VanillaFrameParser {
  private acc = new Uint8Array(0);
  feed(chunk: Uint8Array) {
    const next = new Uint8Array(this.acc.length + chunk.length);
    next.set(this.acc); next.set(chunk, this.acc.length);
    this.acc = next;
  }
  drain(cb: (msgId: number, payload: Uint8Array) => void) {
    for (;;) {
      if (this.acc.length < 2) return;
      const len = this.acc[0] | (this.acc[1] << 8);
      if (len < 3 || len > 65535) throw new Error(`vanilla 帧装配:非法 frameLen=${len}`);
      if (this.acc.length < len) return;
      const msgId = this.acc[2];
      cb(msgId, this.acc.subarray(3, len));
      this.acc = this.acc.subarray(len);
    }
  }
  get pending(): number { return this.acc.length; }
}
