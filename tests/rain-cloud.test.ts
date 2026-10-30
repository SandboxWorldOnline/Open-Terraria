// 雨云魔杖 1244 / 猩红魔杖 1256 云弹家族行为锁(aiStyle 45 1:1,Projectile.cs:28351-28520):
//  ①移动云过锚双轴齐停 → Kill 钩原位变 238 降雨云(:76032-76037)
//  ②降雨云开阔带每 >8t 落 239 雨滴(vy 5);受阻(2×20 带实心)不降雨
//  ③同型存活计数:238 活>2 → 最老者 age=18000 起淡出
//  ④雨滴撞格亡/命中敌承 damage
import { describe, it, expect, vi } from 'vitest';
import { RainCloudProj } from '../src/entities/WeaponProj';
import { damageVarRoll } from '../src/stats/DamageVar';
import { World } from '../src/world/World';
import { TILE_BY_KEY } from '../src/data/tiles';
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
  const w = new World(60, 200, 1, 'rc');
  // 清出高空测试带(行 20-70):种子 1 生成地形会填满洞周
  for (let x = 0; x < 60; x++) {
    for (let y = 20; y <= 70; y++) w.store.setTileSilent(x, y, 0, 0, 0);
  }
  const added: unknown[] = [];
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
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  };
  (hooks as unknown as { entities: { nextId: number; add: (e: unknown, b: string) => void; projectiles: unknown[] } }).entities = {
    nextId: 1,
    add: (e: unknown, b: string) => { if (b === 'projectiles') added.push(e); },
    projectiles: added,
  };
  return { hooks: hooks as unknown as GameHooks, world: w, added, player };
}

