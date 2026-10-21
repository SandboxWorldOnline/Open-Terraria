// ★BJ700-D（2026-10-20）万花筒(4914→proj 915)鞭尘判别锁
// 用户实报:挥鞭后「留下粒子,慢慢变大,过一段时间后才消失」。
// 定谳(反编译 1457):Projectile.cs:48741-48744 白影 = Dust.CloneDust(dust9) 全字段
// 拷贝(含 noGravity=true,Dust.cs:276;源尘 :48735 已置)后仅三覆写(scale÷2/:48742,
// fadeIn×0.85/:48743,color 白/:48744)。本仓曾手工 spawnDust 重掷克隆且漏 noGravity
// → Dust.cs:2407-2413 链 B 兜底(fadeIn==0 → scale−0.04)不生效,267 尘净
// +0.02(链A :1672)−0.01(老化 :2199)=+0.01/t 无界生长,至 scale>10 死门
// (Dust.cs:444-447)≈16s——与实报形态学逐位吻合。
// 原版期望曲线(参数推演):主尘 scale∈[0.9,1.8]>fadeIn∈[0,0.9) → 首拍清 fadeIn,
// 净 −0.03/t ≤58t 死,峰值 ≤1.85;克隆 scale∈[0.45,0.9],fadeIn∈[0,0.765),
// 生长期 ≤7t 后净 −0.03/t ≤~32t 死,峰值 ≤0.9。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TileStore } from '../src/world/TileStore';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { WhipProj } from '../src/entities/WhipProj';
import { VanillaDust } from '../src/fx/VanillaDust';
import type { VDust } from '../src/fx/VanillaDust';
import type { GameHooks } from '../src/entities/types';

const W = 220, H = 130;

/** 真实尘池接线(Game.ts:48774 spawnDust / :48795 cloneDust 同款直通)——
 *  判别锁的关键:尘走真生命周期链(链A 267 专属 + fadeIn 老化 + 链B 兜底),
 *  桩尘(恒 noGravity=false 记录)测不出「漏 noGravity → 无界生长」。 */
function makeRig() {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 104; y < H; y++) store.setTile(x, y, 1);
  const player = new Player(50 * 16, 90 * 16, new Inventory());
  const vd = new VanillaDust();
  const enemies: Array<Record<string, unknown>> = [];
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
    spawnDust: (x: number, y: number, w: number, h: number, type: number, sx: number, sy: number, alpha: number, color: unknown, scale: number) =>
      vd.spawn(x, y, w, h, type, sx, sy, alpha, color as VDust['color'], scale),
    cloneDust: (d: VDust) => vd.clone(d),
    entities: { projectiles: [], add: () => {} },
  } as never;
  return { hooks, player, vd };
}

interface Track { tick: number; clone: boolean; noGrav: boolean; maxScale: number; deadAt: number | null }

/** 挥鞭全程 + 静置,逐拍步进尘池,逐尘(WeakMap 身份)跟踪 267 尘生命周期。 */
function swingAndTrack(): { tracks: Track[]; whipDeadTick: number } {
  const { hooks, player, vd } = makeRig();
  const whip = new WhipProj(player.cx, player.cy, 0, 915, 4914, 20, 2, 30, 10,
    () => player, () => 0);
  const seen = new WeakMap<VDust, number>();
  const born = new Map<number, Track>();
  let uid = 0;
  let whipDeadTick = -1;
  for (let t = 0; t < 320; t++) {
    if (!whip.dead) whip.fixedUpdate(1 / 60, hooks);
    else if (whipDeadTick < 0) whipDeadTick = t;
    vd.update(-4000, -4000, 12000, 12000);   // 大视口=无屏裁干扰
    const alive = new Set<number>();
    for (const d of (vd as unknown as { pool: VDust[] }).pool) {
      if (!d.active || d.type !== 267) continue;
      let u = seen.get(d);
      if (u === undefined) {
        u = ++uid;
        seen.set(d, u);
        // 白影克隆判据:CloneDust 后 color 覆写纯白(:48744);主尘=hsl 彩色(l=0.5 恒非全白)
        const clone = !!(d.color && d.color.r === 255 && d.color.g === 255 && d.color.b === 255);
        born.set(u, { tick: t, clone, noGrav: d.noGravity, maxScale: d.scale, deadAt: null });
      }
      const rec = born.get(u)!;
      alive.add(u);
      if (d.scale > rec.maxScale) rec.maxScale = d.scale;
      rec.noGrav = d.noGravity;   // 267 链不翻 noGravity,持续复核
    }
    for (const [u, rec] of born) {
      if (rec.deadAt === null && !alive.has(u)) rec.deadAt = t;
    }
  }
  return { tracks: [...born.values()], whipDeadTick };
}

