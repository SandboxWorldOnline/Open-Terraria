// 召唤随从 AI 备案遗留 7 项回归（2026-08-23,标杆 Terarria1457/Terraria/Projectile.cs）：
//  ① AI_062 飞行随从逐型定制速度曲线（:66529-66826）——373 分段/423·613 悬停带/375 反推
//  ② 地面步行族贴地行走（蜘蛛 390-392 AI_026 flag7 :63058-63340 / 吸血蛙 758 AI_067
//     flag2 :51296-51619）——重力+行走+遇障跳梯
//  ③ 黄蜂 373 射击冷却随机计数器（:66963-66978 ai[1]+=Next(1,4) 阈 90）
//  ④ 俾格米掷矛 Y 抛物线预瞄（AI_026 :62713-62720 num155=|Δx|×0.1×Next(0,100)×0.001）
//  ⑤ AI_062 索敌距门以玩家为基准（407/613/423 :66361-66402;1456 :62416/:62433 同段）
//  ⑥ 致命球 533 双门：扫描 2000（:30105-30111/:30330-30340）+ 触发 800（:30632-30640）
//  ⑦ 随从绘制旋转枢 = 贴图宽/2（Main.cs:29601 原式化简,同 WeaponProj.drawProj 修法）
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { MinionProj } from '../src/entities/MinionProj';
import { Arrow, setProjSpriteOverride } from '../src/entities/Arrow';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { TILE_BY_KEY } from '../src/data/tiles';
import { freeUpMinionsForSummon } from '../src/core/Game';
import { pinGameTimeTicks } from '../src/core/GameTime';
import type { GameHooks } from '../src/entities/types';

const W = 200, H = 120;
function makeStore(): TileStore {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  return store;
}
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number) => boolean;
}
function mkEnemy(id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy, hp: 100000,
    hurt: (d: number) => { e.hp -= d; return true; },
  };
  return e;
}
function makeHooks(enemies: MockEnemy[] = []) {
  const store = makeStore();
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const projectiles: unknown[] = [];
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: { store, flags: { hardMode: false } } as never,
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
  };
  (hooks as unknown as { entities: { add: (e: unknown, b?: string) => void; projectiles: unknown[] } }).entities = {
    add: (e: unknown) => { added.push(e); projectiles.push(e); },
    projectiles,
  };
  return { hooks, store, player, projectiles, added, enemies };
}
function mkMinion(projId: number, owner: Player, x?: number, y?: number): MinionProj {
  return new MinionProj(x ?? owner.cx, y ?? owner.cy - 40, projId, 10, 2, false, 0, false, () => owner);
}
const priv = (m: MinionProj): { a62A0: number; a62A1: number; a62Lai0: number; a62EU: number;
  dA0: number; dA1: number; frA0: number; spLai1: number; spDir: number } =>
  m as unknown as { a62A0: number; a62A1: number; a62Lai0: number; a62EU: number;
    dA0: number; dA1: number; frA0: number; spLai1: number; spDir: number };

