// 蓝队 F2 回归：鞭命中环浸剂乘区/彩带（Projectile.cs:13687-96
//  `ownedBySomeone && (melee || IsAWhip[type])` 门——鞭 SetDefaults 全走
//  DefaultToWhip（:10706-10718）无 melee 类旗，靠 IsAWhip 臂进本门）。
//   · nano（meleeEnchant==6）：dmg=(int)(dmg×GetNanoFlaskDamageBoost()=1.05f)
//     —— DamageVar 后、StrikeNPC 前（Player.cs:44760-64 同位次）；
//   · party（meleeEnchant==7）：出弹 289 彩带于目标 Center、速=目标速度（:13693-95），
//     本仓经 GameHooks.spawnFriendlyProj 口 = WeaponProj 弹幕侧同通道。
//  此前只在 WeaponProj.hitEnemies 接过，真鞭伤害走 WhipProj.tryHit 自有命中环=漏接。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { WhipProj } from '../src/entities/WhipProj';
import { ConfettiBurstProj } from '../src/entities/meleeOnHitProjs';
import { BuffType } from '../src/stats/Buffs';
import type { GameHooks } from '../src/entities/types';

const W = 200, H = 120;
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number;
  vanillaId?: number;
  vx?: number; vy?: number;
  hurt: (d: number) => boolean;
  hits: number[];
}
function mkEnemy(id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy, hp: 10000, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
}
function makeHooks(enemies: MockEnemy[] = []) {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const spawned: unknown[] = [];
  const hooks: GameHooks = {
    world: { store } as never,
    player: player as never,
    enemies: () => enemies,
    critters: () => [],
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
    // ★F2 出射口录制（types.ts:61 可选钩子——真实现 Game.spawnFriendlyProj :32877）
    spawnFriendlyProj: (e) => { spawned.push(e); },
  };
  return { hooks, player, spawned };
}
/** 鞭命中驱动：9 tick 后把敌挪到 ai0=20 快照曲线中段控制点，再 tick 一拍取一次命中 */
function landOneHit(w: WhipProj, hooks: GameHooks, enemy: MockEnemy): void {
  for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
  const p = w.pointsAt(20, true)[10];
  enemy.cx = p.x; enemy.cy = p.y; enemy.x = p.x - 8; enemy.y = p.y - 12;
  w.fixedUpdate(1, hooks);                     // 本 tick 碰撞含 ai0=20 快照（a-batch2 同式）
}
const mkWhip = (player: Player, dmg: number): WhipProj =>
  new WhipProj(player.cx, player.cy, 0, 841 /*皮革鞭*/, 4672, dmg, 4, 30, 4, () => player);

describe('F2：鞭命中环 nano ×1.05 / party 彩带 289', () => {
  it('ImbueNano → 命中伤 = (int)(dmg×1.05)（40→42）；无浸剂对照组 = 全额 40', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ723-C S03 位移修复:鞭 DV(:12970) 中性档——平值断言复稳（BJ716-A 配方）
    const eCtl = mkEnemy(1, 400, 600);
    const ctl = makeHooks([eCtl]);
    landOneHit(mkWhip(ctl.player, 40), ctl.hooks, eCtl);
    expect(eCtl.hits.length).toBe(1);
    expect(eCtl.hits[0]).toBe(40);

    const eNano = mkEnemy(2, 400, 600);
    const n = makeHooks([eNano]);
    n.player.buffs.apply(BuffType.ImbueNano, 30);           // 免疫金属水 → meleeEnchant==6 档
    landOneHit(mkWhip(n.player, 40), n.hooks, eNano);
    expect(eNano.hits[0]).toBe(Math.trunc(40 * 1.05));       // 42
  });

  it('ImbueParty → 每次命中经 spawnFriendlyProj 出 ConfettiBurstProj（Center+目标速度）；无浸剂不出弹', () => {
    const e0 = mkEnemy(3, 400, 600);
    const noBuffs = makeHooks([e0]);
    landOneHit(mkWhip(noBuffs.player, 40), noBuffs.hooks, e0);
    expect(noBuffs.spawned.filter((x) => x instanceof ConfettiBurstProj).length).toBe(0);

    const e1 = mkEnemy(4, 400, 600);
    e1.vx = 3; e1.vy = -2;                                   // 目标速度直通弹体（:13693-95）
    const withBuff = makeHooks([e1]);
    withBuff.player.buffs.apply(BuffType.ImbueParty, 30);    // 泡泡糖浸剂 → meleeEnchant==7 档
    landOneHit(mkWhip(withBuff.player, 40), withBuff.hooks, e1);
    expect(e1.hits.length).toBe(1);
    const confetti =
      withBuff.spawned.filter((x) => x instanceof ConfettiBurstProj) as ConfettiBurstProj[];
    expect(confetti.length).toBe(1);                          // 单发（原版 NewProjectile 一次）
    const c = confetti[0] as unknown as { x: number; y: number; w: number; h: number; vx: number; vy: number };
    expect(c.vx).toBe(3);
    expect(c.vy).toBe(-2);
    // 出射位 = 被命中敌当前 Center（landOneHit 已把敌挪到曲线控制点 → 用实时盒心对照）
    expect(c.x + c.w / 2).toBeCloseTo(e1.x + e1.w / 2, 5);   // targetNPC.Center.X
    expect(c.y + c.h / 2).toBeCloseTo(e1.y + e1.h / 2, 5);   // targetNPC.Center.Y
  });

  it('两浸剂同挂 → 乘区与出弹并行生效（门同支不互斥）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ723-C S03 位移修复:DV 中性档
    const e = mkEnemy(5, 400, 600);
    const h = makeHooks([e]);
    h.player.buffs.apply(BuffType.ImbueNano, 30);
    h.player.buffs.apply(BuffType.ImbueParty, 30);
    landOneHit(mkWhip(h.player, 200), h.hooks, e);
    expect(e.hits[0]).toBe(Math.trunc(200 * 1.05));           // 210
    expect(h.spawned.some((x) => x instanceof ConfettiBurstProj)).toBe(true);
  });
});
