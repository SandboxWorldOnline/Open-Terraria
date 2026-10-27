// 发射器弹药族对账（2026-08-14；Player.cs PickAmmo :52635-52668 + AI_016 发射支
// :44542-44911 + 撞块响应 :18339-18371 + Kill 地形闸门 :75260-75300）：
//   · 弹型解析：Specific 匹配表（5 发射器×12 弹药）> 雪人/MK2 算式 > 火箭族
//     【加法】（发射器 shoot + 弹药 shoot——非替换！一型 0→基弹/二型 +3/三型 +6/四型 +9）
//   · GrenadeProj fired 模式：火箭加速 ×1.1/雪人追踪 lerp 1/12/发射榴弹 15u 后
//     重力+摩擦/感应雷恒重力+减速布防；撞块语义表（火箭贴墙 vel0+3t 爆、榴弹反弹 ×−0.4）
import { describe, it, expect, vi } from 'vitest';   // ★BJ731:vi=DV 恒等档 mock
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import { GrenadeProj } from '../src/entities/WeaponProj';
import { resolveAmmoProjId, SPECIFIC_LAUNCHER_AMMO } from '../src/data/vanillaItemCombat';
import { Game } from '../src/core/Game';

function makeGame(w: World, list: unknown[] = []): GameHooks {
  return {
    world: w, player: null as unknown, enemies: () => list, critters: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
  } as unknown as GameHooks;
}

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

describe('PickAmmo 弹型解析（resolveAmmoProjId）', () => {
  it('火箭发射器 759：一型 0→基弹 134，二/三/四型偏移 137/140/143', () => {
    expect(resolveAmmoProjId(759, 771, 771, 134, 0)).toBe(134);
    expect(resolveAmmoProjId(759, 772, 771, 134, 3)).toBe(137);
    expect(resolveAmmoProjId(759, 773, 771, 134, 6)).toBe(140);
    expect(resolveAmmoProjId(759, 774, 771, 134, 9)).toBe(143);
  });

  it('Specific 表覆盖 5 发射器 × 12 弹药（集束/干/迷你核弹直查表）', () => {
    expect(resolveAmmoProjId(758, 4445, 771, 133, 0)).toBe(777);   // 榴弹发射器+集束一型
    expect(resolveAmmoProjId(760, 4457, 771, 135, 0)).toBe(795);   // 感应雷+迷你核弹一型
    expect(resolveAmmoProjId(1946, 4459, 771, 338, 0)).toBe(810);  // 雪人炮+干火箭
    expect(resolveAmmoProjId(3930, 772, 771, 714, 3)).toBe(716);   // MK2+二型
    expect(SPECIFIC_LAUNCHER_AMMO[759]).toBeDefined();
    expect(Object.keys(SPECIFIC_LAUNCHER_AMMO).length).toBe(5);
  });

  it('加法语义（非替换）：非表发射器（喜庆 3546）+ 二型 = 134+3=137', () => {
    expect(resolveAmmoProjId(3546, 772, 771, 134, 3)).toBe(137);
    expect(resolveAmmoProjId(3546, 771, 771, 134, 0)).toBe(134);   // 一型 shoot=0 → 基弹（此前 =0 隐形弹）
  });

  it('箭/镖族照旧替换语义（弹药 shoot 覆写）', () => {
    expect(resolveAmmoProjId(1, 51, 40, 1, 51)).toBe(51);
    expect(resolveAmmoProjId(0, 999, 97, 14, 88)).toBe(88);
  });
});

