// 原版网络协议权威结构锁（recon-net-1458.mjs 的运行时闸门，2026-10-24）
// 战役：SW 客户端直连原版 1.4.5.8 服务器。金标 = tests/golden/net-protocol-1458.json
//（从 Terarria1458 反编译机械提取，DRIFT 闸门 = node tools/recon-net-1458.mjs）。
// 本测试锁死提取器与反编译源的契约关键锚：帧语义 / 版本串 / 1458 网络面增量 /
// NetModule 注册序 / 握手状态机白名单 / 专用通道情报。改这些 = 网络面漂移，先定谳。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'golden', 'net-protocol-1458.json');
const g = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
const M = g.messages as Record<string, {
  name: string; readerRaw: string | null; writerRaw: string | null;
  writerPreRaw: string | null; readerOps: string[] | null;
}>;

describe('net-protocol-1458 金标结构锁', () => {
  it('帧语义：frameLen 含 len 头自身（NetMessage.cs CheckBytes:2548-2570 定谳）', () => {
    expect(g.meta.framing.frameLenIncludesSelf).toBe(true);
    expect(g.meta.framing.minFrameLen).toBe(3);
    expect(g.meta.framing.format).toBe('[u16 frameLen LE][u8 msgId][payload]');
  });

  it('版本锚：1458 = curRelease 326 = "Terraria326"（1457=325 做配置回退）', () => {
    expect(g.meta.curRelease).toBe(326);
    expect(g.meta.helloString).toBe('Terraria326');
    expect(M['1'].writerRaw).toContain('"Terraria" + 326');
  });

  it('消息面：163 消息全在金标，关键名字锚防错位', () => {
    expect(g.meta.messageCount).toBe(163);
    expect(Object.keys(M).length).toBe(163);
    expect(M['7'].name).toBe('WorldData');
    expect(M['82'].name).toBe('NetModules');
    expect(M['161'].name).toBe('HostToken');
    expect(M['162'].name).toBe('DamageNPCAck');
  });

  it('★1458 网络面增量锁：msg7 WorldData 追加 dungeonX/Y（Int16×2，线格式真变）', () => {
    expect(M['7'].readerRaw).toMatch(/Main\.dungeonX = reader\.ReadInt16\(\)/);
    expect(M['7'].readerRaw).toMatch(/Main\.dungeonY = reader\.ReadInt16\(\)/);
  });

  it('★1458 网络面增量锁：msg136 SyncCavernMonsterType 服务器侧新增 break 门', () => {
    expect(M['136'].name).toBe('SyncCavernMonsterType');
    expect(M['136'].readerRaw).toMatch(/Main\.netMode == 2/);
  });

  it('msg21 早退改写：IsAir → msgType=151（SendData 双开关结构）', () => {
    expect(M['21'].writerPreRaw).toContain('msgType = 151');
  });

  it('NetModule 注册表：15 员，注册序即 ID（msg82 载荷首 u16）', () => {
    expect(g.netModules).toHaveLength(15);
    expect(g.netModules[0].class).toBe('NetLiquidModule');
    expect(g.netModules[1].class).toBe('NetTextModule');
    expect(g.netModules[2].class).toBe('NetPingModule');
    expect(g.netModules[8].class).toBe('NetTeleportPylonModule');
    expect(g.netModules[14].class).toBe('UnbreakableWallScan.NetModule');
  });

  it('握手状态机 preamble：join 顺序门（State<10 白名单 + State==0 只收 Hello）', () => {
    expect(g.meta.serverHandshakeGate).toContain('State < 10 && b > 12');
    expect(g.meta.serverHandshakeGate).toContain('State == 0 && b != 1');
    expect(g.meta.serverHandshakeGate).toContain('State == -1');
  });

  it('专用通道情报：82/154/162 无 SendData 写侧（NetPacket 通道），162 读侧在', () => {
    expect(M['82'].writerRaw).toBeNull();
    expect(M['154'].writerRaw).toBeNull();
    expect(M['162'].writerRaw).toBeNull();
    expect(M['162'].readerRaw).not.toBeNull();
  });

  it('msg13 PlayerControls 读序含 ReadVector2 扩展（=2×ReadSingle）', () => {
    expect(M['13'].readerOps).toContain('ReadVector2');
  });
});
