// Spectre ghostHurt 浮魂弹「吸取归谁」审计面（组C 终盘 2026-09-18）。
// 判据锚（Terarria1457）：
//   · ghostHurt（Projectile.cs:12021-12070）产出的弹 356 是【伤害球】——AI_059
//     (:29368-29431) 无任何治疗/吸血支（治疗球 = ghostHeal → 298 aiStyle 52,
//     :12077-12103/:28929-28987,两链零交集）⇒「吸取归谁」= 伤害只落敌侧,
//     玩家侧零回复、零 lifeSteal 消费、零治疗弹。
//   · 356 命中不递归触发 ghostHurt/ghostHeal——on-hit 段 flag10 门含
//     `aiStyle != 59`（:13712）⇒ 浮魂弹命中不再产浮魂弹/治疗弹。
//   · 伤害归因：NewProjectile(...,356, num=damage 基伤,...)（:12068-12069）——
//     弹伤 = 源弹基伤（非防后实扣 dealt）,AI 不改伤 ⇒ hurt 实参 ≡ 构造伤。
// 既有覆盖：spectre-stellar-procs.test.ts（门族/EU 子步/预热/触敌即亡/重选转向）。
// 本文件补三面（吸取归谁/无递归/伤害归因）+ Forbidden 引擎回归位。
import { describe, it, expect, vi } from 'vitest';   // ★BJ748：vi=DV 0.5 中性档（A26 随刀补 mock）
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { SpectreSoulProj, playerHasGhostHurt } from '../src/entities/SpectreSoulProj';
import type { GameHooks } from '../src/entities/types';

const W = 120, H = 100;
function makeStore(): TileStore {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 80; y < H; y++) store.setTile(x, y, 1);
  return store;
}
function mkEnemy(id: number, x: number, y: number): {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  hits: number[]; hurt: (d: number) => boolean;
} {
  const e = { id, x, y, w: 18, h: 40, dead: false, hits: [] as number[] };
  return Object.assign(e, { hurt(d: number): boolean { e.hits.push(d); return true; } });
}
function makeHooks(enemies: unknown[], player?: Player): {
  hooks: GameHooks; added: unknown[]; lifeStealCalls: unknown[];
} {
  const p = player ?? new Player(40 * 16, 60 * 16, new Inventory());
  const added: unknown[] = [];
  const lifeStealCalls: unknown[] = [];
  const hooks = {
    world: { store: makeStore(), flags: { hardMode: false } } as never,
    player: p,
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
    applyLifeSteal: (...a: unknown[]) => { lifeStealCalls.push(a); return 0; },
  };
  const anyHooks = hooks as unknown as Record<string, unknown>;
  anyHooks.entities = { add: (e: unknown) => { added.push(e); } };
  return { hooks: hooks as unknown as GameHooks, added, lifeStealCalls };
}

describe('ghostHurt 浮魂弹「吸取归谁」三面（AI_059 :29368-29431 无治疗支）', () => {
  it('★伤害归谁：浮魂弹命中敌 → 敌侧吃构造基伤;玩家侧零回复/零 lifeSteal/零治疗弹', () => {
    // ★BJ748（A26 尾迹收口）：BJ746 A26 给 356 敌臂补 DamageVar（:12970 每靶一掷）
    //  后本断言面进随机域（实收 33±15% 逐跑漂移）——按 BJ723-B 判例补 0.5 中性档
    //  （tier=floor(0.5×31)−15=0 ⇒ ×1.00 恒等）,锁语义仍=「hurt 实参 ≡ 构造基伤」。
    const rnd748 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const p = new Player(40 * 16, 60 * 16, new Inventory());
    p.lifeSteal = 80;                                 // 预算满仓——若误接吸血链必被消费
    const enemy = mkEnemy(1, 41 * 16, 58 * 16);       // 与浮魂弹盒重叠
    const { hooks, added, lifeStealCalls } = makeHooks([enemy], p);
    const lifeBefore = p.hp;
    const orb = new SpectreSoulProj(enemy.x + 4, enemy.y + 4, 0, 0, 33, enemy);
    (orb as unknown as { ai1: number }).ai1 = 60;     // 预热已满（friendly 转正面）
    for (let t = 0; t < 3 && !orb.dead; t++) orb.fixedUpdate(1 / 60, hooks);
    expect(enemy.hits).toEqual([33]);                 // 伤害落敌侧 = 构造基伤
    expect(lifeStealCalls.length).toBe(0);            // 零吸血链入账
    expect(p.lifeSteal).toBe(80);                     // 预算未被消费
    expect(p.hp).toBe(lifeBefore);                    // 玩家零回复（伤害球≠吸血球）
    const heals = added.filter((a) => (a as { projType?: number }).projType === 298
      || (a as { projId?: number }).projId === 298);
    expect(heals.length).toBe(0);                     // 零治疗弹（aiStyle 52 链零交集）
    rnd748.mockRestore();
  });
  it('★无递归（flag10 aiStyle!=59 :13712）：ghostHurt 套装在场 → 356 命中不再产 356', () => {
    // equipStats 为只读 getter——旗标用裸形玩家注（spectre-stellar-procs 同式）
    const p = {
      dead: false, x: 40 * 16, y: 60 * 16, w: 20, h: 42,
      lifeSteal: 80,
      equipStats: { setBonus: { ghostHurt: true }, critMagic: 4 },
    } as never as Player;
    expect(playerHasGhostHurt(p)).toBe(true);
    const enemy = mkEnemy(1, 41 * 16, 58 * 16);
    const { hooks, added } = makeHooks([enemy], p);
    const orb = new SpectreSoulProj(enemy.x + 4, enemy.y + 4, 0, 0, 30, enemy);
    (orb as unknown as { ai1: number }).ai1 = 60;
    orb.fixedUpdate(1 / 60, hooks);
    expect(enemy.hits.length).toBe(1);                // 命中结算
    expect(orb.dead).toBe(true);                      // 触敌即亡（penetrate=1）
    expect(added.length).toBe(0);                     // ★零新浮魂弹（递归禁面）
  });
  it('伤害归因逐值：AI 子步不改伤——非 33 基伤构造 → hurt 实参逐拍恒基伤', () => {
    // ★BJ748：同上——A26 DV 接入后 0.5 中性档（恒等掷）保「恒基伤」锁面。
    const rnd748 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const p = new Player(40 * 16, 60 * 16, new Inventory());
    const enemy = mkEnemy(1, 41 * 16, 58 * 16);
    const { hooks } = makeHooks([enemy], p);
    const orb = new SpectreSoulProj(enemy.x + 4, enemy.y + 4, 0, 0, 57, enemy);
    (orb as unknown as { ai1: number }).ai1 = 60;
    orb.fixedUpdate(1 / 60, hooks);
    expect(enemy.hits).toEqual([57]);
    rnd748.mockRestore();
  });
});
