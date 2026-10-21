// 地狱翼弓 3019 → 狱翼蝠弹 485 行为锁(Player.cs:47992-48001 施法支 +
// Projectile.cs:58690-58718 AI_001 type 段 / :74493-74501 Kill / :80963-80965
// GetAlpha / Utils.cs:1785-1788 RotatedByRandom)。
// ★命名勘误:3019 = Hellwing Bow 地狱翼弓,不是 Seedler(种子弯刀=3018/483,
//   483 才有分裂);485 全程无分裂(见 /tmp/p2/3019-branch.ts 头注)。
// ★落位:game/tests/ 下任意文件名(建议 hellwing-485.test.ts),桩模式 =
//   tests/arrow-flight-trail-dust.test.ts 的 makeGame。
// ★红绿约定:[现状绿] = 当前 src 即过;[B1 后绿]/[B2 后绿] = 需先落
//   3019-branch.ts §B1(三角分布)/§B2(Kill 尘)——即闸门,不落 diff 必红。
import { describe, it, expect } from 'vitest';
import { Arrow, setProjSpriteOverride } from '../src/entities/Arrow';
import { World } from '../src/world/World';
import { projGravSpec } from '../src/data/vanillaItemCombat';
import type { GameHooks } from '../src/entities/types';

const AI_MAX = 0.39269909262657166;      // 反编译字面量(Player.cs:47993 RotatedByRandom 实参)
const SPAWN_MAX = 0.19634954631328583;   // :47996(★R1 对齐,曾用 π/8·π/16 截断值)
const SPEED = 6;                          // Item.cs:27958 shootSpeed=6f
// 原版撞面快照速度(★用例内禁随机扰动:桩 Math.random=0.5 ⇒ 双掷角恒 0,
// 出膛速度/ai 载荷均=基向量,断言取整定值)
const mockRandom05 = (): (() => void) => {
  const real = Math.random;
  Math.random = () => 0.5;
  return () => { Math.random = real; };
};

interface DustRec { type: number; alpha: number; scale: number; noGravity: boolean;
  vx: number; vy: number; x: number; y: number; }

function makeGame(w: World, dusts: DustRec[]): GameHooks {
  return {
    world: w, player: null as unknown, enemies: () => [], critters: () => [],
    projectiles: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    addLightAt: () => {}, onProjectileDeath: () => {},
    broadcastParticleOrchestra: () => {},
    spawnDust: (x: number, y: number, w2: number, h2: number, type: number) => {
      const d: DustRec = { type, alpha: 0, scale: 1, noGravity: false,
        vx: 0, vy: 0, x, y };
      void w2; void h2;
      dusts.push(d);
      return d;
    },
  } as unknown as GameHooks;
}

function openWorld(): World {
  // 清出 160×200 世界中部横飞走廊(行 90-112),地表/洞带不介入弹道
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) {
    for (let y = 90; y <= 112; y++) w.store.setTileSilent(x, y, 0, 0, 0);
  }
  return w;
}

/** 私有字段括号访问(同 tests/arrow-flight-trail-dust killNow 先例) */
const hwOf = (a: Arrow): { x: number; y: number } => {
  const o = a as unknown as { hwAiX: number; hwAiY: number };
  return { x: o.hwAiX, y: o.hwAiY };                 // ★字段名对齐消费面(.x/.y,原稿 hx/hy 错位=NaN 根因)
};

/** 双掷角(相对基向量 x 轴正方向的带符号角) */
const signed = (y: number, x: number): number => Math.atan2(y, x);