describe('① AI_062 逐型速度曲线（1457 :66529-66677）', () => {
  it('373 黄蜂分段：>200 加速段 (v×40+向×6)/41;≤200 上浮段 vy-=0.1（:66616-66677）', () => {
    // 远段：敌 400px 右 → 首拍自静止 vx=6/41（num27=6,num28=40）
    const eFar = mkEnemy(1, 60 * 16 + 400, 90 * 16);
    const a = makeHooks([eFar]);
    const m1 = mkMinion(373, a.player, a.player.cx, eFar.cy - 8);
    m1.fixedUpdate(1, a.hooks);
    expect(m1.vx).toBeCloseTo(6 / 41, 9);
    expect(m1.vy).toBe(0);
    // 近段（≤200）：敌 100px 右同高 → 不入加速段,走尾链上浮 vy-=-0.1、vx 不动
    const eNear = mkEnemy(2, 60 * 16 + 100, 90 * 16);
    const b = makeHooks([eNear]);
    const m2 = mkMinion(373, b.player, b.player.cx, eNear.cy - 8);
    m2.fixedUpdate(1, b.hooks);
    expect(m2.vx).toBe(0);
    expect(m2.vy).toBeCloseTo(-0.1, 9);
  });
  it('423 悬停带归 423/613 专段：70<距<130 → <100 反推 -3、≥100 吸附 7（:66641-66654）', () => {
    // 几何避开 :67097 扇区微调（rotTo ∈ [π/4,3π/4] 不触发）：瞄准点=敌顶心-80,
    // 取敌在随从下前方 40/100 → num23=107.7（≥100 → num30=7 吸附）
    // ★夹具重布（SW-BJ13/BJ16 真盒）：423 真盒 28×28（:4964-4965）——出生左上移
    // (−14,−14) 使盒心保持在原 16×16 缺省盒时代标定的 (1026,808)/(1036,828),
    // 距离/分支断言不变
    const e1 = mkEnemy(1, 1066, 1000);
    const a = makeHooks([e1]);
    const m1 = mkMinion(423, a.player, 1012, 794);       // 盒心 (1026,808)→瞄准点 (1066,908):dx=40,dy=100
    m1.fixedUpdate(1, a.hooks);
    expect(m1.vx).toBeCloseTo((40 / Math.hypot(40, 100)) * 7 / 21, 6);
    expect(m1.vy).toBeCloseTo((100 / Math.hypot(40, 100)) * 7 / 21, 6);
    // 30/80 → num23=85.4（<100 → num30=-3 反推）
    const e2 = mkEnemy(2, 1066, 1000);
    const b = makeHooks([e2]);
    const m2 = mkMinion(423, b.player, 1022, 814);       // 盒心 (1036,828)→瞄准点 (1066,908):dx=30,dy=80
    m2.fixedUpdate(1, b.hooks);
    expect(m2.vx).toBeCloseTo((30 / Math.hypot(30, 80)) * -3 / 21, 6);
    expect(m2.vy).toBeCloseTo((80 / Math.hypot(30, 80)) * -3 / 21, 6);
  });
  it('375 小鬼反推段：距<150 → 向量×-4 反推远离（:66660-66668）', () => {
    const e = mkEnemy(1, 60 * 16 + 100, 90 * 16);        // 敌在右 100px
    const { hooks, player } = makeHooks([e]);
    const m = mkMinion(375, player, player.cx, e.cy - 8);
    m.fixedUpdate(1, hooks);
    expect(m.vx).toBeCloseTo(-4 / 41, 9);                // 被推离敌（向左）
    // 对照：距>200 → 通用加速段 +6/41
    const e2 = mkEnemy(2, 60 * 16 + 300, 90 * 16);
    const b = makeHooks([e2]);
    const m2 = mkMinion(375, b.player, b.player.cx, e2.cy - 8);
    m2.fixedUpdate(1, b.hooks);
    expect(m2.vx).toBeCloseTo(6 / 41, 9);
  });
  it('归位门分型（:66446-66462）：423 有目标 1200 / 373 1000——距玩家 1100 分型分流', () => {
    // 随从距玩家 1100、敌在玩家另一侧 800（距随从 1910>800 免 423 冲刺门、距玩家
    // 800<2000 入选）：423 门 1200 → 保持交战（ai0=0,加速段 6/41+:67097 微调 →
    // |vx|>15/21 归位档上限）;373 门 1000 → 超门转归位（ai0=1,num32=15）
    const e = mkEnemy(1, 60 * 16 - 800 + 8, 90 * 16);
    const a = makeHooks([e]);
    const m423 = mkMinion(423, a.player, a.player.cx + 1100, e.cy - 8);
    m423.fixedUpdate(1, a.hooks);
    expect(priv(m423).a62A0).toBe(0);
    expect(m423.vx).toBeLessThan(-15 / 21);              // 交战段合成速超归位档上限
    const b = makeHooks([e]);
    const m373 = mkMinion(373, b.player, b.player.cx + 1100, e.cy - 8);
    m373.fixedUpdate(1, b.hooks);
    expect(priv(m373).a62A0).toBe(1);
    expect(Math.abs(m373.vx)).toBeLessThanOrEqual(15 / 21 + 1e-9);   // ai0=1 → num32=15
  });
});

