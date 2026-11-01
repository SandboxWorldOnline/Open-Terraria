// 磁球（Magnet Sphere 1266）激光链行为锁（★BJ345 2026-09-25 用户实报"弹幕不发射
// 激光"批）。根因定谳：1266 原走 magic 通用尾支 = 254 落 Arrow 直飞弹，AI_047
// 悬停/去重/索敌/发弹整缺 + 激光弹 255 从未生成——三级链（球→弹→死亡铺束 d160）
// 全断。本文件五面：
//   ①SetDefaults 数据面金标（254/255/260 逐字段 + item 1266/1295 战斗表 + 帧表/贴图）
//   ②球 254 行为（漂移阻尼门/撞墙全弹返/同型去重/发弹门=300px 曼哈顿+CanHitPoint
//     +每 9 flag-tick 1 发+timeLeft<30 停发/发弹参数=球心+v×4、归一×6、伤透传）
//   ③弹 255 行为（隐形本体/逐子步=每拍 100 子步/单 tick 寿命 600px 射程/死亡拍铺束
//     /锚点=第 4 子步末位/命中 pierce=1 单发）
//   ④同族收编 260（Inferno Fork 1295：delay 3/life 200/HeatRay 57 档）
//   ⑤Game 分派面源码锚（1266→MagnetSphereProj、1295→BeamBoltProj、net 拦截面）
// 反编译锚（Terarria1457 行号）：SetDefaults :3371-3389 / AI_047 :42145-42243 /
// aiStyle48 派发 :28608-28639 / Kill 铺束 :71825-71859 / 子步循环 :16781-17345 /
// 弹跳档 :18640-18648 / GetAlpha :81277-81287 / projFrames Main.cs:8715。
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { TileStore } from '../src/world/TileStore';
import { damageVarRoll } from '../src/stats/DamageVar';   // ★G37-A：DV 域锁（bj735a 判例形）
import { MagnetSphereProj, BeamBoltProj, MAGNET_SPHERE_BALL, MAGNET_SPHERE_BOLT, HEAT_RAY_BOLT }
  from '../src/entities/MagnetSphereProj';
import type { GameHooks } from '../src/entities/types';

const projJson = readFileSync(new URL('../src/data/vanilla-projectiles.json', import.meta.url), 'utf8');
const framesJson = readFileSync(new URL('../src/data/vanilla-projframes.json', import.meta.url), 'utf8');
const itemJson = readFileSync(new URL('../src/data/vanilla-itemcombat.json', import.meta.url), 'utf8');
const gameSrc = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');

