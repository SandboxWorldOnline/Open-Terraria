// dontStarve×FTW 霰石/冰雹臂清偿（2026-09-03）：
//   生成臂 = WorldGen.SpawnFallingObjects 独立臂 :72272-72295：Main.dontStarveWorld
//   （theConstant）&& getGood && !remix && IsItStorming → Next(3[drunk 2])!=0 →
//   随机点 !SolidCollision(32,32) → NewProjectile(1049, 70, 10f, ai1=-1)。
//   弹体 1049（SetDefaults Projectile.cs:9940-9952）：24×24 aiStyle5 friendly+hostile
//   trap penetrate-1 timeLeft1200 scale0.8 alpha254 extraUpdates1；AI_005 :24137-24199
//   （无重力直线+淡入）；Kill :75282-75301 = Resize(112,112)+Damage() 纯伤害盒。
//   本文件锁实体行为（生成臂条件为 Game 内联段,常量锚注释见 Game.ts 冰雹块）。
import { describe, it, expect, vi } from 'vitest';
import { TrapShot, TRAP_SHOT_STYLE } from '../src/entities/Dart';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

function makeGame(w: World, opts?: { playerBox?: { x: number; y: number } }) {
  const hurtCalls: Array<{ dmg: number; kx: number }> = [];
  const damageCalls: number[] = [];
  const game = {
    world: w,
    player: {
      x: (opts?.playerBox?.x ?? -9999), y: (opts?.playerBox?.y ?? -9999),
      w: 20, h: 42, cx: 0, cy: 0, dead: false, iframes: 0, luck: 0, hp: 100, maxHp: 100, maxMana: 20,
    },
    enemies: () => [{
      x: 0, y: 0, w: 16, h: 16, dead: false, vanillaId: 1,
      hurt: (dmg: number, kx: number) => { hurtCalls.push({ dmg, kx }); return true; },
    }],
    critters: () => [], npcs: () => [], projectiles: () => [],
    playSfx: vi.fn(), playSfxFiles: () => {}, spawnParticles: vi.fn(),
    addDamageNumber: () => {}, spawnDrop: () => null, cutTile: () => {},
    damagePlayer: (_d: number): number => { damageCalls.push(_d); return _d; },
    onEnemyKilled: () => {}, spawnEnemy: () => ({}),
  } as unknown as GameHooks;
  return { game, hurtCalls, damageCalls };
}

/** 全空世界（无地形） */
function emptyWorld(): World {
  return new World(120, 120, 7, 'open');
}

