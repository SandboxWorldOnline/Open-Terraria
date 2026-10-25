// BJ708-G28 — 新登记债清偿·尘/弹幕域四件（2026-10-24;债源 BJ708-A 登记簿）：
//   1. d173 暗影束尘 update 分支缺（链 A :1199-1226——活发射方=294 暗影束铺束
//      shadowbeamLineFx,旧落 default 吃重力+0.1/慢衰 −0.01/缺紫光）。
//   2. d164 update 分支同缺（:1161-1197,仓内 0 发射方=潜伏面,家族补全同批纪律
//      ——F2 130-134/219-223 先例）。
//   3. BeamBoltProj InWorld 门 ±(−5/+5) 四界外扩 10 格 ≠ 原版 WorldGen.InWorld
//      (center,5)=tile∈[5,max−5)（BJ345 自带,低危——对齐）。
//   4. chloro-setbonus「227 Kill 音」预先红 = BJ692 修码漏改测试侧（'Item_6' 魔镜
//      采样误译→playSfx('chop')）,测试侧修在 chloro-setbonus.test.ts（本文件不重复）。
// 权威：Terarria1457（1456 同文已核;Dust.cs/Projectile.cs/WorldGen.cs/
// LegacySoundPlayer.cs/ParticleOrchestrator.cs 行号均 1457）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VanillaDust } from '../src/fx/VanillaDust';
import { BeamBoltProj, MAGNET_SPHERE_BOLT } from '../src/entities/MagnetSphereProj';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');
const src = (f: string): string => readFileSync(join(GAME, f), 'utf8');
const vanilla = (f: string): string => readFileSync(join(VAN, 'Terraria', f), 'utf8');

afterEach(() => { vi.restoreAllMocks(); });

// ============================================================
// ① 原版锚（读错反编译即红）
// ============================================================
describe('① 原版锚：Dust.cs 164/173 分支 + AI_048 InWorld 门', () => {
  it('Dust.cs:1161-1197 case 164：蓝白光 (1,0.1,0.8) + noGravity 三臂（×1.075/×−0.95 反转/×1.05）', () => {
    const dust = vanilla('Dust.cs');
    expect(dust).toContain('Lighting.AddLight((int)(dust.position.X / 16f), (int)(dust.position.Y / 16f), num64, num64 * 0.1f, num64 * 0.8f);');
    expect(dust).toContain('dust.velocity *= 1.075f;');
    expect(dust).toContain('dust.velocity *= -0.95f;');      // :1174 速度反转（含符号）
    expect(dust).toContain('dust.velocity *= 1.05f;');
    expect(dust).toContain('dust.scale -= 0.03f;');
  });

  it('Dust.cs:1181-1196 case 164 else 臂：−0.005/×0.9/漂移 ×0.02/1/5 子尘 scale×2.5', () => {
    const dust = vanilla('Dust.cs');
    expect(dust).toContain('dust.scale -= 0.005f;');
    expect(dust).toContain('dust.velocity *= 0.9f;');
    expect(dust).toContain('Main.dust[num65].scale = dust.scale * 2.5f;');
  });

  it('Dust.cs:1199-1226 case 173：紫光 (0.4,0.1,1) + noGravity ×0.8/±0.01/−0.01', () => {
    const dust = vanilla('Dust.cs');
    expect(dust).toContain('Lighting.AddLight((int)(dust.position.X / 16f), (int)(dust.position.Y / 16f), num66 * 0.4f, num66 * 0.1f, num66);');
    expect(dust).toContain('dust.velocity *= 0.8f;');
    expect(dust).toContain('dust.scale -= 0.01f;');
    expect(dust).toContain('dust.scale -= 0.015f;');
  });

  it('Dust.cs:1220 173 else 臂子尘门 Next(10)==10 = 原版死支（Next(10)∈[0,10) 恒≠10）', () => {
    expect(vanilla('Dust.cs')).toContain('if (Main.rand.Next(10) == 10)');
  });

  it('Projectile.cs:28610-28614 AI_048：!InWorld(center,5) → Kill（fluff=5 语义）', () => {
    const proj = vanilla('Projectile.cs');
    expect(proj).toContain('if (!WorldGen.InWorld(base.Center.ToTileCoordinates(), 5))');
    expect(vanilla('WorldGen.cs')).toContain(
      'if (x < fluff || x >= Main.maxTilesX - fluff || y < fluff || y >= Main.maxTilesY - fluff)');
  });
});

