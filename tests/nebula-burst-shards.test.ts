// ★星云奥秘爆炸碎片链收口刃（617 爆裂 → 620 碎片/618 清场最后一层）：
//   刀A 620 碎片出生锚 = 盒心语义（原版 NewProjectile position=(X−w/2,Y−h/2)，
//       :10238-10239 居中语义 + :73637 vector34=Center+RandomVector2(±30)）——
//       旧码 ctor 左上 −2 偏移 ≠ −w/2(−4) → 碎片整体 +2px 东南偏
//   刀B 618 火花出生锚 = 父球盒心（:35379-35383 NewProjectile(Center.X,Center.Y)
//       → 618 盒(18×30)中心 = 父心）——旧码直传父心作左上 → +9/+15 偏
//   刀C 死亡爆 AoE 局部免疫门（Kill→Resize(176)→Damage() 走 Damage_PVE
//       `usesLocalNPCImmunity && array[i]==0` :12586；3 击终结目标命中侧已写
//       immuneArray=localNPCHitCooldown=8（:14178）→ 爆箱二次结算【跳过】该目标；
//       Damage_PVE_Inner 尾 :14175 写档、:17380 每 tick 递减）——旧码爆箱无门 =
//       3 击终结目标被爆箱再吃一次（双倍伤）
//   刀D 爆炸尘盘散布（:73561-73594 逐尘 position = Center + 半盘向×rand×88）+
//       d90 Crimson×0.5 tint（:73579）+ 4×d240 无 noGravity 写行（:73563-73564
//       仅覆 position → 重力开）——旧码全部堆心 8px 盒 + 全 noGravity + 无 tint
//   钉面 618 节奏（慢速段 30t 步进 <241 → 8 枚封顶）与父亡清场（naParent 死 → 下拍自杀）
//   钉面 620 碎片 AI（40t 寿命/重力 0.2 钳 18/阻力 0.98/尾迹 2+1 尘双混位）
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import type { GameHooks } from '../src/entities/types';
import { Arrow } from '../src/entities/Arrow';
import { GorePiece } from '../src/entities/GorePiece';

interface DustRec {
  type: number; alpha: number; scale: number; noGravity: boolean;
  fadeIn?: number; x: number; y: number; vx: number; vy: number;
  color: { r: number; g: number; b: number; a: number } | null;
}

interface FoeRec {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  hurtCalls: Array<{ dmg: number; kb: number }>;
}

function makeGame(
  w: World,
  dusts: DustRec[],
  bucket?: Arrow[],
  foes?: FoeRec[],
) {
  return {
    world: w, player: null as unknown,
    enemies: () => (foes ?? []) as unknown[],
    critters: () => [],
    projectiles: () => [],
    entities: { nextId: 1, add: (e: unknown) => { if (bucket) bucket.push(e as Arrow); } },
    playSfx: () => {}, playSfxFiles: (() => {}) as unknown,
    playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    addLightAt: () => {},
    spawnDust: (_x: number, _y: number, _w: number, _h: number, type: number,
      sx = 0, sy = 0, alpha = 0, c: { r: number; g: number; b: number; a: number } | null = null,
      scale = 1, ng = false) => {
      const d: DustRec = { type, alpha, scale, noGravity: !!ng, x: _x, y: _y,
        vx: sx, vy: sy, fadeIn: undefined, color: c };
      dusts.push(d);
      return d;
    },
    broadcastParticleOrchestra: () => {},
  } as unknown as GameHooks;
}

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

function flyFrames(a: Arrow, game: GameHooks, frames: number): void {
  for (let i = 0; i < frames && !a.dead; i++) a.fixedUpdate(1 / 60, game);
}

function stubGoreNull(): () => void {
  const orig = GorePiece.newGore;
  (GorePiece as unknown as { newGore: unknown }).newGore = function () {
    return null as unknown as GorePiece;
  };
  return () => { (GorePiece as unknown as { newGore: unknown }).newGore = orig; };
}

/** 慢速段 617（v=(0,3) 直接入慢速支） */
function slowOrb(game: GameHooks): Arrow {
  return new Arrow(1600, 1500, 0, 3, 70, 5, 617, { grav: 0, life: 3600, pierce: 3 });
}

