// ★BJ705（2026-10-21 用户实报「远古号角坐骑二段跳后平地最高速度 41→63mph」）回归锁。
//  ★BJ705-B 勘正（2026-10-22 低概率路径穷举）:本锁首版判语「现盘无此 bug」系
//  【无瓶装备】单驱面——穷举后发现第二活码面:骑 14 持瓶(Mount.cs:1648-97 无
//  blockExtraJumps=瓶跳放行)空中第 2 跳耗瓶置 performingJump='Blizzard'/'Fart'/
//  'Sail',而仓内瓶族 boost 线与 G19 撤掉的坐骑线同在坐骑 stats 覆写【后】(vanilla
//  :26778-26812 全族在 :26852-54 覆写前=骑乘期被冲掉) → 弧内峰 12.7/14.7/10.35
//  px/t≈63/73/52mph(用户 41→63 数值吻合)。已修(mntWipeBoost 灭门),判别锁=
//  tests/bj705b-basilisk-lowsweep.test.ts(§0A 定谳复现+§1 随机扫描+§2 结构锁,
//  8 变异恰红含 G19 旧形态 M1 回植)。本文件保留无瓶典型流锁:
//  单驱夹具实测骑 14（远古号角 3771→Basilisk）二段跳前后持续极速均 8.2px/t
//  （≈41mph,8+0.2 振荡过冲）。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const playerSrc = readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8');

const fakeHooks = (w: World, p: Player) => ({
  world: w, player: p,
  playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
  spawnParticles: () => {}, spawnDust: () => null, spawnDrop: () => null,
  damagePlayer: () => 0, onEnemyKilled: () => {},
  entities: { add: () => {} }, enemies: () => [],
});

describe('§1 远古号角（Basilisk 14）二段跳前后平地持续极速不变（M1 位）', () => {
  it('首跳+坐骑二段跳（performing=Basilisk 实触发）+落地续跑:两段极速差 <0.1', () => {
    const w = new World(80, 120, 72, 'bj705');
    for (let x = 20; x <= 70; x++) w.store.setTileSilent(x, 80, 1);
    const p = new Player(30 * 16, 77 * 16, new Inventory());
    const h = fakeHooks(w, p) as never;
    expect(p.mount.setMount(14, p)).toBe(true);
    expect(p.mount.jumpOption).toBe('Basilisk');
    const run = (n: number): number => {
      let top = 0;
      for (let t = 0; t < n; t++) {
        p.inputX = 1; p.inputJump = false; p.inputDown = false;
        p.fixedUpdate(1 / 60, h);
        top = Math.max(top, Math.abs(p.vx));
      }
      return top;
    };
    const top1 = run(240);                                  // 首段持续极速（≈8.2=41mph）
    expect(top1).toBeGreaterThan(7.9);
    expect(top1).toBeLessThan(8.6);
    p.inputJump = true; p.fixedUpdate(1 / 60, h); p.inputJump = false;   // 首跳
    for (let t = 0; t < 8; t++) p.fixedUpdate(1 / 60, h);
    p.inputJump = true; p.fixedUpdate(1 / 60, h); p.inputJump = false;   // 坐骑二段跳
    expect((p as unknown as { performingJump: string | null }).performingJump).toBe('Basilisk');   // 实触发证明
    for (let t = 0; t < 200; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, h); }   // 落地
    const top2 = run(240);                                  // 二段跳后持续极速
    expect(Math.abs(top2 - top1)).toBeLessThan(0.1);        // 不变（旧活码=12px/t≈61-63mph）
  });
});

describe('§2 结构锁：覆写后无残余乘区', () => {
  it('坐骑 stats 覆写（:6532-34）之后不存在 mountJumpPerforming 消费线（G19 撤线守卫）', () => {
    expect(playerSrc).not.toMatch(/mountJumpPerforming[^;]*\)\s*\{[^}]*maxRun\s*\*=/);
    expect(playerSrc).not.toMatch(/maxRun\s*\*=\s*1\.5[^)]*mountJumpPerforming/);
    // G19 定谳注在位（防按「简单漏行」再登记回植）
    expect(playerSrc).toContain('骑乘期整块');   // 注释换行拆词,锚取前半
  });
});
