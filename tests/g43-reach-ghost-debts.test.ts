// G43 高优登记债清偿（2026-11-03）——两把刀的行为锁
//   D-A-5  Game.tileReach 乘区序反了（旅程 ×2+8 应在配饰/工具箱【之前】）
//   D-N15  远端硬核幽灵在 activePlayerCountForScale 二次计入
//
// 原版锚（1457 唯一标杆）：
//   旅程远置：Player.cs:18931-18941（ResetEffects 先复位 5/3 → ×2 → +8）
//   射程配饰：Player.cs:13138-13142（equippedAnyTileRangeAcc 布尔门 +3/+2）
//   工具箱 1923：Player.cs:15068-15072（+1/+1）
//   钳与 TB：TileReachCheckSettings.cs:15-20（Simple limit=20）/ :28-42（GetRanges 钳）
//             / :53-56（GetTileRegion 钳【后】+TB）
//   活跃玩家数：NPC.cs:18528-18543（netMode==0→1；否则 active && !ghost）
//   原版 msg13 幽灵位：NetMessage.cs:468（bitsByte22[6]=player.ghost 独立位，非 dead∪ghost）
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { withMutation } from './mutation-guard';
import { Game } from '../src/core/Game';
import { ClientNet } from '../src/net/ClientNet';
import { VanillaClient } from '../src/net/vanilla/VanillaClient';
import { NetReader } from '../src/net/protocol';
import { bindJourneyPowers, createJourneyPowers } from '../src/world/JourneyPowers';

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });   // 变异自证内层 spawn 按仓内习语放宽（vitest-default-timeout-pseudo-red）

const SRC = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

afterEach(() => bindJourneyPowers(null));

// ===========================================================================
// D-A-5：tileReach 乘区序
// ===========================================================================
function reachGame(opts: { journey: boolean; tileRange?: boolean; toolboxRange?: number }) {
  const g = Object.create(Game.prototype) as any;
  g.player = { equipStats: { tileRange: !!opts.tileRange, toolboxRange: opts.toolboxRange ?? 0 } };
  g.world = { isJourney: opts.journey };
  return g;
}

describe('G43 D-A-5 tileReach 乘区序 1:1 原版', () => {
  it('非旅程：5/3 基线；配饰 +3/+2；工具箱 +1/+1', () => {
    expect(reachGame({ journey: false }).tileReach(0)).toEqual({ x: 5, y: 3 });
    expect(reachGame({ journey: false, tileRange: true, toolboxRange: 1 }).tileReach(0))
      .toEqual({ x: 9, y: 6 });
  });

  it('旅程（farPlacementRange 默认开）：基础先 ×2+8 = 18/14', () => {
    bindJourneyPowers({ ...createJourneyPowers(), farPlacementRange: true });
    expect(reachGame({ journey: true }).tileReach(0)).toEqual({ x: 18, y: 14 });
    // 旅程+配饰：y = 14+2 = 16（反序旧式 = (3+2)×2+8 = 18）
    expect(reachGame({ journey: true, tileRange: true }).tileReach(0)).toEqual({ x: 20, y: 16 });
  });

  it('旅程+配饰+工具箱：((5×2+8)+3+1)/((3×2+8)+2+1) = 22/17 → 钳 x=20；旧反序 20/20', () => {
    bindJourneyPowers({ ...createJourneyPowers(), farPlacementRange: true });
    const g = reachGame({ journey: true, tileRange: true, toolboxRange: 1 });
    expect(g.tileReach(0)).toEqual({ x: 20, y: 17 });
    // 负控：同输入下反序旧式 y=20——本测必须能区分两序
    const legacyY = Math.min(20, (3 + 2 + 1) * 2 + 8);
    expect(legacyY).toBe(20);
    expect(g.tileReach(0).y).not.toBe(legacyY);
  });

  it('TB 在钳【后】加（TileReachCheckSettings.cs:53-56）：20+2=22 / 17+2=19，不再钳', () => {
    bindJourneyPowers({ ...createJourneyPowers(), farPlacementRange: true });
    const g = reachGame({ journey: true, tileRange: true, toolboxRange: 1 });
    expect(g.tileReach(2)).toEqual({ x: 22, y: 19 });
  });

  it('farPlacementRange 关闭 → 回 5/3 基线（配饰照加）', () => {
    bindJourneyPowers({ ...createJourneyPowers(), farPlacementRange: false });
    expect(reachGame({ journey: true, tileRange: true }).tileReach(0)).toEqual({ x: 8, y: 5 });
  });
});

// ===========================================================================
// D-N15：msg13 flagBits[1] 独立硬核幽灵位
// ===========================================================================
function mkLocalPlayer(opts: { dead: boolean; ghost: boolean }) {
  return {
    x: 100, y: 200, vx: 1, vy: 2, facing: 1, dead: opts.dead,
    inputX: 0, inputJump: false, inputDown: false, inputUp: false, inputDash: false,
    sleeping: false, hostile: false, team: 0,
    inv: { selected: 0, slots: [], heldItem: () => null },
    isGhostPhase: (_w: unknown) => opts.ghost,
  };
}

/** ClientNet 无构造器桩（Object.create：私有字段按测试面注入） */
function mkNet(player: any, world: any) {
  const net = Object.create(ClientNet.prototype) as any;
  net.game = { player, world };
  net.mySlot = 0;
  net.pendingCamTarget = null;
  net.lastStateSent = 0;
  net.lastSentPos = { x: 0, y: 0 };
  net.lastSentCtrl = -1; net.lastSentSel = -1; net.lastSentDead = false;
  net.lastSentSleep = false; net.lastSentHostile = false; net.lastSentTeam = 0;
  net.lastSentGhost = false; net.lastSyncedCamTarget = null;
  net.players = new Map();
  let frame: Uint8Array | null = null;
  net.send = (b: Uint8Array) => { frame = b; };
  net.take = () => frame;
  return net;
}