/** PNG IHDR 尺寸（字节 16-24 大端宽高） */
function pngSize(rel: string): { w: number; h: number } {
  const buf = readFileSync(new URL(rel, import.meta.url));
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ==================== 测试夹具 ====================

interface Rec {
  broadcast: Array<{ type: number; x: number; y: number; mx: number; my: number; info: number }>;
  dusts: Array<{ type: number; x: number; y: number }>;
  bolts: unknown[];
  hurts: Array<{ dmg: number; kbx: number; armorPen: number; crit: boolean; pierce: number; fromPlayer: boolean }>;
}

interface FakeEnemy {
  dead: boolean;
  x: number; y: number; w: number; h: number;
  maxHp: number;
  def: { hp: number; friendly: boolean };
  vanillaId: number;
  hurt: ReturnType<typeof vi.fn>;
}

function mkEnemy(cx: number, cy: number): FakeEnemy {
  return {
    dead: false,
    x: cx - 10, y: cy - 20, w: 20, h: 40,      // 原版典型怪盒
    maxHp: 100, def: { hp: 100, friendly: false }, vanillaId: -1,
    hurt: vi.fn(),
  };
}

/** 全空 TileStore（LOS 恒通）+ 记录桩 */
function mkGame(enemies: FakeEnemy[] = [], store?: TileStore): GameHooks & { rec: Rec; store: TileStore } {
  const st = store ?? new TileStore(400, 400);
  const rec: Rec = { broadcast: [], dusts: [], bolts: [], hurts: [] };
  const g = {
    world: { store: st },
    player: { dead: false, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 20, h: 42 },
    enemies: () => enemies,
    critters: () => [],
    projectiles: () => [],
    spawnDust: (x: number, y: number, _w: number, _h: number, type: number) => {
      rec.dusts.push({ type, x, y });
      return { x, y, vx: 0, vy: 0 };
    },
    broadcastParticleOrchestra: (type: number, x: number, y: number, mx = 0, my = 0, info = 0) => {
      rec.broadcast.push({ type, x, y, mx, my, info });
    },
    spawnFriendlyProj: (e: unknown) => { rec.bolts.push(e); },
  } as unknown as GameHooks & { rec: Rec; store: TileStore };
  (g as unknown as { rec: Rec }).rec = rec;
  return g;
}

/** 造实心墙（1 格厚竖墙 @tx,ty..ty+len） */
function buildWall(st: TileStore, tx: number, ty: number, len: number): void {
  for (let y = ty; y < ty + len; y++) {
    st.type[st.idx(tx, y)] = 1;    // dirt stone（SOLID_LUT 实心）
    st.flags[st.idx(tx, y)] = 1;   // active 位
  }
}

// ==================== ① SetDefaults 数据面金标 ====================

describe('①SetDefaults 金标：254 球 / 255 激光弹 / 260 炼狱叉弹（P.cs:3371-3389 档）', () => {
  it('球 254：aiStyle47/38×38/timeLeft900/magic——★无 friendly 行=本体零接触伤', () => {
    const d = JSON.parse(projJson)['254'];
    expect(d).toMatchObject({ aiStyle: 47, width: 38, height: 38, timeLeft: 900, magic: true });
    expect(d.friendly).toBeUndefined();          // :3371-3379 无 friendly 行
    expect(d.extraUpdates).toBeUndefined();      // 逐 tick 一次 AI
  });

  it('弹 255：aiStyle48/8×8/friendly/extraUpdates=100/timeLeft100（:3380-3389）', () => {
    const d = JSON.parse(projJson)['255'];
    expect(d).toMatchObject({ aiStyle: 48, width: 8, height: 8, friendly: true, magic: true, extraUpdates: 100, timeLeft: 100 });
  });

  it('弹 260：aiStyle48/penetrate1/timeLeft200/extraUpdates=100（Inferno Fork 同族）', () => {
    const d = JSON.parse(projJson)['260'];
    expect(d).toMatchObject({ aiStyle: 48, width: 8, height: 8, friendly: true, extraUpdates: 100, timeLeft: 200, penetrate: 1 });
  });

  it('帧表 projFrames[254]=5（Main.cs:8715）+ 贴图 38×220（5×44 竖条,IHDR 直读）', () => {
    expect(JSON.parse(framesJson)['254']).toBe(5);
    const p = pngSize('../public/sprites/vanilla/Projectile_254.png');
    expect([p.w, p.h]).toEqual([38, 220]);
  });

  it('item 1266 磁球战斗表（I.cs:15724-15738）：shoot 254/shootSpeed 1.2/mana 14/伤 48', () => {
    const it1266 = JSON.parse(itemJson)['1266'];
    expect(it1266).toMatchObject({ shoot: 254, shootSpeed: 1.2, mana: 14, damage: 48, knockBack: 6, magic: true });
  });

  it('item 1295 炼狱叉战斗表（I.cs:16007-16023）：shoot 260/shootSpeed 15/伤 90', () => {
    const it1295 = JSON.parse(itemJson)['1295'];
    expect(it1295).toMatchObject({ shoot: 260, shootSpeed: 15, damage: 90, knockBack: 3, magic: true });
  });
});

// ==================== ② 球 254 行为 ====================

describe('②球 254：漂移/反弹/去重（AI_047 :42145-42186）', () => {
  it('速度 ≤2 不阻尼（:42169-42172 门）——shootSpeed 1.2 恒速漂移', () => {
    const g = mkGame();
    const b = new MagnetSphereProj(2000, 2000, 1.2, 0, 48, 6);
    b.fixedUpdate(1 / 60, g);
    b.fixedUpdate(1 / 60, g);
    expect(b.vx).toBeCloseTo(1.2, 5);
  });

  it('速度 >2 → 每拍 ×0.98（:42169-42172）', () => {
    const g = mkGame();
    const b = new MagnetSphereProj(2000, 2000, 10, 0, 48, 6);
    b.fixedUpdate(1 / 60, g);
    expect(b.vx).toBeCloseTo(9.8, 5);
  });

  it('撞墙全速反转 ×-1 无阻尼（HandleMovement 弹性档 :18640-18648）——永不撞亡', () => {
    const st = new TileStore(400, 400);
    buildWall(st, 140, 100, 60);               // 墙 @x=140..141 格,球从左侧漂来
    const g = mkGame([], st);
    const b = new MagnetSphereProj(140 * 16 - 40, 130 * 16, 1.2, 0, 48, 6);
    for (let t = 0; t < 60 && b.vx > 0; t++) b.fixedUpdate(1 / 60, g);
    expect(b.vx).toBeLessThan(0);              // 反转
    expect(b.vx).toBeCloseTo(-1.2, 5);         // 全速（无阻尼系数）
    expect(b.dead).toBe(false);                // 永不撞亡
  });

  it('同主同型去重（:42168-42176）：我 life 900 > 旧球 800 → 旧球 life=30 衰退', () => {
    const old = new MagnetSphereProj(2000, 2000, 0, 0, 48, 6);
    old.life = 800;
    const g = mkGame();
    (g as unknown as { rec: Rec }).rec = (g as unknown as { rec: Rec }).rec;
    // 第二球入桶,去重扫描读 projectiles()
    const projectiles: unknown[] = [old];
    (g as unknown as { projectiles: () => unknown[] }).projectiles = () => projectiles;
    const fresh = new MagnetSphereProj(2200, 2000, 0, 0, 48, 6);
    projectiles.push(fresh);
    fresh.fixedUpdate(1 / 60, g);
    expect(old.life).toBe(30);
    expect(fresh.life).toBe(899);              // 自身不误伤（-1 是本拍寿命消耗）
  });
});

describe('②球 254：发弹门与激光生成（AI_047_MagnetSphere_TryAttacking :42188-42243）', () => {
  it('300px 内可视怪：每 9 个 flag-tick 恰发 1 弹（localAI[0]>8 门）', () => {
    const e = mkEnemy(2100, 2000);             // 球心 (2000,2000) 距离 100 < 300
    const g = mkGame([e]);
    const b = new MagnetSphereProj(2000, 2000, 0, 0, 48, 6);
    for (let t = 0; t < 9; t++) b.fixedUpdate(1 / 60, g);
    expect(g.rec.bolts.length).toBe(1);        // 第 9 个 flag-tick 恰 1 发
    for (let t = 0; t < 8; t++) b.fixedUpdate(1 / 60, g);
    expect(g.rec.bolts.length).toBe(1);        // 发后 8 拍静默
    b.fixedUpdate(1 / 60, g);
    expect(g.rec.bolts.length).toBe(2);        // 第 18 拍第 2 发
  });

  it('300px 外不发（曼哈顿距离 :42218 门）', () => {
    const e = mkEnemy(2400, 2000);             // 距离 400 > 300
    const g = mkGame([e]);
    const b = new MagnetSphereProj(2000, 2000, 0, 0, 48, 6);
    for (let t = 0; t < 30; t++) b.fixedUpdate(1 / 60, g);
    expect(g.rec.bolts.length).toBe(0);
  });

  it('墙隔视线不发（Collision.CanHit :42219 门）——墙须在球怪之间（起步格不查）', () => {
    const st = new TileStore(400, 400);
    buildWall(st, 128, 100, 100);              // 球 tile125 → 怪 tile131,墙 @tile128 中间
    const e = mkEnemy(2100, 2000);
    const g = mkGame([e], st);
    const b = new MagnetSphereProj(2000, 2000, 0, 0, 48, 6);
    for (let t = 0; t < 30; t++) b.fixedUpdate(1 / 60, g);
    expect(g.rec.bolts.length).toBe(0);
  });

  it('timeLeft<30 停发（:42228-42230 散场静默）', () => {
    const e = mkEnemy(2100, 2000);
    const g = mkGame([e]);
    const b = new MagnetSphereProj(2000, 2000, 0, 0, 48, 6);
    b.life = 29;
    for (let t = 0; t < 12; t++) b.fixedUpdate(1 / 60, g);
    expect(g.rec.bolts.length).toBe(0);
  });

  it('发弹参数：弹速 6 归一、出生位=球心+velocity×4、伤/kb 透传、暴击链注入', () => {
    const e = mkEnemy(2100, 2000);
    const g = mkGame([e]);
    const b = new MagnetSphereProj(2000, 2000, 0, 0, 48, 6);
    b.critChance = 0.21; b.armorPen = 7;
    for (let t = 0; t < 9; t++) b.fixedUpdate(1 / 60, g);   // 第 9 flag-tick 发弹
    expect(g.rec.bolts.length).toBe(1);
    const bolt = g.rec.bolts[0] as BeamBoltProj;
    expect(bolt).toBeInstanceOf(BeamBoltProj);
    // 出生位 = (2000+0×4, 2000+0×4) = 球心（v=0 时）;方向 = 目标心 − 出生位 归一 ×6
    const dl = Math.hypot(2100 - 2000, 2000 - 2000);
    expect(bolt.vx).toBeCloseTo((2100 - 2000) / dl * 6, 3);
    expect(bolt.vy).toBeCloseTo(0, 6);
    expect((bolt as unknown as { damage: number }).damage).toBe(48);
    expect((bolt as unknown as { knockback: number }).knockback).toBe(6);
    expect((bolt as unknown as { critChance: number }).critChance).toBe(0.21);
    expect((bolt as unknown as { armorPen: number }).armorPen).toBe(7);
  });

  it('候选随机掷（:42232 Main.rand.Next(num)）：每 flag-tick 恰一掷、掷在发弹门前', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const e = mkEnemy(2100, 2000);
      const g = mkGame([e]);
      const b = new MagnetSphereProj(2000, 2000, 0, 0, 48, 6);
      const drawn: number[] = [];
      rnd.mockImplementation(() => { drawn.push(1); return 0.5; });
      b.fixedUpdate(1 / 60, g);
      expect(drawn.length).toBe(1);            // flag-tick 恰一掷
      drawn.length = 0;
      b.fixedUpdate(1 / 60, g);
      expect(drawn.length).toBe(1);            // 每 flag-tick 一掷（含非发弹拍）
    } finally {
      rnd.mockRestore();
    }
  });
});