describe('地狱翼弓 3019 → 狱翼蝠 485(施法支散布 + ai 载荷 + 承袭 + Kill 尘)', () => {
  it('①[现状绿] 散布角度范围:出膛初速 ∈ ±π/16、ai 载荷 ∈ ±π/8(400 样本零越界)',
    () => {
      for (let i = 0; i < 400; i++) {
        const a = new Arrow(1000, 1600, SPEED, 0, 10, 1, 485, {});
        const b = signed(a.vy, a.vx);                      // 出膛速度角
        const ai = signed(hwOf(a).y, hwOf(a).x);           // ai[0]/ai[1] 游移角
        expect(Math.abs(b)).toBeLessThanOrEqual(SPAWN_MAX + 1e-9);
        expect(Math.abs(ai)).toBeLessThanOrEqual(AI_MAX + 1e-9);
      }
    });

  it('②[B1 后绿] 双掷分布=三角(RotatedByRandom=两次 U(0,r) 之差,Utils.cs:1785):'
    + 'P(|角|<r/2)≈0.75、P(|角|<r/4)≈0.4375——均匀分布会给 0.5/0.25 必红', () => {
      const n = 1200;
      let aHalf = 0, aQuart = 0, bHalf = 0, bQuart = 0;
      for (let i = 0; i < n; i++) {
        const a = new Arrow(1000, 1600, SPEED, 0, 10, 1, 485, {});
        const ai = signed(hwOf(a).y, hwOf(a).x);
        const b = signed(a.vy, a.vx);
        if (Math.abs(ai) < AI_MAX / 2) aHalf++;
        if (Math.abs(ai) < AI_MAX / 4) aQuart++;
        if (Math.abs(b) < SPAWN_MAX / 2) bHalf++;
        if (Math.abs(b) < SPAWN_MAX / 4) bQuart++;
      }
      // 三角分布 CDF;带宽 ±0.06 ≈ 4σ(n=1200,σ≈0.0125..0.0143)防 flake
      expect(Math.abs(aHalf / n - 0.75)).toBeLessThan(0.06);
      expect(Math.abs(aQuart / n - 0.4375)).toBeLessThan(0.06);
      expect(Math.abs(bHalf / n - 0.75)).toBeLessThan(0.06);
      expect(Math.abs(bQuart / n - 0.4375)).toBeLessThan(0.06);
    });

  it('③[现状绿] ai 载荷与出膛速度幅值恒= shootSpeed(旋转保幅长):'
    + 'ai[0]/ai[1] 是"被劫持的游移向量"非单位向', () => {
      for (let i = 0; i < 50; i++) {
        const a = new Arrow(1000, 1600, SPEED, 0, 10, 1, 485, {});
        expect(Math.abs(Math.hypot(hwOf(a).x, hwOf(a).y) - SPEED)).toBeLessThan(1e-6);
        expect(Math.abs(Math.hypot(a.vx, a.vy) - SPEED)).toBeLessThan(1e-6);
      }
    });

  it('④[现状绿] AI 载荷消费:v=(v×39+ai)/40 逐拍渐转(Projectile.cs:58692-58693),'
    + '150 拍后速度向收敛到 ai 向且幅值不减(无重力无阻力固定点)', () => {
      const game = makeGame(openWorld(), []);
      const a = new Arrow(1000, 1600, SPEED, 0, 10, 1, 485, {});
      const aiAng = signed(hwOf(a).y, hwOf(a).x);
      for (let t = 0; t < 150 && !a.dead; t++) a.fixedUpdate(1 / 60, game);
      expect(a.dead).toBe(false);
      expect(Math.abs(signed(a.vy, a.vx) - aiAng)).toBeLessThan(0.03);
      expect(Math.abs(Math.hypot(a.vx, a.vy) - SPEED)).toBeLessThan(0.2);
    });

  it('⑤[现状绿] 无重力面:projGravSpec(485)={grav:0,delay:-1}(AI1_NO_DROP=flag3 表,'
    + 'Projectile.cs:56986 + :58550 ai[0]>=15 门被 ai 载荷劫持永不达)——'
    + '恒定掷下 300 拍 vy 恒 0', () => {
      expect(projGravSpec(485)).toEqual({ grav: 0, delay: -1 });
      const restore = mockRandom05();
      try {
        const game = makeGame(openWorld(), []);
        const a = new Arrow(1000, 1600, SPEED, 0, 10, 1, 485, {});
        expect(a.vy).toBe(0);
        for (let t = 0; t < 300 && !a.dead; t++) a.fixedUpdate(1 / 60, game);
        expect(Math.abs(a.vy)).toBeLessThan(0.5);   // 若误挂 0.1@15 档,此处 ≈28.5
      } finally {
        restore();
      }
    });

  it('⑥[现状绿] 承袭面:伤害/击退直传、penetrate=-1/timeLeft=1200/24×24 走数据表、'
    + 'critBonus/armorPen/frostEligible 注入面(Game.ts:12794-12798 弓支契约)', () => {
      const a = new Arrow(1000, 1600, SPEED, 0, 30, 5.5, 485, {});
      expect(a.damage).toBe(30);            // 弓伤+弹药伤由 Game 侧合成后直传
      expect(a.knockback).toBe(5.5);
      expect(a.pierce).toBe(-1);            // Projectile.cs:5614 penetrate=-1 无限穿透
      expect(a.life).toBe(1200);            // :5615 timeLeft=1200
      expect(a.w).toBe(24);                 // :5609-5610
      expect(a.h).toBe(24);
      a.critBonus = 18;                     // rangedCrit 总值(%)
      a.armorPen = 7;
      a.frostEligible = true;
      expect(a.critBonus).toBe(18);
      expect(a.armorPen).toBe(7);
      expect(a.frostEligible).toBe(true);
    });

  it('⑦[B2 后绿] Kill 尘:15×尘6、noGravity、v -= oldVelocity×Next(20,60)×0.01'
    + '(Projectile.cs:74493-74501)——撞面快照 (6,0) ⇒ 每粒 vx∈[-3.59,-1.2]、vy=0',
    () => {
      const dusts: DustRec[] = [];
      const game = makeGame(openWorld(), dusts);
      const restore = mockRandom05();
      try {
        const a = new Arrow(1000, 1600, SPEED, 0, 10, 1, 485, {});
        expect(a.vx).toBe(SPEED);           // 双掷角恒 0,出膛即撞面快照
        (a as unknown as { killNow: (g: GameHooks) => void }).killNow(game);
        const d6 = dusts.filter((d) => d.type === 6);
        expect(d6).toHaveLength(15);
        expect(d6.every((d) => d.noGravity)).toBe(true);
        for (const d of d6) {
          expect(d.vx).toBeLessThanOrEqual(-SPEED * 0.2 - 1e-9);
          expect(d.vx).toBeGreaterThan(-SPEED * 0.6 - 1e-9);
          expect(d.vy).toBe(0);
        }
      } finally {
        restore();
      }
    });
});