describe('冰雹弹 1049（TrapShot hail）', () => {
  it('SetDefaults 面（Projectile.cs:9940-9952）：24×24 / timeLeft1200 / penetrate-1 / hostile / id1049', () => {
    const w = emptyWorld();
    const { game } = makeGame(w);
    const b = new TrapShot(60 * TILE, 20 * TILE, 3, 8, 70, 'hail');
    expect(b.w).toBe(24);
    expect(b.h).toBe(24);
    expect(b.life).toBe(1200);
    expect(b.pierceLeft).toBe(Infinity);      // penetrate=-1 → 无限存续
    expect(b.hostile).toBe(true);             // friendly+hostile → 伤玩家
    expect(TRAP_SHOT_STYLE.hail.blast).toBe(56);          // Kill Resize(112,112) 半宽
    expect(TRAP_SHOT_STYLE.hail.kb).toBe(10);             // NewProjectile kb=10f
    expect(TRAP_SHOT_STYLE.hail.steps).toBe(2);           // extraUpdates=1 → 每拍 2 步
    expect(TRAP_SHOT_STYLE.hail.rotOff).toBeCloseTo(-Math.PI / 2); // rotation=ToRotation()−π/2
    expect(TRAP_SHOT_STYLE.hail.drawScale).toBe(0.8);     // SetDefaults scale=0.8
    // 空场飞行：无重力直线（aiStyle5 无重力支）
    const x0 = b.x, y0 = b.y;
    b.fixedUpdate(1 / 60, game);
    expect(b.vy).toBeCloseTo(8);                          // 速度不变
    expect(b.x - x0).toBeCloseTo(6);                      // extraUpdates=1 → 2×vx
    expect(b.y - y0).toBeCloseTo(16);                     // 2×vy
  });

  it('撞块 → Kill 落地爆（:75282-75301）：112×112 盒内敌怪吃 70/盒外不吃,Item89 音', () => {
    const w = emptyWorld();
    // 地面在 y=40 行：弹从 (60,20) 格以 (0,8)×2/拍 下落,~10 拍内触块
    for (let x = 0; x < 120; x++) w.store.setTileSilent(x, 40, 1, 0, 0);
    const { game, hurtCalls } = makeGame(w);
    const b = new TrapShot(60 * TILE, 20 * TILE, 0, 8, 70, 'hail');
    // 敌怪 A 放落点旁 48px（盒内）；敌怪 B 用独立 mock 远置（盒外）
    let ticks = 0;
    while (!b.dead && ticks < 200) { b.fixedUpdate(1 / 60, game); ticks++; }
    expect(b.dead).toBe(true);
    expect(ticks).toBeLessThan(60);                       // 触块即爆,非 timeout
    expect(game.playSfx).toHaveBeenCalledWith('hailImpact', 1, expect.any(Number), expect.any(Number));
    // 敌怪 mock 位于 (0,0)（世界左上角）,落点 (60,40) 格 → 盒 112px 中心距 ~2240px → 盒外
    expect(hurtCalls.length).toBe(0);
  });

  it('Kill 伤害盒半宽 56：紧贴落点的敌怪吃 70 伤+kb=sign(vx)×10', () => {
    const w = emptyWorld();
    for (let x = 0; x < 120; x++) w.store.setTileSilent(x, 40, 1, 0, 0);
    const hurtCalls: Array<{ dmg: number; kx: number }> = [];
    const { game } = makeGame(w);
    (game as { enemies: () => unknown[] }).enemies = () => [{
      x: 60 * TILE - 48, y: 40 * TILE - 8, w: 16, h: 16, dead: false, vanillaId: 1,
      hurt: (dmg: number, kx: number) => { hurtCalls.push({ dmg, kx }); return true; },
    }];
    const b = new TrapShot(60 * TILE, 20 * TILE, 0, 8, 70, 'hail');
    let ticks = 0;
    // ★BJ731 改判史（2026-10-27）：Kill 爆箱伤走 :12970 DV 掷（BJ723-B 落地面）
    //   ——0.5 恒等档钉 70（未 mock 必漂 59-80）。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      while (!b.dead && ticks < 200) { b.fixedUpdate(1 / 60, game); ticks++; }
    } finally { rvi731.mockRestore(); }
    expect(b.dead).toBe(true);
    expect(hurtCalls.length).toBeGreaterThan(0);
    expect(hurtCalls[0]!.dmg).toBe(70);
    expect(hurtCalls[0]!.kx).toBe(0);                     // vx=0 → sign×10=0
  });

  it('寿命=600 拍（timeLeft1200 在 extraUpdates 子步环内每拍 -2,Projectile.cs:16780-81/:17307）;命中玩家不碎（penetrate=-1）', () => {
    const w = emptyWorld();
    const { game } = makeGame(w);
    const b = new TrapShot(60 * TILE, 20 * TILE, 1, 8, 70, 'hail');
    // 逐拍计数：第 599 拍末 timeLeft=2 仍存活；第 600 拍 -2 → 0 → Kill 落地爆
    // （timeLeft-- 每 extraUpdates+1=2 次/拍 :16780-16781 + :17307-17313）
    for (let t = 0; t < 599 && !b.dead; t++) b.fixedUpdate(1 / 60, game);
    expect(b.dead).toBe(false);                           // 1200 − 2×599 = 2 > 0
    expect(b.life).toBe(2);
    b.fixedUpdate(1 / 60, game);
    expect(b.dead).toBe(true);                            // 恰 600 拍归零（原版机制等价）
    expect(game.playSfx).toHaveBeenCalledWith('hailImpact', 1, expect.any(Number), expect.any(Number));

    // 命中玩家：弹体存续（穿透面,与巨石同档）
    const w2 = emptyWorld();
    const g2 = makeGame(w2);
    (g2.game.player as { x: number; y: number }).x = 60 * TILE - 10;
    (g2.game.player as { x: number; y: number }).y = 30 * TILE;   // 弹道 (60,20)→(60,40) 格纵穿
    const b2 = new TrapShot(60 * TILE, 20 * TILE, 0, 8, 70, 'hail');
    for (let t = 0; t < 40 && g2.damageCalls.length === 0; t++) b2.fixedUpdate(1 / 60, g2.game);
    expect(g2.damageCalls.length).toBeGreaterThan(0);     // EVP 结算
    expect(b2.dead).toBe(false);                          // 不碎,继续飞行
  });
});
