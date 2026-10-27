// BJ728-A 债1（BJ715-A 登记债 D-⑤S 清偿，2026-10-27）：枯萎兽灵气脉冲一次性跟踪轨。
// 原版锚（亲读 Terarria1457）：
//   · NPC.cs:64084-64094（case 568/569, AI_107_ImprovedWalkers :63575 内）=
//     GetActiveSound(SlotId.FromFloat(localAI[1])) 空 → PlayTrackedSound(
//     SoundID.DD2_WitherBeastAuraPulse, Center)；在播仅 activeSound.Position=Center。
//   · SoundID.cs:966 CreateTrackable("dd2_wither_beast_aura_pulse", 2)——无
//     WithVolume → SoundStyle.cs:35 缺省音量 **1**（旧实现 0.5 无锚）；2 变体每播
//     随机（LegacySoundStyle.cs:24-29 Style getter 每读重掷）；非循环（循环走
//     PlayTrackedLoopedSound 另口）——播毕槽释放、次拍判空重触发=以音长 2.3/3.0s
//     为节拍的重触发链。
// 落地形制（BJ715-A 备案 1:1）：Sfx.startTrackedOneShot（onended done 门+每播随机
// 变体+setPos 距离衰减/声像）+ GameHooks 可选钩 + Game.ts 三行代理；★禁
// startTrackedLoop 近似（反模式⑧）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { TILE } from '../src/core/constants';
import { ai107ImprovedWalkers } from '../src/entities/bossAI_dd2';
import { soundTrackFiles } from '../src/data/vanillaNpcs';
import { withMutation } from './mutation-guard';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME_ROOT, 'src', p), 'utf8');
const DD2_SRC = join(GAME_ROOT, 'src/entities/bossAI_dd2.ts');
const spawnVitest = (filter: string) => spawnSync('npx', ['vitest', 'run', filter, '--reporter=basic'],
  { cwd: GAME_ROOT, encoding: 'utf8', timeout: 180_000, env: { ...process.env, BJ728A_MUT_SKIP: '1' } });
const itMut = process.env.BJ728A_MUT_SKIP === '1' ? it.skip : it;
afterEach(() => vi.restoreAllMocks());

/** 一次性跟踪轨记录仪（mock GameHooks.startTrackedOneShot） */
interface OneShotRec {
  files: string[]; vol: number; x: number; y: number;
  setPosCalls: Array<[number, number]>; stopCalls: number;
}
type DoneCell = { done: boolean };
function makeAuraRig(doneCell: DoneCell, opts: { startReturns?: () => boolean } = {}) {
  const w = new World(220, 160, 7, 'bj728a-aura');
  for (let tx = 0; tx < 220; tx++) { w.store.setTile(tx, 120, 1); w.store.setTile(tx, 121, 1); }
  const e = Enemy.fromVanilla(568, 90 * TILE, 0)!;
  e.y = 120 * TILE - e.h;                       // 落地（bj715a 件5 同夹具）
  e.vx = 0; e.vy = 0;
  const starts: OneShotRec[] = [];
  let grant = true;
  const hooks = {
    world: w, player: null,
    enemies: () => [e], critters: () => [],
    spawnDust: () => null, spawnParticles: () => {},
    spawnDrop: () => null, damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, playSfx: () => {}, playSfxFiles: () => {},
    showPickupLabel: () => {},
    startTrackedOneShot: (files: string[], vol: number, x: number, y: number) => {
      const rec: OneShotRec = { files: [...files], vol, x, y, setPosCalls: [], stopCalls: 0 };
      starts.push(rec);
      if (!grant) return null;                  // 缓冲未就绪档（A5）
      return {
        get done() { return doneCell.done; },   // 活门：播毕翻 true
        stop: () => { rec.stopCalls++; },
        setPos: (px: number, py: number) => { rec.setPosCalls.push([px, py]); },
      };
    },
  } as unknown as GameHooks;
  if (opts.startReturns) { /* 保留扩展位 */ }
  const grantStarts = (g: boolean) => { grant = g; };
  return { w, e, hooks, starts, grantStarts };
}
/** 进灵气态（bj715a 件5 同法：首驱清 bInit → ai0=1 驻留 1↔2 振荡） */
const enterAura = (e: Enemy, hooks: GameHooks) => {
  ai107ImprovedWalkers(e, hooks, null);
  e.ai0 = 1;
};
const drive = (e: Enemy, hooks: GameHooks, n: number) => {
  for (let i = 0; i < n; i++) ai107ImprovedWalkers(e, hooks, null);
};