// ==================== ③ 弹 255 行为 ====================

describe('③激光弹 255：子步飞行/死亡铺束/命中（aiStyle48 + Kill :71825-71859）', () => {
  it('单 tick 寿命：100 子步 × 6px = 射程 600px,一 tick 内死（:17307 循环内 timeLeft--）', () => {
    const g = mkGame();
    const bolt = new BeamBoltProj(2000, 2000, 6, 0, 48, 6);
    bolt.fixedUpdate(1 / 60, g);
    expect(bolt.dead).toBe(true);
    expect(bolt.cx).toBeCloseTo(2000 + 600, 4);   // 恰 100 子步 × 6px
  });

  it('死亡拍铺束：本地 d160 尘线 + broadcast MagnetSphereBolt(56)（锚→死亡心）', () => {
    const g = mkGame();
    const bolt = new BeamBoltProj(2000, 2000, 6, 0, 48, 6);
    bolt.fixedUpdate(1 / 60, g);
    // broadcast：posX/posY=死亡心 (2600,2000)、moveX/moveY=锚、uniqueInfo=|v|×1000=6000
    expect(g.rec.broadcast.length).toBe(1);
    const ev = g.rec.broadcast[0];
    expect(ev.type).toBe(56);
    expect(ev.x).toBeCloseTo(2600, 4);
    expect(ev.mx).toBeCloseTo(2000 + 4 * 6, 4);   // 锚=第 4 子步末位（24px 前方）
    expect(ev.info).toBe(6000);
    // 本地尘：步距 max(4,|v|)=6,区间 24..600 → ≥95 站 × 4 层 d160
    expect(g.rec.dusts.length).toBeGreaterThanOrEqual(300);
    expect(g.rec.dusts.every((d) => d.type === 160)).toBe(true);
  });

  it('delay 前（<4 子步）死不铺束（:71836 localAI[0]>=delay 门 + :28615 锚单次等值记录）', () => {
    const st = new TileStore(400, 400);
    buildWall(st, 129, 100, 60);                  // 墙 @px2064..（含弹行 y tile125）
    const g = mkGame([], st);
    const bolt = new BeamBoltProj(2050, 2000, 6, 0, 48, 6);
    // 盒右缘 cx+4 ≥ 2064 → cx=2062 = 第 2 子步撞墙,l0=2 < delay(4) → 锚未记、无束
    bolt.fixedUpdate(1 / 60, g);
    expect(bolt.dead).toBe(true);
    expect(g.rec.broadcast.length).toBe(0);
    expect(g.rec.dusts.length).toBe(0);
    // 对照组：≥4 子步后撞墙 → 束照铺（同几何外推）
    const st2 = new TileStore(400, 400);
    buildWall(st2, 135, 100, 60);                 // 墙 @px2160..
    const g2 = mkGame([], st2);
    const bolt2 = new BeamBoltProj(2050, 2000, 6, 0, 48, 6);
    bolt2.fixedUpdate(1 / 60, g2);                // 一 tick 100 子步 > 到墙 ~18 子步 → 死
    expect(bolt2.dead).toBe(true);
    expect(g2.rec.broadcast.length).toBe(1);      // l0=18 >= 4 → 铺束
    expect(g2.rec.broadcast[0].mx).toBeCloseTo(2050 + 4 * 6, 4);   // 锚=4 子步末位
  });

  it('命中敌怪：单发 flag3（pierce=1 无视免疫）、伤透传、命中位铺束、弹亡', () => {
    const e = mkEnemy(2050, 2000);                // 盒 (2040..2060, 1980..2020)
    const g = mkGame([e]);
    const bolt = new BeamBoltProj(2000, 2000, 6, 0, 48, 6);
    (bolt as unknown as { armorPen: number }).armorPen = 5;
    bolt.fixedUpdate(1 / 60, g);
    expect(bolt.dead).toBe(true);
    expect(e.hurt).toHaveBeenCalledTimes(1);
    const [dmg, kbx, , , armorPen, , pierce, fromPlayer] = e.hurt.mock.calls[0];
    // ★G37-A（D6,2026-10-31）改判史：255 敌臂补 DV :12970 逐靶掷（census 外同形面
    //  随刀）→ 旧平值钉 48 改 31 档 DV 域锁（bj735a 判例形,luck=0 单掷域）。
    const dvDomain255 = new Set<number>();
    for (let i = 0; i < 31; i++) dvDomain255.add(damageVarRoll(48, 0, () => i / 31));
    expect(dvDomain255.has(dmg)).toBe(true);
    expect(kbx).toBeGreaterThan(0);               // kb 沿飞行方向
    expect(armorPen).toBe(5);
    expect(pierce).toBe(1);                       // 单发 flag3（:11904）
    expect(fromPlayer).toBe(true);
    // 命中位铺束（盒右缘 cx+4 > 2040 → 第 7 子步死,l0>=4 → 锚已在 4 子步末位记录）
    expect(g.rec.broadcast.length).toBe(1);
    expect(g.rec.broadcast[0].mx).toBeCloseTo(2000 + 4 * 6, 4);   // 锚=24px 前方
    expect(g.rec.broadcast[0].x).toBeCloseTo(2042, 1);            // 死亡位=怪盒缘
  });

  it('penetrate 单发：命中即死,不穿透后续怪（弹 255 SetDefaults 无 penetrate 行=1）', () => {
    const e1 = mkEnemy(2020, 2000);
    const e2 = mkEnemy(2050, 2000);
    const g = mkGame([e1, e2]);
    const bolt = new BeamBoltProj(2000, 2000, 6, 0, 48, 6);
    bolt.fixedUpdate(1 / 60, g);
    expect(e1.hurt).toHaveBeenCalledTimes(1);
    expect(e2.hurt).not.toHaveBeenCalled();
  });
});

