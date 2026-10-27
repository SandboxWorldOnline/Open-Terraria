// BJ388（2026-09-28）WeaponProj/bossAI 域登记债四件判别面。标杆 Terarria1457/
// Terarria1457 逐支亲读（Projectile.cs/Main.cs/NPC 消费面）：
//   件1 hitEnemies onHit 受理位（BJ385 登记）：原版 Damage_PVE_Inner 全部命中段
//       （特例链 :13056-13134/aiStyle99 链 :13290-13330/StatusNPC :13637/676 反射
//       :13721-13725/免疫写链 :14031-14182/penetrate-- :14189）在免疫门 :12634-12637
//       之后 = 严格受理位,门拒整段静默;hurt() 返假两族——头部三早退（dead/iframes/
//       dontTakeDamage）=门拒,血尽级联返假（:14367/:14375/:14381/:14391/:14396）
//       =原版受理（StrikeNPC 照跑）→ 受理面谓词 = !vanillaGated 非 hurt 返真。
//   件2 dmgScale 单次截断（BJ344 登记）：原版 dmg 在 :12970 DamageVar 已 int,型号段
//       乘完再各自 (int)（383 ×0.6 :13088/悠悠球 ×0.75 :13318/555·546 ×2 :13428）=
//       先截后乘;旧单截式 trunc(base×scale×mul) 段间进位面 ±1 微差。
//   件3 902 命中转回收（BJ344 登记）:14104-14112 immune[owner]=7 + ai[0]!=1 → ai[0]=1
//       （任意态命中即转回收;窗口 7t 先于通用 10t 档）。
//   件4 1058 球体锚（BJ367/344 登记）：中心锚组=M.cs:33161 大表（{25,26,35,63,154,
//       247,757}）,1058 不在表 → :35492 通用通支锚（贴图左上=盒左上,球心=盒心
//       +(+2,+3)px）——与 BJ367 404 同案。
//   件5 BossFled 灰字 toast 摘除（BJ347 登记）：原版 boss 消散零 UI 反馈
//       （EncourageDespawn :78797 段无任何 Broadcast/CombatText）。
// 运行：cd game && npx vitest run tests/bj388-weaponproj-accept-plane.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import {
  hitEnemies, HitCooldown, Boomerang, YoyoProj, FlailProj, FlaironSpike,
} from '../src/entities/WeaponProj';
import { setProjSpriteOverride } from '../src/entities/Arrow';
import { BuffType } from '../src/stats/Buffs';
import type { GameHooks } from '../src/entities/types';

const W = 200, H = 160;
const PX = 50 * 16, PY = 90 * 16;

function makeHooks() {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) {
    for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  }
  const player = new Player(PX, PY, new Inventory());
  const enemies: Array<Record<string, unknown>> = [];
  const hooks: GameHooks = {
    world: { store } as never,
    player: player as never,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: () => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  };
  return { hooks, player, enemies, store };
}

/** 探针敌：hurt 按真实 Enemy 头部门语义返值（iframes>0 → false）,记录每次入参。
 *  hurtFalse=true = 恒返假（血尽级联形态模拟——无 iframes 字段族,如 kbFoe 旧夹具） */
function foe(id: number, x: number, y: number,
  opts: { w?: number; h?: number; iframes?: number; immortal?: boolean; hurtFalse?: boolean } = {}) {
  const rec: Array<{ dmg: number; kx: number }> = [];
  const w = opts.w ?? 24, h = opts.h ?? 40;
  const f = {
    id, x, y, w, h, dead: false, vx: 0, vy: 0,
    iframes: opts.iframes ?? 0,
    immortal: opts.immortal,
    cx: x + w / 2, cy: y + h / 2,
    hurt: (d: number, kx: number) => {
      rec.push({ dmg: d, kx });
      if (opts.hurtFalse) return false;
      return f.iframes > 0 ? false : true;
    },
  };
  return { foe: f, rec };
}

