// ============================================================================
// 水晶蛇 Crystal Serpent(item 3210 → 弹 523)行为锁(aiStyle 95 1:1)
//   依赖落地:src/entities/WeaponProj.ts 尾部追加 CrystalSerpentProj /
//   rollCrystalSerpentVelocity / CRYSTAL_SERPENT_PROJ(/tmp/p2/3210-branch.ts PART A)
//
// ★1457 定谳前置(反编译 Projectile.cs:33572-33597 全文核对):
//   弹 523 【不是】蛇形追踪弹——无索敌/无正弦摆动,「蛇」=贴图本体随 vx×0.1 微倾;
//   真行为 = 出手直飞 → ai[0] 相位(出手 rand(20),Player.cs:48902)到点 →
//   上浮(vy −0.05/拍 软帽 −8)+横向阻尼(vx ×0.98);ai[0] 唯一消费点 = 相位闸
//   (:33585-33591)——自由段 = 31−ai0 拍,相位越大越早抬升(三连发散布"错峰")。
//   本套测试据此把简报的「追踪行为锁」改判为「无索敌锁+上浮行为锁」。
// ============================================================================
import { describe, it, expect } from 'vitest';
import { CrystalSerpentProj, rollCrystalSerpentVelocity, CRYSTAL_SERPENT_PROJ } from '../src/entities/WeaponProj';
import { damageVarRoll } from '../src/stats/DamageVar';
import { World } from '../src/world/World';
import { TILE_BY_KEY } from '../src/data/tiles';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; hits: number[];
  hurt: (d: number, kx: number, ky: number, g: GameHooks) => boolean;
}
const mkEnemy = (id: number, cx: number, cy: number): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - 8, y: cy - 12, w: 16, h: 24, dead: false, cx, cy, hp: 10000, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};

function mkHooks(enemies: MockEnemy[] = []) {
  const w = new World(60, 200, 1, 'cs');
  // 清出高空测试带(行 10-170):比雨云带更深——上浮段测试要在清空域内跑 ~220 拍不撞地形
  for (let x = 0; x < 60; x++) {
    for (let y = 10; y <= 170; y++) w.store.setTileSilent(x, y, 0, 0, 0);
  }
  const added: unknown[] = [];
  const sounds: string[] = [];
  const bursts: Array<{ x: number; y: number; count: number }> = [];
  const player = new Player(30 * 16, 20 * 16, new Inventory());
  const hooks = {
    world: w,
    player,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    // Kill 钩(:74622-74633)捕捞:Item_54 + 25×dust256
    spawnParticles: (x: number, y: number, _c: string, count: number) => { bursts.push({ x, y, count }); },
    playSfx: () => {},
    playSfxFiles: (files: string[]) => { sounds.push(files[0]); },
    showPickupLabel: () => {},
    notifyInventoryChanged: () => {},
  };
  (hooks as unknown as { entities: { nextId: number; add: (e: unknown, b: string) => void; projectiles: unknown[] } }).entities = {
    nextId: 1,
    add: (e: unknown, b: string) => { if (b === 'projectiles') added.push(e); },
    projectiles: added,
  };
  return { hooks: hooks as unknown as GameHooks, world: w, added, sounds, bursts, player };
}

/** 固定值 rand:钉值测试用(0.5 → 全部抖动恰为 0/速度中值 8.0/相位 10;
 *  0.995 → 抖动 +1.2/+0.9、速度 9.0、相位 19——全落 Next 区间上界侧) */
const fixed = (v: number) => () => v;
/** LCG 确定性流(域锁测试用,与 Math.random 独立) */
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

