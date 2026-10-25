// 弹幕 Kill 附加批回归（审计"弹幕 Kill 附加 ❌3 项"）：
//   ① 水晶子弹 515 → 弹 89 Kill 碎裂（Projectile.cs:72289-72306）：2 片 90 水晶碎块、
//     伤 = ⌊dmg×0.5⌋、速度 = 反向×Next(40,70)% + Next(-20,21)×0.4、出生点 =
//     命中点 + 该速度（原版 position.X + num668 同式）、owner 本机门
//   ② 银弹 981 对狼人 ×3（Damage_PVE_Inner :12594-12597 `type==981 &&
//     targetNPC.type==104 → num12 *= 3`，暴击翻倍前；★审计原文"蚀地怪 Eater of
//     Segments"系误记——1456 NPCID.cs:11273 `Werewolf = 104`，银弹克狼人是
//     1.4.5 主题机制；本仓 VanillaSpawner L4533 满月夜 hard 生成 104）
//   ③ 异星泡泡枪 2797 泡沫链（Player.cs:46943-46968）：Next(4,5)=4 + Next(4)==0
//     （25%）→ 4-5 颗 444、散布 = 2π/3×rand−π/3、泡速 = 弹速×(rand×0.2+0.05)；
//     泡体纯载体不结算接触伤害（Damage_CanDealDamage :11782 豁免表含 444）、
//     timeLeft 钳 60（:29711-29713）逐子步消耗（:15861）/ 撞块即爆 → Kill
//     （:70282-70303）按锁定弹型/弹速（localAI[0]/[1]）回调 Game 生成真子弹
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/core/Game';
import { Arrow } from '../src/entities/Arrow';
import {
  XenoBubbleProj, xenoBubbleCount, xenoBubbleVelocity,
  XENO_BUBBLE_LIFE, XENO_SPREAD, XENO_BUBBLE_PROJ,
} from '../src/entities/XenoBubbleProj';
import { projectileData } from '../src/data/vanillaProjectiles';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

const gameSrc = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// ① 水晶子弹 89 Kill 碎裂（Projectile.cs:72289-72306）
// ---------------------------------------------------------------------------
/** onProjectileDeath 零场桩（Object.create(Game.prototype) 先例：buff-partial） */
const mkDeathGame = () => {
  const spawned: Arrow[] = [];
  const g = Object.create(Game.prototype) as unknown as {
    onProjectileDeath: (...a: unknown[]) => void;
  } & Record<string, unknown>;
  g.playSfxFiles = () => {};
  g.spawnDust = () => null;
  g.sfx = { play: () => {} };   // 89 分支的 Dig 落地音(Game.ts:20975;runtime 恒有)
  g.entities = { add: (e: unknown) => { spawned.push(e as Arrow); } };
  g.player = { dead: false, cx: 0, cy: 0, x: 0, y: 0, w: 20, h: 42 };
  return { g, spawned };
};