describe('刀A：620 碎片出生锚=盒心语义（:73637 NewProjectile 居中）', () => {
  it('统计偏置：碎片中心相对球心均值 ≈ 0（旧码 −2≠−4 = +2px 东南偏）', () => {
    const restore = stubGoreNull();
    try {
      let sx = 0, sy = 0, n = 0;
      for (let burst = 0; burst < 220; burst++) {
        const dusts: DustRec[] = [];
        const bucket: Arrow[] = [];
        const game = makeGame(emptyWorld(), dusts, bucket);
        const a = new Arrow(1600, 1500, 3.9, 0, 70, 5, 617, { grav: 0, life: 3600, pierce: 3 });
        (a as unknown as { killNow: (g: GameHooks) => void }).killNow(game);
        for (const s of bucket) {
          if (s.projId !== 620) continue;
          sx += s.cx - a.cx; sy += s.cy - a.cy; n++;
        }
      }
      expect(n).toBeGreaterThanOrEqual(150 * 10);   // 每爆 10..16 枚
      expect(Math.abs(sx / n), `x 偏置 ${(sx / n).toFixed(2)} ≠ 0（ctor 左上 −w/2 回正）`).toBeLessThan(1);
      expect(Math.abs(sy / n), `y 偏置 ${(sy / n).toFixed(2)} ≠ 0`).toBeLessThan(1);
    } finally {
      restore();
    }
  });

  it('数量掷 10..16 + 伤 ×0.65 截断 + 击退 ×0.8（:73622-73658）', () => {
    const restore = stubGoreNull();
    try {
      const dusts: DustRec[] = [];
      const bucket: Arrow[] = [];
      const game = makeGame(emptyWorld(), dusts, bucket);
      // damage=101 → ×0.65=65.65 → (int) 截断 65；kb=5 → 4
      const a = new Arrow(1600, 1500, 3.9, 0, 101, 5, 617, { grav: 0, life: 3600, pierce: 3 });
      (a as unknown as { killNow: (g: GameHooks) => void }).killNow(game);
      const shards = bucket.filter((s) => s.projId === 620);
      expect(shards.length).toBeGreaterThanOrEqual(10);
      expect(shards.length).toBeLessThanOrEqual(16);
      for (const s of shards) {
        expect(s.damage).toBe(65);
        expect(s.knockback).toBeCloseTo(4, 5);
        expect(s.pierce).toBe(1);                       // 不穿透
        expect([86, 90]).toContain(s.na620Dust);        // ai[0]=尾迹尘色键
      }
      // 色键互补：86/90 两环各一批（SelectRandom + 互补 :73617-73621）
      const dustKeys = new Set(shards.map((s) => s.na620Dust));
      expect(dustKeys.size).toBe(2);
      // 初速域：A 环 7..10 / B 环 4..8（Next(70,101)|Next(40,81)×0.1）——按色键分组
      // （A 环全带 tA 键、B 环全带互补 tB 键 :73617-73621,速度域 7..8 重叠不可按速分）
      const byKeyA = shards.filter((s) => s.na620Dust === shards[0].na620Dust).map((s) => Math.hypot(s.vx, s.vy));
      const byKeyB = shards.filter((s) => s.na620Dust !== shards[0].na620Dust).map((s) => Math.hypot(s.vx, s.vy));
      const hiBand = byKeyA.some((v) => v >= 6.99) ? byKeyA : byKeyB;
      const loBand = hiBand === byKeyA ? byKeyB : byKeyA;
      for (const v of hiBand) { expect(v).toBeGreaterThanOrEqual(6.99); expect(v).toBeLessThan(10.01); }
      for (const v of loBand) { expect(v).toBeGreaterThanOrEqual(3.99); expect(v).toBeLessThan(8.01); }
      // 上抛反折：无碎片初始向下 >0.4 速比（A 环 0.2 / B 环 0.4 :73632-73634/:73646-73648）
      for (const s of shards) {
        const norm = Math.hypot(s.vx, s.vy);
        expect(s.vy / norm).toBeLessThanOrEqual(0.4001);
      }
    } finally {
      restore();
    }
  });
});

