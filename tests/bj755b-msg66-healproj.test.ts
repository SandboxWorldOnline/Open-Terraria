// ★BJ755-A T2（2026-11-02，bj746a D4 清偿判别锁）：msg66 HealProj 远端治疗同步。
// 覆盖：reader（远端臂 rp.hp+=钳/己槽臂 onPlayerHeal 钩子/负控 amount≤0）、
//       writer（sendHeal66 字节回环+双负控、HealProj 到位结算 reportHeal 单源上报、
//       月噬 145 拒发拒写、floor(heal)≤0 不上报）、Game 注线结构锁。
// 标杆：Terarria1457（NetMessage.cs:1112-1115 writer / MessageBuffer.cs:3030-3048 reader /
//       Projectile.cs:28943-28950 发送位；1458 同相 :1114/:3038-3056/:28941-28953 零 diff 亲读）。
// 变异恰红（withMutation）在 M 组；过滤串纪律见 bj755a 头注（正则元字符/名碰撞双雷）。
import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withMutation } from './mutation-guard';
import { VanillaClient } from '../src/net/vanilla/VanillaClient';
import { VWriter, VReader, MsgId } from '../src/net/vanilla/codec';
import { HealProj } from '../src/entities/HealProj';
import { entityNet } from '../src/net/entitySyncHooks';
import type { GameHooks } from '../src/entities/types';

const VC_PATH = join(process.cwd(), 'src', 'net', 'vanilla', 'VanillaClient.ts');
const HP_PATH = join(process.cwd(), 'src', 'entities', 'HealProj.ts');

afterEach(() => { entityNet.reportHeal = null; });   // 单例钩子测试后复位（防跨 describe 泄漏）

const feed = (vc: VanillaClient, w: VWriter, msgId: number): void => {
  const frame = w.finish(msgId);
  (vc as unknown as { handle(id: number, payload: Uint8Array): void })
    .handle(msgId, frame.slice(3));
};

// ============ reader：msg66 HealPlayer（MessageBuffer.cs:3030-3048） ============

describe('BJ755-A T2 reader：msg66 治疗收款', () => {
  it('远端臂：msg66 → rp.hp += 钳 maxHp（msg16 随后校准,与 vanilla 同相）', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    const players = (vc as unknown as { players: Map<number, { hp: number; maxHp: number }> }).players;
    players.set(3, { hp: 60, maxHp: 100 } as never);
    feed(vc, new VWriter().u8(3).i16(20), MsgId.HealPlayer);
    expect(players.get(3)!.hp).toBe(80);
    feed(vc, new VWriter().u8(3).i16(50), MsgId.HealPlayer);   // 超额 → 钳 maxHp（:3038-3041）
    expect(players.get(3)!.hp).toBe(100);
  });

  it('己槽臂：服务器中继治疗 → onPlayerHeal 钩子（hp 钳+绿飘字通道）', () => {
    let healed = 0;
    const vc = new VanillaClient({}, { onWorldReady: () => {}, onPlayerHeal: (a) => { healed = a; } });
    (vc as unknown as { mySlot: number }).mySlot = 2;
    feed(vc, new VWriter().u8(2).i16(17), MsgId.HealPlayer);
    expect(healed).toBe(17);
  });

  it('负控：amount≤0 不入账（reader :3034 门）', () => {
    let healed = 0;
    const vc = new VanillaClient({}, { onWorldReady: () => {}, onPlayerHeal: (a) => { healed = a; } });
    (vc as unknown as { mySlot: number }).mySlot = 2;
    const players = (vc as unknown as { players: Map<number, { hp: number; maxHp: number }> }).players;
    players.set(3, { hp: 60, maxHp: 100 } as never);
    feed(vc, new VWriter().u8(2).i16(-5), MsgId.HealPlayer);
    feed(vc, new VWriter().u8(3).i16(-5), MsgId.HealPlayer);
    feed(vc, new VWriter().u8(3).i16(0), MsgId.HealPlayer);
    expect(healed).toBe(0);
    expect(players.get(3)!.hp).toBe(60);   // 负值不得漏门扣血
  });
});

