// BJ725-A 批B 结算链五登记债清偿判别锁（bj723b 登记债 D1/D2/D4/D5 + D3 销案锁死）：
//   D1 狱炎箭 41 Kill 爆炸内联支补 crit 掷+DV（R03 邻位——原版 Kill Resize(64,64)
//      重跑 Damage()=Inner 全链;同块 critter 臂 BJ723-B 已有同形,敌怪臂本批补齐）
//   D2 ClusterFragmentProj(779/783/862/863) 接触面补 banner/DV（R02 族邻位,链序
//      DV:12970→banner:13388→snap:13439-46;crit 经 S02 已通）
//   D3 MagicProj 死面豁免——BJ494 判例保持（预倍形+crit 静态掷,生产不可达零行为
//      差;接活线时随 BJ494 口径整体收编）→ 本文件锁死防再登记
//   D4 爆炸面 snap 双支（:13439-46 焰爆石 kind1/拍击石 kind0,host {projId} 类位门
//      经 projectileData）+ settleKillExplosion critter 臂补 crit/DV（原版单遍历同掷）
//   D5 netApplyStrike 远端 crit 位（msg42 尾段 u8 crit,server slot 后重排=双向优雅
//      降级;S02 后 hurt 防后 ×2——房主镜像 crit 缺=权威 hp 不翻倍+染色缺）
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Game } from '../src/core/Game';
import { ClusterFragmentProj } from '../src/entities/ClusterFragmentProj';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ClientNet } from '../src/net/ClientNet';
import { withMutation } from './mutation-guard';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME_ROOT, 'src', p), 'utf8');
const GAME_SRC = join(GAME_ROOT, 'src/core/Game.ts');
const MISSILE_SRC = join(GAME_ROOT, 'src/entities/MissileProj.ts');
const CLIENTNET_SRC = join(GAME_ROOT, 'src/net/ClientNet.ts');
const SERVER_SRC = (p: string) => readFileSync(join(GAME_ROOT, '..', 'server/src', p), 'utf8');
const spawnVitest = (filter: string) => spawnSync('npx', ['vitest', 'run', filter, '--reporter=basic'],
  { cwd: GAME_ROOT, encoding: 'utf8', timeout: 180_000, env: { ...process.env, BJ725_MUT_SKIP: '1' } });
const itMut = process.env.BJ725_MUT_SKIP === '1' ? it.skip : it;   // 变异子进程跳过变异测试（防递归挂锁）
afterEach(() => vi.restoreAllMocks());

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; hp: number; maxHp: number; vanillaId: number;
  dontTakeDamage: boolean; vx: number; vy: number; realLife: number;
  hits: Array<{ d: number; crit: boolean }>;
  hurt: (d: number, ...a: unknown[]) => boolean;
}
const mkEnemy = (id: number, cx: number, cy: number, vanillaId = 15): MockEnemy => {
  const e = {
    id, x: cx - 12, y: cy - 12, w: 24, h: 24, cx, cy,
    dead: false, iframes: 0, hp: 100000, maxHp: 100000, vanillaId,
    dontTakeDamage: false, vx: 0, vy: 0, realLife: -1, hits: [] as MockEnemy['hits'],
    hurt(d: number, _kx: number, _ky: number, _g: unknown, _pen?: unknown, crit?: boolean) {
      e.hp -= d; e.hits.push({ d, crit: crit === true }); return true;
    },
  } as MockEnemy;
  return e;
};

// ================= D1 狱炎箭 41 内联支（crit+DV） =================
describe('BJ725-B D1：41 Kill 爆炸内联支 crit 掷+DV（R03 邻位）', () => {
  it('D1-1 结构锁：敌怪臂掷位在（critX41/dmgV41）,旧 trunc 固定档退役', () => {
    const s = SRC('core/Game.ts');
    expect(s).toContain('const critX41 = rollVanillaHitCrit(projId, this);');
    expect(s).toContain('const dmgV41 = damageVarRoll(dmg, this.player.luck ?? 0);');
    expect(s).not.toContain('applyBannerDamageDealt(this, e, Math.max(1, Math.trunc(dmg)))');
  });
  itMut('D1-M1 变异恰红：dmgV41 回退裸值 → 结构锁红', () => {
    withMutation(GAME_SRC,
      'const dmgV41 = damageVarRoll(dmg, this.player.luck ?? 0);',
      'const dmgV41 = dmg; /* BJ725B-M1 变异:41 臂 DV 摘除 */',
      () => {
        const r = spawnVitest('tests/bj725a-settle-chain.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D1-1');
      }, { label: 'BJ725B-M1' });
  });
});