describe('刀B：618 火花出生锚=父球盒心（:35379-35383）', () => {
  it('出生瞬间火花中心 = 父球中心（旧码直传父心作左上 = +9/+15 偏）', () => {
    const dusts: DustRec[] = [];
    const bucket: Arrow[] = [];
    const snaps: Array<{ pcx: number; pcy: number; s: Arrow }> = [];
    const game = makeGame(emptyWorld(), dusts, bucket);
    const a = slowOrb(game);
    // 在 add 钩里快照父心与火花（raw add 后、任何 update 前）
    const rawAdd = (game as unknown as { entities: { add: (e: unknown, b?: string) => void } }).entities.add;
    (game as unknown as { entities: { add: (e: unknown, b?: string) => void } }).entities.add =
      (e: unknown, b?: string) => {
        rawAdd(e, b);
        const s = e as Arrow;
        if (s.projId === 618) snaps.push({ pcx: a.cx, pcy: a.cy, s });
      };
    flyFrames(a, game, 31);
    expect(snaps.length, '慢速段 30t 步进首枚 618 应已出生').toBeGreaterThanOrEqual(1);
    const first = snaps[0];
    expect(Math.abs(first.s.cx - first.pcx), `618 x 锚偏 ${(first.s.cx - first.pcx).toFixed(1)}`).toBeLessThan(0.5);
    expect(Math.abs(first.s.cy - first.pcy), `618 y 锚偏 ${(first.s.cy - first.pcy).toFixed(1)}`).toBeLessThan(0.5);
    // 伤 = damage/2 截断、kb 0、寿命 420
    expect(first.s.damage).toBe(35);
    expect(first.s.knockback).toBe(0);
    expect(first.s.life).toBe(420);
  });

  it('节奏钉面：慢速段 240t 内恰 8 枚（%30 步进 <241 封顶）；父亡 → 残留下拍清空', () => {
    const dusts: DustRec[] = [];
    const bucket: Arrow[] = [];
    const game = makeGame(emptyWorld(), dusts, bucket);
    const a = slowOrb(game);
    flyFrames(a, game, 241);
    const sparks = bucket.filter((s) => s.projId === 618);
    expect(sparks.length, '前半生（ai0<241）每 30t 一枚 = 8').toBe(8);
    // 父亡清场（:35475-35478 proj4==null → Kill；本仓 naParent 死 → 下拍自杀）
    for (const s of sparks) expect(s.dead).toBe(false);
    a.dead = true;
    flyFrames(sparks[0], game, 2);
    expect(sparks[0].dead).toBe(true);
  });
});

describe('刀C：死亡爆 AoE 局部免疫门（Damage_PVE :12586 + 命中写档 :14178）', () => {
  function foeRec(id: number, cx: number, cy: number): FoeRec {
    const f: FoeRec = { id, x: cx - 10, y: cy - 15, w: 20, h: 30, dead: false, hurtCalls: [] };
    (f as unknown as { hurt: (...a: unknown[]) => boolean }).hurt =
      (...a: unknown[]) => { f.hurtCalls.push({ dmg: a[0] as number, kb: a[1] as number }); return true; };
    return f;
  }
  it('3 击终结目标（免疫窗 8t 内）被爆箱跳过；免疫窗外敌照吃 AoE', () => {
    const restore = stubGoreNull();
    try {
      const dusts: DustRec[] = [];
      const victim = foeRec(42, 1600 + 40, 1500);      // 免疫窗内（刚挨第 3 击）
      const bystander = foeRec(43, 1600 - 40, 1500);   // 窗外旁观敌
      const game = makeGame(emptyWorld(), dusts, undefined, [victim, bystander]);
      const a = new Arrow(1600, 1500, 3.9, 0, 70, 5, 617, { grav: 0, life: 3600, pierce: 3 });
      // 直写局部免疫表（= 命中侧 :14178 写档后的状态；617 localNPCHitCooldown=8）
      (a as unknown as { localImmuneCd: Map<number, number> }).localImmuneCd.set(42, 8);
      (a as unknown as { killNow: (g: GameHooks) => void }).killNow(game);
      expect(victim.hurtCalls.length, '免疫窗内目标不得被爆箱二次结算（Damage_PVE array[i]!=0 → skip）').toBe(0);
      expect(bystander.hurtCalls.length, '窗外敌照吃 AoE').toBe(1);
      // ★BJ731 改判史（2026-10-27）：BJ723-B 起爆箱伤走 :12970 DV 掷（±15% 31 档）
      //   ——钉值改区间。★恒 mock 不可用：killNow 尘盘散布是概率循环
      //   （rnd()<p 续掷档）,Math.random 恒 0.5 使 p>0.5 的循环永真=无限生尘
      //   OOM（实测 8G 堆亦炸）;区间断言零 mock 零风险。
      expect(bystander.hurtCalls[0].dmg).toBeGreaterThanOrEqual(60);   // 70×0.85 下界
      expect(bystander.hurtCalls[0].dmg).toBeLessThanOrEqual(80);      // 70×1.15 上界
    } finally {
      restore();
    }
  });
  it('无免疫档时爆箱全面结算（= 原版 array[i]==0 恒真路径）', () => {
    const restore = stubGoreNull();
    try {
      const dusts: DustRec[] = [];
      const f1 = foeRec(42, 1600 + 40, 1500);
      const f2 = foeRec(43, 1600 - 40, 1500);
      const game = makeGame(emptyWorld(), dusts, undefined, [f1, f2]);
      const a = new Arrow(1600, 1500, 3.9, 0, 70, 5, 617, { grav: 0, life: 3600, pierce: 3 });
      (a as unknown as { killNow: (g: GameHooks) => void }).killNow(game);
      expect(f1.hurtCalls.length).toBe(1);
      expect(f2.hurtCalls.length).toBe(1);
    } finally {
      restore();
    }
  });
});