describe('② 地面步行族贴地行走（1457 AI_026 flag7 / AI_067 flag2）', () => {
  it('蜘蛛 390 贴地：落地静止 vy=0/onGround,玩家远移 → 步行追 vx>0 且保持贴地', () => {
    const { hooks, player } = makeHooks();
    player.y = 100 * 16 - 42;                            // 玩家落地（脚贴地表）
    // ★SW-BJ17：出生 y 按真盒 h=30（SetDefaults :4746-4747,旧 16×16 假设退役）——
    //  盒底仍落 100*16 行顶,中腰行 99 不变（centerY=1585 → :63222 基准同档）
    const m = mkMinion(390, player, 60 * 16 - 38, 100 * 16 - 30);  // 跟随锚上（p.cx-30）
    for (let k = 0; k < 5; k++) m.fixedUpdate(1, hooks);
    expect(m.onGround).toBe(true);                       // 贴地（重力 0.4 落地 :65221-65229）
    expect(m.y).toBe(100 * 16 - 30);
    expect(m.vy).toBe(0);
    expect(m.vx).toBe(0);                                // 锚 ±(10+40) 死区内 → 无行走意图
    player.x = 60 * 16 + 200;                            // 玩家右移 200 → flag3 行走
    for (let k = 0; k < 10; k++) m.fixedUpdate(1, hooks);
    expect(m.vx).toBeGreaterThan(0);                     // 0.4/t 加速（:63099-63146）
    expect(m.onGround).toBe(true);                       // 行走中保持贴地
    expect(m.y).toBe(100 * 16 - 30);
  });
  it('蜘蛛遇障跳梯：前方 2 高墙 → 探测命中落地起跳 vy=-7.1（:63208-63244 中腰行基准）', () => {
    const { hooks, player, store } = makeHooks();
    player.x = 60 * 16 + 200;
    player.y = 100 * 16 - 42;
    const m = mkMinion(390, player, 60 * 16 - 38, 100 * 16 - 30);   // ★SW-BJ17 真盒 h=30
    // ★终清波批行基订正：AI_026 探测基准=中腰行（num190=centerY/16,:63222 重锚，
    // 旧实现误用脚下行）。立行 99（中腰=99）：墙占行 98/99 两高 → 前墙单格(99)
    // 检出、梯档 solid(-1)=98✓ 而 solid(-2)=97 空 → 第二档 -7.1（旧底行基算出
    // -9.1 系失真面,随中腰重锚订正）——真盒 30 后 centerY=1585 → 中腰仍 99 行
    for (let y = 98; y <= 99; y++) { store.setTile(63, y, 1); store.setTile(64, y, 1); }
    let vy = 0;
    for (let k = 0; k < 60; k++) {
      m.fixedUpdate(1, hooks);
      if (m.vy < 0) { vy = m.vy; break; }
    }
    expect(vy).toBeCloseTo(-7.1, 6);
  });
  it('蜘蛛墙面爬行：竖列 3 格 ≥2 有墙 → 无重力爬向玩家、rotation 朝运动向（:65092-65175）', () => {
    const { hooks, player, store } = makeHooks();
    const m = mkMinion(390, player, 60 * 16, 90 * 16);
    for (let y = 89; y <= 91; y++) store.setWall(60, y, 1);   // 中心竖列 3 格墙
    m.fixedUpdate(1, hooks);
    expect(m.rot).not.toBe(0);                           // rotation = 运动向 + π/2
    expect(m.vy).toBeLessThanOrEqual(0.9);               // 爬行段不加重力（速度 lerp /10）
  });
  it('吸血蛙 758 贴地跟随：走向跟随锚并驻停（AI_067 :50329-50334/:51348-51410）', () => {
    const { hooks, player } = makeHooks();
    player.y = 100 * 16 - 42;                            // 主落地（防 :51492 高出跳表误触）
    const m = mkMinion(758, player, 60 * 16, 100 * 16 - 16);
    for (let k = 0; k < 5; k++) m.fixedUpdate(1, hooks);
    expect(m.onGround).toBe(true);
    player.x = 60 * 16 + 200;                            // 锚 = p.cx-(35+w/2)×dir
    for (let k = 0; k < 80; k++) m.fixedUpdate(1, hooks);
    const anchor = player.cx - (35 + player.w / 2) * player.facing;
    expect(Math.abs(m.cx - anchor)).toBeLessThan(12);    // 驻停锚 ±5 死区内
    expect(m.onGround).toBe(true);
    expect(priv(m).frA0).toBe(0);                        // 地面态
  });
});

describe('③ 黄蜂 373 射击冷却随机计数器（1457 :66963-66978）', () => {
  it('出手后 ai[1]=1,每拍 +Next(1,4)∈[1,3],>90 归零再出手——周期 ∈[30,90] 且非定值', () => {
    const e = mkEnemy(1, 60 * 16 + 300, 90 * 16);
    const { hooks, player, added } = makeHooks([e]);
    const m = mkMinion(373, player, player.cx, e.cy - 8);
    m.fixedUpdate(1, hooks);
    expect(added.filter((a) => a instanceof Arrow && (a as Arrow).projId === 374).length).toBe(1);
    expect(priv(m).a62A1).toBe(1);                       // 出手 ai[1]++（:67155）
    m.fixedUpdate(1, hooks);
    const after1 = priv(m).a62A1;
    expect(after1).toBeGreaterThanOrEqual(2);            // +1..3
    expect(after1).toBeLessThanOrEqual(4);
    // 逐周期计量：归零（再出手）周期 ∈[30,90]（全 1 → 90 拍、全 3 → 30 拍）
    const cycles: number[] = [];
    let ticks = 0;
    let shots = added.filter((a) => a instanceof Arrow).length;
    for (let k = 0; k < 4000 && cycles.length < 24; k++) {
      m.fixedUpdate(1, hooks);
      ticks++;
      const now = added.filter((a) => a instanceof Arrow).length;
      if (now > shots) { cycles.push(ticks); ticks = 0; shots = now; }
    }
    expect(cycles.length).toBe(24);
    for (const c of cycles) { expect(c).toBeGreaterThanOrEqual(30); expect(c).toBeLessThanOrEqual(90); }
    expect(new Set(cycles).size).toBeGreaterThan(2);     // 随机域（非定值 36）
  });
});

describe('④ 俾格米掷矛 Y 抛物线预瞄（AI_026 :62708-62716）', () => {
  it('水平 400px 目标（≤num151=450 开火阈,BJ516④）：Δy 均值显著 <0（预瞄偏置 ≈-|Δx|×0.1×0.0495≈-2,无预瞄 ≈0）', () => {
    const e = mkEnemy(1, 60 * 16 + 400, 90 * 16);
    const { hooks, player, added } = makeHooks([e]);
    const m = mkMinion(191, player, player.cx, e.cy - 8);
    const ys: number[] = [];
    for (let k = 0; k < 1000; k++) {
      e.cx = m.cx + 400; e.x = e.cx - e.w / 2; e.cy = 90 * 16; e.y = e.cy - e.h / 2;  // 钉回 400px
      (m as unknown as { shootCd: number }).shootCd = 0;                              // 每拍可出手
      m.fixedUpdate(1, hooks);
      const shot = added[added.length - 1];
      if (shot instanceof Arrow && (shot as Arrow).projId === 195) {
        ys.push((shot as Arrow).vy);
      }
    }
    expect(ys.length).toBeGreaterThan(900);
    // num155 = |Δx|×0.1×Next(0,100)×0.001 ∈ [0,3.96]、Δy 均值 ≈-1.98（jitter ±20 均值 0）
    // → 弹速 11 归一后 vy 均值 ≈-1.98×11/400 ≈ -0.054（无预瞄 ≈0 ±0.005）
    const mean = ys.reduce((s, v) => s + v, 0) / ys.length;
    expect(mean).toBeLessThan(-0.03);
    for (const a of added) {                             // num158=11/|v| 归一（:62721-62724）
      if (a instanceof Arrow) expect(Math.hypot(a.vx, a.vy)).toBeCloseTo(11, 6);
    }
  });
});

