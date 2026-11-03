// ★BJ755-A T1（2026-11-02，bj739a D-① 清偿判别锁）：msg50 PlayerBuffs buff 传播协议。
// 覆盖：reader（保序压缩回环/己槽跳过/44 槽满+超界钳/空表终止子清空/尾槽 Array.Clear）、
//       writer（差分节拍：首拍发+字节回环/同 type 不重发/变 type 即发/越界 id 滤除）、
//       代理镜像（applyRemoteBuffMirror 裸写/清 stale/未映射跳过）、Game 注线结构锁。
// 标杆：Terarria1457（NetMessage.cs:997-1010 writer / MessageBuffer.cs:2448-2474 reader /
//       Main.cs:17848-17861 TrySyncingMyPlayer 差分 / Player.cs:1491 maxBuffs=44）；
//       1458 同相（NetMessage.cs:999 / MessageBuffer.cs:2456，两版零 diff 亲读）。
// 变异恰红（withMutation）在 M 组。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withMutation } from './mutation-guard';
import { VanillaClient } from '../src/net/vanilla/VanillaClient';
import { VWriter, VReader, MsgId } from '../src/net/vanilla/codec';
import { BuffState, BuffType, vanillaIdOfBuff, buffTypeByVanilla, applyRemoteBuffMirror } from '../src/stats/Buffs';

const VC_PATH = join(process.cwd(), 'src', 'net', 'vanilla', 'VanillaClient.ts');

/** 喂帧（payload=[u16 len][u8 id] 后段,g36a 同形制） */
const feed = (vc: VanillaClient, w: VWriter, msgId: number): void => {
  const frame = w.finish(msgId);
  (vc as unknown as { handle(id: number, payload: Uint8Array): void })
    .handle(msgId, frame.slice(3));
};

// ============ reader：msg50 PlayerBuffs（MessageBuffer.cs:2448-2474） ============

describe('BJ755-A T1 reader：msg50 buff 栏镜像', () => {
  it('保序压缩回环：[u8 slot][u16×N][u16 0] → buffTypes 槽位赋值（buffTime=60t 不镜像）', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    feed(vc, new VWriter().u8(3).u16(26).u16(4).u16(5), MsgId.PlayerBuffs);
    const rp = (vc as unknown as { players: Map<number, { buffTypes: number[] }> }).players.get(3);
    expect(rp).toBeDefined();
    expect(rp!.buffTypes.slice(0, 3)).toEqual([26, 4, 5]);
    expect(rp!.buffTypes.length).toBe(44);
    expect(rp!.buffTypes.slice(3).every((v) => v === 0)).toBe(true);   // 尾槽 Array.Clear（:2468）
  });

  it('己槽跳过（:2455-2458 slot==myPlayer && !SSC → break）：不建项不回写', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    (vc as unknown as { mySlot: number }).mySlot = 2;
    feed(vc, new VWriter().u8(2).u16(26).u16(5), MsgId.PlayerBuffs);
    const players = (vc as unknown as { players: Map<number, unknown> }).players;
    expect(players.has(2)).toBe(false);   // 未建项（非 SSC=自有 buff 权威端）
  });

  it('44 槽满：恰 44 条全落;第 45 条钳弃（线消费仍由终止子驱动,不串帧）', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    const w = new VWriter().u8(7);
    for (let i = 1; i <= 45; i++) w.u16(i);   // 45 条（1..45）
    w.u16(0);
    feed(vc, w, MsgId.PlayerBuffs);
    const rp = (vc as unknown as { players: Map<number, { buffTypes: number[] }> }).players.get(7);
    expect(rp!.buffTypes.length).toBe(44);
    expect(rp!.buffTypes[0]).toBe(1);
    expect(rp!.buffTypes[43]).toBe(44);        // 第 44 条落位
    // 第 45 条（45）被钳——44 槽之外不写（原版越界写=崩;SW fail-soft 钳,合法流量零差）
  });

  it('空表终止子清空：先满后空 → 全零（对端 buff 全消亦清镜像）', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    feed(vc, new VWriter().u8(3).u16(26).u16(4), MsgId.PlayerBuffs);
    feed(vc, new VWriter().u8(3).u16(0), MsgId.PlayerBuffs);   // 空表（终止子即首元）
    const rp = (vc as unknown as { players: Map<number, { buffTypes: number[] }> }).players.get(3);
    expect(rp!.buffTypes.every((v) => v === 0)).toBe(true);
  });
});