// ============ writer：sendHeal66 + HealProj 结算单源（Projectile.cs:28943-28950） ============

describe('BJ755-A T2 writer：sendHeal66 帧', () => {
  it('sendHeal66 字节回环：[u8 slot][i16 amount]（NetMessage.cs:1112-1115）', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    (vc as unknown as { active: boolean }).active = true;
    (vc as unknown as { worldDelivered: boolean }).worldDelivered = true;
    const sent: Uint8Array[] = [];
    (vc as unknown as { send(f: Uint8Array): void }).send = (f) => { sent.push(f); };
    (vc as unknown as { sendHeal66(s: number, a: number): void }).sendHeal66(7, 25);
    expect(sent.length).toBe(1);
    const r = new VReader(sent[0]!);
    expect(r.u16()).toBe(sent[0]!.length);   // frameLen 全帧长含头
    expect(r.u8()).toBe(MsgId.HealPlayer);
    expect(r.u8()).toBe(7);
    expect(r.i16()).toBe(25);
    expect(r.remaining).toBe(0);              // 编码语义自证
  });

  it('sendHeal66 负控：amount≤0/未激活不发送', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    (vc as unknown as { active: boolean }).active = true;
    (vc as unknown as { worldDelivered: boolean }).worldDelivered = true;
    const sent: Uint8Array[] = [];
    (vc as unknown as { send(f: Uint8Array): void }).send = (f) => { sent.push(f); };
    (vc as unknown as { sendHeal66(s: number, a: number): void }).sendHeal66(7, 0);
    (vc as unknown as { sendHeal66(s: number, a: number): void }).sendHeal66(7, -3);
    expect(sent.length).toBe(0);
    (vc as unknown as { active: boolean }).active = false;
    (vc as unknown as { sendHeal66(s: number, a: number): void }).sendHeal66(7, 25);
    expect(sent.length).toBe(0);              // 未激活/未进世界不发送
  });
});

// ============ HealProj 结算位单源上报（与 vanilla 发送位同构） ============

/** HealProj 测试夹具：目标在弹出生点（首子步即命中门） */
const mkHooks = (opts?: { moonLeech?: boolean }): { game: GameHooks; nums: number[] } => {
  const nums: number[] = [];
  const game = {
    player: { buffs: { moonLeech: !!opts?.moonLeech } },
    addDamageNumber: (x: number, y: number, n: number) => { nums.push(n); },
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1, x: 0, y: 0 }),
  } as unknown as GameHooks;
  return { game, nums };
};

describe('BJ755-A T2 HealProj 结算上报', () => {
  it('到位结算：reportHeal(target, floor(heal)) 单次上报（本地 hp 写+飘字照常）', () => {
    const { game, nums } = mkHooks();
    const target = { x: 1000, y: 500, w: 16, h: 32, hp: 60, maxHp: 100 };
    const calls: Array<{ t: unknown; n: number }> = [];
    entityNet.reportHeal = (t, n) => { calls.push({ t, n }); };
    const hp = new HealProj(298, 1008, 516, 9.7, target);   // (x,y)=中心;heal 9.7 → floor 9
    hp.fixedUpdate(1 / 60, game);
    expect(hp.dead).toBe(true);                     // Kill 门外无月噬照常消亡
    expect(target.hp).toBe(69);                     // 本地写（min(100, 60+9)）
    expect(nums).toEqual([9]);                      // 绿飘字（n>0）
    expect(calls.length).toBe(1);                   // 单源单次
    expect(calls[0]!.n).toBe(9);                    // (int)ai[1] :28942
    expect(calls[0]!.t).toBe(target);               // 目标引用（Game 注线解析槽位）
  });

  it('月噬门：拒治疗不拒消亡（Kill 门外=原版同相）+ 零上报', () => {
    const { game, nums } = mkHooks({ moonLeech: true });
    const target = { x: 1000, y: 500, w: 16, h: 32, hp: 60, maxHp: 100 };
    let called = 0;
    entityNet.reportHeal = () => { called++; };
    const hp = new HealProj(305, 1008, 516, 9, target);
    hp.fixedUpdate(1 / 60, game);
    expect(hp.dead).toBe(true);                     // Kill 在门外（:28952）
    expect(target.hp).toBe(60);                     // 月噬拒写
    expect(nums).toEqual([]);                       // 拒飘字
    expect(called).toBe(0);                         // 拒上报（Projectile.cs:28940 门内）
  });

  it('负控：floor(heal)≤0 不上报（heal<1 的防御钳;vanilla ai[1] 构造恒正）', () => {
    const { game } = mkHooks();
    const target = { x: 1000, y: 500, w: 16, h: 32, hp: 60, maxHp: 100 };
    let called = 0;
    entityNet.reportHeal = () => { called++; };
    const hp = new HealProj(298, 1008, 516, 0.4, target);
    hp.fixedUpdate(1 / 60, game);
    expect(hp.dead).toBe(true);
    expect(called).toBe(0);
  });
});