describe('GrenadeProj fired 模式（AI_016 发射支）', () => {
  it('火箭 134：无重力直线 + 飞行加速 ×1.1', () => {
    const game = makeGame(emptyWorld());
    const booms: Array<[number, number, number]> = [];
    const r = new GrenadeProj(10 * TILE, 40 * TILE, 10, 0, 100, 3600, 134,
      (x, y, d) => { booms.push([x, y, d]); });
    r.fired = true;
    const sp0 = Math.hypot(r.vx, r.vy);
    for (let t = 0; t < 10 && !r.dead; t++) r.fixedUpdate(1, game);
    expect(r.dead).toBe(false);
    expect(r.vy).toBe(0);                                    // 火箭族无重力（:44850 分支）
    // 加速 ×1.1 直到任一轴 ≥15 停（:44738-44741 门）——10 起步 5 次后 16.105 封顶
    expect(Math.hypot(r.vx, r.vy)).toBeCloseTo(sp0 * Math.pow(1.1, 5), 4);
  });

  it('火箭撞墙 → 贴墙 vel=0 + 3t 后爆（:18365-18370）', () => {
    const w = emptyWorld();
    for (let y = 30; y < 60; y++) w.store.setTileSilent(30, y, 1, 0, 0);   // 前方墙
    const game = makeGame(w);
    const booms: Array<[number, number, number]> = [];
    const r = new GrenadeProj(28 * TILE, 40 * TILE, 6, 0, 100, 3600, 134,
      (x, y, d) => { booms.push([x, y, d]); });
    r.fired = true;
    let guard = 0;
    while (!r.dead && guard++ < 200) r.fixedUpdate(1, game);
    expect(booms.length).toBe(1);                            // 撞墙引爆
  });

  it('发射榴弹 133：15u 平飞后重力下坠 + 落地摩擦（:44870-44879）', () => {
    const game = makeGame(emptyWorld());
    const g = new GrenadeProj(10 * TILE, 40 * TILE, 8, 0, 100, 3600, 133, () => {});
    g.fired = true;
    for (let t = 0; t < 15; t++) g.fixedUpdate(1, game);
    expect(g.vy).toBe(0);                                    // ai0 1..15 无重力
    g.fixedUpdate(1, game);                                  // ai0=16 > 15
    expect(g.vy).toBeGreaterThan(0);                         // vy += 0.2
  });

  it('雪人火箭 338：ai0>30 后追踪转向敌（lerp 1/12）', () => {
    const list: unknown[] = [];
    const game = makeGame(emptyWorld(), list);
    list.push({ id: 1, x: 30 * TILE, y: 44 * TILE, w: 24, h: 24, cx: 30 * TILE + 12, cy: 44 * TILE + 12, dead: false, hurt: () => true });
    const s = new GrenadeProj(10 * TILE, 40 * TILE, 10, 2, 100, 3600, 338, () => {});
    s.fired = true;
    for (let t = 0; t < 30; t++) s.fixedUpdate(1, game);
    expect(s.vy).toBeCloseTo(2, 6);                          // ai0≤30 未追踪，vy 不变
    for (let t = 0; t < 30 && !s.dead; t++) s.fixedUpdate(1, game);
    expect(s.vy).toBeGreaterThan(2);                         // 已向敌（下方）转向
  });

  it('感应雷 135：恒重力 + v×0.97 减速 → 布防半隐', () => {
    const game = makeGame(emptyWorld());
    const m = new GrenadeProj(10 * TILE, 40 * TILE, 4, 0, 100, 3600, 135, () => {});
    m.fired = true;
    m.fixedUpdate(1, game);
    expect(m.vy).toBeGreaterThan(0);                         // 恒重力（:44857-44859）
    expect(m.vx).toBeCloseTo(4 * 0.97, 6);                   // 减速 ×0.97
    let guard = 0;
    while (!(Math.abs(m.vx) < 0.2 && Math.abs(m.vy) < 0.2) && guard++ < 600 && !m.dead) {
      m.fixedUpdate(1, game);
    }
    expect(m.dead || (Math.abs(m.vx) < 0.2 && Math.abs(m.vy) < 0.2)).toBe(true);
  });

  it('接触引爆：碰敌 → timeLeft 钳 3 → 爆（Damage :12330-12340）', () => {
    const list: unknown[] = [];
    const game = makeGame(emptyWorld(), list);
    list.push({ id: 1, x: 12 * TILE, y: 40 * TILE, w: 24, h: 24, cx: 12 * TILE + 12, cy: 40 * TILE + 12, dead: false, hurt: () => true });
    const booms: Array<[number, number, number]> = [];
    const r = new GrenadeProj(10 * TILE, 40 * TILE, 8, 0, 100, 3600, 134,
      (x, y, d) => { booms.push([x, y, d]); });
    r.fired = true;
    let guard = 0;
    while (!r.dead && guard++ < 100) r.fixedUpdate(1, game);
    expect(booms.length).toBe(1);
    expect(booms[0][2]).toBe(100);
  });

  it('液体火箭入液即爆（:44267 wet → timeLeft=1）', () => {
    const w = emptyWorld();
    // 前方水格（x 14-16，y 40-44，水量满格）
    for (let x = 14; x <= 16; x++) {
      for (let y = 40; y <= 44; y++) {
        w.store.setTileSilent(x, y, 0, 0, 0);
        w.store.liquid[w.store.idx(x, y)] = 255;
      }
    }
    const game = makeGame(w);
    const booms: Array<[number, number, number]> = [];
    const wet = new GrenadeProj(11 * TILE, 41 * TILE, 6, 0, 100, 3600, 784,   // 湿火箭（759+4447）
      (x, y, d) => { booms.push([x, y, d]); });
    wet.fired = true;
    let guard = 0;
    while (!wet.dead && guard++ < 60) wet.fixedUpdate(1, game);
    expect(booms.length).toBe(1);                            // 入水次帧爆
  });
});