describe('⑤ AI_062 索敌距门以玩家为基准（1457 :66361-66402;1456 :62416/:62433）', () => {
  /** 场景：玩家右移至 x=1500;随从在玩家右侧 900（leash 内）;敌在玩家左上
   *  (270,540)——距玩家 hypot(1240,921)=1545<2000（玩家基准入选）、距随从
   *  hypot(2140,888)=2317>2000（随从基准落空）→ 两基准判别分野 */
  function scene() {
    const h = makeHooks([mkEnemy(1, 270, 540)]);
    h.player.x = 1500;
    return h;
  }
  it('407：敌距随从 2317（随从基准超 2000）但距玩家 1545 → 仍入选交战（ai0=0）', () => {
    const { hooks, player } = scene();
    const m = mkMinion(407, player, player.cx + 900, 90 * 16 - 12);
    m.fixedUpdate(1, hooks);
    expect(priv(m).a62A0).toBe(0);                       // 玩家基准入选 → 交战
  });
  it('423 同门（leash 1200 内）→ 入选交战', () => {
    const { hooks, player } = scene();
    const m = mkMinion(423, player, player.cx + 900, 90 * 16 - 12);
    m.fixedUpdate(1, hooks);
    expect(priv(m).a62A0).toBe(0);
  });
  it('373 对照组以随从为基准（:66431 base.Center）→ 不入选 → 距玩家 900>500 归位态', () => {
    const { hooks, player } = scene();
    const m = mkMinion(373, player, player.cx + 900, 90 * 16 - 12);
    m.fixedUpdate(1, hooks);
    expect(priv(m).a62A0).toBe(1);
    expect(Math.abs(m.vx)).toBeLessThanOrEqual(15 / 21 + 1e-9);
  });
});

describe('⑥ 致命球 533 双门：扫描 2000 + 触发 800（1457 :30105-30111/:30330-30340/:30632-30640）', () => {
  it('敌 1200px（<2000 扫描入池、>800 触发门）→ 有目标不归位（门 1500）也不冲刺', () => {
    const e = mkEnemy(1, 60 * 16 + 1200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([e]);
    const m = mkMinion(533, player, player.cx + 200, player.cy - 60);
    m.fixedUpdate(1, hooks);
    expect(priv(m).dA0).toBe(0);                         // 未触发冲刺（曾 700 扫描档同值）
    expect(priv(m).dA1).toBe(0);
    // 对照旧档：随从离玩家 1000、无目标（>900）才走归位 dA0+=9——有目标门 1500 不触发
  });
  it('敌 700px（<800 触发门）→ 冲刺 ai[0]=6（:30632-30640 num559=800）', () => {
    const e = mkEnemy(1, 60 * 16 + 700, 90 * 16 - 40);
    const { hooks, player } = makeHooks([e]);
    const m = mkMinion(533, player, player.cx + 200, player.cy - 60);
    m.fixedUpdate(1, hooks);
    expect(priv(m).dA0).toBe(6);
  });
  it('扫描门 2000 判别：随从距玩家 1100、敌距随从 1000 → 有目标门 1500 不归位（旧 700 档 tgt=null→900 门误归位 dA0=9）', () => {
    const e = mkEnemy(1, 60 * 16 + 2100, 90 * 16 - 40);  // 距随从 1000（<2000 入池,>800 不触发）
    const { hooks, player } = makeHooks([e]);
    const m = mkMinion(533, player, player.cx + 1100, player.cy - 60);
    m.fixedUpdate(1, hooks);
    expect(priv(m).dA0).toBe(0);                         // 有目标 → 归位门 1500（1100<1500）
  });
  it('对照（扫描外）：敌距随从 >2000 → 无目标 + 距玩家 1100>900 → 归位态 dA0=9', () => {
    const e = mkEnemy(1, 40, 90 * 16 - 40);              // 距随从 2038 > 2000
    const { hooks, player } = makeHooks([e]);
    const m = mkMinion(533, player, player.cx + 1100, player.cy - 60);
    m.fixedUpdate(1, hooks);
    expect(priv(m).dA0).toBe(9);                         // :28741-28753 dA0 += 3×(3-⌊0/3⌋)
  });
});

describe('⑦ 随从绘制旋转枢 = 贴图宽/2（Main.cs:29601 化简,同 WeaponProj 修法）', () => {
  beforeAll(() => {
    // projFrameImg 走 document.createElement —— 桩出极简 canvas（记录型 ctx）
    const calls: Array<{ m: string; a: unknown[] }> = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const c = { width: 0, height: 0 };
        const inner = new Proxy({}, {
          get: (_t, k) => (k === 'canvas' ? undefined : (...a: unknown[]) => { calls.push({ m: String(k), a }); }),
        });
        return Object.assign(c, { getContext: () => inner });
      },
    });
    setProjSpriteOverride(373, { width: 30, height: 18, complete: true } as unknown as HTMLImageElement);
  });
  it('373（偏移表 [6,-10]）translate x = 盒左 + 贴图宽/2 + num144;drawImage dx = -贴图宽/2', () => {
    const { hooks, player } = makeHooks();
    const m = mkMinion(373, player, 1000, 1400);
    const t: unknown[][] = [];
    const d: unknown[][] = [];
    const ctx = {
      set imageSmoothingEnabled(_: boolean) {},
      get imageSmoothingEnabled() { return false; },
      save() {}, restore() {},
      translate(...a: unknown[]) { t.push(a); },
      rotate() {}, scale() {},
      drawImage(...a: unknown[]) { d.push(a); },
      fillRect() {}, strokeRect() {},
      set fillStyle(_: string) {}, set strokeStyle(_: string) {},
      set globalAlpha(_: number) {},
    } as unknown as CanvasRenderingContext2D;
    m.draw({ ctx } as never);
    // num145 = 30/2 = 15（曾 (30+16)/2=23 → 枢轴右偏 8px 绕偏心点公转）
    expect(t[0][0]).toBeCloseTo(m.cx - m.w / 2 + 15 + (-10), 6);
    expect(d[0][1]).toBeCloseTo(-15, 6);
  });
});