describe('BJ728-A 债1：枯萎兽灵气脉冲一次性跟踪轨（行为锁）', () => {
  it('A1 调用形制：变体组整组传入 + 音量 1（CreateTrackable 缺省,非 0.5）+ 起振位=Center', () => {
    const { e, hooks, starts } = makeAuraRig({ done: false });
    enterAura(e, hooks);
    const cxBefore = e.cx, cyBefore = e.cy;
    drive(e, hooks, 1);
    expect(starts.length, '灵气态首拍即起振（GetActiveSound 空 → PlayTrackedSound）').toBe(1);
    expect(starts[0].files, '变体组整组传入（随机取一在 Sfx 内,LegacySoundStyle.Style 每播重掷）')
      .toEqual(['dd2_wither_beast_aura_pulse_0', 'dd2_wither_beast_aura_pulse_1']);
    expect(starts[0].vol, '音量=SoundStyle 缺省 1（SoundID.cs:966 无 WithVolume;旧 0.5 无锚）').toBe(1);
    expect(starts[0].x).toBe(cxBefore);
    expect(starts[0].y).toBe(cyBefore);
  });

  it('A2 重触发节拍=音长 done 门：在播零新起振,播毕（onended）次拍即重触发', () => {
    const doneCell = { done: false };
    const { e, hooks, starts } = makeAuraRig(doneCell);
    enterAura(e, hooks);
    drive(e, hooks, 1);
    expect(starts.length).toBe(1);
    drive(e, hooks, 5);                          // 在播（done=false）：只跟随,不重触发
    expect(starts.length, '在播 5 拍零新起振（GetActiveSound 非 null）').toBe(1);
    doneCell.done = true;                        // 播毕（onended → 槽释放）
    drive(e, hooks, 1);
    expect(starts.length, '播毕次拍即重触发（槽释放 → 判空重播）').toBe(2);
    doneCell.done = false;                       // 新实例在播
    drive(e, hooks, 3);
    expect(starts.length).toBe(2);
    doneCell.done = true;
    drive(e, hooks, 1);
    expect(starts.length, '重触发链连续（音长 2.3/3.0s 节拍,整段灵气期）').toBe(3);
  });

  it('A3 Position 跟随：在播每拍仅 setPos(当前 Center),不二次 PlayTrackedSound', () => {
    const { e, hooks, starts } = makeAuraRig({ done: false });
    enterAura(e, hooks);
    drive(e, hooks, 1);
    const rec = starts[0];
    expect(rec.setPosCalls.length).toBe(0);      // 起振拍自身无 setPos（原版 Play 时即定位）
    drive(e, hooks, 4);                          // 4 拍跟随
    expect(starts.length).toBe(1);
    expect(rec.setPosCalls.length, '在播每拍 setPos 一跳（activeSound.Position=Center :64093）').toBe(4);
    const [px, py] = rec.setPosCalls[3];
    expect(Math.abs(px - e.cx)).toBeLessThanOrEqual(TILE);   // 站定碰撞 ε 蠕动带内
    expect(Math.abs(py - e.cy)).toBeLessThanOrEqual(TILE);
  });

  it('A4 槽复位（:64064-64069）：ai0=0 弃槽不截声,再入灵气态首拍即重触发', () => {
    const { e, hooks, starts } = makeAuraRig({ done: false });
    enterAura(e, hooks);
    drive(e, hooks, 1);
    expect(starts.length).toBe(1);
    e.ai0 = 0;                                   // localAI[1]=SlotId.Invalid 等价面
    drive(e, hooks, 1);
    expect(starts[0].stopCalls, '弃槽不截声（原版 SlotId.Invalid 不 Stop,余音自然播完）').toBe(0);
    e.ai0 = 1;                                   // 再入灵气态
    drive(e, hooks, 1);
    expect(starts.length, '复位后首拍重触发（旧句柄在播也新起——槽已 Invalid）').toBe(2);
    expect(starts[0].stopCalls, '旧实例全程不被截断').toBe(0);
  });

  it('A5 缓冲未就绪 null：逐拍重试至命中;缺省 mock 无可选钩=静默零崩', () => {
    const { e, hooks, starts, grantStarts } = makeAuraRig({ done: false });
    grantStarts(false);                          // 前 2 拍缓冲未就绪（ensureBuffer null）
    enterAura(e, hooks);
    drive(e, hooks, 2);
    expect(starts.length, '未就绪每拍重试（GetActiveSound 空 → 重播同语义）').toBe(2);
    grantStarts(true);
    drive(e, hooks, 1);
    expect(starts.length).toBe(3);               // 第 3 次命中
    drive(e, hooks, 2);
    expect(starts.length, '命中后驻留（仅 setPos）').toBe(3);
    // 缺省 mock（无 startTrackedOneShot 可选钩）：静默跳过零崩（测试/SimHost 兼容）
    const rig2 = makeAuraRig({ done: false });
    const bare = { ...rig2.hooks } as Record<string, unknown>;
    delete bare.startTrackedOneShot;
    enterAura(rig2.e, bare as unknown as GameHooks);
    expect(() => drive(rig2.e, bare as unknown as GameHooks, 3)).not.toThrow();
    expect(rig2.starts.length).toBe(0);
  });

  it('A6 亡实体弃槽不截声（destroy 注入,尾音 ≤3s 自然播完）', () => {
    const doneCell = { done: false };
    const rigA = makeAuraRig(doneCell);
    const rigB = makeAuraRig(doneCell);
    enterAura(rigA.e, rigA.hooks); drive(rigA.e, rigA.hooks, 1);
    enterAura(rigB.e, rigB.hooks); drive(rigB.e, rigB.hooks, 1);
    expect(rigA.starts.length + rigB.starts.length).toBe(2);
    rigA.e.dead = true;
    drive(rigB.e, rigB.hooks, 1);                // 存活实例代扫（sweep）掉亡槽
    expect(rigA.starts[0].stopCalls, '亡实体弃槽不截声（一次性轨与循环轨 stop 全拆语义相反）').toBe(0);
    rigA.e.dead = false; rigA.e.ai0 = 1;         // 槽已被 sweep → 复活首拍新起振
    drive(rigA.e, rigA.hooks, 1);
    expect(rigA.starts.length).toBe(2);
    // destroy 兜底（Entity.compact 回调）同样只弃槽
    (rigB.e as { destroy?: () => void }).destroy?.();
    rigB.e.dead = false; rigB.e.ai0 = 1;
    drive(rigB.e, rigB.hooks, 1);
    expect(rigB.starts.length, 'destroy 弃槽后复活首拍新起振').toBe(2);
    expect(rigB.starts[0].stopCalls).toBe(0);
  });
});