// ============================================================
// 件1：onHit 受理位——门拒静默 / 血尽级联仍受理
// ============================================================
describe('BJ388 件1: onHit 受理位（:12634-12637 门拒静默;级联返假仍受理）', () => {
  it('①门拒（iframes>0）:回旋镖命中段整段静默——速度不反转/ai0 不翻', () => {
    const { hooks, enemies } = makeHooks();
    const b = new Boomerang(PX + 40, PY, 3, 0, 10, 2, 6, 1);
    const f = foe(7, PX + 48, PY - 10, { iframes: 5 });
    enemies.push(f.foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect(f.rec.length).toBeGreaterThanOrEqual(1);   // hurt 被调（返假）
    expect((b as unknown as { ai0: number }).ai0).toBe(0);   // 回收门不跑（旧码=1 红）
    expect((b as unknown as { vx: number }).vx).toBe(3);     // 速度不反转
  });

  it('②受理（无免疫窗）:同一命中翻转照跑（对照面）', () => {
    const { hooks, enemies } = makeHooks();
    const b = new Boomerang(PX + 40, PY, 3, 0, 10, 2, 6, 1);
    const f = foe(7, PX + 48, PY - 10);
    enemies.push(f.foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect(f.rec.length).toBeGreaterThanOrEqual(1);
    expect((b as unknown as { ai0: number }).ai0).toBe(1);
    expect((b as unknown as { vx: number }).vx).toBe(-3);
  });

  it('③血尽级联形态（hurt 恒返假、无 iframes）:仍按受理跑翻转（:14367 等价面）', () => {
    const { hooks, enemies } = makeHooks();
    const b = new Boomerang(PX + 40, PY, 3, 0, 10, 2, 6, 1);
    const f = foe(7, PX + 48, PY - 10, { hurtFalse: true });
    enemies.push(f.foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect(f.rec.length).toBeGreaterThanOrEqual(1);
    expect((b as unknown as { ai0: number }).ai0).toBe(1);   // 级联返假≠门拒
    expect((b as unknown as { vx: number }).vx).toBe(-3);
  });

  it('④405 泡泡（flag3,hurtPierce=1）:免疫残窗敌照受理照亡（:12634 flag3 豁免）', () => {
    const { hooks, enemies } = makeHooks();
    const s = new FlaironSpike(PX + 43, PY - 7, 0, 0, 20, 4.5);
    const f = foe(7, PX + 31, PY - 20, { iframes: 5, w: 24, h: 40 });
    enemies.push(f.foe as never);
    s.fixedUpdate(1 / 60, hooks);
    expect(f.rec.length).toBeGreaterThanOrEqual(1);
    expect((s as unknown as { dead: boolean }).dead).toBe(true);   // hitAny→killExplode 照跑
  });
});

// ============================================================
// 件3：902 命中转回收（:14104-14112）+ 7t 窗 + dirOverride 门拒静默
// ============================================================
describe('BJ388 件3: 902 命中转回收（ai[0]=1 :14104-14112;immune 7t）', () => {
  it('①出程命中 → ai0 即刻翻 1 转回收（旧码停留 0=登记缺口）', () => {
    const { hooks, enemies } = makeHooks();
    const b = new Boomerang(PX + 40, PY, 3, 0, 10, 2, 902, 1);
    const f = foe(7, PX + 48, PY - 10);
    enemies.push(f.foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect((b as unknown as { ai0: number }).ai0).toBe(1);
  });

  it('②门拒（iframes>0）:回收翻转与 direction 翻转都静默（回收态 dirOverride 不求值）', () => {
    const { hooks, enemies } = makeHooks();
    const b = new Boomerang(PX + 40, PY, -3, 0, 10, 2, 902, 1);
    (b as unknown as { ai0: number }).ai0 = 1;   // 回收态（dirOverride 翻转档）
    const f = foe(7, PX + 28, PY - 10, { iframes: 5 });
    enemies.push(f.foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect((b as unknown as { ai0: number }).ai0).toBe(1);   // 不变（本就不重翻,静默面）
    expect((b as unknown as { dir: number }).dir).toBe(1);   // 翻转不求值（旧码=−1 红）
  });

  it('③同敌免疫窗 = 7t 非 10t（:14104-14112 immune[owner]=7 专支）', () => {
    const { hooks, enemies } = makeHooks();
    const b = new Boomerang(PX + 40, PY, 3, 0, 10, 2, 902, 1);
    const f = foe(7, PX + 48, PY - 10);
    enemies.push(f.foe as never);
    b.fixedUpdate(1 / 60, hooks);
    const cd = (b as unknown as { hitCd: HitCooldown }).hitCd;
    expect(cd.ready(7, 2147483647)).toBe(false);   // 在窗内（ready 探针不改窗内状态）
    for (let t = 0; t < 6; t++) cd.tick();          // 6t 后仍在窗（10t 档此步后 v=4 仍在）
    expect(cd.ready(7, 2147483647)).toBe(false);
    cd.tick();                                      // 第 7t 窗尽
    expect(cd.ready(7, 2147483647)).toBe(true);
  });
});

// ============================================================
// 件2：dmgScale 逐段先截后乘（:13088/:13318/:13428）
// ============================================================
describe('BJ388 件2: dmgScale=DV int 上逐段 (int) 截断（旧单截式 ±1 微差）', () => {
  it('①nano ×1.05（mul 档）与 383 ×0.6（段档）叠加：trunc(trunc(13×1.05)×0.6)=7（旧=8）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★W01(BJ723-B)位移修复:hitEnemies DV 中性档（平值断言复稳,BJ716-A 配方）
    const { hooks, player, enemies } = makeHooks();
    (player as unknown as { buffs: { apply: (t: number, s: number) => void } })
      .buffs.apply(BuffType.ImbueNano, 200);
    const self = { x: PX, y: PY, w: 20, h: 20, vx: 1, damage: 13, knockback: 0, projId: 6,
      critChance: 0 };
    const f = foe(7, PX, PY - 10);
    enemies.push(f.foe as never);
    hitEnemies(self, hooks, new HitCooldown(), 10, 1, 0, undefined,
      (_e, d) => Math.trunc(d * 0.6), false, undefined, 0, 1, 1);
    expect(f.rec[0].dmg).toBe(7);
  });

  it('②悠悠球 555 合成段（无视线 ×0.75 → 里程碑 ×2）:trunc(trunc(13×0.75)×2)=18（旧单返式=9）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★W01 位移修复:DV 中性档
    const { hooks, player, enemies, store } = makeHooks();
    store.setTile(51, 90, 1);            // 玩家盒(790-810)与悠悠球盒(838-854)之间的隔墙
    store.setTile(51, 91, 1);
    const y = new YoyoProj(838, PY, 13, 0, 555, 300, () => true, () => ({ x: 846, y: PY }), 0);
    (y as unknown as { critChance: number }).critChance = 0;
    (player as unknown as { yoyoHitCounter: number }).yoyoHitCounter = 7;   // 7%7==0 里程碑
    const f = foe(7, 834, PY - 10, { w: 24, h: 40 });      // 敌盒罩住悠悠球盒
    enemies.push(f.foe as never);
    y.fixedUpdate(1 / 60, hooks);
    expect(f.rec.length).toBeGreaterThanOrEqual(1);
    expect(f.rec[0].dmg).toBe(18);
  });

  it('③526/546 里程碑 flag8 门：immortal 敌不吃 ×2（:12816 flag8=!immortal）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★W01 位移修复:DV 中性档
    const { hooks, player, enemies } = makeHooks();
    const y = new YoyoProj(PX + 26, PY, 13, 0, 546, 300, () => true,
      () => ({ x: PX + 200, y: PY }), 0);
    (y as unknown as { critChance: number }).critChance = 0;
    (player as unknown as { yoyoHitCounter: number }).yoyoHitCounter = 3;   // 3%3==0
    const f = foe(7, PX + 22, PY - 10, { w: 24, h: 40, immortal: true });
    enemies.push(f.foe as never);
    y.fixedUpdate(1 / 60, hooks);
    expect(f.rec.length).toBeGreaterThanOrEqual(1);
    expect(f.rec[0].dmg).toBe(13);   // 无 ×0.75（LOS 通）无 ×2（immortal 豁免）
  });
});

// ============================================================
// 件4：1058 球体锚 = :35492 通用通支（非 :33161 中心锚组）
// ============================================================
describe('BJ388 件4: 1058 通用通支锚（贴图左上=盒左上）;25 保持中心锚', () => {
  type Call = { m: string; a: unknown[] };
  function makeRecCtx() {
    const calls: Call[] = [];
    const store: Record<string, unknown> = {};
    const ctx = new Proxy(store, {
      get: (t, k) => (typeof k === 'string' && k in t ? t[k] : (...a: unknown[]) => { calls.push({ m: String(k), a }); }),
      set: (_t, k, v) => { store[String(k)] = v; calls.push({ m: `set:${String(k)}`, a: [v] }); return true; },
    });
    return { calls, ctx: ctx as unknown as CanvasRenderingContext2D };
  }
  beforeAll(() => {
    setProjSpriteOverride(1058, { width: 30, height: 32 } as never);
    setProjSpriteOverride(25, { width: 34, height: 34 } as never);
  });
  afterAll(() => { vi.unstubAllGlobals(); });

  it('①1058:translate=(盒左+15,盒上+13)、drawImage 偏 (−15,−13)=贴图左上钉盒左上', () => {
    const { calls, ctx } = makeRecCtx();
    const f = new FlailProj(PX, PY, 10, 2, 1058, () => true, () => ({ x: PX + 200, y: PY }));
    f.draw({ ctx, lighting: { lightAt: () => [255, 255, 255] } } as never, {} as never);
    const tr = calls.filter((c) => c.m === 'translate' && c.a[0] === PX + 15 && c.a[1] === PY + 13);
    expect(tr.length).toBeGreaterThanOrEqual(1);   // 通用通支锚（旧中心锚=PX+13/PY+13 红）
    const di = calls.find((c) => c.m === 'drawImage' && c.a.length === 5);
    expect(di).toBeDefined();
    expect(di!.a[1]).toBe(-15);                    // origin.x=num153=15
    expect(di!.a[2]).toBe(-13);                    // origin.y=盒高/2=13（非贴图中心 16）
  });

  it('②25（:33161 组成员）:中心锚保持——translate=盒心、无 num145 偏置', () => {
    const { calls, ctx } = makeRecCtx();
    const f = new FlailProj(PX, PY, 10, 2, 25, () => true, () => ({ x: PX + 200, y: PY }));
    f.draw({ ctx, lighting: { lightAt: () => [255, 255, 255] } } as never, {} as never);
    // 盒 = trunc(22×0.9)=19 → 盒心 = (PX+9.5, PY+9.5);通用锚会是 PX+17
    const tr = calls.filter((c) => c.m === 'translate' && c.a[0] === PX + 9.5 && c.a[1] === PY + 9.5);
    expect(tr.length).toBeGreaterThanOrEqual(1);
    const trGeneric = calls.filter((c) => c.m === 'translate' && c.a[0] === PX + 17);
    expect(trGeneric.length).toBe(0);
  });
});

// ============================================================
// 件5：BossFled 灰字 toast 摘除（bossFled 旗与记账分支保留）
// ============================================================
describe('BJ388 件5: bossFled 零 UI 反馈（原版 EncourageDespawn 无广播）', () => {
  it('①Game.ts 不再有 BossFled toast 发射位;bossFled 记账分支保留', () => {
    const src = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    expect(src).not.toContain("newText(Lang.text('Mods.SandboxWorld.Toast.BossFled'");
    expect(src).toContain('bossFled');   // 旗/分支仍在（不写 downed/不记击败）
  });
});