describe('液体火箭载荷表（Kill :74051-74244 四分发）', () => {
  it('BOMB_PAYLOAD 覆盖湿/熔岩/蜂蜜/干 × 四发射器弹体', () => {
    expect(Game.BOMB_PAYLOAD[784]).toEqual({ kind: 'water', radius: 3 });   // 759+湿火箭
    expect(Game.BOMB_PAYLOAD[787]).toEqual({ kind: 'lava', radius: 3 });    // 759+熔岩火箭
    expect(Game.BOMB_PAYLOAD[790]).toEqual({ kind: 'honey', radius: 3 });   // 759+蜂蜜火箭
    expect(Game.BOMB_PAYLOAD[799]).toEqual({ kind: 'dry', radius: 3.5 });   // 759+干火箭
    expect(Game.BOMB_PAYLOAD[805]).toEqual({ kind: 'water', radius: 3 });   // 雪人炮+湿火箭
    expect(Game.BOMB_PAYLOAD[810]).toEqual({ kind: 'dry', radius: 3.5 });   // 雪人炮+干火箭
    // 四族齐全（每族 4 弹体）
    for (const k of ['water', 'lava', 'honey', 'dry'] as const) {
      expect(Object.values(Game.BOMB_PAYLOAD).filter((p) => p.kind === k).length)
        .toBeGreaterThanOrEqual(4);
    }
  });
});