// ============================================================
// ② d164 update 行为（VanillaDust 1:1,旧落 default 恰红）
// ============================================================
describe('② d164 update：蓝白光 + 三臂阻尼 + 1/5 子尘（Dust.cs:1161-1197）', () => {
  it('缺省（重力）档：光 (1,0.1,0.8)×min(1,scale) + 净 −0.015/t + ×0.9 漂移 + 子尘×2.5 noGravity', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);                     // 预设视口（spawn 裁剪门用）
    const d = vd.spawn(500, 500, 1, 1, 164)!;
    d.scale = 1; d.vx = 1; d.vy = 0;                 // 排除 spawn 抖动,钉初值
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    vd.update(0, 0, 1000, 1000);
    spy.mockRestore();
    expect(d.scale).toBeCloseTo(1 - 0.005 - 0.01, 10);    // 本支 −0.005 + 公共老化 −0.01
    expect(d.vx).toBeCloseTo(1 * 0.9 - 0.2, 10);          // ×0.9 + Next(-10,11)×0.02 漂移(=0 → −0.2)
    expect(d.vy).toBeCloseTo(0 * 0.9 - 0.2, 10);
    const l = vd.lights.find((x) => x.x === d.x && x.y === d.y);
    expect(l).toBeDefined();                               // 旧 default 无光恰红
    expect(l!.r).toBeCloseTo(1, 6);
    expect(l!.g).toBeCloseTo(0.1, 6);
    expect(l!.b).toBeCloseTo(0.8, 6);
    // 1/5 子尘（Next(5)==0 掷中）：noGravity + scale=本拍已衰减 scale×2.5
    // （子尘占 pool 下一槽 → 同拍在途再老化：noGravity 臂 −0.03 + 公共 −0.01 +
    //  链 B 兜底 −0.04;父 0.995×2.5=2.4875 → 2.4075）
    const kids = [...vd.each(false)].filter((c) => c.type === 164 && c.noGravity);
    expect(kids.length).toBe(1);
    expect(kids[0].scale).toBeCloseTo((1 - 0.005) * 2.5 - 0.03 - 0.01 - 0.04, 6);
  });

  it('光带 scale 门：scale 0.5 → (0.5,0.05,0.4)（min(1,scale) 非 160 的 ×1.3 档）', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 164)!;
    d.scale = 0.5; d.vx = 0; d.vy = 0;
    vd.update(0, 0, 1000, 1000);
    const l = vd.lights.find((x) => x.x === d.x && x.y === d.y)!;
    expect(l.r).toBeCloseTo(0.5, 6);
    expect(l.g).toBeCloseTo(0.05, 6);
    expect(l.b).toBeCloseTo(0.4, 6);
  });

  it('noGravity 三臂①：scale<0.7 → ×1.075 加速（净 −0.08/t 含链 B −0.04,再 ×0.92）', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 164)!;
    d.noGravity = true; d.scale = 0.5; d.vx = 1; d.vy = 1;
    vd.update(0, 0, 1000, 1000);
    expect(d.scale).toBeCloseTo(0.5 - 0.03 - 0.01 - 0.04, 10);
    expect(d.vx).toBeCloseTo(1.075 * 0.92, 10);            // ×1.075 + 链 B noGravity ×0.92
  });

  it('noGravity 三臂②：scale≥0.7 且 1/2 掷 → ×−0.95 速度反转', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 164)!;
    d.noGravity = true; d.scale = 1; d.vx = 1; d.vy = 1;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);   // Next(2)==0 → 反转臂
    vd.update(0, 0, 1000, 1000);
    spy.mockRestore();
    expect(d.scale).toBeCloseTo(1 - 0.03 - 0.01 - 0.04, 10);
    expect(d.vx).toBeCloseTo(-0.95 * 0.92, 10);            // 负号=反转锁（误落 ×0.95 恰红）
    expect(d.vy).toBeCloseTo(-0.95 * 0.92, 10);
  });

  it('noGravity 三臂③：scale≥0.7 且 1/2 掷否 → ×1.05', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 164)!;
    d.noGravity = true; d.scale = 1; d.vx = 1; d.vy = 1;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.9); // Next(2)==1 → ×1.05 臂
    vd.update(0, 0, 1000, 1000);
    spy.mockRestore();
    expect(d.vx).toBeCloseTo(1.05 * 0.92, 10);
    expect(d.scale).toBeCloseTo(1 - 0.03 - 0.01 - 0.04, 10);
  });
});