describe('① 水晶子弹 89 Kill 碎裂（P.cs:72289-72306：2 片 90 / 伤×0.5 / 反向散布）', () => {
  it('Kill 89 → 恰 2 片 proj 90，伤 = ⌊40×0.5⌋=20（(int) 截断）', () => {
    const { g, spawned } = mkDeathGame();
    g.onProjectileDeath(89, 100, 200, 4, 4, 6, -8, 40, { hostile: false });
    expect(spawned.length).toBe(2);
    for (const s of spawned) {
      expect(s.projId).toBe(90);
      expect(s.damage).toBe(20);
    }
  });

  it('速度 = -v×Next(40,70)% + Next(-20,21)×0.4（域断言）；出生点 = 命中点 + 该速度', () => {
    for (let round = 0; round < 50; round++) {
      const { g, spawned } = mkDeathGame();
      g.onProjectileDeath(89, 100, 200, 4, 4, 6, -8, 40, { hostile: false });
      for (const s of spawned) {
        // vx = -6×(0.40..0.69) + (-8..8) ∈ [-12.14, 5.6]
        expect(s.vx).toBeGreaterThanOrEqual(-6 * 0.69 - 8 - 1e-9);
        expect(s.vx).toBeLessThanOrEqual(-6 * 0.40 + 8 + 1e-9);
        // vy = 8×(0.40..0.69) + (-8..8) ∈ [-4.8, 13.52]
        expect(s.vy).toBeGreaterThanOrEqual(8 * 0.40 - 8 - 1e-9);
        expect(s.vy).toBeLessThanOrEqual(8 * 0.69 + 8 + 1e-9);
        // NewProjectile(position.X + num668, ...)（:72303）——出生点随速度偏移
        expect(s.x).toBe(100 + s.vx);
        expect(s.y).toBe(200 + s.vy);
      }
    }
  });

  it('hostile 门（owner ≠ Main.myPlayer）不裂片；kb = 0（:72303 第 8 参）', () => {
    const { g, spawned } = mkDeathGame();
    g.onProjectileDeath(89, 0, 0, 4, 4, 6, -8, 40, { hostile: true });
    expect(spawned.length).toBe(0);
    const { g: g2, spawned: sp2 } = mkDeathGame();
    g2.onProjectileDeath(89, 0, 0, 4, 4, 6, -8, 40, { hostile: false });
    for (const s of sp2) expect(s.knockback).toBe(0);
  });

  it('90 水晶碎块数据可用（vanilla-projectiles.json：aiStyle 24 / 6×6 / 穿墙 / ranged）', () => {
    const d = projectileData(90);
    expect(d?.aiStyle).toBe(24);
    expect(d?.width).toBe(6);
    expect(d?.height).toBe(6);
    expect(d?.tileCollide).toBe(false);
    expect(d?.friendly).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ② 银弹 981 对狼人（NPCID 104）×3（P.cs:12594-12597）
// ---------------------------------------------------------------------------
/** 命中环假敌（hurt 侦听）；store 用真 TileStore（全空气）走通用位移/撞块段 */
const mkFoe = (vanillaId: number | null, taken: number[]) => ({
  x: 1600, y: 1600, w: 24, h: 48, id: 7, dead: false, vanillaId,
  cx: 1612, cy: 1624,
  hurt: (d: number) => { taken.push(d); return true; },
});

const hitHooks = (enemies: unknown[]): GameHooks => {
  const store = new TileStore(200, 200);
  return {
    world: { store } as never,
    player: { dead: false, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 20, h: 42 } as never,
    enemies: () => enemies,
    critters: () => [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    onProjectileDeath: () => {},
  } as unknown as GameHooks;
};

/** 真实命中：Arrow 压在假敌盒上跑一拍 subStep（critChance=-1 钳死不暴击） */
const hitOnce = (projId: number, vanillaId: number | null, dmg = 30): number[] => {
  const taken: number[] = [];
  const foe = mkFoe(vanillaId, taken);
  const a = new Arrow(1600, 1600, 5, 0, dmg, 1, projId, {});
  a.critChance = -1;   // truthy → Math.random() < -1 恒 false（确定性不暴击）
  (a as unknown as { subStep: (g: GameHooks) => void }).subStep(hitHooks([foe]));
  return taken;
};

describe('② 银弹 981 对狼人（NPCID 104）×3（P.cs:12594-12597 num12 *= 3）', () => {
  it('981 × vanillaId 104 → 30×3=90（暴击翻倍前同槽位）；×103 对照 → 30', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（主环首掷 ×1.0）
    expect(hitOnce(981, 104)).toEqual([90]);
    expect(hitOnce(981, 103)).toEqual([30]);
    expect(hitOnce(981, null)).toEqual([30]);
  });

  it('弹型门：普通火枪弹 14 打狼人仍 30（仅 981 吃倍率）；奇偶伤截断 25→75', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    expect(hitOnce(14, 104)).toEqual([30]);
    expect(hitOnce(981, 104, 25)).toEqual([75]);
  });

  it('源码锚：命中环 981/104 分支存在（Arrow.ts）', () => {
    const src = readFileSync(new URL('../src/entities/Arrow.ts', import.meta.url), 'utf8');
    expect(src).toContain('this.projId === 981 &&');
    expect(src).toContain("vanillaId === 104");
  });
});

// ---------------------------------------------------------------------------
// ③ 异星泡泡枪 2797 泡沫链（Pl.cs:46943-46968 / AI_078 :29684-29714 / Kill :70282-70303）
// ---------------------------------------------------------------------------
describe('③ 异星泡泡枪 2797：4-5 颗 444 泡（Pl.cs:46957-46966）', () => {
  it('泡数 = Next(4,5)=4 + Next(4)==0（25%）→ 恒 4-5；roll 边界', () => {
    for (let i = 0; i < 400; i++) {
      const n = xenoBubbleCount(Math.random());
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(xenoBubbleCount(0)).toBe(5);      // Next(4)==0 → +1
    expect(xenoBubbleCount(0.24)).toBe(5);
    expect(xenoBubbleCount(0.25)).toBe(4);   // 商 1 → 不加
    expect(xenoBubbleCount(0.99)).toBe(4);
  });

  it('逐泡初速：泡速 = 弹速×(rand×0.2+0.05)（0.6..3 @12 速）、偏转 ∈ ±2π/6', () => {
    for (let i = 0; i < 200; i++) {
      const v = xenoBubbleVelocity(12, 0, Math.random(), Math.random());
      const spd = Math.hypot(v.vx, v.vy);
      expect(spd).toBeGreaterThanOrEqual(12 * 0.05 - 1e-9);
      expect(spd).toBeLessThanOrEqual(12 * 0.25 + 1e-9);
      expect(Math.abs(Math.atan2(v.vy, v.vx))).toBeLessThanOrEqual(XENO_SPREAD / 2 + 1e-9);
    }
    // 中位锚：rot01=0.5 → 零偏转；spd01=0.5 → ×0.15
    const mid = xenoBubbleVelocity(12, 0, 0.5, 0.5);
    expect(mid.vx).toBeCloseTo(12 * 0.15, 6);
    expect(mid.vy).toBeCloseTo(0, 6);
  });

  it('444 数据可用（aiStyle 78 / 10×10 / extraUpdates 1 / ranged）', () => {
    const d = projectileData(XENO_BUBBLE_PROJ);
    expect(d?.aiStyle).toBe(78);
    expect(d?.width).toBe(10);
    expect(d?.extraUpdates).toBe(1);
    expect(d?.friendly).toBe(true);
  });
});

describe('③b 444 泡体行为（AI_078 :29684-29714 + Kill :70282-70303）', () => {
  it('寿命：60 子步（extraUpdates 1 → 30 tick）到点爆裂，回调携泡体伤/kb', () => {
    const bursts: Array<{ cx: number; cy: number; dmg: number; kb: number }> = [];
    const b = new XenoBubbleProj(1600, 1600, 1, 0, 0, 45, 3, 14, 12,
      (cx, cy, dmg, kb) => bursts.push({ cx, cy, dmg, kb }));
    for (let t = 0; t < 29; t++) b.fixedUpdate(1 / 60, hitHooks([]));
    expect(b.dead).toBe(false);              // 58/60 子步
    b.fixedUpdate(1 / 60, hitHooks([]));     // 第 60 子步 → Kill
    expect(b.dead).toBe(true);
    expect(bursts.length).toBe(1);
    expect(bursts[0].dmg).toBe(45);          // 伤透传（:70301 damage）
    expect(bursts[0].kb).toBe(3);            // kb 透传
    expect(bursts[0].cx).toBeGreaterThan(1600);   // 漂移后泡心
  });

  it('撞块即爆（tileCollide 缺省 true）；寿命钳值常量 = 60（:29711-29713）', () => {
    expect(XENO_BUBBLE_LIFE).toBe(60);
    const bursts: Array<{ cx: number; cy: number }> = [];
    const solid = {
      world: { store: { inBounds: () => true, isSolid: () => true, get: () => 1 } },
    } as unknown as GameHooks;
    const b = new XenoBubbleProj(1600, 1600, 1, 0, 0, 45, 3, 14, 12,
      (cx, cy) => bursts.push({ cx, cy }));
    b.fixedUpdate(1 / 60, solid);
    expect(b.dead).toBe(true);
    expect(bursts.length).toBe(1);
  });

  it('泡体纯载体：压在敌盒上不结算接触伤害不早爆（Damage_CanDealDamage :11782 豁免 444）', () => {
    const taken: number[] = [];
    const foe = mkFoe(103, taken);
    const b = new XenoBubbleProj(foe.cx, foe.cy, 1, 0, 0, 45, 3, 14, 12,
      () => { throw new Error('泡体提前爆裂'); });
    for (let t = 0; t < 10; t++) b.fixedUpdate(1 / 60, hitHooks([foe]));
    expect(taken.length).toBe(0);
    expect(b.dead).toBe(false);
  });

  it('Game 发射链接入 2797 专支：前探 40px CanHit 门 + 锁定弹型/弹速回调', () => {
    expect(gameSrc).toContain('bowVid2 === 2797');
    expect(gameSrc).toContain('xenoBubbleCount(Math.random())');
    expect(gameSrc).toContain('xenoBubbleVelocity(svx, svy');
    expect(gameSrc).toContain('* 40');   // 前探 40×sItem.scale（枪族 scale=1）
  });
});