describe('刀D：爆炸尘盘散布 + d90 Crimson tint + 4×d240 重力（:73561-73594）', () => {
  it('散布尘（d240α100/d62α200s3.7/d90/d62α0s2.7/d240α0）离心半径均值 >25px（旧码堆心 8px 盒）', () => {
    const restore = stubGoreNull();
    try {
      const dusts: DustRec[] = [];
      const game = makeGame(emptyWorld(), dusts);
      const a = new Arrow(1600, 1500, 3.9, 0, 70, 5, 617, { grav: 0, life: 3600, pierce: 3 });
      (a as unknown as { killNow: (g: GameHooks) => void }).killNow(game);
      // 散布面 = 4 d240 + 30 d62(3.7) + 30 d90 + 10 d62(2.7) + 10 d240(α0) = 84 全体
      // （每尘 position 都被 :73564/:73569/:73574/:73584/:73592 逐式覆写）
      const spread = dusts.map((d) => Math.hypot(d.x - 1600, d.y - 1500));
      const mean = spread.reduce((s, v) => s + v, 0) / spread.length;
      expect(mean, `爆尘离心均值 ${mean.toFixed(1)}px（原版 = rand×88 半盘散布）`).toBeGreaterThan(25);
      const max = Math.max(...spread);
      expect(max).toBeGreaterThan(60);                 // 88 半径盘内必有深位
    } finally {
      restore();
    }
  });
  it('d90 ×30 携 Crimson×0.5 tint（:73579 Color.Crimson*0.5f）', () => {
    const restore = stubGoreNull();
    try {
      const dusts: DustRec[] = [];
      const game = makeGame(emptyWorld(), dusts);
      const a = new Arrow(1600, 1500, 3.9, 0, 70, 5, 617, { grav: 0, life: 3600, pierce: 3 });
      (a as unknown as { killNow: (g: GameHooks) => void }).killNow(game);
      const h90 = dusts.filter((d) => d.type === 90);
      expect(h90.length).toBe(30);
      for (const d of h90) {
        expect(d.color, 'd90 爆尘缺 Crimson×0.5 tint').not.toBeNull();
      }
      // 4×d240（α100）原版无 noGravity 写行 → 重力开（:73563-73564 仅覆 position）
      const d240a100 = dusts.filter((d) => d.type === 240 && d.alpha === 100);
      expect(d240a100.length).toBe(4);
      for (const d of d240a100) expect(d.noGravity).toBe(false);
      // 其余 80 尘 noGravity（:73570/:73577/:73585/:73593）
      const rest = dusts.filter((d) => !(d.type === 240 && d.alpha === 100));
      for (const d of rest) expect(d.noGravity).toBe(true);
    } finally {
      restore();
    }
  });
});