// ================= D2 ClusterFragmentProj 接触面（banner/DV） =================
describe('BJ725-B D2：裂片接触面 DV+banner（R02 族邻位）', () => {
  const fragWorld = () => {
    const w = new World(200, 120, 7, 'bj725a');
    for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
    return w;
  };
  const runFrag = (rnd: number, projId = 783): MockEnemy => {
    const e = mkEnemy(1, 100 * 16, 100 * 16 - 32);
    vi.spyOn(Math, 'random').mockReturnValue(rnd);
    const hooks = {
      world: fragWorld() as never,
      player: new Player(100 * 16, 90 * 16, new Inventory()) as never,
      enemies: () => [e], npcs: () => [], critters: () => [],
      spawnDrop: () => null, damagePlayer: () => 0, addDamageNumber: () => {},
      cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
      spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
      playSfxFiles: () => {}, showPickupLabel: () => {}, applyLifeSteal: () => 0,
      entities: { add: () => {}, nextId: 1, projectiles: [] } as never,
    } as GameHooks;
    const frag = new ClusterFragmentProj(e.cx, e.cy, 0, 0, 40, projId, 60, () => {});
    frag.fixedUpdate(1, hooks);
    return e;
  };
  it('D2-1 接触伤 DV 掷：mock0.9999 → 46（+15% 档;旧裸 40 恒定）', () => {
    const e = runFrag(0.9999);
    expect(e.hits.length).toBe(1);
    expect(e.hits[0]!.d).toBe(46);
    expect(e.hits[0]!.crit).toBe(false);   // critChance=0 关断钉
  });
  it('D2-2 mock0.5 恒等档 40（DV 接入后回归锚）', () => {
    const e = runFrag(0.5);
    expect(e.hits[0]!.d).toBe(40);
  });
  itMut('D2-M1 变异恰红：DV+banner 包裹回退裸 this.damage → D2-1 红', () => {
    withMutation(join(GAME_ROOT, 'src/entities/ClusterFragmentProj.ts'),
      'applyBannerDamageDealt(game, e, damageVarRoll(this.damage, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0)) + (snap ? snap : 0)',
      'this.damage + (snap ? snap : 0) /* BJ725B-M2 变异:DV/banner 摘除 */',
      () => {
        const r = spawnVitest('tests/bj725a-settle-chain.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D2-1');
      }, { label: 'BJ725B-M2' });
  });
});

// ================= D3 MagicProj 死面豁免（BJ494 判例锁死,防再登记） =================
describe('BJ725-B D3：MagicProj 死面豁免销案锁（BJ494 判例保持）', () => {
  it('D3-1 豁免注+预倍形在位（生产不可达零行为差;接活线时随 BJ494 整体收编）', () => {
    const s = SRC('entities/MagicProj.ts');
    expect(s).toContain('BJ494 定谳本命中环生产不可达');
    expect(s).toContain('crit ? this.damage * 2 : this.damage');   // 预倍形保留
    expect(s).toContain('接活线时随 BJ494 登记口径整体收编');       // 防再登记注
  });
});

// ================= D4 爆炸面 snap + critter 臂 crit/DV =================
describe('BJ725-B D4：爆炸面 snap 双支 + settleKillExplosion critter 臂同掷', () => {
  const PX = 1000, PY = 1000;
  const runExplodeCritter = (rndSeq: number[]): MockEnemy => {
    const c = mkEnemy(20, PX, PY);
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => rndSeq[i++] ?? 0.5);
    const fakeThis = {
      entities: { enemies: [] as MockEnemy[], critters: [c] },
      player: { luck: 0 },
      world: { difficulty: 0, seedFlags: {} },
    };
    (Game.prototype as unknown as {
      settleKillExplosion: (cx: number, cy: number, half: number, dmg: number,
        projId: number, flags?: { hostile?: boolean; arpen?: number }) => void;
    }).settleKillExplosion.call(fakeThis, PX, PY, 75, 100, 246);
    return c;
  };
  it('D4-1 critter 臂 crit 掷+DV：[0.0,0.9999] → {d:115,crit:true}（旧 {d:100,crit:false}）', () => {
    const c = runExplodeCritter([0.0, 0.9999]);
    expect(c.hits.length).toBe(1);
    expect(c.hits[0]).toEqual({ d: 115, crit: true });
  });
  it('D4-2 未掷中拍 [0.999,0.5] → {d:100,crit:false}', () => {
    const c = runExplodeCritter([0.999, 0.5]);
    expect(c.hits[0]).toEqual({ d: 100, crit: false });
  });
  it('D4-3 snap 三站结构锁（41 臂/settle 敌怪臂/explodeAt 敌怪臂,host {projId} 类位门）', () => {
    const s = SRC('core/Game.ts');
    expect(s.split('projectileSnapStrikeBonus(this').length - 1).toBe(3);
    expect(s).toContain('const snapX41 = projectileSnapStrikeBonus(this, { projId, hostile: flags?.hostile === true }');
    expect(s).toContain('const snapX = projectileSnapStrikeBonus(this, { projId, hostile: flags?.hostile === true }');
    expect(s).toContain('const snapE = projectileSnapStrikeBonus(this, { projId }');
  });
  itMut('D4-M1 变异恰红：critter 臂 DV 回退固定档 → D4-1 红', () => {
    withMutation(GAME_SRC,
      'const dmgVCK = damageVarRoll(dmg, this.player.luck ?? 0);',
      'const dmgVCK = Math.max(1, Math.trunc(dmg)); /* BJ725B-M4 变异:critter DV 摘除 */',
      () => {
        const r = spawnVitest('tests/bj725a-settle-chain.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D4-1');
      }, { label: 'BJ725B-M4' });
  });
});

