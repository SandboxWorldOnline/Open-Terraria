// 蓝队 R7 复核修复批（2026-08-23）回归测试——弹幕 AI 逐族（红队第七轮对拍）：
//   R7-19 614 星尘细胞弹 = aiStyle 113 TargetSticker（硬追踪/失的即杀/183 buff ai1==i 门/
//         目标盒收缩——曾当直飞 Arrow 生成）
//   R7-01 837 骷髅头转向权重 32→20（1457 :57861-57864 数值增量,曾照抄 1456）
//   R7-02 837 实心格 timeLeft−33 速消段（1457 :57774-57779 新增块,曾整缺）
//   R7-03 837 不播 75 号尘拖尾（:57760 仅 207）
//   R7-05 timeLeft 递减在子步末（Update :17307-17311——AI 恰跑 timeLeft 次,寿命尽当拍杀）
//   R7-10/11 AI_029 homing：提速双轴 +0.1·单位向、近距转向乘子作用于 (turn+0.05) 整项
//   R7-38 鞭 CutTiles（:15292-15300 IsAWhip 支——割草/开罐）
// 参照：Terarria1457 Projectile.cs（行号见各断言注释）
import { describe, it, expect } from 'vitest';
import { Arrow } from '../src/entities/Arrow';
import { WhipProj } from '../src/entities/WhipProj';
import { TileStore } from '../src/world/TileStore';
import { TILE_BY_KEY } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';

interface HurtArgs { 0: number; 1: number }
interface StubEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  hurtLog: HurtArgs[]; stardustT?: number;
  hurt: (...a: unknown[]) => boolean;
}
function mkEnemy(id: number, x: number, y: number, w = 16, h = 16): StubEnemy {
  const e = { id, x, y, w, h, dead: false, hurtLog: [] } as unknown as StubEnemy;
  e.hurt = (...a: unknown[]) => { e.hurtLog.push(a as unknown as HurtArgs); return false; };
  return e;
}

function makeHooks(enemies: StubEnemy[] = [], store?: TileStore) {
  const dusts: unknown[] = [];
  const cuts: Array<[number, number]> = [];
  return {
    hooks: {
      world: { store: store ?? new TileStore(200, 120) } as never,
      player: { equipStats: {}, cx: 800, cy: 1440, x: 790, y: 1419, w: 20, h: 42, dead: false } as never,
      enemies: () => enemies,
      critters: () => [],
      npcs: () => [],
      spawnDrop: () => null,
      damagePlayer: (): number => 0,
      addDamageNumber: () => {},
      cutTile: (x: number, y: number) => { cuts.push([x, y]); },
      onEnemyKilled: () => {},
      spawnEnemy: () => {},
      spawnParticles: () => {},
      spawnDust: (...a: unknown[]) => { dusts.push(a); return null; },
      notifyInventoryChanged: () => {},
      playSfx: () => {},
      playSfxFiles: () => {},
    } as unknown as GameHooks,
    enemies, dusts, cuts,
  };
}