// ============ 结构锁：Game 注线（防静默回退） ============

describe('BJ755-A T2 结构锁', () => {
  it('Game：reportHeal 注入（槽位解析:本地=mySlot/代理=__netSlot）+ onPlayerHeal 钩子 + teardown', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'core', 'Game.ts'), 'utf8');
    expect(src).toContain('entityNet.reportHeal = (target, amount) => {');
    expect(src).toContain('vc.sendHeal66(slot, amount);');
    expect(src).toContain('onPlayerHeal: (amount) => {');
    expect(src).toContain('entityNet.reportHeal = null;');
  });
  it('writer 单源=HealProj 结算位（applyLifeSteal 无重复发送面）', () => {
    const hp = readFileSync(HP_PATH, 'utf8');
    expect(hp).toContain('entityNet.reportHeal?.(this.target, n);');
    const gm = readFileSync(join(process.cwd(), 'src', 'core', 'Game.ts'), 'utf8');
    // applyLifeSteal 函数体内不得出现 sendHeal66（发射位≠发送位,任务书单源条款）
    const fnBody = gm.slice(gm.indexOf('applyLifeSteal(kind:'), gm.indexOf('applyLifeSteal(kind:') + 2400);
    expect(fnBody).not.toContain('sendHeal66');
  });
});

// ============ 变异恰红（摘除判别——测试有牙;过滤串纪律见 bj755a 头注） ============

const spawnVitest = (filter: string) => spawnSync(
  'npx', ['vitest', 'run', 'tests/bj755b-msg66-healproj.test.ts', '--no-file-parallelism', '-t', filter], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, SW_BJ755B_MUT: '1' },
  },
);
const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
  withMutation(file, trigger, replacement, () => {
    const r = spawnVitest(filter);
    expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
    expect(r.stdout).toContain(filter);
  }, { label: `BJ755-A T2 ${filter}` });
};

describe('BJ755-A T2 变异恰红', () => {
  it('M1 HealProj：摘 reportHeal 调用 → 到位结算红', () => {
    mutate(HP_PATH,
      'if (n > 0) entityNet.reportHeal?.(this.target, n);',
      '/* BJ755 mut */',
      '单次上报');
  });
  it('M2 reader：摘己槽钩子分发 → 己槽臂红', () => {
    mutate(VC_PATH,
      'if (slot === this.mySlot) {\n          this.hooks.onPlayerHeal?.(amount);\n          return;\n        }',
      'if (slot === this.mySlot) {\n          return;\n        }',
      '中继治疗');
  });
  it('M3 writer：摘 sendHeal66 负控门 → 假帧红', () => {
    mutate(VC_PATH,
      'if (amount <= 0 || targetSlot < 0 || targetSlot > 255) return;',
      'if (targetSlot < 0 || targetSlot > 255) return;',
      '不发送');
  });
});