describe('刀E：局部免疫逐拍递减=全弹公共面（DecrementLocalImmuneTimeCounters :17365-17384,Update :16779 调用）', () => {
  function foeRec(id: number, cx: number, cy: number): FoeRec {
    const f: FoeRec = { id, x: cx - 10, y: cy - 15, w: 20, h: 30, dead: false, hurtCalls: [] };
    (f as unknown as { hurt: (...a: unknown[]) => boolean }).hurt =
      (...a: unknown[]) => { f.hurtCalls.push({ dmg: a[0] as number, kb: a[1] as number }); return true; };
    return f;
  }
  it('617 驻场同敌：8t 冷却衰减后可再命中 → 3 击耗尽穿透爆炸（旧码递减只在 502 块内=617 恒卡 1 击）', () => {
    const restore = stubGoreNull();
    try {
      const dusts: DustRec[] = [];
      const bucket: Arrow[] = [];
      const victim = foeRec(42, 1600, 1500);
      const game = makeGame(emptyWorld(), dusts, bucket, [victim]);
      // 静止球体叠在肉垫上（慢速段,无索敌扰动）
      const a = new Arrow(1600, 1500, 0, 3.9, 70, 5, 617, { grav: 0, life: 3600, pierce: 3 });
      let explodeTick = -1;
      for (let t = 1; t <= 120 && explodeTick < 0; t++) {
        if (a.dead) { explodeTick = t; break; }
        a.fixedUpdate(1 / 60, game);
        if (a.dead) explodeTick = t;
      }
      expect(victim.hurtCalls.length, `驻场 120t 内命中数（旧码=1:localImmuneCd 恒 8 不衰减）got ${victim.hurtCalls.length}`)
        .toBeGreaterThanOrEqual(3);
      expect(explodeTick, '3 击耗尽 → 爆炸（旧码=永不,只能等 600t 计时）').toBeGreaterThan(0);
      const shards = bucket.filter((s) => s.projId === 620);
      expect(shards.length, '爆炸 → 620 碎片 10..16').toBeGreaterThanOrEqual(10);
    } finally {
      restore();
    }
  });
});

describe('钉面：620 碎片 AI（aiStyle29 type620 支 :38357-38387）', () => {
  it('重力 0.2 钳 18 + X 阻力 0.98 + 40t 寿终 + 尾迹 2+1 尘双混位/衰减', () => {
    const dusts: DustRec[] = [];
    const game = makeGame(emptyWorld(), dusts);
    const a = new Arrow(1600, 1500, 10, 0, 65, 4, 620, { grav: 0, life: 3600, pierce: 1 });
    (a as unknown as { na620Dust: number }).na620Dust = 90;
    a.fixedUpdate(1 / 60, game);                     // t1：vy=0.2, vx=9.8
    expect(a.vy).toBeCloseTo(0.2, 5);
    expect(a.vx).toBeCloseTo(9.8, 5);
    a.fixedUpdate(1 / 60, game);
    expect(a.vy).toBeCloseTo(0.4, 5);
    expect(a.vx).toBeCloseTo(9.8 * 0.98, 5);
    // 本拍尾迹 = 2×A（pos=(尘+心)/2, vel×0.3, scale 1.1×fade）+ 1×B（pos=(尘+心×5)/6, vel×0.1, fadeIn 0.9×fade, scale 0.6×fade）
    const tickDusts = dusts.slice(-3);
    expect(tickDusts.filter((d) => d.type === 90).length).toBe(3);
    const fade = (60 - 2) / 60;
    const big = tickDusts.filter((d) => Math.abs(d.scale - 1.1 * fade) < 1e-6);
    const small = tickDusts.filter((d) => Math.abs(d.scale - 0.6 * fade) < 1e-6);
    expect(big.length).toBe(2);
    expect(small.length).toBe(1);
    for (const d of big) {
      expect(d.vx).toBeCloseTo(a.vx * 0.3, 5);        // 帧内序：AI 阻力后 spawn → 同拍 a.vx
    }
    for (const d of small) {
      expect(d.fadeIn).toBeCloseTo(0.9 * fade, 5);
      expect(d.vx).toBeCloseTo(a.vx * 0.1, 5);        // vel×0.1
    }
    // 双混位：A = (尘+心)/2、B = (尘+心×5)/6 → B 尘更贴弹心（|B−cx| < |A−cx|）
    for (const d of small) {
      expect(Math.abs(d.x - a.cx)).toBeLessThan(Math.abs(big[0].x - a.cx));
    }
    // 40t 寿终（ai[1] > 40 → Kill :38361-38363）：帧 40 ai1=40 存活、帧 41 ai1=41 亡
    for (let i = 0; i < 38 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(a.dead).toBe(false);                      // ai1=40（不 >40）存活
    a.fixedUpdate(1 / 60, game);
    expect(a.dead).toBe(true);                       // ai1=41 → Kill
    // 消亡尘爆 = 10×ai[0] 色尘（:73671-73701 共段；1/3 升档 type++ → 90|91 混合）
    const killDusts = dusts.slice(-10);
    expect(killDusts.filter((d) => d.type === 90 || d.type === 91).length).toBe(10);
  });
});
