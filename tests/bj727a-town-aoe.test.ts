// BJ727-A C-D4「Kill 爆 AoE 城镇面」族刀判别锁（BJ723-C D4 登记/BJ725-A 判族另刀
// 清偿）：原版 Projectile.Kill 的 Resize(N×N)+penetrate=-1+Damage() 重跑 victim 循环
// （Projectile.cs:12592）对城镇 voodoo 靶（:12618-12631 flag 门=22 killGuide/54
// killClothier/318 例外;hostile 弹走 flag2=friendly&&!dontTakeDamageFromHostiles 恒命中
// 分支）同链结算——本仓 Kill 爆箱族此前只扫 enemies 桶=城镇靶系统性缺面。
// 本批接线 16 面：Game settleKillExplosion(246/312/514)/41/286、Arrow gemAoeBurst/
// arcanumDeathBurst(617)/flame659DeathBurst(659)/blackBolt661Burst(661)/
// barrel1023Burst(1023,休眠)/烟花 167-170 blast/283 三段、MissileProj KILL_BURST
// (79/16/34)、Dart blastDamage(162/281/烟花盒)+烟花接触爆、DeadCellsMushroom 1044、
// Mounts 圣坦 930——单源 hitTownNpcsAoeBox（projTargets.ts,巫毒窄门/免疫帧/mod 链/
// banner/防后 crit ×2 全走 hitTownNpcs 原语,settle 逐靶镜像各面敌怪臂链）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Game } from '../src/core/Game';
import { MagicMissileProj } from '../src/entities/MissileProj';
import { hitTownNpcsAoeBox } from '../src/entities/projTargets';
import { withMutation } from './mutation-guard';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME_ROOT, 'src', p), 'utf8');
const GAME_SRC = join(GAME_ROOT, 'src/core/Game.ts');
const PROJ_TARGETS_SRC = join(GAME_ROOT, 'src/entities/projTargets.ts');
const MISSILE_SRC = join(GAME_ROOT, 'src/entities/MissileProj.ts');
const spawnVitest = (filter: string) => spawnSync('npx', ['vitest', 'run', filter, '--reporter=basic'],
  { cwd: GAME_ROOT, encoding: 'utf8', timeout: 180_000, env: { ...process.env, BJ727_MUT_SKIP: '1' } });
const itMut = process.env.BJ727_MUT_SKIP === '1' ? it.skip : it;   // 变异子进程跳过变异测试（防递归挂锁,BJ725 判例 4）
afterEach(() => vi.restoreAllMocks());

interface MockTown {
  id: number; vanillaId: number; x: number; y: number; w: number; h: number;
  dead: boolean; bound: boolean; calls: unknown[][];
  hurt: (...a: unknown[]) => boolean;
}
const mkTown = (vanillaId: number, cx: number, cy: number): MockTown => {
  const calls: unknown[][] = [];
  return {
    id: 1, vanillaId, x: cx - 12, y: cy - 12, w: 24, h: 24,
    dead: false, bound: false, calls,
    hurt(...a: unknown[]) { calls.push(a); return true; },
  };
};
const mkGame = (towns: MockTown[], eq: Record<string, boolean> = {}): GameHooks => ({
  player: { luck: 0, equipStats: eq } as never,
  npcs: () => towns,
  enemies: () => [],
  world: { difficulty: 0, seedFlags: {} } as never,
} as unknown as GameHooks);

// ================= U1 单源 helper（hitTownNpcsAoeBox） =================
describe('BJ727-A U1：hitTownNpcsAoeBox 盒几何+巫毒窄门+hostile 恒命中', () => {
  const PX = 1000, PY = 1000;
  it('U1-1 guide+killGuide 盒内 → hurt(100, kb, 0, g, 0, 0, false, false, true, 246)（mock0.5 恒等档）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const t = mkTown(22, PX, PY);
    hitTownNpcsAoeBox(PX, PY, 75, mkGame([t], { killGuide: true }), 100, 246);
    expect(t.calls.length).toBe(1);
    expect(t.calls[0]![0]).toBe(100);          // DV tier0 恒等
    expect(t.calls[0]![6]).toBe(false);        // crit 掷 0.5>0.04（arg6=crit;arg5=flatPen）
    expect(t.calls[0]![8]).toBe(true);         // fromPlayer
    expect(t.calls[0]![9]).toBe(246);          // srcProjId
  });
  it('U1-2 无娃娃 → 零受理（巫毒窄门 :12618-12631）', () => {
    const t = mkTown(22, PX, PY);
    hitTownNpcsAoeBox(PX, PY, 75, mkGame([t], {}), 100, 246);
    expect(t.calls.length).toBe(0);
  });
  it('U1-3 盒外（半宽外 4px）→ 零受理（盒几何）', () => {
    const t = mkTown(22, PX + 160, PY);
    hitTownNpcsAoeBox(PX, PY, 75, mkGame([t], { killGuide: true }), 100, 246);
    expect(t.calls.length).toBe(0);
  });
  it('U1-4 hostile 源 → 无娃娃照命中（flag2 分支 :12631 hostile&victim.friendly）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const t = mkTown(22, PX, PY);
    hitTownNpcsAoeBox(PX, PY, 75, mkGame([t], {}), 100, 246, 'hostile');
    expect(t.calls.length).toBe(1);
  });
});