describe('雨云/猩红魔杖云弹家族（aiStyle 45）', () => {
  it('①移动云过锚双轴齐停 → Kill 钩原位变 238 降雨云', () => {
    const { hooks, added } = mkHooks();
    // 锚 (200,100),出生 (100,100) 顶左,vx=4 → cx=114 起 22t 内过锚
    const c = new RainCloudProj(100, 100, 4, 0, 30, 0, 237, 200, 100);
    for (let t = 0; t < 40 && !c.dead; t++) c.fixedUpdate(1 / 60, hooks);
    expect(c.dead).toBe(true);
    const rains = added.filter((a) => (a as RainCloudProj).projId === 238);
    expect(rains).toHaveLength(1);
    const rain = rains[0] as RainCloudProj;
    expect(Math.abs(rain.cx - 200)).toBeLessThanOrEqual(27);   // 死亡点 Center 生成
    expect(rain.vy).toBe(0);
  });

  it('②降雨云开阔带每 >8t 落 239 雨滴(vy=5,承 damage)', () => {
    const { hooks, added } = mkHooks();
    const rain = new RainCloudProj(30 * 16, 30 * 16, 0, 0, 30, 0, 238);
    for (let t = 0; t < 40; t++) rain.fixedUpdate(1 / 60, hooks);
    const drops = added.filter((a) => (a as RainCloudProj).projId === 239);
    expect(drops.length).toBeGreaterThanOrEqual(3);           // beat>8 → 9/18/27/36 拍四滴
    const d0 = drops[0] as RainCloudProj;
    expect(d0.vy).toBe(5);
    expect(d0.damage).toBe(30);
  });

  it('③受阻(云底 20px 像素探针内实心)不降雨(Collision.SolidTiles 像素盒)', () => {
    const { hooks, world, added } = mkHooks();
    const rain = new RainCloudProj(30 * 16, 30 * 16, 0, 0, 30, 0, 238);
    // 云体 54×28 顶左 (480,480) → 云底 y=508;探针=中缝 2px × 向下 20px = y 508..528
    // → 格行 31..33;行 31-32 置实心 → 受阻不降雨
    const dirt = TILE_BY_KEY['dirt'] ?? 1;
    for (let xx = 28; xx <= 34; xx++) {
      world.store.setTileSilent(xx, 31, dirt, 0, 0);
      world.store.setTileSilent(xx, 32, dirt, 0, 0);
    }
    for (let t = 0; t < 40; t++) rain.fixedUpdate(1 / 60, hooks);
    expect(added.filter((a) => (a as RainCloudProj).projId === 239)).toHaveLength(0);
  });

  it('③c 开阔:实心仅在探针 20px 外照常降雨(像素盒回归锁,曾误译 2×20 格带)', () => {
    const { hooks, world, added } = mkHooks();
    const rain = new RainCloudProj(30 * 16, 30 * 16, 0, 0, 30, 0, 238);
    // 云底 y=508,探针至 y=528(行 31..33);实心在行 34-35(y 544) = 探针外 → 照常降雨
    // (旧「2 格宽×20 格深」误译判受阻 = 户外近地施法整段哑弹)
    const dirt = TILE_BY_KEY['dirt'] ?? 1;
    for (let xx = 28; xx <= 34; xx++) {
      world.store.setTileSilent(xx, 34, dirt, 0, 0);
      world.store.setTileSilent(xx, 35, dirt, 0, 0);
    }
    for (let t = 0; t < 40; t++) rain.fixedUpdate(1 / 60, hooks);
    expect(added.filter((a) => (a as RainCloudProj).projId === 239).length).toBeGreaterThanOrEqual(3);
  });

  it('③b 同型存活计数:238 活>2 → 最老者 age=18000 起淡出(雨云=双云)', () => {
    const { hooks, added } = mkHooks();
    const a = new RainCloudProj(20 * 16, 30 * 16, 0, 0, 30, 0, 238);
    const b = new RainCloudProj(25 * 16, 30 * 16, 0, 0, 30, 0, 238);
    const c = new RainCloudProj(35 * 16, 30 * 16, 0, 0, 30, 0, 238);
    added.push(a, b, c);                                       // 注册进桶(扫描面=桶)
    (a as unknown as { age: number }).age = 100;               // a 最老
    (b as unknown as { age: number }).age = 50;
    (c as unknown as { age: number }).age = 10;
    for (let t = 0; t < 12; t++) a.fixedUpdate(1 / 60, hooks);
    // vanilla ai[1]++ 在 ≥18000 判定前(淡出中仍自增),断言 ≥ + 淡出已启动
    expect((a as unknown as { age: number }).age).toBeGreaterThanOrEqual(18000);
    expect((a as unknown as { fade: number }).fade).toBeGreaterThan(0);
    expect((b as unknown as { age: number }).age).toBeLessThan(18000);
    expect((c as unknown as { age: number }).age).toBeLessThan(18000);
  });

  it('④雨滴:撞格亡;命中敌承 damage;penetrate 5', () => {
    const e = mkEnemy(1, 30 * 16, 32 * 16);
    const { hooks, world } = mkHooks([e]);
    // 地板在行 35(敌下方),雨滴从 30*16 上方落下穿过敌身
    const dirt = TILE_BY_KEY['dirt'] ?? 1;
    for (let xx = 28; xx <= 32; xx++) world.store.setTileSilent(xx, 35, dirt, 0, 0);
    const drop = new RainCloudProj(30 * 16 - 2, 30 * 16, 0, 5, 30, 0, 239);
    drop.critChance = 0;                                       // 钉 4% 暴击 roll=确定 30
    for (let t = 0; t < 30 && !drop.dead; t++) drop.fixedUpdate(1 / 60, hooks);
    expect(e.hits.length).toBeGreaterThanOrEqual(1);           // 命中承伤
    // ★BJ735 改判史（随 BJ723-B W01,2026-10-26）：hitEnemies 主环接 DamageVar 首掷
    // （Projectile.cs:12970,31 离散档 ±15%,luck=0 单掷;critChance=0 已钉无 crit 掷）
    // → 平值钉 30 变 31 档域锁（枚举域自证,同 crystal-serpent ⑪ 改判形）。
    const dvDomain = new Set<number>();
    for (let i = 0; i < 31; i++) dvDomain.add(damageVarRoll(30, 0, () => i / 31));
    expect(dvDomain.has(e.hits[0])).toBe(true);
    expect(drop.dead).toBe(true);                              // 撞地板亡
  });

  it('①b 过锚轴置零(:28361-28371):X 先过锚不再漂移,雨云落点=过锚停点', () => {
    const { hooks, added } = mkHooks();
    // 出生顶左 (480,352) → cx=507/cy=366;v=(4,2);锚 (600,480):
    // X 于 t=24 过锚(cx=603)【置零】;Y 至 t=58 过锚(cy=482) → 双轴齐停亡于 (603,482)。
    // 旧实现漏置零:cx 一路漂到 507+4×58=739
    const c = new RainCloudProj(480, 352, 4, 2, 30, 0, 237, 600, 480);
    for (let t = 0; t < 80 && !c.dead; t++) c.fixedUpdate(1 / 60, hooks);
    expect(c.dead).toBe(true);
    const rain = added.find((a) => (a as RainCloudProj).projId === 238) as RainCloudProj;
    expect(rain).toBeDefined();
    expect(Math.abs(rain.cx - 603)).toBeLessThanOrEqual(4);    // cx 钉在过锚拍
    expect(Math.abs(rain.cy - 482)).toBeLessThanOrEqual(4);
  });

  it('②b 雨滴横散 Next(-14,15)=[-14,14](低端 -15 纠偏)', () => {
    const { hooks, added } = mkHooks();
    const rain = new RainCloudProj(30 * 16, 30 * 16, 0, 0, 30, 0, 238);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);   // rand=0 → 偏移取低端
    for (let t = 0; t < 10; t++) rain.fixedUpdate(1 / 60, hooks);
    spy.mockRestore();
    const d0 = added.find((a) => (a as RainCloudProj).projId === 239) as RainCloudProj;
    expect(d0).toBeDefined();
    expect(d0.x).toBeCloseTo(rain.cx - 14 - 2, 6);             // 左上=盒心(=cx)+偏移-半盒(2)
  });

  it('④b 239/245 EU=1 子步:一 tick 两子步(位移 10px);life=timeLeft 300', () => {
    const { hooks } = mkHooks();
    const a = new RainCloudProj(30 * 16 - 2, 30 * 16, 0, 5, 30, 0, 239);
    const y0 = a.y;
    a.fixedUpdate(1 / 60, hooks);                              // 无格无敌 → 纯位移
    expect(a.y - y0).toBe(10);                                 // 2 子步 × 5px(旧单步=5)
    const b = new RainCloudProj(30 * 16 - 2, 30 * 16, 0, 5, 30, 0, 245);
    expect(b.life).toBe(300);                                  // SetDefaults timeLeft(:3292)
  });

  it('④c 245 penetrate=2 vs 239 penetrate=5(穿透双敌判生死)', () => {
    // ★共享免疫表为模块级单例,敌 id 跨测试须唯一(同 id 167ms 内继承旧免疫账)
    const mkPair = (base: number) => [mkEnemy(base, 30 * 16, 31 * 16), mkEnemy(base + 1, 30 * 16, 33 * 16)];
    const [a1, a2] = mkPair(21);
    const a = mkHooks([a1, a2]);
    const d245 = new RainCloudProj(30 * 16 - 2, 30 * 16 - 20, 0, 5, 30, 0, 245);
    for (let t = 0; t < 12 && !d245.dead; t++) d245.fixedUpdate(1 / 60, a.hooks);
    expect(d245.dead).toBe(true);                              // 2 命中即亡(:3280)
    expect(a1.hits.length + a2.hits.length).toBe(2);
    const [b1, b2] = mkPair(31);
    const b = mkHooks([b1, b2]);
    const d239 = new RainCloudProj(30 * 16 - 2, 30 * 16 - 20, 0, 5, 30, 0, 239);
    for (let t = 0; t < 12 && !d239.dead; t++) d239.fixedUpdate(1 / 60, b.hooks);
    expect(b1.hits.length + b2.hits.length).toBe(2);           // 2 < 5 → 仍活
    expect(d239.dead).toBe(false);
  });

  it('④d 全场同型共享免疫(idStatic=10):两滴同拍同敌只一跳(:3211)', () => {
    const e = mkEnemy(41, 30 * 16, 32 * 16);                   // 敌 id 本测独占(模块级免疫账)
    const { hooks } = mkHooks([e]);
    const a = new RainCloudProj(30 * 16 - 2, 32 * 16 - 60, 0, 5, 30, 0, 239);
    const b = new RainCloudProj(30 * 16 - 2, 32 * 16 - 60, 0, 5, 30, 0, 239);
    a.fixedUpdate(1 / 60, hooks);
    b.fixedUpdate(1 / 60, hooks);
    expect(e.hits.length).toBe(1);                             // 同型一张账(旧每弹私账=2)
  });

  it('④e Kill 溅花尘(:75964-75993):239=尘154 带重力;vy≤0 不发', () => {
    const e = mkEnemy(1, 30 * 16, 32 * 16);
    const { hooks, world } = mkHooks([e]);
    const dusts: Array<{ x: number; y: number; w: number; h: number; type: number }> = [];
    (hooks as unknown as { spawnDust: unknown }).spawnDust =
      (x: number, y: number, w: number, h: number, type: number) => {
        dusts.push({ x, y, w, h, type });
        return null;
      };
    const dirt = TILE_BY_KEY['dirt'] ?? 1;
    for (let xx = 28; xx <= 32; xx++) world.store.setTileSilent(xx, 35, dirt, 0, 0);
    const drop = new RainCloudProj(30 * 16 - 2, 30 * 16, 0, 5, 30, 0, 239);
    for (let t = 0; t < 30 && !drop.dead; t++) drop.fixedUpdate(1 / 60, hooks);
    expect(drop.dead).toBe(true);
    expect(dusts.length).toBe(1);                              // 撞格亡一次性溅花
    expect(dusts[0].type).toBe(154);                           // 239 → 154(:75966)
    expect(dusts[0].y).toBeCloseTo(drop.y + drop.h - 2, 6);    // 盒=(x, y+h-2, 2, 2)
  });

  it('⑤ 锚=0 门跳过(:28355 num333/334 != 0 双门):单轴 0 → 过锚臂全不跑(原版同门)'
    + '——R5 登记钉:移动云无 timeLeft 兜底亡(锚=光标 ≤~1000px/16px/t ≪3600t,'
    + '唯 0.0 浮点测度零,负锚走比较臂照停)', () => {
    const { hooks } = mkHooks();
    // anchorX=0(门跳过),anchorY 非 0:若误删 `!==0` 双门,vx>0&&cx>0 立即旗 X、
    // vy==0 立即旗 Y → 当拍 Kill → 本测即红
    const c = new RainCloudProj(480, 480, 4, 0, 30, 0, 237, 0, 480);
    for (let t = 0; t < 60; t++) c.fixedUpdate(1 / 60, hooks);
    expect(c.dead).toBe(false);
    expect(c.vx).toBe(4);                                      // 门内才有清速臂
  });
});