describe('GrenadeProj 接触引爆（Damage_PVE_Inner aiStyle16 :12330-12340）', () => {
  it('碰 NPC → 立即结算接触伤害 + 钳 fuse=3（曾只钳引信不结算=穿体后才爆）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const hurts: Array<{ d: number; kx: number; pen: number; crit: boolean }> = [];
    const nums: number[] = [];
    const dummy = {
      x: 30 * TILE, y: 40 * TILE - 40, w: 18, h: 40, dead: false,
      hurt(d: number, kx: number, _ky: number, _g: unknown, pen: number, crit: boolean) {
        hurts.push({ d, kx, pen, crit });
        return false;
      },
    };
    (game as unknown as { enemies: () => unknown[] }).enemies = () => [dummy];
    const origNum = game.addDamageNumber;
    (game as unknown as { addDamageNumber: unknown }).addDamageNumber = (x: number, y: number, n: number) => { nums.push(n); };
    const booms: Array<[number, number, number]> = [];
    const r = new GrenadeProj(26 * TILE, 40 * TILE - 20, 10, 0, 100, 3600, 134,
      (x, y, d) => { booms.push([x, y, d]); });
    r.contactPen = 7;
    r.contactKb = 5.5;
    // ★BJ489 def-3：critChance=路由门非掷率（旧 `critChance=1 必暴` 采样杠杆退役）——
    // 必暴改由 owner 聚合承载（rollVanillaHitCrit 阈值 0.04+agg/100,134 ranged 旗）
    (game as unknown as { player: unknown }).player = {
      critChance: () => 100, inv: { heldItem: () => null },
    };
    r.fired = true;
    // 飞向目标:10px/t,起点 26*16=416 → 目标左缘 480:~6t 接触
    let guard = 0;
    // ★BJ731 改判史（2026-10-27）：接触结算走 Damage_PVE_Inner :12970 DV 掷
    //   （BJ723-B W01 落地面）——0.5 恒等档钉 100（未 mock 必漂 85-115）。
    //   crit 掷 0.5<0.04+100/100 恒真,不受影响。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      while (hurts.length === 0 && guard++ < 100) r.fixedUpdate(1, game);
    } finally { rvi731.mockRestore(); }
    expect(hurts.length).toBe(1);                              // 接触即结算(曾=0)
    expect(hurts[0].d).toBe(100);                              // 弹体伤害
    expect(hurts[0].pen).toBe(7);                              // 发射侧穿甲
    expect(hurts[0].crit).toBe(true);                          // 暴击率注入
    expect(hurts[0].kx).toBeGreaterThanOrEqual(0);             // 火箭从左来 → 击退向右(正)
    expect(r.fuse).toBe(3);                                    // 引信钳 3(:12331-12332)——SW-L1 I-2 接触段移至爆点判后(原版 Damage :17184 晚于 AI Kill 判同构)→钳值 3 保持,次拍 --fuse→2≤2 爆(爆拍等价)
    // 飘值=真 Enemy.hurt 单点（mock hurt 绕过;浏览器计数探针 _dummy-numcount-probe=1 份）
    // 3t 后爆炸仍发生(溅射其他目标)
    const t0 = guard;
    while (!r.dead && guard++ < t0 + 10) r.fixedUpdate(1, game);
    expect(booms.length).toBe(1);
    (game as unknown as { addDamageNumber: unknown }).addDamageNumber = origNum;
  });

  it('未接触不结算、不钳引信（擦过继续飞）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const dummy = { x: 60 * TILE, y: 40 * TILE - 40, w: 18, h: 40, dead: false, hurt: () => true };
    (game as unknown as { enemies: () => unknown[] }).enemies = () => [dummy];
    const r = new GrenadeProj(10 * TILE, 40 * TILE - 20, 10, 0, 100, 3600, 134, () => {});
    r.fired = true;
    for (let t = 0; t < 20 && !r.dead; t++) r.fixedUpdate(1, game);
    expect(r.dead).toBe(false);
    expect(r.fuse).toBe(3600 - 20);                            // 引信未被钳
  });
});

describe('GrenadeProj 出生重叠实心格（像素方块夹缝,2026-08-23 用户报）', () => {
  it('夹缝出生朝空档方向发射 → 正常飞出（Y 检查不得采样旧 x 右缘）', () => {
    const w = emptyWorld();
    // 夹缝:出生盒右缘跨入右侧实心 (21,40)/(21,39),左向为开阔地
    w.store.setTileSilent(21, 40, 1, 0, 0);
    w.store.setTileSilent(21, 39, 1, 0, 0);
    const game = makeGame(w);
    const booms: Array<[number, number, number]> = [];
    // 出生在玩家中心 (20.5*16=328? 用格 20 中部),弹盒 14 宽 → 右缘跨入 (21,40)
    const r = new GrenadeProj(20 * TILE + 10, 40 * TILE + 2, -10, 0, 100, 3600, 134,
      (x, y, d) => { booms.push([x, y, d]); });
    r.fired = true;
    for (let t = 0; t < 12 && !r.dead; t++) r.fixedUpdate(1, game);
    expect(r.dead).toBe(false);                      // 未引爆
    expect(r.fuse).toBe(3600 - 12);                  // 引信未被钳(曾=贴墙 3t 原地爆)
    expect(booms.length).toBe(0);
    expect(r.x).toBeLessThan(20 * TILE);             // 已向左飞出夹缝
  });

  it('朝实心方向发射 → 贴墙 3t 爆（原版 :18365-18370 velocity×0+timeLeft=3）', () => {
    const w = emptyWorld();
    w.store.setTileSilent(22, 40, 1, 0, 0);
    const game = makeGame(w);
    const booms: Array<[number, number, number]> = [];
    const r = new GrenadeProj(20 * TILE + 10, 40 * TILE + 2, 10, 0, 100, 3600, 134,
      (x, y, d) => { booms.push([x, y, d]); });
    r.fired = true;
    let guard = 0;
    while (!r.dead && guard++ < 200) r.fixedUpdate(1, game);
    expect(booms.length).toBe(1);                    // 撞墙贴墙引爆
  });
});
