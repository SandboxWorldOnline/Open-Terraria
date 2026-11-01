// ★G40-A D-①（2026-11-01,bj745a 登记债①清偿）行为锁:日曜爆闪 608 反击面
// per-target DamageVar 掷（Damage_PVE :12969-12970 `Main.DamageVar(num15,
// Main.player[owner].luck)` 逐靶独立掷;608 owner=Main.myPlayer=受害玩家本人）。
//
// 原版链（Player.cs:38600-38604 → Projectile.Kill :73438-73443 → Damage_PVE）:
//   基伤 (int)(150×meleeDamage) →【逐靶】DV(±15% 离散 31 档+owner luck 重掷,
//   Main.cs:67097-67123) → banner (int)(dmg×sample)（:13388-90,DV 后）→
//   StrikeNPC（crit ×2 在防后——608 SetDefaults :6556-5664 无 melee/ranged/magic
//   类旗 ⇒ 类掷零 RNG、crit 恒 false）。
//
// A22 冲撞爆闪面（Player.ts:10425,BJ746）同掷已在 bj538 11c/bj746a A22 锁定;
// 本文件锁 A21 反击面（Game.damagePlayer 漏斗）:
//   ① DV 档值（rnd 0.03 → tier −15 → base×0.85 ToEvenRound）;
//   ② 逐靶独立掷（双靶双档）;
//   ③ owner luck 重掷取极值（luck=1 时低档被重掷覆盖）;
//   ④ DV→banner 次序（base 150/tier −15/旗 ×1.5:正序 192,倒序 191——恰可判别档）;
//   ⑤ 结构锁:DV 掷在 applyBannerDamageDealt 内参（次序的源码级证据）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { registerGlobalHurtBuckets } from '../src/player/HurtCooldownBuckets';

const here = dirname(fileURLToPath(import.meta.url));
const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!] ?? -1;

async function mkShell() {
  const { Game } = await import('../src/core/Game');
  const g = Object.create(Game.prototype) as Record<string, any>;
  const w = new World(96, 96, 7, 'g40a-d1');
  const p = new Player(60 * 16, 90 * 16, new Inventory());
  p.hp = p.maxHp;
  p.inv.armor[0] = { id: iid(2763), stack: 1 };   // Solar Flare Helmet
  p.inv.armor[1] = { id: iid(2764), stack: 1 };   // Solar Flare Breastplate
  p.inv.armor[2] = { id: iid(2765), stack: 1 };   // Solar Flare Leggings
  p.solarShields = 3;
  g.player = p; g.world = w;
  g.golfState = { tryGetCameraTrackingPosition: () => null };
  g._bannerNpcs = new Set<number>();
  g.sfx = { play: vi.fn(), playWavFile: vi.fn(), playFiles: vi.fn(() => true) };
  g.remotePlayerProxies = [];
  g.spawnParticles = vi.fn();
  g.entities = { add: vi.fn() };
  g.addDamageNumber = vi.fn();
  g.recorder = undefined;
  registerGlobalHurtBuckets(null);
  const mkEnemy = (dx: number) => {
    const hurt = vi.fn((_d: number, ..._rest: unknown[]): number => 0);
    return {
      cx: p.cx + dx, cy: p.cy, x: p.cx + dx - 12, y: p.cy - 21, w: 24, h: 42,
      vanillaId: 3, dead: false, dontTakeDamage: false, iframes: 0,
      def: { damage: 40, name: 'Zombie' }, hurt,
    };
  };
  return { g, p, mkEnemy };
}

afterEach(() => {
  vi.restoreAllMocks();
  registerGlobalHurtBuckets(null);
});