// ==================== 登记项③（2026-09-03,B3）：485 GetAlpha 78.4% 不透明 ====================
// 权威：Projectile.cs:80962-80965（1457）`if (type == 485 || type == 502)
// return new Color(255, 255, 255, 200)`——A=200/255≈78.4% 恒定档（不读 alpha 字段,
// 无 fade 面）。本仓承载 = vanillaProjAlpha.ts PROJ_ALPHA_MOD[485] fixed(255,255,255,200)
// → Arrow.drawTableAlpha ga=200/255（rgb 全白 → 无滤镜）,drawGlobalAlpha/drawXenoFilter
// 均 null → 桌表生效。原登记"我方 draw 不透明 100%"系 GetAlpha 面接线前陈账——本例钉死。
class FakeCanvasHw {
  width = 0; height = 0;
  getContext() {
    return { drawImage() {}, imageSmoothingEnabled: false };
  }
}
// node 环境无 canvas:485 系 5 帧竖条贴图（vanilla-projframes 485=5）,本体 drawImage
// 走 projFrameImg 帧切片（document.createElement）→ 桩之（minion-orientation 同款）
(globalThis as { document?: unknown }).document = {
  createElement: (): FakeCanvasHw => new FakeCanvasHw(),
};

describe('485 狱翼蝠 GetAlpha (255,255,255,200) → 本体 78.4% 不透明（B3/登记项③）', () => {
  it('draw 本体 drawImage globalAlpha=200/255（PROJ_ALPHA_MOD[485] fixed 档,常规合成非加算）', () => {
    setProjSpriteOverride(485, { width: 24, height: 120 } as unknown as HTMLImageElement); // 5 帧 × 24px
    const dusts: DustRec[] = [];
    const game = makeGame(openWorld(), dusts);
    const a = new Arrow(1000, 1600, SPEED, 0, 10, 1, 485, {});
    a.fixedUpdate(1 / 60, game);                       // 推进 1 拍（hwFrame 帧链/age=1）
    const calls: Array<{ ga: number; gco: string }> = [];
    let ga = 1;
    let gco = 'source-over';
    const ctx = {
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      set globalAlpha(v: number) { ga = v; },
      get globalAlpha() { return ga; },
      set globalCompositeOperation(v: string) { gco = v; },
      get globalCompositeOperation() { return gco; },
      filter: 'none',
      imageSmoothingEnabled: false,
      drawImage: () => { calls.push({ ga, gco }); },
    } as unknown as CanvasRenderingContext2D;
    // ★BJ703-F 夹具勘误（2026-10-21,存量红分诊=夹具病非 src 回归）：BJ-C1 F3
    //  （2026-10-06 常量色族通用全亮通道）后 485（fixed 白 (255,255,255,200) →
    //  constFullbrightGate 过门）本体段经 recording-ctx 捕获、由 r.queueProjFullbright
    //  闭包重放——旧直断 ctx 笔=零调用恒红（本测 2026-09-03 早于 F3 架构）。本夹具
    //  给队列桩:立即以断言 ctx 执行闭包 = 重放路径 1:1（bj529 同款习语）。
    const queued: Array<(c: CanvasRenderingContext2D) => void> = [];
    a.draw({
      ctx, mainPlayer: undefined,
      queueProjFullbright: (fn: (c: CanvasRenderingContext2D) => void) => { queued.push(fn); },
    } as never, undefined as never);
    expect(queued.length).toBe(1);                     // 常量色族 capture→commit 单闭包
    for (const fn of queued) fn(ctx);
    expect(calls.length).toBeGreaterThanOrEqual(1);    // 本体走帧切片 drawImage 路径
    expect(calls.every((c) => Math.abs(c.ga - 200 / 255) < 1e-9)).toBe(true);   // 78.4%
    expect(calls.every((c) => c.gco === 'source-over')).toBe(true);   // 不在加算组
  });
});