// ================= B1 settleKillExplosion（246/312/514）城镇臂 =================
describe('BJ727-A B1：settleKillExplosion 城镇臂（C-D4 余面本体）', () => {
  const PX = 1600, PY = 1600;
  const run = (t: MockTown, eq: Record<string, boolean>, rndSeq: number[],
    flags?: { hostile?: boolean; arpen?: number }) => {
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => rndSeq[i++] ?? 0.5);
    const fakeThis = {
      entities: { enemies: [], critters: [] },
      npcs: () => [t],
      player: { luck: 0, equipStats: eq },
      world: { difficulty: 0, seedFlags: {} },
    };
    (Game.prototype as unknown as {
      settleKillExplosion: (cx: number, cy: number, half: number, dmg: number,
        projId: number, flags?: { hostile?: boolean; arpen?: number }) => void;
    }).settleKillExplosion.call(fakeThis, PX, PY, 75, 100, 246, flags);
    return t;
  };
  it('B1-1 guide+killGuide → DV 掷 mock0.5 恒等 100;arpen 透传 penPercent', () => {
    const t = run(mkTown(22, PX, PY), { killGuide: true }, [0.5], { arpen: 12 });
    expect(t.calls.length).toBe(1);
    expect(t.calls[0]![0]).toBe(100);
    expect(t.calls[0]![4]).toBe(12);           // penPercent=flags.arpen（敌怪臂 arpen 同源）
    expect(t.calls[0]![9]).toBe(246);
  });
  it('B1-2 DV 判别档 mock0.9999 → 115（+15%;旧无城镇臂=零调用）', () => {
    const t = run(mkTown(22, PX, PY), { killGuide: true }, [0.9999, 0.5]);
    expect(t.calls.length).toBe(1);
    expect(t.calls[0]![0]).toBe(115);
  });
  it('B1-3 裁缝师 54：无娃娃拒/killClothier 受理（窄门双靶位）', () => {
    expect(run(mkTown(54, PX, PY), {}, [0.5]).calls.length).toBe(0);
    expect(run(mkTown(54, PX, PY), { killClothier: true }, [0.5]).calls.length).toBe(1);
  });
  it('B1-4 hostile 弹 → 无娃娃照命中（246 反射/敌发爆对称面）', () => {
    expect(run(mkTown(22, PX, PY), {}, [0.5], { hostile: true }).calls.length).toBe(1);
  });
});

// ================= B2 MissileProj KILL_BURST（79/16/34）城镇臂 =================
describe('BJ727-A B2：MissileProj killNow 爆箱城镇臂（BJ723-C D4 登记本体）', () => {
  it('B2-1 16 魔法飞弹 Kill 爆 → 盒内 guide+killGuide 受理（DV 恒等档;critChance 门未开掷）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const PX = 1600, PY = 1600;
    const t = mkTown(22, PX, PY);
    const game = {
      player: { luck: 0, equipStats: { killGuide: true } },
      npcs: () => [t], enemies: () => [],
      playSfxFiles: () => {}, world: { difficulty: 0, seedFlags: {} },
    } as unknown as GameHooks;
    const m = new MagicMissileProj(PX - 8, PY - 8, 1, 0, {
      projId: 16, damage: 100, knockback: 2, useTime: 30,
      channelCb: () => false, aimCb: () => ({ x: 0, y: 0 }),
      payMana: () => true, fireExtra: () => {},
    });
    (m as unknown as { killNow: (g: GameHooks) => void }).killNow(game);
    expect(t.calls.length).toBe(1);
    expect(t.calls[0]![0]).toBe(100);
    expect(t.calls[0]![9]).toBe(16);
  });
});