// ============ writer：差分节拍（Main.cs:17848-17861 TrySyncingMyPlayer buff 段） ============

describe('BJ755-A T1 writer：msg50 差分上报', () => {
  const mkVc = (buffs: BuffState) => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    (vc as unknown as { mySlot: number }).mySlot = 5;
    (vc as unknown as { game: unknown }).game = { player: { buffs } };
    const sent: Uint8Array[] = [];
    (vc as unknown as { send(f: Uint8Array): void }).send = (f) => { sent.push(f); };
    return { vc, sent };
  };

  it('首拍发+字节回环：[u8 5][u16 vid]×N 槽序[u16 0 终止子]', () => {
    const b = new BuffState();
    b.active.set(BuffType.Ironskin, 60);   // 施加序=Map 插入序（≈原版槽序）
    b.active.set(BuffType.Gills, 10);
    const { vc, sent } = mkVc(b);
    (vc as unknown as { syncBuffs(): void }).syncBuffs();
    expect(sent.length).toBe(1);
    const r = new VReader(sent[0]!);
    expect(r.u16()).toBe(sent[0]!.length);      // frameLen 全帧长含头
    expect(r.u8()).toBe(MsgId.PlayerBuffs);
    expect(r.u8()).toBe(5);                       // mySlot
    expect(r.u16()).toBe(vanillaIdOfBuff(BuffType.Ironskin));
    expect(r.u16()).toBe(vanillaIdOfBuff(BuffType.Gills));
    expect(r.u16()).toBe(0);                      // 终止子（NetMessage.cs:1008）
    expect(r.remaining).toBe(0);                  // 编码语义自证
  });

  it('差分防抖：同 type 不重发（clientClone 快照等价）;变 type 即发', () => {
    const b = new BuffState();
    b.active.set(BuffType.Ironskin, 60);
    const { vc, sent } = mkVc(b);
    const sync = () => (vc as unknown as { syncBuffs(): void }).syncBuffs();
    sync();
    expect(sent.length).toBe(1);
    sync(); sync();                               // 同集不重发（时长变化不触发——只比类型）
    expect(sent.length).toBe(1);
    b.active.set(BuffType.WellFed, 30);           // 变 type 即发
    sync();
    expect(sent.length).toBe(2);
    b.active.delete(BuffType.Ironskin);           // 消失亦发（集合差）
    sync();
    expect(sent.length).toBe(3);
    const r = new VReader(sent[2]!);
    r.u16(); r.u8(); r.u8();
    expect(r.u16()).toBe(vanillaIdOfBuff(BuffType.WellFed));
    expect(r.u16()).toBe(0);
    expect(r.remaining).toBe(0);
  });

  it('越界 id 滤除：未映射（-1）/超 BuffID.Count=401 的伪 id 不上线（崩服防线）', () => {
    const b = new BuffState();
    b.active.set(9999 as BuffType, 60);           // 未映射伪键 → vanillaIdOfBuff=-1
    b.active.set(BuffType.Ironskin, 60);
    const { vc, sent } = mkVc(b);
    (vc as unknown as { syncBuffs(): void }).syncBuffs();
    expect(sent.length).toBe(1);
    const r = new VReader(sent[0]!);
    r.u16(); r.u8(); r.u8();
    expect(r.u16()).toBe(vanillaIdOfBuff(BuffType.Ironskin));   // 仅合法条目
    expect(r.u16()).toBe(0);
    expect(r.remaining).toBe(0);
  });
});

// ============ 代理镜像：applyRemoteBuffMirror（MessageBuffer.cs:2462-2469 等价） ============