describe('G43 D-N15 远端硬核幽灵计数', () => {
  it('发端：硬核幽灵置 [1]+[6]；普通死亡仅 [6]；存活皆 0（并集锁不动）', () => {
    const world = {};
    const ghost = mkNet(mkLocalPlayer({ dead: true, ghost: true }), world);
    ghost.sendPlayerState(true);
    const f1 = ghost.take()!;
    expect(f1[2]).toBe(13);              // [u16 len][u8 msgId]
    expect(f1[5] & 2).toBe(2);           // flagBits[1] hardcoreGhost（★D-N15）
    expect(f1[5] & 64).toBe(64);         // flagBits[6] dead∪ghost 并集（BJ742-A R22）

    const deadOnly = mkNet(mkLocalPlayer({ dead: true, ghost: false }), world);
    deadOnly.sendPlayerState(true);
    const f2 = deadOnly.take()!;
    expect(f2[5] & 2).toBe(0);           // 普通死亡不算 ghost（原版 ghost=false）
    expect(f2[5] & 64).toBe(64);         // 但远端仍须显 dead（并集语义）

    const alive = mkNet(mkLocalPlayer({ dead: false, ghost: false }), world);
    alive.sendPlayerState(true);
    const f3 = alive.take()!;
    expect(f3[5] & 3).toBe(0);
    expect(f3[5] & 64).toBe(0);
  });

  it('收端：flagBits[1] → rp.ghostPhase；[6] 仍 → rp.dead', () => {
    const world = {};
    const tx = mkNet(mkLocalPlayer({ dead: true, ghost: true }), world);
    tx.mySlot = 7;
    tx.sendPlayerState(true);
    const frame = tx.take()!;
    const rx = mkNet(mkLocalPlayer({ dead: false, ghost: false }), world);
    rx.mySlot = 0;
    rx.handle(13, new NetReader(frame.subarray(3)));   // 去帧头 = msg13 体
    const rp = rx.players.get(7)!;
    expect(rp.ghostPhase).toBe(true);
    expect(rp.dead).toBe(true);
  });

  it('消费端：ghostPhase 远端不计；普通死亡（dead 且非 ghost）照计（NPC.cs:18534-18540）', () => {
    const player = mkLocalPlayer({ dead: false, ghost: false });
    const mkGame = (remotes: Array<[number, boolean, boolean]>) => ({
      world: {}, player,
      net: {
        active: true, mySlot: 0,
        players: new Map(remotes.map(([slot, active, ghostPhase]) => [slot, { active, ghostPhase }])),
      },
    }) as unknown as Game;
    expect(Game.prototype.activePlayerCountForScale.call(mkGame([[1, true, false]]))).toBe(2);
    expect(Game.prototype.activePlayerCountForScale.call(mkGame([[1, true, true]]))).toBe(1);
    expect(Game.prototype.activePlayerCountForScale.call(mkGame([[1, true, true], [2, true, false]]))).toBe(2);
  });

  it('原版服槽复用：PlayerActive 再上线清幽灵位（上一 occupant 不得残留）', () => {
    const vc = new VanillaClient({}, { onWorldReady: () => {} });
    const players = (vc as unknown as {
      players: Map<number, { active: boolean; ghostPhase: boolean }>;
    }).players;
    players.set(3, { active: false, ghostPhase: true });
    (vc as unknown as { handle(id: number, payload: Uint8Array): void })
      .handle(14, new Uint8Array([3, 1]));   // msg14 PlayerActive: [u8 slot][u8 active]
    const rp = players.get(3)!;
    expect(rp.ghostPhase).toBe(false);
    expect(rp.active).toBe(true);
  });

  it('原版服直连映射 + 线格式文档锁', () => {
    const vc = SRC('net/vanilla/VanillaClient.ts');
    expect(vc).toContain('rp.ghostPhase = !!(c2 & 64)');   // NetMessage.cs:468
    expect(vc).toContain('ghostPhase: false,');
    expect(SRC('net/ClientNet.ts')).toContain('p.ghostPhase = !!(flag & 2);');
    expect(SRC('net/protocol.ts')).toContain('[1]hardcoreGhost');
  });
});

// ===========================================================================
// 变异自证（withMutation 只打 src/net/ClientNet.ts——本刀独占改动面）
// ★D-A-5 的宿主在 Game.ts（禁变异）；其判别由上方「反序旧式」负控行为断言承担。
// 过滤串=测试名独有片段、零正则元字符（vitest -t 是正则）。
// ===========================================================================
describe.skipIf(process.env.SW_G43_MUT)('G43 债务变异恰红', () => {
  const CN = join(process.cwd(), 'src', 'net', 'ClientNet.ts');
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/g43-reach-ghost-debts.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      env: { ...process.env, SW_G43_MUT: '1' },
    });
  const mutate = (trigger: string, replacement: string, filter: string): void => {
    let pristineSha = '';
    withMutation(CN, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout + r.stderr).toContain(filter);
    }, {
      label: `G43 D-N15 ${filter}`,
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    // 还原逐字节对拍（BJ662 判例：锁内重读）
    expect(createHash('sha256').update(readFileSync(CN)).digest('hex'), `还原对拍 ${filter}`)
      .toBe(pristineSha);
  };

  it('M1 发端 flagBits[1] 摘除 → 发端位断言红', () => {
    mutate('| (ghostPhase ? 2 : 0)', '| 0', '发端');
  });

  it('M2 收端 flagBits[1] 映射摘除 → 收端 ghostPhase 断言红', () => {
    mutate('p.ghostPhase = !!(flag & 2);', 'p.ghostPhase = false;', '收端');
  });
});