// ================= S1 结构锁：16 面接线在位 =================
describe('BJ727-A S1：16 面 Kill 爆城镇臂接线结构锁', () => {
  it('S1-1 各文件 hitTownNpcsAoeBox 调用计数（Game 3/Arrow 7/Missile 1/Dart 1/DCM 1/Mounts 1）', () => {
    const cnt = (p: string, m = 'hitTownNpcsAoeBox(') => SRC(p).split(m).length - 1;
    expect(cnt('core/Game.ts')).toBe(3);        // settleKillExplosion/41/286
    expect(cnt('entities/Arrow.ts')).toBe(7);   // gem/617/659/661/1023/烟花/283
    expect(cnt('entities/MissileProj.ts')).toBe(1);   // KILL_BURST 79/16/34
    expect(cnt('entities/Dart.ts')).toBe(1);    // blastDamage（烟花接触爆另走 hitTownNpcs）
    expect(cnt('entities/DeadCellsMushroom.ts')).toBe(1);
    expect(cnt('entities/Mounts.ts')).toBe(1);  // 圣坦 930 explode
    expect(cnt('entities/projTargets.ts')).toBe(1);   // 单源定义本体
  });
  it('S1-2 敌怪臂链镜像标记在位（DV/crit 掷位随面;残差登记 D2 注）', () => {
    expect(SRC('core/Game.ts')).toContain('hitTownNpcsAoeBox(cx, cy, half, this, dmg, projId,');
    expect(SRC('entities/MissileProj.ts')).toContain('hitTownNpcsAoeBox(this.cx, this.cy, R, game, this.damage, this.projId');
    expect(SRC('entities/Arrow.ts')).toContain('hitTownNpcsAoeBox(this.cx, this.cy, R, game, this.damage, this.projId');
    expect(SRC('entities/Dart.ts')).toContain('hitTownNpcsAoeBox(cx, cy, r, game, this.damage,');
    expect(SRC('entities/Mounts.ts')).toContain('hitTownNpcsAoeBox(this.cx, this.cy, R, game, this.damage, this.projId');
    // 残差注（D2 敌怪臂 DV/crit 面级既有形态勿单侧补齐）与 D3 近似注在位
    expect(SRC('entities/Arrow.ts')).toContain('残差随 BJ727-A 登记债 D2');
    expect(SRC('entities/Arrow.ts')).toContain('近似登记 D3');
  });
});

// ================= 变异恰红 =================
describe('BJ727-A 变异恰红', () => {
  itMut('M1 settleKillExplosion 城镇臂摘除 → B1 红', () => {
    withMutation(GAME_SRC,
      'hitTownNpcsAoeBox(cx, cy, half, this, dmg, projId,',
      'if (false) hitTownNpcsAoeBox(cx, cy, half, this, dmg, projId, /* BJ727A-M1 变异:城镇臂摘除 */',
      () => {
        const r = spawnVitest('tests/bj727a-town-aoe.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('B1-1');
      }, { label: 'BJ727A-M1' });
  });
  itMut('M2 单源 settle 通道摘除 → B1-2 DV 判别档红（100≠115）', () => {
    withMutation(PROJ_TARGETS_SRC,
      'game, dmg, 0, source, projId,\n    undefined, undefined, undefined, undefined, settle,',
      'game, dmg, 0, source, projId,\n    undefined, undefined, undefined, undefined, undefined, /* BJ727A-M2 变异:settle 摘除 */',
      () => {
        const r = spawnVitest('tests/bj727a-town-aoe.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('B1-2');
      }, { label: 'BJ727A-M2' });
  });
  itMut('M3 MissileProj KILL_BURST 城镇臂摘除 → B2 红', () => {
    withMutation(MISSILE_SRC,
      "hitTownNpcsAoeBox(this.cx, this.cy, R, game, this.damage, this.projId, 'playerProj',",
      "if (false) hitTownNpcsAoeBox(this.cx, this.cy, R, game, this.damage, this.projId, 'playerProj', /* BJ727A-M3 变异:KILL_BURST 城镇臂摘除 */",
      () => {
        const r = spawnVitest('tests/bj727a-town-aoe.test.ts');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('B2-1');
      }, { label: 'BJ727A-M3' });
  });
});