describe('水晶蛇 3210→523（aiStyle 95 独占族）', () => {
  it('①弹型锚:CRYSTAL_SERPENT_PROJ=523(施法支/StatusNPC 表/绘制全按它寻址)', () => {
    expect(CRYSTAL_SERPENT_PROJ).toBe(523);
    const p = new CrystalSerpentProj(480, 640, 4, 2, 43, 3, 0);
    expect(p.projId).toBe(523);
    expect(p.w).toBe(32); expect(p.h).toBe(32);        // SetDefaults :5931-5932
    expect(p.life).toBe(3600);                          // timeLeft 全局缺省 :789
    expect(p.frostEligible).toBe(true);                 // ranged=true :5935
  });

  it('②出手速度掷:方向=瞄准方向,速度=8.0 中值,与瞄准模长/shootSpeed 无关(归一化在前)', () => {
    // rand=0.5 → 两轮抖动恰为 0(Next(-30,31) 中值 30×0.04=0)、速度=Next(70,91) 中值 8.0
    const up = rollCrystalSerpentVelocity(0, -777, fixed(0.5));
    expect(up.vx).toBe(0);
    expect(up.vy).toBe(-8);                             // 精确 8.0(777/777=1)
    const far = rollCrystalSerpentVelocity(99999, 0, fixed(0.5));
    expect(far.vx).toBe(8);                             // |aim|=99999 → 仍 8.0(shootSpeed 8.5 只进方向)
    expect(far.vy).toBe(0);
  });

  it('③出手速度掷钉值:两轮抖动 ±1.2/±0.9+速度 9.0+相位 19(掷序 X,Y,速度,X,Y,相位)', () => {
    // rand=0.995 → jx=+30×0.04=1.2 / jy=+30×0.03=0.9 / spd=(70+20)×0.1=9.0 / phase=19
    const s = rollCrystalSerpentVelocity(1000, 0, fixed(0.995));
    expect(s.vx).toBeCloseTo(10.199996, 4);             // (1001.2,0.9)归一×9 +1.2
    expect(s.vy).toBeCloseTo(0.908090, 4);
    expect(s.phase).toBe(19);                           // Next(20) 上界(:48902)
  });

  it('④终速域锁:5000 掷 |v|∈[5.5,10.5]、相位∈[0,19]、零向量方向无 NaN', () => {
    // 终速域 = [7.0−1.5, 9.0+1.5](抖动向量模长上界 √(1.2²+0.9²)=1.5)——恒速 8.5 的
    // 旧通用兜底在本域外,即为本支的存在意义
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const aim = i % 2 === 0 ? [12345, -6789] : [3, 2];
      const s = rollCrystalSerpentVelocity(aim[0], aim[1], lcg(1000 + i));
      const m = Math.hypot(s.vx, s.vy);
      min = Math.min(min, m); max = Math.max(max, m);
      expect(s.phase).toBeGreaterThanOrEqual(0);
      expect(s.phase).toBeLessThanOrEqual(19);
      expect(Number.isFinite(s.vx)).toBe(true);
      expect(Number.isFinite(s.vy)).toBe(true);
    }
    expect(min).toBeGreaterThanOrEqual(5.5 - 1e-9);
    expect(max).toBeLessThanOrEqual(10.5 + 1e-9);
  });

  it('⑤ai[0] 相位闸:ai0=0 自由段 31 拍零转向;近敌不索敌(非蛇形追踪锁);tick32 起上浮', () => {
    const e = mkEnemy(1, 30 * 16, 30 * 16);             // 敌在弹道上方,永不相交
    const { hooks } = mkHooks([e]);
    const p = new CrystalSerpentProj(30 * 16, 40 * 16, 4, 2, 43, 3, 0);
    for (let t = 0; t < 31; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.vx).toBe(4);                               // 自由段零阻尼(:33588 else 支只 ++
    expect(p.vy).toBe(2);                               //  无任何速度改写)
    expect(p.dead).toBe(false);
    expect(e.hits).toHaveLength(0);                     // ★无索敌锁:aiStyle 95 无追踪项
    let vx = 4, vy = 2;
    for (let i = 0; i < 10; i++) { vx *= 0.98; vy -= 0.05; }
    for (let t = 0; t < 10; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.vy).toBeCloseTo(vy, 9);                    // tick32..41 上浮 10 拍
    expect(p.vx).toBeCloseTo(vx, 9);
  });

  it('⑥相位错峰对照:ai0=19 上浮自 tick13 起(自由段 12 拍)', () => {
    const { hooks } = mkHooks();
    const p = new CrystalSerpentProj(30 * 16, 40 * 16, 4, 2, 43, 3, 19);
    for (let t = 0; t < 12; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.vy).toBe(2);                               // 12 拍仍自由(31−19=12)
    p.fixedUpdate(1 / 60, hooks);                       // tick13 首拍上浮
    expect(p.vy).toBeCloseTo(1.95, 9);                  // 2 − 0.05
  });

  it('⑦上浮软帽 −8(浮点重复减终值=末步漂移,与原版 XNA float 同病)与 rotation=vx×0.1(:33592)', () => {
    const { hooks } = mkHooks();
    const p = new CrystalSerpentProj(30 * 16, 140 * 16, 4, 0, 43, 3, 31);   // 相位已过闸
    for (let t = 0; t < 220; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.vy).toBeLessThanOrEqual(-8);               // 已越帽(0.05×n 重复减漂移 ≈ −8.05)
    expect(p.vy).toBeGreaterThan(-8.1);                 // 不超过一个步长
    const vyAtCap = p.vy;
    for (let t = 0; t < 20; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.vy).toBe(vyAtCap);                         // ★软帽语义:vy>-8 才减,越帽后恒停(:33586)
    expect((p as unknown as { rot: number }).rot).toBeCloseTo(p.vx * 0.1, 12);
  });

  it('⑧alpha 淡入:255→(3 拍延迟)−20/拍→钳 100;drawAlpha=(255−alpha)/255', () => {
    const { hooks } = mkHooks();
    const p = new CrystalSerpentProj(30 * 16, 40 * 16, 0, 0, 43, 3, 0);
    expect(p.drawAlpha).toBe(0);                        // alpha 255 = XNA 全透(SetDefaults :5935)
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.drawAlpha).toBe(0);                        // localAI[0] 数 3 拍未启淡(:33573-33582)
    p.fixedUpdate(1 / 60, hooks);                       // tick4 → 235
    expect(p.drawAlpha).toBeCloseTo(20 / 255, 9);
    for (let t = 0; t < 7; t++) p.fixedUpdate(1 / 60, hooks);   // tick11:255−8×20=95→钳 100
    expect(p.drawAlpha).toBeCloseTo(1 - 100 / 255, 9);  // 终值 0.6078,非全不透明
    p.fixedUpdate(1 / 60, hooks);                       // 钳位不续降
    expect(p.drawAlpha).toBeCloseTo(1 - 100 / 255, 9);
  });

  it('⑨水面:浮升 −0.2/拍【无视相位闸】+vx×0.94+湿态位移折半（★2026-09-08 F6 金标反转：出生预置 :10886-10893 在生成时点写 wet,首拍 AI 浮升支 :33593 读预置值——旧「1 拍滞后」钉系对原版偏差,共享体接入批校正）', () => {
    const { hooks, world } = mkHooks();
    const st = world.store;
    const ti = st.idx(30, 140);
    st.liquid[ti] = 255;                                // 出生格置水
    st.liquidType[ti] = LIQUID_TYPE.WATER;
    const p = new CrystalSerpentProj(30 * 16, 140 * 16, 6, 2, 43, 3, 0);   // 相位 0=未过闸
    const cx0 = p.cx;
    p.fixedUpdate(1 / 60, hooks);                       // tick1:预置 wet=1(原版 NewProjectile 时点) → 浮升即跑
    expect(p.vy).toBeCloseTo(2 * 0.98 - 0.2, 9);        // vy>0 先 ×0.98 再 −0.2(:33594-33596)
    expect(p.vx).toBeCloseTo(5.64, 9);                  // ×0.94
    expect(p.cx).toBeCloseTo(cx0 + 5.64 * 0.5, 6);      // 位移折半 = liqFactor 0.5(wetVelocity :17721-17764)
    p.fixedUpdate(1 / 60, hooks);                       // tick2:AI 读上拍样本(仍湿) → 浮升续跑
    expect(p.vy).toBeCloseTo(1.76 * 0.98 - 0.2, 9);     // 1.5248
    expect(p.vx).toBeCloseTo(5.64 * 0.94, 9);           // 5.3016
    expect(p.cx).toBeCloseTo(cx0 + 5.64 * 0.5 + 5.3016 * 0.5, 6);
  });

  it('⑩撞格亡:通用默认支(:18160-18166)→ Kill 钩 Item_54 + 25 尘(:74622-74633)', () => {
    const { hooks, world, sounds, bursts } = mkHooks();
    const dirt = TILE_BY_KEY['dirt'] ?? 1;
    for (let yy = 136; yy <= 144; yy++) {
      world.store.setTileSilent(34, yy, dirt, 0, 0);
      world.store.setTileSilent(35, yy, dirt, 0, 0);
    }
    const p = new CrystalSerpentProj(30 * 16, 140 * 16, 4, 0, 43, 3, 0);
    for (let t = 0; t < 40 && !p.dead; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.dead).toBe(true);
    expect(p.cx).toBeLessThan(34 * 16);                 // 停在墙前(tile 碰撞盒=中心 10×10 :20072)
    expect(sounds).toContain('Item_54');
    expect(bursts).toHaveLength(1);
    expect(bursts[0].count).toBe(25);
  });

  it('⑪命中敌:penetrate 1 首中即亡+承伤 43/86+Poisoned(20) 10..29s(:11485 表驱动)', () => {
    const e = mkEnemy(1, 34 * 16, 140 * 16);            // 敌盒 [536,552]×[2228,2252]
    const { hooks } = mkHooks([e]);
    const p = new CrystalSerpentProj(30 * 16, 140 * 16 - 16, 4, 0, 43, 3, 0);
    // 弹盒 [x,x+32]×[y,y+32]=[480..]×[2224,2256] 与敌盒 y 交叠;x 推进至 x+32>536 命中
    for (let t = 0; t < 30 && !p.dead; t++) p.fixedUpdate(1 / 60, hooks);
    expect(p.dead).toBe(true);                          // penetrate=1(:5936)首中耗尽 → Kill
    expect(e.hits).toHaveLength(1);
    // ★BJ735 改判史（随 BJ723-B W01+S02,2026-10-26）：hitEnemies 主环接 DamageVar
    // 首掷（Projectile.cs:12970 Main.DamageVar 31 离散档 ±15%,luck=0 单掷）+crit ×2
    // 移 Enemy.hurt 防后（S02）→ mock hurt 记录值=未翻倍 DV 档（旧钉 [43,86]=平值+
    // 调用侧预倍遗迹;86 域自 S02 起对 mock 记录面不可达）。域锁=31 档全枚举
    // （damageVarRoll float32 逐级精度面自证,不手算端点防再陈旧）。
    const dvDomain = new Set<number>();
    for (let i = 0; i < 31; i++) dvDomain.add(damageVarRoll(43, 0, () => i / 31));
    expect(dvDomain.has(e.hits[0])).toBe(true);
    const pt = (e as unknown as { poisonT?: number }).poisonT ?? 0;
    expect(pt).toBeGreaterThanOrEqual(10);              // 60×Next(10,30)t = 10..29s
    expect(pt).toBeLessThanOrEqual(29);
  });

  it('⑫世界边界出界=静默消散,无 Kill 特效(Update :16790 与 Kill 钩分立)', () => {
    const { hooks, sounds, bursts } = mkHooks();
    const p = new CrystalSerpentProj(30 * 16, -40, 4, 0, 43, 3, 0);   // 顶界之外
    p.fixedUpdate(1 / 60, hooks);
    expect(p.dead).toBe(true);
    expect(sounds).not.toContain('Item_54');            // 上浮必出顶界——原版本相,勿改 Kill 路径
    expect(bursts).toHaveLength(0);
  });
});