describe('BJ700-D 万花筒(915)鞭尘生命周期(原版 Dust.cs 定谳)', () => {
  it('主尘/白影克隆 noGravity 全 true;全体 ≤65 拍死;峰值 scale ≤1.9(无界生长绝迹)', () => {
    const { tracks, whipDeadTick } = swingAndTrack();
    // 基线:挥鞭真发生且双尘型都在(防「零尘真空绿」——夹具须真消费)
    expect(whipDeadTick).toBeGreaterThan(10);
    const mains = tracks.filter((t) => !t.clone);
    const clones = tracks.filter((t) => t.clone);
    expect(mains.length).toBeGreaterThanOrEqual(5);
    expect(clones.length).toBeGreaterThanOrEqual(5);

    // ★判别面 1:noGravity(CloneDust :276 拷贝)——病灶变量,曾 0/42
    for (const t of tracks) expect(t.noGrav, `${t.clone ? '克隆' : '主尘'} noGravity`).toBe(true);

    // ★判别面 2:寿命有界(原版净 −0.03/t;病灶态 +0.01/t 至 scale>10 ≈16s)
    for (const t of tracks) {
      expect(t.deadAt, `尘应已死(生 ${t.tick})`).not.toBeNull();
      expect(t.deadAt! - t.tick, `寿命 ${t.deadAt! - t.tick} 应 ≤65`).toBeLessThanOrEqual(65);
    }
    // 原版参数推演细分:主尘 ≤58t、克隆 ≤35t(0.03/t 收缩域)
    expect(Math.max(...mains.map((t) => t.deadAt! - t.tick))).toBeLessThanOrEqual(58);
    expect(Math.max(...clones.map((t) => t.deadAt! - t.tick))).toBeLessThanOrEqual(35);

    // ★判别面 3:scale 峰值有界(主尘 ≤1.85=0.9+0.9+首拍 0.05;克隆 ≤0.95=0.45..0.9
    //   出生 + 首拍链A 0.02+fadeIn 生长 0.03——fadeIn>scale 的生长期原版就有)
    expect(Math.max(...mains.map((t) => t.maxScale))).toBeLessThanOrEqual(1.9);
    expect(Math.max(...clones.map((t) => t.maxScale))).toBeLessThanOrEqual(0.95);
  });

  it('挥鞭全程 + 静置 320 拍后尘池 267 归零(实报「留下粒子」绝迹)', () => {
    const rig = makeRig();
    const whip = new WhipProj(rig.player.cx, rig.player.cy, 0, 915, 4914, 20, 2, 30, 10,
      () => rig.player, () => 0);
    let spawned = 0;
    for (let t = 0; t < 320; t++) {
      const before = [...(rig.vd as unknown as { pool: VDust[] }).pool].filter((d) => d.active && d.type === 267).length;
      if (!whip.dead) whip.fixedUpdate(1 / 60, rig.hooks);
      rig.vd.update(-4000, -4000, 12000, 12000);
      spawned = Math.max(spawned, before);
    }
    // 挥鞭期池内确有 267 尘(防零尘真空绿),静置后归零
    expect(spawned).toBeGreaterThanOrEqual(5);
    const alive267 = [...(rig.vd as unknown as { pool: VDust[] }).pool].filter((d) => d.active && d.type === 267).length;
    expect(alive267).toBe(0);
  });

  it('结构锁:915 白影走 cloneDust 全字段拷贝 + 三覆写;手工 spawnDust 重掷克隆禁复辟', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/entities/WhipProj.ts', import.meta.url)), 'utf8');
    const i0 = src.indexOf('915: (c) =>');
    const i1 = src.indexOf('914: (c) =>');
    expect(i0).toBeGreaterThan(0);
    expect(i1).toBeGreaterThan(i0);
    const seg = src.slice(i0, i1);
    expect(seg).toContain('cloneDust?.(d)');                     // Dust.CloneDust(dust9) :48741
    expect(seg).toContain('w.scale /= 2');                       // :48742
    expect(seg).toContain('w.fadeIn *= 0.85');                   // :48743
    expect(seg).toContain('w.color = { r: 255, g: 255, b: 255, a: 255 }');   // :48744
    expect(seg).not.toMatch(/spawnDust\?\.\(\s*d\.x/);           // 旧手工克隆(漏 noGravity)禁回退
  });
});