// ================= D5 netApplyStrike 远端 crit 位 =================
describe('BJ725-B D5：msg42 尾段 crit 位（访客→房主权威结算 ×2）', () => {
  it('D5-1 线格式：sendStrike 尾字节 = crit（true→1/false→0/缺省→0）', () => {
    const frames: Uint8Array[] = [];
    const cn = Object.create(ClientNet.prototype) as ClientNet;
    (cn as unknown as { send: (b: Uint8Array) => void }).send = (b) => frames.push(b);
    const ss = (...a: unknown[]) =>
      (cn as unknown as { sendStrike: (...x: unknown[]) => void }).sendStrike(...a);
    ss(7, 100, 2, 3, true);
    ss(8, 100, 2, 3, false);
    ss(9, 100, 2, 3);
    const [t, f, u] = frames;
    expect(t!.length).toBe(f!.length);
    expect(t![t!.length - 1]).toBe(1);      // ★crit 位（旧线格式无此段）
    expect(f![f!.length - 1]).toBe(0);
    expect(u![u!.length - 1]).toBe(0);      // 缺省 undefined → 0
  });
  it('D5-2 netApplyStrike crit 穿参（hurt 第 6 参 true;旧恒缺）', () => {
    const calls: unknown[][] = [];
    const e = {
      netPuppet: false, id: 7, dead: false,
      applyNetInteraction: () => {},
      hurt: (...a: unknown[]) => { calls.push(a); return true; },
    };
    const fakeThis = { entities: { enemies: [e] } };
    (Game.prototype as unknown as { netApplyStrike: (...a: unknown[]) => void })
      .netApplyStrike.call(fakeThis, 7, 100, 1, 0, undefined, true);
    expect(calls.length).toBe(1);
    expect(calls[0]![0]).toBe(100);
    expect(calls[0]![5]).toBe(true);        // ★crit 位（旧 undefined）
  });
  it('D5-3 全链结构锁：decode/room relay/SimHost/vanilla msg28 crit 位', () => {
    expect(SRC('net/ClientNet.ts')).toContain('const crit = r.remaining > 0 ? r.u8() > 0 : false;');
    expect(SRC('net/ClientNet.ts')).toContain('this.hooks.onStrike?.(netId, dmg, kbx, kby, fromSlot, crit);');
    expect(SERVER_SRC('room.ts')).toContain('.u8(c.slot).u8(crit ? 1 : 0).finish()');
    expect(SERVER_SRC('sim/SimHost.ts')).toContain('e.hurt(rawDmg, kbx, kby, this.hooks, 0, crit);');
    expect(SRC('net/vanilla/VanillaClient.ts')).toContain('.u8(dir).u8(crit ? 1 : 0)');
    expect(SRC('net/protocol.ts')).toContain('{u32 netId, i16 dmg, f32 kbx, f32 kby}[u8 crit]');
  });
  itMut('D5-M1 变异恰红：sendStrike 尾字节摘除 → D5-1 红', () => {
    withMutation(CLIENTNET_SRC,
      '.f32(kby).u8(crit ? 1 : 0).finish());',
      '.f32(kby).finish()); /* BJ725B-M5 变异:crit 字节摘除 */',
      () => {
        const r = spawnVitest('tests/bj725a-settle-chain.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D5-1');
      }, { label: 'BJ725B-M5' });
  });
});

// 遗留注（bj723b D4 城镇支半面）：爆炸城镇臂 census = explodeAt/scarabBomb/
// explodePrimeBomb102 三站均已走 explodeFriendlyVictimDamage（DV 在位）;settleKill
// Explosion 城镇臂整缺 = bj723c D4 enemies 桶扫族登记面（121 处同病族,另刀）。