// ---------------------------------------------------------------------------
// ⑧ 423/613 冲刺 extraUpdates 真子步（Update :16780-16783 numUpdates 循环;
//    触发 :66556-66562/:66593-66600;曾"10px/t 摊 ai[1] 拍"折算退役）
// ---------------------------------------------------------------------------
describe('⑧ 423/613 冲刺真子步（:16780-16783/:66556-66600）', () => {
  function dust423() {
    // 随从盒左 (1994,1494)（★真盒 28×28 → 心 2008,1508,与 16×16 缺省盒时代标定
    // 的几何对齐）;敌顶 (2508,1428) → 423 瞄准点 (2508,1348)
    // → num23=√(500²+160²)=524.8 ∈ (300,800] → ai[1]=extraUpdates=52
    const e = mkEnemy(1, 2508, 1440);                    // 顶 = cy-12 = 1428
    const a = makeHooks([e]);
    const dust: number[] = [];
    (a.hooks as unknown as { spawnParticles: unknown }).spawnParticles =
      (...args: unknown[]) => { void args; dust.push(1); };
    const m = mkMinion(423, a.player, 1994, 1494);
    return { a, m, dust, e };
  }
  it('423：触发拍位移恰 10px+extraUpdates=ai[1];次拍 52 子步一次走完（512px）→ 2 拍总位移 10N+2', () => {
    const { a, m, dust } = dust423();
    const nl = Math.hypot(500, 160);
    const nx = 500 / nl, ny = -160 / nl;
    const x0 = m.x, y0 = m.y;
    m.fixedUpdate(1, a.hooks);                           // 触发拍（:66556-66562）
    expect(priv(m).a62A0).toBe(2);
    expect(priv(m).a62A1).toBe(52);                      // ai[1]=(int)(num23/10)
    expect(priv(m).a62EU).toBe(52);                      // extraUpdates=(int)ai[1]（:66559）
    expect(m.x - x0).toBeCloseTo(nx * 10, 6);            // 触发拍位移 = velocity×1 子步
    expect(m.y - y0).toBeCloseTo(ny * 10, 6);
    expect(dust.length).toBe(0);                         // 触发拍 return——冲刺尘块未入（:66158 在次拍起）
    m.fixedUpdate(1, a.hooks);                           // 次拍：52 子步循环（归零子步终止）
    expect(priv(m).a62EU).toBe(0);                       // extraUpdates=0（:66178）=冲刺终结
    expect(priv(m).a62A1).toBeGreaterThanOrEqual(30);    // 归零重置 30（:66174）+归零拍冷却块
    expect(priv(m).a62A1).toBeLessThanOrEqual(32);       //  +1..2（:67017,冲刺拍照走=原版不 return）
    // 总位移 = 触发 10 + 51×10 + 归零拍 2 = 522px（+归零拍后续 AI 微动 ~2px）
    const proj = (m.x - x0) * nx + (m.y - y0) * ny;
    expect(proj).toBeGreaterThan(520);                   // 旧折算 10px/t 两拍仅 20px
    expect(proj).toBeLessThan(528);
    // 冲刺尘：每子步 ai[1]>3 一粒（:66158-66166）→ 递减值 51..4 共 48 粒
    expect(dust.length).toBe(48);
  });
  it('613：同构子步（44 子步）+ 归零拍 15+15 尘爆（:66249-66270）+ 每子步双尘调用（:66198-66226）', () => {
    // 随从心 (2008,1508);敌心 (2508,1508)=正右 500 → 613 瞄准点 = 敌心+背向 60
    // = (2448,1508) → num23=440 → ai[1]=44
    // ★夹具重布（SW-BJ16 真盒）：613 真盒 24×24（:6600-6611）——出生左上移
    // (−4,−4) 使盒心保持在标定的 (2008,1508),ai[1]/尘账断言不变
    const e = mkEnemy(1, 2508, 1508);
    const a = makeHooks([e]);
    const dust: number[] = [];
    (a.hooks as unknown as { spawnParticles: unknown }).spawnParticles =
      (...args: unknown[]) => { void args; dust.push(1); };
    const m = mkMinion(613, a.player, 1996, 1496);
    const x0 = 1996;
    m.fixedUpdate(1, a.hooks);
    expect(priv(m).a62A1).toBe(44);                      // (int)(440/10)
    expect(m.x - x0).toBeCloseTo(10, 6);                 // 触发拍 10px
    m.fixedUpdate(1, a.hooks);
    expect(priv(m).a62EU).toBe(0);                       // 归零重置（:66236）=冲刺终结
    expect(m.x - x0).toBeGreaterThan(440);               // 10+43×10+2=442（+归零拍 AI 微动）
    expect(m.x - x0).toBeLessThan(448);
    // 尘调用：ai[1]>3 子步（递减值 43..4 共 40 拍）——numUpdates≥20 拍只出环 2 调用
    // （25 拍）,<20 拍出 3 粒群+环 3 调用（15 拍,:66199-66226 门）+归零爆 2 = 97
    expect(dust.length).toBe(25 * 2 + 15 * 3 + 2);
  });
  it('rotation 通道（:66827 rotation=vx×0.05 + :66947-66954 spriteDirection）：每拍终速写入、触发/冲刺拍冻结', () => {
    const e = mkEnemy(1, 60 * 16 + 600, 90 * 16 - 40);
    const a = makeHooks([e]);
    const m = mkMinion(423, a.player, a.player.cx, 90 * 16 - 52);
    m.fixedUpdate(1, a.hooks);                           // 600px → 触发冲刺
    expect(priv(m).a62A0).toBe(2);
    expect(m.rot).toBe(0);                               // 触发拍 return 冻结（:66562）
    expect(m.facing).toBe(1);                            // spriteDirection 保持初值
    // 非冲刺对照：407 无冲刺门 → 每拍 rot=终速×0.05（:66827）
    const e2 = mkEnemy(1, 60 * 16 + 600, 90 * 16 - 40);
    const b = makeHooks([e2]);
    const m2 = mkMinion(407, b.player, b.player.cx, 90 * 16 - 52);
    m2.fixedUpdate(1, b.hooks);
    expect(m2.vx).toBeGreaterThan(0);
    expect(m2.rot).toBeCloseTo(m2.vx * 0.05, 9);
    expect(m2.facing).toBe(-1);                          // :66947-66954 右行=-1
  });
  it('渲染 rot+flip 复合（XNA 同 draw 调用,Main.cs:30529-30533）：407 rotate 后 scale(-1,1);387 旋转制恒不翻', () => {
    // 407 走同一 :66827 通道（无 423 射击扇区微调 :67097 后置改速干扰）
    const e = mkEnemy(1, 60 * 16 + 600, 90 * 16 - 40);
    const a = makeHooks([e]);
    const m = mkMinion(407, a.player, a.player.cx, 90 * 16 - 52);
    m.fixedUpdate(1, a.hooks);
    expect(m.vx).toBeGreaterThan(0);
    expect(m.rot).toBeCloseTo(m.vx * 0.05, 9);
    expect(m.facing).toBe(-1);
    const calls: Array<{ op: string; a: unknown[] }> = [];
    const ctx = {
      set imageSmoothingEnabled(_: boolean) {}, get imageSmoothingEnabled() { return false; },
      save() {}, restore() {}, translate() {},
      rotate(...a: unknown[]) { calls.push({ op: 'rotate', a }); },
      scale(...a: unknown[]) { calls.push({ op: 'scale', a }); },
      drawImage() {}, fillRect() {}, strokeRect() {},
      set fillStyle(_: string) {}, set strokeStyle(_: string) {}, set globalAlpha(_: number) {},
    } as unknown as CanvasRenderingContext2D;
    m.draw({ ctx } as never);
    expect(calls[0]).toEqual({ op: 'rotate', a: [m.rot] });
    expect(calls[1]).toEqual({ op: 'scale', a: [-1, 1] });   // facing=-1（右行翻转叠旋转）
    // 旋转制对照（387 ∈ MINION_ROT_ONLY,原版 dir 恒 None）：rotate 后无 scale
    const b = makeHooks([mkEnemy(1, 60 * 16 + 600, 90 * 16 - 40)]);
    const twin = mkMinion(387, b.player, b.player.cx, 90 * 16 - 52);
    twin.fixedUpdate(1, b.hooks);
    calls.length = 0;
    twin.draw({ ctx } as never);
    expect(calls.filter((c) => c.op === 'rotate').length).toBe(1);
    expect(calls.filter((c) => c.op === 'scale').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑨ 蜘蛛/蛙地面 AI 四项清零（tileCollide 动态门 :62843-62860/:50648/:51266;
//    撤退档 :14027-14030+:62958-63012;镜像 :63302-63323/:65162/:51647-51671）
// ---------------------------------------------------------------------------
describe('⑨ 蜘蛛/蛙地面 AI（tileCollide 门/撤退档/镜像）', () => {
  it('蜘蛛 tileCollide 动态门：LOS 目标在下方+脚踩平台 → false 穿平台下落,清空后回 true（:62843-62860）', () => {
    const PLAT = TILE_BY_KEY['platform'];
    const { hooks, player, store } = makeHooks();
    player.x = 60 * 16; player.y = 90 * 16 - 42;         // 主站平台上
    for (let x = 58; x <= 63; x++) store.setTile(x, 90, PLAT);
    const m = mkMinion(390, player, 60 * 16, 90 * 16 - 30);   // ★SW-BJ17 真盒 h=30（盒底同行顶）
    for (let k = 0; k < 8; k++) m.fixedUpdate(1, hooks); // 落台
    expect(m.onGround).toBe(true);
    expect(m.y).toBe(90 * 16 - 30);
    expect(m.tileCollide).toBe(true);                    // 盒无实心 → true（:62843-62845）
    const below = mkEnemy(1, 60 * 16 + 8, 96 * 16);      // 平台下 6 格 LOS 目标
    const b = makeHooks([below]);
    (b.hooks as unknown as { world: { store: TileStore } }).world.store = store;
    b.player.x = 60 * 16; b.player.y = 90 * 16 - 42;
    const m2 = mkMinion(390, b.player, 60 * 16, 90 * 16 - 30);
    for (let k = 0; k < 8; k++) m2.fixedUpdate(1, b.hooks);
    expect(priv(m2).spLai1).toBe(0);
    expect(m2.tileCollide).toBe(false);                  // 敌在下方+脚踩平台（:62852-62860）
    for (let k = 0; k < 60 && m2.y + m2.h < 90 * 16 + 20; k++) m2.fixedUpdate(1, b.hooks);
    expect(m2.y + m2.h).toBeGreaterThan(90 * 16 + 16);   // 已整体穿过平台行
    expect(m2.tileCollide).toBe(true);                   // 脚下行离开平台 → 回 true（:62843）
  });
  it('蛙 tileCollide：归位飞行 false（:50648）/ 地面 true（:51266）——moveAndCollide 跳碰撞直写位移', () => {
    const { hooks, player } = makeHooks();
    player.y = 100 * 16 - 42;
    const m = mkMinion(758, player, player.cx + 200, 90 * 16);
    expect(m.tileCollide).toBe(true);
    (priv(m) as { frA0: number }).frA0 = 1;              // 归位飞行态
    m.fixedUpdate(1, hooks);
    expect(m.tileCollide).toBe(false);
  });
  it('蜘蛛撤退档：命中置 localAI[1]=20（StatusNPC :14027-14030）→ 20t 不咬（friendly=false :63004）后复咬', () => {
    const e = mkEnemy(1, 60 * 16 + 8, 100 * 16 - 20);    // 与随从盒重叠（扑咬窗）
    const { hooks, player } = makeHooks([e]);
    player.y = 100 * 16 - 42;
    const m = mkMinion(390, player, 60 * 16, 100 * 16 - 16);
    const hp0 = e.hp;
    // ★BJ704-G9（R1-P2②）夹具重产（G1 758 oracle 判例）：步行支接触冷却已归一
    //  idStatic 15 共享桶（绝对到期,GTW 钟）——夹具须逐拍推进钉钟（旧模型=冻结钟
    //  下私表倒数桶时代旧世界,不推进则 15t 永不到期=复咬永拒伪红）。
    let tick = 0;
    pinGameTimeTicks(tick++);
    m.fixedUpdate(1, hooks);
    expect(e.hp).toBeLessThan(hp0);                      // 首咬（bucket 390 写 0+15）
    expect(priv(m).spLai1).toBe(20);                     // localAI[1]=20（:14027-14030）
    let bitten = 0;
    for (let k = 0; k < 20; k++) {                       // 撤退 20t：hp 冻结（friendly=false）
      const before = e.hp;
      pinGameTimeTicks(tick++);
      m.fixedUpdate(1, hooks);
      if (e.hp < before) bitten++;
      expect(priv(m).spLai1).toBeGreaterThanOrEqual(0);
    }
    expect(bitten).toBe(0);
    expect(priv(m).spLai1).toBe(0);
    let resumed = false;
    for (let k = 0; k < 80 && !resumed; k++) {           // 撤退结束（21t>15t 窗）→ 复咬
      const before = e.hp;
      pinGameTimeTicks(tick++);
      m.fixedUpdate(1, hooks);
      if (e.hp < before) resumed = true;
    }
    expect(resumed).toBe(true);                          // idStatic 15 到期（旧私表 20 档退役）
  });
  it('蜘蛛镜像：direction=sign(vx)+行走精化 → spriteDirection=-direction（:63302-63323/:65162）——右行 facing=-1', () => {
    const { hooks, player } = makeHooks();
    player.y = 100 * 16 - 42;
    player.x = 60 * 16 + 200;                            // 玩家右移 → 行走意图向右
    const m = mkMinion(390, player, 60 * 16 - 38, 100 * 16 - 16);
    for (let k = 0; k < 12; k++) m.fixedUpdate(1, hooks);
    expect(m.vx).toBeGreaterThan(0.4);                   // |vx|>num184=0.4
    expect(priv(m).spDir).toBe(1);                       // direction=+1（:63310-63313）
    expect(m.facing).toBe(-1);                           // spriteDirection=-direction（:65162）
    player.x = 60 * 16 - 300;                            // 反向
    for (let k = 0; k < 30; k++) m.fixedUpdate(1, hooks);
    expect(priv(m).spDir).toBe(-1);
    expect(m.facing).toBe(1);
  });
  it('蛙镜像：direction=sign(vx)/静止朝玩家/意图精化 → spriteDirection=+direction（:51647-51671）', () => {
    const { hooks, player } = makeHooks();
    player.y = 100 * 16 - 42;
    player.x = 60 * 16 + 200;
    const m = mkMinion(758, player, 60 * 16, 100 * 16 - 16);
    for (let k = 0; k < 12; k++) m.fixedUpdate(1, hooks);
    expect(m.facing).toBe(1);                            // +direction（蛙贴图朝右）
    player.x = 60 * 16 - 300;
    for (let k = 0; k < 30; k++) m.fixedUpdate(1, hooks);
    expect(m.facing).toBe(-1);
    // 静止朝玩家（:51655-51657）：锚达停驻 vx=0 → 朝玩家侧
    player.x = 60 * 16 + 500;
    for (let k = 0; k < 200; k++) m.fixedUpdate(1, hooks);
    expect(m.vx).toBe(0);
    expect(m.facing).toBe(player.cx > m.cx ? 1 : -1);
  });
});

// ---------------------------------------------------------------------------
// ⑩ 龙延伸槽位（:6737-6739 每段 0.5;超限自裁 :16812-16845 摘链;
//    驱逐池尾邻对 :52404-52426）
// ---------------------------------------------------------------------------
describe('⑩ 龙延伸槽位（:6737-6739/:16812-16845/:52404-52426）', () => {
  function dragonScene() {
    const { hooks, player, projectiles } = makeHooks();
    const head = mkMinion(625, player);
    head.noSlot = false;
    projectiles.push(head);
    head.fixedUpdate(1, hooks);                          // 首拍派生基础链 626/627/628
    return { hooks, player, projectiles, head };
  }
  it('extendDragon：延伸段 626/627 noSlot=false（0.5 槽/段 :6737-6739）,链插入尾前', () => {
    const { hooks, projectiles, head } = dragonScene();
    expect(head.extendDragon(hooks)).toBe(true);
    const segs = projectiles.filter((p): p is MinionProj => p instanceof MinionProj)
      .map((p) => ({ id: p.projId, noSlot: p.noSlot, dead: p.dead }));
    expect(segs.filter((s) => !s.noSlot && !s.dead).map((s) => s.id).sort())
      .toEqual([625, 626, 627]);                         // 延伸对实账
    const tail = projectiles.find((p) => p instanceof MinionProj && (p as MinionProj).projId === 628) as MinionProj;
    expect(tail.parentRef?.()?.projId).toBe(627);        // 尾接延伸段 b
  });
  it('驱逐：超限先逐普通随从;龙身段只逐「尾邻 627+其前驱 626」且摘链不断链（:52404-52452）', () => {
    const { hooks, projectiles, head } = dragonScene();
    head.extendDragon(hooks);
    const other = mkMinion(375, hooks.player);
    projectiles.push(other);
    // 池（noSlot 不入账）：625=1、延伸对=1、375=1 → used=3;max=2 → 须腾 1
    const pool = (projectiles as MinionProj[]).filter((m) => !m.sentry);
    freeUpMinionsForSummon(191, pool, 2);
    expect(other.dead).toBe(true);                       // 1 槽普通随从先逐
    const ext = (id: number) => projectiles.find((p) => p instanceof MinionProj
      && (p as MinionProj).projId === id && !(p as MinionProj).noSlot) as MinionProj;
    const base = (id: number) => projectiles.find((p) => p instanceof MinionProj
      && (p as MinionProj).projId === id && (p as MinionProj).noSlot) as MinionProj;
    const tail = projectiles.find((p) => p instanceof MinionProj && (p as MinionProj).projId === 628) as MinionProj;
    expect(head.dead).toBe(false);                       // 龙头豁免（:52434）
    expect(tail.dead).toBe(false);                       // 尾豁免 + 摘链存活
    expect(ext(627).dead).toBe(true);                    // 尾邻 627 逐
    expect(ext(626).dead).toBe(true);                    // 前驱 626 随对逐
    expect(tail.parentRef?.()).toBe(base(627));          // 摘链后尾接回基础链段 627（链未断）
    expect(base(627).dead).toBe(false);
    expect(base(626).dead).toBe(false);
  });
});