// ==================== ④ 同族收编 260 ====================

describe('④炼狱叉弹 260（Inferno Fork 1295,delay 3/life 200/HeatRay 57）', () => {
  it('射程 = 200 子步 × 速度;跨 2 tick 存活（timeLeft 200 > 100 子步/tick）', () => {
    const g = mkGame();
    const bolt = new BeamBoltProj(2000, 2000, 6, 0, 48, 6, HEAT_RAY_BOLT);
    bolt.fixedUpdate(1 / 60, g);
    expect(bolt.dead).toBe(false);                // tick1 后仍活（101 子步 < 200）
    expect(bolt.cx).toBeGreaterThan(2000 + 100 * 6);
    bolt.fixedUpdate(1 / 60, g);
    expect(bolt.dead).toBe(true);                 // tick2 内 200 子步耗尽
    expect(g.rec.broadcast[0].type).toBe(57);     // HeatRay 档
    expect(g.rec.dusts.every((d) => d.type === 162)).toBe(true);  // d162 热射线尘
  });
});

// ==================== ⑤ Game 分派面源码锚 ====================

describe('⑤Game.ts 分派面（防回归源码锚）', () => {
  it('1266 专支存在且生成 MagnetSphereProj（不再落通用尾支 Arrow）', () => {
    expect(gameSrc).toMatch(/if \(critVid === 1266\) \{/);
    const branch = gameSrc.slice(gameSrc.indexOf('if (critVid === 1266)'));
    expect(branch.slice(0, 900)).toContain('new MagnetSphereProj(');
  });

  it('1295 专支存在且生成 BeamBoltProj(HEAT_RAY_BOLT)（同族收编）', () => {
    expect(gameSrc).toMatch(/if \(critVid === 1295\) \{/);
    const branch = gameSrc.slice(gameSrc.indexOf('if (critVid === 1295)'));
    expect(branch.slice(0, 900)).toContain('new BeamBoltProj(');
    expect(branch.slice(0, 900)).toContain('HEAT_RAY_BOLT');
  });

  it('net 分派面：BeamBoltProj 先于 projId 通判拦截（防 kind1 误重建回旋镖）', () => {
    const iBeam = gameSrc.indexOf('p instanceof BeamBoltProj');
    const iGeneric = gameSrc.indexOf('else if (p.projId !== undefined)');
    expect(iBeam).toBeGreaterThan(-1);
    expect(iGeneric).toBeGreaterThan(-1);
    expect(iBeam).toBeLessThan(iGeneric);          // 拦截支必须在前
    expect(gameSrc).toContain('p instanceof MagnetSphereProj');
    expect(gameSrc).toContain('tag = String(MAGNET_SPHERE_BALL)');   // kind0 傀儡位
  });
});