// ============================================================
// ③ d173 update 行为（活发射方=294 暗影束 Kill/越界铺束）
// ============================================================
describe('③ d173 update：紫光 + 自管衰减漂移 + 死支不触发（Dust.cs:1199-1226）', () => {
  it('缺省（重力）档：紫光 (0.4,0.1,1) + 净 −0.025/t + ×0.8 漂移 ±0.05（无重力 +0.1）', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 173)!;
    d.scale = 1; d.vx = 1; d.vy = 0;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    vd.update(0, 0, 1000, 1000);
    spy.mockRestore();
    expect(d.scale).toBeCloseTo(1 - 0.015 - 0.01, 10);     // 本支 −0.015 + 公共老化 −0.01
    expect(d.vx).toBeCloseTo(1 * 0.8 - 0.05, 10);          // ×0.8 + Next(-10,11)×0.005(=0 → −0.05)
    expect(d.vy).toBeCloseTo(0 - 0.05, 10);                // 无通用重力 +0.1（旧 default 恰红）
    const l = vd.lights.find((x) => x.x === d.x && x.y === d.y);
    expect(l).toBeDefined();                               // 旧 default 无光恰红
    expect(l!.r).toBeCloseTo(0.4, 6);
    expect(l!.g).toBeCloseTo(0.1, 6);
    expect(l!.b).toBeCloseTo(1, 6);
  });

  it('noGravity 档：×0.8 阻尼 + ±0.2 漂移 + 净 −0.06/t（含链 B 兜底 −0.04）', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 173)!;
    d.noGravity = true; d.scale = 1; d.vx = 1; d.vy = 1;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    vd.update(0, 0, 1000, 1000);
    spy.mockRestore();
    expect(d.scale).toBeCloseTo(1 - 0.01 - 0.01 - 0.04, 10);
    expect(d.vx).toBeCloseTo((1 * 0.8 - 0.2) * 0.92, 10);  // ×0.8 + Next(-20,21)×0.01(=0 → −0.2) + 链 B ×0.92
  });

  it('光带 scale 门：scale 0.5 → (0.2,0.05,0.5)', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 173)!;
    d.scale = 0.5; d.vx = 0; d.vy = 0;
    vd.update(0, 0, 1000, 1000);
    const l = vd.lights.find((x) => x.x === d.x && x.y === d.y)!;
    expect(l.r).toBeCloseTo(0.2, 6);
    expect(l.g).toBeCloseTo(0.05, 6);
    expect(l.b).toBeCloseTo(0.5, 6);
  });

  it('1/10 子尘门 = 原版死支：随机全域（0/0.999999/30 拍真随机）恒不产子尘', () => {
    // Next(10)∈[0,10) 恒≠10 → else 臂子尘永不触发（保形移植,掷仍消费）
    for (const rv of [0, 0.999999]) {
      const vd = new VanillaDust();
      vd.update(0, 0, 1000, 1000);
      const d = vd.spawn(500, 500, 1, 1, 173)!;
      d.scale = 1; d.vx = 0; d.vy = 0;
      const spy = vi.spyOn(Math, 'random').mockReturnValue(rv);
      vd.update(0, 0, 1000, 1000);
      spy.mockRestore();
      expect([...vd.each(false)].filter((c) => c.type === 173).length).toBe(1);
    }
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 173)!;
    d.scale = 1; d.vx = 0; d.vy = 0; d.noGravity = true;
    for (let t = 0; t < 30; t++) {
      vd.update(0, 0, 1000, 1000);
      expect([...vd.each(false)].filter((c) => c.type === 173).length).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================
// ④ GetAlpha 族（:2627-2630 已在册——防回退守卫）
// ============================================================
describe('④ GetAlpha：164/173 与 160/162 同档 (250×scale,…,0) 纯加性', () => {
  it('alphaOf(d164/d173) = {rgb: min(1,250·scale/255), a: 0}', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d164 = vd.spawn(500, 500, 1, 1, 164)!;
    d164.scale = 1;
    const a164 = VanillaDust.alphaOf(d164);
    expect(a164.a).toBe(0);
    expect(a164.rgb).toBeCloseTo(250 / 255, 6);
    const d173 = vd.spawn(600, 600, 1, 1, 173)!;
    d173.scale = 0.5;
    const a173 = VanillaDust.alphaOf(d173);
    expect(a173.a).toBe(0);
    expect(a173.rgb).toBeCloseTo((250 * 0.5) / 255, 6);
  });
});

// ============================================================
// ⑤ BeamBoltProj InWorld 门（tile∈[5,max−5);旧 ±(−5/+5) 恰红）
// ============================================================
describe('⑤ BeamBoltProj InWorld 门：WorldGen.InWorld(center,5) 四界', () => {
  interface Rec { broadcast: Array<{ type: number }>; dusts: number[]; }
  function mkGame(): { g: GameHooks; rec: Rec } {
    const rec: Rec = { broadcast: [], dusts: [] };
    const g = {
      world: { store: new TileStore(400, 400) },
      player: { dead: false, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 20, h: 42 },
      enemies: () => [],
      critters: () => [],
      projectiles: () => [],
      spawnDust: ((x: number, y: number, _w: number, _h: number, type: number) => {
        rec.dusts.push(type); return { x, y, vx: 0, vy: 0 };
      }) as never,
      broadcastParticleOrchestra: (type: number) => { rec.broadcast.push({ type }); },
    } as unknown as GameHooks;
    return { g, rec };
  }
  const bolt = (cx: number, cy: number) => new BeamBoltProj(cx, cy, 6, 0, 48, 6, MAGNET_SPHERE_BOLT);

  it('左缘 tx=4（<5）首子步即 Kill,且越界杀先于锚记录 → 零广播（旧 tx<−5 恰红）', () => {
    const { g, rec } = mkGame();
    const b = bolt(4 * 16 + 8, 2000);              // tx=4 ∈ [0,5) 原版判界外
    b.fixedUpdate(1 / 60, g);
    expect(b.dead).toBe(true);
    expect(rec.broadcast.length).toBe(0);          // l0=0 < delay4 → killBeam 无铺束
  });

  it('右缘 tx=w−5 首子步即 Kill（旧 tx≥w+5 才杀恰红;tile 395/400 格世界）', () => {
    const { g, rec } = mkGame();
    const b = bolt(395 * 16, 2000);                // tx=395 = 400−5 → 界外
    b.fixedUpdate(1 / 60, g);
    expect(b.dead).toBe(true);
    expect(rec.broadcast.length).toBe(0);
  });

  it('界内 tx=125：不越界杀——一拍内 timeLeft 100 耗尽自然 Kill + 铺束广播 56', () => {
    const { g, rec } = mkGame();
    const b = bolt(2000, 2000);                    // tx=125 ∈ [5,395)
    b.fixedUpdate(1 / 60, g);                      // 101 子步,timeLeft 100 于第 100 子步耗尽
    expect(b.dead).toBe(true);                     // 死因=寿命（非 InWorld:锚已录 l0≥4）
    expect(rec.broadcast.length).toBe(1);
    expect(rec.broadcast[0].type).toBe(56);        // MagnetSphereBolt 铺束（本拍音尘同相）
  });
});

// ============================================================
// ⑥ 结构锁（源文本锚,防静默回退）
// ============================================================
describe('⑥ 结构锁：VanillaDust case 164/173 + BeamBoltProj 四界表达式', () => {
  it('VanillaDust.ts：164/173 分支判据与位序（光色/三臂/死支/子尘 ×2.5）', () => {
    const s = src('src/fx/VanillaDust.ts');
    expect(s).toContain('case 164: {');
    expect(s).toContain('case 173: {');
    expect(s).toContain('r: num64, g: num64 * 0.1, b: num64 * 0.8');
    expect(s).toContain('r: num66 * 0.4, g: num66 * 0.1, b: num66');
    expect(s).toContain('d.vx *= -0.95; d.vy *= -0.95;');
    expect(s).toContain('c708g.scale = d.scale * 2.5');
    expect(s).toContain('Math.floor(Math.random() * 10) === 10');   // 死支保形
    // 两支均独占链接（chainLink）——不落 default 吃重力
    expect(s).toContain('case 160: case 162: case 164: case 173:'); // GetAlpha 族档同在
  });

  it('MagnetSphereProj.ts：InWorld 四界 = [5, max−5)（旧 ±(−5/+5) 回退恰红）', () => {
    expect(src('src/entities/MagnetSphereProj.ts'))
      .toContain('if (tx < 5 || ty < 5 || tx >= st.w - 5 || ty >= st.h - 5)');
  });
});