// ---------------------------------------------------------------------------
// R7-19 614 星尘细胞弹 aiStyle 113 TargetSticker（:41289-41330）
// ---------------------------------------------------------------------------
describe('R7-19 614 星尘细胞弹 TargetSticker', () => {
  it('硬追踪 v=(v×4+敌向×14)/5：右飞弹向上偏转追高敌', () => {
    const e = mkEnemy(1, 572, 712);            // 敌盒心(580,720),弹心(500,800) → 45° 上偏
    const g = makeHooks([e]);
    const a = new Arrow(492, 792, 14, 0, 30, 2, 614, { grav: 0, life: 300 });
    a.stickerTgt = 1;
    a.alpha = 255;                             // MinionProj 发射侧置 255（SetDefaults :6619）
    a.fixedUpdate(1 / 60, g.hooks);
    // vx'=(14×4+14·cos45)/5=13.18、vy'=(0×4−14·sin45)/5=−1.98（:41321-41330）
    expect(a.vx).toBeCloseTo(13.1798, 3);
    expect(a.vy).toBeCloseTo(-1.9799, 3);
    expect(a.alpha).toBe(192);                 // 255 −63/t 淡入（num=63 :41293）
  });
  it('目标失格(!CanBeChasedBy/移除)→立即 Kill（:41317-41320）', () => {
    const g = makeHooks([]);                   // 无敌怪 = 目标失效
    const a = new Arrow(492, 792, 14, 0, 30, 2, 614, { grav: 0, life: 300 });
    a.stickerTgt = 1;
    a.fixedUpdate(1 / 60, g.hooks);
    expect(a.dead).toBe(true);
  });
  it('命中绑定目标上 buff 183×900t（StatusNPC :11381-11383 ai1==i 门）', () => {
    const bound = mkEnemy(1, 492, 792);        // 绑定目标即被命中敌
    const g = makeHooks([bound]);
    const a = new Arrow(492, 792, 14, 0, 30, 2, 614, { grav: 0, life: 300 });
    a.stickerTgt = 1;
    a.fixedUpdate(1 / 60, g.hooks);
    expect(bound.hurtLog).toHaveLength(1);
    expect(bound.stardustT).toBe(15);          // 900t/60=15s（贴附层同入池）
  });
  it('非绑定敌受击【转贴附+183 同上】（★BJ703-D3 勘误：:13248 改写 ai[1] 先于 StatusNPC :13634）', () => {
    const bound = mkEnemy(1, 1200, 792);       // 绑定目标在场（远处,不被命中）
    const other = mkEnemy(2, 496, 792);        // 挡路敌（被命中,含 614 目标盒收缩余量）
    const g = makeHooks([bound, other]);
    const a = new Arrow(492, 792, 14, 0, 30, 2, 614, { grav: 0, life: 300 });
    a.stickerTgt = 1;
    a.fixedUpdate(1 / 60, g.hooks);
    expect(other.hurtLog).toHaveLength(1);     // 照常受击
    // ★BJ703-D3：转刺入（Damage_PVE_Inner :13244-13251）在 StatusNPC（:13634）【前】
    //  改写 ai[1]=victimIndex ⇒ 183 gate `ai[1]==i` 读的就是实际受击敌——挡路敌
    //  同上 183×900t 并被贴附（旧锁「非绑定不上 183」系按出生 ai[1] 读门=时序误读,
    //  R1-F1 钉值锁误读判例同族,随刀改判）。stickerA0=1=stuck 态直锁。
    expect(other.stardustT).toBe(15);          // 900t/60=15s（实际 victim 同上）
    expect((a as unknown as { stickerA0: number }).stickerA0).toBe(1);
    expect((a as unknown as { stickerTgt: number }).stickerTgt).toBe(2);
    expect(bound.hurtLog).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// R7-01/02/03 837 骷髅头法书弹（1457 增量三件）
// ---------------------------------------------------------------------------
describe('R7-01/02/03 837 骷髅头', () => {
  it('R7-01 转向权重 N=20：v=(v×19+向×speed)/20（:57861-57864,曾 32）', () => {
    const e = mkEnemy(1, 497, 600);            // 敌盒心(505,608)与弹心(505,805)同列 → 向 (0,−1)
    const g = makeHooks([e]);
    const a = new Arrow(492, 792, 10, 0, 30, 2, 837, { grav: 0, life: 480 });
    a.fixedUpdate(1 / 60, g.hooks);
    expect(a.vx).toBeCloseTo(9.5, 6);          // (10×19+0)/20
    expect(a.vy).toBeCloseTo(-0.5, 6);         // (0×19−10)/20
  });
  it('R7-02 弹心埋实心格 timeLeft −33 速消（:57774-57779）', () => {
    const store = new TileStore(200, 120);
    const stone = TILE_BY_KEY['stone'] ?? 1;
    for (let x = 24; x <= 26; x++) for (let y = 49; y <= 51; y++) store.setTile(x, y, stone);
    const g = makeHooks([mkEnemy(1, 800, 1600)], store);
    const a = new Arrow(392, 792, 0, 0, 30, 2, 837, { grav: 0, life: 100, noTileCollide: true });
    a.fixedUpdate(1 / 60, g.hooks);            // AI 期 −33（100→67）+ 尾递减 → 66
    expect(a['life']).toBe(66);
    a.fixedUpdate(1 / 60, g.hooks);            // −33（66→33）+ 尾递减 → 32
    expect(a['life']).toBe(32);
    for (let i = 0; i < 31; i++) a.fixedUpdate(1 / 60, g.hooks);   // 32→1（life≤33 不再烧）
    expect(a.dead).toBe(false);
    a.fixedUpdate(1 / 60, g.hooks);            // 1→0 → 当拍杀
    expect(a.dead).toBe(true);
  });
  it('R7-03 837 无尘拖尾、207 有（:57760 type==207 门）', () => {
    const g837 = makeHooks([]);
    const a = new Arrow(492, 792, 10, 0, 30, 2, 837, { grav: 0, life: 480 });
    for (let i = 0; i < 6; i++) a.fixedUpdate(1 / 60, g837.hooks);   // alpha 255→<170 期
    expect(g837.dusts).toHaveLength(0);
    const g207 = makeHooks([]);
    const b = new Arrow(492, 792, 10, 0, 30, 2, 207, { grav: 0, life: 480 });
    for (let i = 0; i < 6; i++) b.fixedUpdate(1 / 60, g207.hooks);
    expect(g207.dusts.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// R7-05 timeLeft 递减时点（Update :17307-17311 子步末）
// ---------------------------------------------------------------------------
describe('R7-05 life 递减在子步末', () => {
  it('life=1 当拍仍跑 AI 且当拍杀（Kill 链同拍触发）', () => {
    const g = makeHooks([]);
    const a = new Arrow(492, 792, 8, 0, 30, 2, 1, { grav: 0, life: 1 });
    const x0 = a.x;
    a.fixedUpdate(1 / 60, g.hooks);
    expect(a.dead).toBe(true);
    expect(a.x - x0).toBeCloseTo(8, 5);        // AI/位移照跑（原寿命语义少一拍）
  });
});

// ---------------------------------------------------------------------------
// R7-10/11 AI_029 宝石法珠 homing 形状（:38580-38601）
// ---------------------------------------------------------------------------
describe('R7-10/11 AI_029 homing', () => {
  it('R7-11 近距低速转向 = (prox×0.1+0.01+0.05)×Remap(sp,1,3,10,1) 整项乘', () => {
    // 竖直下飞 v=(0,1)（sp=1<8 提速档）,敌在正右视距内（496<500）
    const e = mkEnemy(1, 988, 800);            // 盒心(996,808)
    const g = makeHooks([e]);
    const a = new Arrow(492, 792, 0, 1, 30, 2, 125, { grav: 0, life: 300 });
    a['gem'] = { homing: true } as never;
    a.fixedUpdate(1 / 60, g.hooks);
    const dist = Math.hypot(996 - 497, 808 - 797);   // 弹心(497,797) 125=10×10
    const prox = Math.max(0, 1 - dist / 500);
    const sp = 1.21;                            // 提速 (1+0.1)×1.1
    const turn = (prox * 0.1 + 0.01 + 0.05) * Math.max(1, Math.min(10, 10 - (sp - 1) * 4.5));
    const nv = Math.PI / 2 - turn;              // diff=want−cur<−turn → 钳到 −turn
    expect(a.vx).toBeCloseTo(Math.cos(nv) * sp, 3);
    expect(a.vy).toBeCloseTo(Math.sin(nv) * sp, 3);
  });
  it('R7-10 提速段双轴对称：竖直飞行的 vy 也吃 +0.1·ny（:38580-38584）', () => {
    const e = mkEnemy(1, 492, 1200);           // 盒心(500,1208) 正下方视距内 → 方向不变纯加速
    const g2 = makeHooks([e]);
    const b = new Arrow(492, 792, 0, 1, 30, 2, 125, { grav: 0, life: 300 });
    b['gem'] = { homing: true } as never;
    b.fixedUpdate(1 / 60, g2.hooks);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(1.21, 6);   // (1+0.1)×1.1 双轴
    expect(b.vy).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// R7-38 鞭 CutTiles（:15292-15300 IsAWhip 支）
// ---------------------------------------------------------------------------
describe('R7-38 鞭 CutTiles', () => {
  it('挥鞭沿控制点割草域扫描调 game.cutTile', () => {
    const g = makeHooks([]);
    const player = {
      x: 32 * 16, y: 40 * 16, w: 20, h: 42, cx: 32 * 16 + 10, cy: 40 * 16 + 21,
      facing: 1, equipStats: {}, whipBuffs: {}, summonDamageMult: 1, dead: false,
    };
    const whip = new WhipProj(player.cx, player.cy, 0, 847, 4901, 30, 2, 30, 10,
      () => player as never);
    whip.fixedUpdate(1 / 60, g.hooks);
    expect(g.cuts.length).toBeGreaterThan(0);  // 控制点盒域 → cutTile 调用
  });
});