describe('G40-A D-① 日曜爆闪 608 per-target DamageVar', () => {
  it('① DV 档值:rnd 0.03 → tier −15 → 193×0.85=164.05 ToEvenRound 164（旧定值 193 必红）', async () => {
    const { g, p, mkEnemy } = await mkShell();
    const near = mkEnemy(40);
    g.enemies = (): unknown[] => [near];
    vi.spyOn(Math, 'random').mockReturnValue(0.03);
    (g.damagePlayer as (...a: unknown[]) => number)
      .call(g, 30, p.cx, p.cy - 10, undefined, true);
    expect(near.hurt.mock.calls.length).toBe(1);
    expect(near.hurt.mock.calls[0][0]).toBe(164);        // 193×0.85=164.05→164
    expect(near.hurt.mock.calls[0][5]).toBe(false);      // 608 无类旗=零类掷 crit 恒 false
    expect(near.hurt.mock.calls[0][9]).toBe(608);        // srcProjId=608
  });

  it('② 逐靶独立掷:双靶 [0.03, 0.5] → 164 / 193（共享单掷=双 164 必红）', async () => {
    const { g, p, mkEnemy } = await mkShell();
    const e1 = mkEnemy(40), e2 = mkEnemy(-40);
    g.enemies = (): unknown[] => [e1, e2];
    vi.spyOn(Math, 'random')
      .mockImplementationOnce(() => 0.03)   // e1 tier −15
      .mockImplementationOnce(() => 0.5)    // e2 tier 0（×1.0）
      .mockReturnValue(0.5);
    (g.damagePlayer as (...a: unknown[]) => number)
      .call(g, 30, p.cx, p.cy - 10, undefined, true);
    expect(e1.hurt.mock.calls[0][0]).toBe(164);
    expect(e2.hurt.mock.calls[0][0]).toBe(193);          // 150×1.29=193.5 截 193,tier 0
  });

  it('③ owner luck 重掷取极大:luck=1 [0.03(档),0.03(门),0.5(重掷档)] → 150（无 luck=128）', async () => {
    const { g, p, mkEnemy } = await mkShell();
    const near = mkEnemy(40);
    g.enemies = (): unknown[] => [near];
    // 裸乘区:damageMult('melee') 钉 1 → 基伤恰 150（127.5→128 档 / 重掷 150 档,判别开）
    vi.spyOn(p, 'damageMult').mockReturnValue(1);
    Object.defineProperty(p, 'luck', { value: 1, configurable: true });
    vi.spyOn(Math, 'random')
      .mockImplementationOnce(() => 0.03)   // tier −15 → 127.5
      .mockImplementationOnce(() => 0.03)   // luck 门 0.03<1 过
      .mockImplementationOnce(() => 0.5)    // 重掷 tier 0 → 150 > 127.5 取大
      .mockReturnValue(0.5);
    (g.damagePlayer as (...a: unknown[]) => number)
      .call(g, 30, p.cx, p.cy - 10, undefined, true);
    expect(near.hurt.mock.calls[0][0]).toBe(150);
    // 对照:luck=0 单掷同首档 → 128（toEvenRound(127.5)=128,half-up=128 同值,
    // 但 150 vs 128 判别的是【luck 是否流入掷参】）
    const near2 = mkEnemy(40);
    g.enemies = (): unknown[] => [near2];
    const p2 = p;
    p2.iframes = 0;                    // 首击无敌帧清零（二连击门)
    p2.solarShields = 3;
    p2.hp = p2.maxHp;
    Object.defineProperty(p2, 'luck', { value: 0, configurable: true });
    vi.spyOn(Math, 'random').mockReturnValue(0.03);
    (g.damagePlayer as (...a: unknown[]) => number)
      .call(g, 30, p2.cx, p2.cy - 10, undefined, true);
    expect(near2.hurt.mock.calls.length).toBe(1);
    expect(near2.hurt.mock.calls[0][0]).toBe(128);
  });

  it('④ DV→banner 次序:base 150/tier −15/僵尸旗 ×1.5 → trunc(128×1.5)=192（倒序 191 必红）', async () => {
    const { g, p, mkEnemy } = await mkShell();
    const near = mkEnemy(40);
    g.enemies = (): unknown[] => [near];
    g._bannerNpcs = new Set<number>([3]);    // 僵尸旗激活（bannerNpcActive(3)）
    vi.spyOn(p, 'damageMult').mockReturnValue(1);
    vi.spyOn(Math, 'random').mockReturnValue(0.03);
    (g.damagePlayer as (...a: unknown[]) => number)
      .call(g, 30, p.cx, p.cy - 10, undefined, true);
    // 正序（原版 :12970 DV → :13388-90 banner）:toEven(150×0.85)=128 → trunc(128×1.5)=192
    // 倒序（病灶）:trunc(150×1.5)=225 → toEven(225×0.85)=toEven(191.25)=191
    expect(near.hurt.mock.calls[0][0]).toBe(192);
  });

  it('⑤ 结构锁:DV 掷在 applyBannerDamageDealt 内参 + luck 入掷参（次序源码级证据）', () => {
    const src = readFileSync(join(here, '..', 'src', 'core', 'Game.ts'), 'utf8');
    expect(src).toContain(
      'applyBannerDamageDealt(this, en as never, damageVarRoll(retaliation, p.luck ?? 0))');
    // 608 双面族完整性:A22 冲撞面（Player.ts）同掷在位（BJ746 落地,交叉锚）
    const psrc = readFileSync(join(here, '..', 'src', 'entities', 'Player.ts'), 'utf8');
    expect(psrc).toContain(
      'applyBannerDamageDealt(game, entF, damageVarRoll(dmg3, this.luck ?? 0))');
  });
});