describe('BJ728-A 债1：数据/资产/结构锁', () => {
  it('B1 变体窗数据锁：soundTrackFiles=恰 2 变体;资产在位（opus+mp3 ×2,Safari 回退面）', () => {
    expect(soundTrackFiles('dd2_wither_beast_aura_pulse'))
      .toEqual(['dd2_wither_beast_aura_pulse_0', 'dd2_wither_beast_aura_pulse_1']);
    for (const f of ['dd2_wither_beast_aura_pulse_0', 'dd2_wither_beast_aura_pulse_1']) {
      for (const ext of ['opus', 'mp3']) {
        expect(existsSync(join(GAME_ROOT, 'public/sounds', `${f}.${ext}`)),
          `资产缺失: ${f}.${ext}（资产缺口须登记勿近似顶替——本刀资产在位）`).toBe(true);
      }
    }
  });

  it('B2 结构锁三件套 + 反模式⑧ 禁令', () => {
    expect(SRC('core/Sfx.ts'), 'Sfx 实现：onended done 门 + 每播随机变体 + setPos')
      .toContain('startTrackedOneShot(files: string[], vol: number, x: number, y: number)');
    expect(SRC('entities/types.ts'), 'GameHooks 可选钩')
      .toContain('startTrackedOneShot?(');
    expect(SRC('core/Game.ts'), 'Game.ts 极小代理（≤3 行）')
      .toContain('return this.sfx.startTrackedOneShot(files, vol, x, y);');
    const dd2 = SRC('entities/bossAI_dd2.ts');
    expect(dd2, '消费面：音量 1 + 变体组整组 + Center 定位')
      .toContain("game.startTrackedOneShot?.(soundTrackFiles('dd2_wither_beast_aura_pulse'), 1, e.cx, e.cy)");
    expect(dd2.includes("startTrackedLoop?.('dd2_wither_beast_aura_pulse'"), '禁 startTrackedLoop 近似（反模式⑧）').toBe(false);
    expect(dd2.includes("playSfxFiles(soundTrackFiles('dd2_wither_beast_aura_pulse'), 0.5"), '旧单闩 0.5 音量形制退役').toBe(false);
  });
});

describe('BJ728-A 债1：变异恰红', () => {
  itMut('M1 音量回退 0.5（无锚旧值） → A1 恰红', () => {
    withMutation(DD2_SRC,
      "game.startTrackedOneShot?.(soundTrackFiles('dd2_wither_beast_aura_pulse'), 1, e.cx, e.cy);",
      "game.startTrackedOneShot?.(soundTrackFiles('dd2_wither_beast_aura_pulse'), 0.5, e.cx, e.cy);",
      () => {
        const r = spawnVitest('tests/bj728a-wither-aura-oneshot.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('A1');
      }, { label: 'BJ728A-M1' });
  });
  itMut('M2 done 门摘除（播毕不弃槽=旧单闩病灶复发） → A2 恰红', () => {
    withMutation(DD2_SRC,
      '    if (k.dead || h.done) witherAuraSfx.delete(k);',
      '    if (k.dead) witherAuraSfx.delete(k);',
      () => {
        const r = spawnVitest('tests/bj728a-wither-aura-oneshot.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('A2');
      }, { label: 'BJ728A-M2' });
  });
  itMut('M3 Position 跟随摘除 → A3 恰红', () => {
    withMutation(DD2_SRC,
      '  h.setPos(e.cx, e.cy);   // activeSound.Position = Center（:64093,每拍跟随）',
      '  /* BJ728A-M3 变异:setPos 摘除 */',
      () => {
        const r = spawnVitest('tests/bj728a-wither-aura-oneshot.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('A3');
      }, { label: 'BJ728A-M3' });
  });
});