describe('BJ755-A T1 代理镜像：applyRemoteBuffMirror 裸写', () => {
  it('映射集合落栏（1s=60t 镜像）+ 未映射 id 跳过不出错', () => {
    const b = new BuffState();
    applyRemoteBuffMirror(b, [vanillaIdOfBuff(BuffType.Ironskin), 999, vanillaIdOfBuff(BuffType.Gills)]);
    expect(b.active.get(BuffType.Ironskin)).toBe(1);   // 60t=1s
    expect(b.active.get(BuffType.Gills)).toBe(1);
    expect(b.active.has(999 as BuffType)).toBe(false); // 未映射跳过
    expect(buffTypeByVanilla(999)).toBeUndefined();    // 前提自证:999 无映射
  });

  it('缺席即清（Array.Clear 尾段等价）——含全零拍清空（摘守卫陷阱面）', () => {
    const b = new BuffState();
    b.active.set(BuffType.Ironskin, 60);
    b.active.set(BuffType.Gills, 60);
    applyRemoteBuffMirror(b, [vanillaIdOfBuff(BuffType.Gills)]);   // Ironskin 缺席 → 清
    expect(b.active.has(BuffType.Ironskin)).toBe(false);
    expect(b.active.has(BuffType.Gills)).toBe(true);
    applyRemoteBuffMirror(b, []);                                    // 全零拍 → 全清
    expect(b.active.size).toBe(0);
  });

  it('不走 AddBuff 逻辑（裸写）：免疫门不拦镜像（apply 族会丢条目=污染判别）', () => {
    // apply 头门 `immuneVanilla.has(vb) → return`（AddBuff :5052）;裸写镜像=原版
    // reader 直拷语义,免疫态照落——用免疫集构造 apply/裸写分歧行为锁。
    const b = new BuffState();
    b.immuneVanilla.add(vanillaIdOfBuff(BuffType.Ironskin));
    applyRemoteBuffMirror(b, [vanillaIdOfBuff(BuffType.Ironskin)]);
    expect(b.active.get(BuffType.Ironskin)).toBe(1);   // 若误走 apply=被免疫门吞,红
  });
});

// ============ 结构锁：Game 注线（防静默回退） ============

describe('BJ755-A T1 结构锁', () => {
  it('Game.simulateRemotePlayers 注入 applyRemoteBuffMirror（含全零清空路径=无 .some 守卫）', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'core', 'Game.ts'), 'utf8');
    expect(src).toContain('applyRemoteBuffMirror(proxy.buffs, srcB);');
    expect(src).toContain('buffTypes');
  });
  it('VanillaClient：reader case + writer 差分 + BuffID.Count 滤界在盘', () => {
    const src = readFileSync(VC_PATH, 'utf8');
    expect(src).toContain('case MsgId.PlayerBuffs:');
    expect(src).toContain('vid > 0 && vid < 401');
    expect(src).toContain('this.syncBuffs();');
  });
});

// ============ 变异恰红（摘除判别——测试有牙） ============

// ★过滤串纪律（本跑实测两雷,2026-11-02）：
//   ①`-t` 是【正则】——过滤串含 `+` 等元字符=不匹配 → 内层全 skip → exit 0 假绿;
//   ②过滤串不得与 M 测试自身名碰撞（如 '己槽跳过' 同时命中 M1 名）——内层子进程
//     会重入 withMutation（父持锁）→ 泄漏自愈误触发+盘面错乱。两雷均已实测复现。
//   故过滤串取「仅目标测试名独有片段 + 零正则元字符」。
const spawnVitest = (filter: string) => spawnSync(
  'npx', ['vitest', 'run', 'tests/bj755a-msg50-buff-proto.test.ts', '--no-file-parallelism', '-t', filter], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, SW_BJ755A_MUT: '1' },
  },
);
const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
  withMutation(file, trigger, replacement, () => {
    const r = spawnVitest(filter);
    expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
    expect(r.stdout).toContain(filter);
  }, { label: `BJ755-A T1 ${filter}` });
};

describe('BJ755-A T1 变异恰红', () => {
  it('M1 reader：摘己槽跳过 → 己槽建项红', () => {
    mutate(VC_PATH,
      'const slot = r.u8();\n        if (slot === this.mySlot) return;\n        const rp = this.players.get(slot) ?? this.mkRemote(slot);',
      'const slot = r.u8();\n        const rp = this.players.get(slot) ?? this.mkRemote(slot);',
      '不建项不回写');
  });
  it('M2 reader：摘尾槽清空 → 空表清空红', () => {
    mutate(VC_PATH,
      'for (let i = Math.min(n, 44); i < 44; i++) bt[i] = 0;   // Array.Clear 尾槽（:2468）',
      '/* BJ755 mut */',
      '先满后空');
  });
  it('M3 writer：摘终止子 → 字节回环红（帧无 u16 0 收尾）', () => {
    mutate(VC_PATH,
      'w.u16(0);                                   // 终止子（NetMessage.cs:1008）',
      '/* BJ755 mut */',
      '槽序');
  });
  it('M4 镜像：摘缺席清除 → stale 清空红', () => {
    mutate(join(process.cwd(), 'src', 'stats', 'Buffs.ts'),
      'if (!want.has(t)) buffs.active.delete(t);   // Array.Clear 尾段等价（缺席即清）',
      '/* BJ755 mut */',
      '全零拍清空');
  });
});
