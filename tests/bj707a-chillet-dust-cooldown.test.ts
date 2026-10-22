// ★BJ707-A（2026-10-22 用户实报两案,Chillet 族坐骑 62-65/物品 5665/6150）定谳+守卫：
//
// 案1「召唤和取消坐骑出现黑色粒子」——定谳=尘 306 渲染管线三病灶（非 doSpawnDust
//   发射面——BJ704-G18 已 1:1,本仓 C4 锁仍在）：
//   ① alphaOf case 306（Dust.cs:2534-2536 `return this.color*num`）rgbv/a 曾裸 0-255 域
//     （消费面全 0-1）——a=c.a*num≈97 经 dustPremulPair clamp(1) 顶满 255;
//   ② Renderer 本体预乘对只吃标量 rgb（case 306 rgb=0）→黑底剪影（尘型对色对仍黑）;
//   ③ colorPass 标量 base + `cp.a>0.004` 门槛——vanilla GetColor 二程
//     （Main.cs:39697 `PackedValue != 0` =任一通道非零即画）306=(0,145,195,0) A=0 纯
//     加性青光整程漏画。修=域归一+本体对逐通道（mR/mG/mB,标量档恒等）+colorPass
//     逐通道 base+门槛补 RGB 面。306 另入全亮桶（GetAlpha 不读光照入参=自色尘,
//     lit 桶会被 compositeLight 二重乘光）。
//   附带:update 链 A case 306（:1093-1105 −0.04/实心收缩/自管重力 0.05）曾整缺
//   （净老化 −0.05/t vs 原版 −0.09/t≈2× 寿命）。284 同族域修（dormant）。
//
// 案2「冲刺冷却感觉比原版长」——定谳=【时序机 1:1 无 bug】+体感源=滑行视觉整缺:
//   实测仓内全周期 51 拍（滑行 31+冷却 20）≈ vanilla 手算 52（16→12 ×0.992+摩擦
//   0.1/0.2 →12→6.5 ×0.96;num15=坐骑 dashSpeed 6.5;冷却 num17=20/:21523 收敛 30）;
//   vanilla dash==6 滑行支（:21527-21548）每拍 8×尘306 尾焰+AddLight(0.5,0.1,0.6)
//   曾「未建模视觉面」（Player.ts 旧注）=冲刺零尾焰零光晕→体感冷却占比放大。
//   修=emitDashSlideDust dash6 支（同向滑行拍发射,收敛拍零尘）+ mountLights
//   case 62-65 滑行光晕。坐骑染料 shader（GetSecondaryShader(cMount)）缺省 0=null
//   零建模（登记:接线须随 miscDyes[3] 染料槽一并）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VanillaDust, type VDust } from '../src/fx/VanillaDust';
import { emitDashSlideDust, type BJ595DustPool } from '../src/entities/Player';
import { MountInstance, mountLights, type MountedPlayerView } from '../src/entities/Mounts';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RENDERER = readFileSync(join(ROOT, 'src/render/Renderer.ts'), 'utf8');
const VDUST = readFileSync(join(ROOT, 'src/fx/VanillaDust.ts'), 'utf8');

const vd306 = (over: Partial<VDust> = {}): VDust => ({
  active: true, x: 0, y: 0, vx: 0, vy: 0, type: 306, scale: 2, alpha: 60,
  fadeIn: 0, noGravity: true, noLight: false, noLightEmittance: false,
  color: { r: 100, g: 227, b: 255, a: 127 }, rotation: 0, fx: 60, fy: 30,
  followPlayer: false, followOnce: false, dyeVid: -1, followEnt: null, attractTo: null,
  ...over,
}) as VDust;

// ===================== §0 案1:尘306 渲染管线（判别锁） =====================
describe('BJ707-A §0 尘306 渲染语义（黑粒子案根因面）', () => {
  it('0a alphaOf case 306 域=0-1（曾裸 0-255→本体对黑底）;数值=this.color×num 四通道', () => {
    // spawn 尘实参（doSpawnDust 62-65 支:g18-C4 锁）:color (100,227,255,127)/α60 → num=195/255
    const r = VanillaDust.alphaOf(vd306());
    const num = 195 / 255;
    expect(r.rgbv).toBeDefined();
    expect(r.rgbv![0]).toBeCloseTo((100 / 255) * num, 6);   // ≈0.300（旧裸域 76.5→clamp 前无消费=红）
    expect(r.rgbv![1]).toBeCloseTo((227 / 255) * num, 6);   // ≈0.681
    expect(r.rgbv![2]).toBeCloseTo((255 / 255) * num, 6);   // ≈0.765
    expect(r.a).toBeCloseTo((127 / 255) * num, 6);          // ≈0.381（旧 97.15→clamp 顶 255=全不透明黑）
    // 域锁:全部 ∈(0,1] —— 旧域直接红（>1）
    for (const v of [...r.rgbv!, r.a]) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('0b case 284 同族域锁（dormant 零发射方,防回潮）', () => {
    const r = VanillaDust.alphaOf(vd306({ type: 284, alpha: 0 }));
    expect(r.a).toBeCloseTo(127 / 255, 6);                  // A=color.A（Dust.cs:2728;入参色 a=127）
    expect(r.rgbv).toEqual([100 / 255, 227 / 255, 255 / 255]);
  });

  it('0c colorPass 逐通道 base（306 二程=(0,145/255,195/255,0)——A=0 纯加性青,vanilla PackedValue!=0 必画）', () => {
    const d = vd306();                                      // GetAlpha=(76,173,195,97)/255
    const cp = VanillaDust.colorPass(d, 0, (127 / 255) * (195 / 255), [(100 / 255) * (195 / 255), (227 / 255) * (195 / 255), (195 / 255)]);
    expect(cp!.r).toBeCloseTo(0, 6);                        // clamp(100−(255−76))=0
    expect(cp!.g).toBeCloseTo(145 / 255, 6);                // clamp(227−(255−173))=145（旧标量 base=0 红）
    expect(cp!.b).toBeCloseTo(195 / 255, 6);                // clamp(255−(255−195))=195
    expect(cp!.a).toBeCloseTo(0, 6);                        // clamp(127−(255−97))=0
    // 标量档零回归:不带 rgbv 与旧式恒等（clamp255 截断域同既有实现）
    const d31 = vd306({ type: 31, color: { r: 200, g: 100, b: 50, a: 255 } });
    const cpScalar = VanillaDust.colorPass(d31, 0.5, 0.5);
    expect(cpScalar!.r).toBeCloseTo(72 / 255, 10);          // trunc(200−127.5)=72
    expect(cpScalar!.g).toBe(0);
    expect(cpScalar!.b).toBe(0);
    expect(cpScalar!.a).toBeCloseTo(127 / 255, 10);
  });

  it('0d 306 入全亮桶（GetAlpha :2534 不读光照入参=自色尘;lit 桶 compositeLight 二重乘光）', () => {
    const vd = new VanillaDust();
    const d = vd.spawn(0, 0, 10, 10, 306, 0, 0, 60, { r: 100, g: 227, b: 255, a: 127 }, 2);
    expect(d).not.toBeNull();
    const fb = [...vd.each(true)].filter((x) => x.type === 306);
    const lit = [...vd.each(false)].filter((x) => x.type === 306);
    expect(fb.length).toBe(1);                              // 修前 0=红
    expect(lit.length).toBe(0);                             // 修前 1=红
  });

  it('0e Renderer 结构锁:本体预乘对逐通道 mR/mG/mB + colorPass rgbv 透传 + 二程门槛含 RGB 面', () => {
    expect(RENDERER).toContain('this.dustPremulPair(img, d.fx, d.fy, mR, mG, mB, a)');
    expect(RENDERER).not.toContain('this.dustPremulPair(img, d.fx, d.fy, rgb, rgb, rgb, a)');
    expect(RENDERER).toContain('VanillaDust.colorPass(d, rgb, a, rgbv)');
    expect(RENDERER).toContain('cp.a > 0.004 || Math.max(cp.r, cp.g, cp.b) > 0.004');
  });

  it('0f update 链A case 306:净老化 −0.09/拍（−0.04 支−0.01 公共−0.04 链B兜底）+实心收缩+自管重力', () => {
    const vd = new VanillaDust();
    // noGravity 档（doSpawnDust/dash6 双发射方恒 noGravity=true）;scale 钉 2（spawn ±0.2 抖动消解）
    const d1 = vd.spawn(500, 500, 10, 10, 306, 0, 0, 60, { r: 100, g: 227, b: 255, a: 127 }, 2)!;
    d1.scale = 2; d1.noGravity = true; d1.vx = 3; d1.vy = 2;
    vd.update(-2000, -2000, 8000, 8000, 0, 0, null, () => false, null, null);
    expect(d1.scale).toBeCloseTo(2 - 0.09, 10);             // 旧缺支=−0.05/拍 红
    expect(d1.vx).toBeCloseTo(3 * 0.92, 10);                // 链B 兜底 ×0.92
    expect(d1.vy).toBeCloseTo(2 * 0.92, 10);                // !noGravity 重力 +0.05 不吃（noGravity）
    // 实心格收缩档（SolidCollision(pos−(5,5),10,10) ∧ fadeIn==0）
    const vd2 = new VanillaDust();
    const d2 = vd2.spawn(500, 500, 10, 10, 306, 0, 0, 60, { r: 100, g: 227, b: 255, a: 127 }, 2)!;
    d2.scale = 2; d2.noGravity = true; d2.vx = 3; d2.vy = 2;
    vd2.update(-2000, -2000, 8000, 8000, 0, 0, null, () => true, null, null);
    expect(d2.scale).toBeCloseTo((2 - 0.04) * 0.9 - 0.05, 10);   // 支内 −0.04→×0.9,后公共−0.01+链B−0.04
    expect(d2.vx).toBeCloseTo(3 * 0.25 * 0.92, 10);         // 支内 ×0.25 后链B ×0.92
    // 重力档（dash6 外无发射方,锁语义:!noGravity → vy+0.05 替通用 +0.1;链B ×0.92 门= noGravity,不达）
    const vd3 = new VanillaDust();
    const d3 = vd3.spawn(500, 500, 10, 10, 306, 0, 0, 60, { r: 100, g: 227, b: 255, a: 127 }, 1)!;
    d3.scale = 1; d3.noGravity = false; d3.vy = 0;
    vd3.update(-2000, -2000, 8000, 8000, 0, 0, null, () => false, null, null);
    expect(d3.vy).toBeCloseTo(0.05, 10);                    // +0.05（自管）;旧吃通用 +0.1 红
    expect(d3.scale).toBeCloseTo(1 - 0.04 - 0.01, 10);      // 链B −0.04 门（noGravity）不达
  });

  it('0g 反编译锚在位:GetAlpha 306 `this.color * num` / NewDust 恒写 color / DrawDust 二程 PackedValue 门', () => {
    expect(VDUST).toContain('case 306:');                   // alphaOf
    expect(VDUST).toContain('BJ707-A');                     // 判例注
  });
});

// ===================== §1 案1:doSpawnDust 全链渲染位（非黑断言） =====================
describe('BJ707-A §1 召唤/下坐尘渲染位（100×306 全员可渲非黑）', () => {
  it('1a setMount(62) 发射 100×306,每尘 alphaOf 三通道+α 全域内>0（旧=黑底 rgb0/a顶满）', () => {
    const spawned: VDust[] = [];
    const game = {
      spawnDust: (...a: unknown[]) => {
        const d = { active: true, x: 0, y: 0, vx: 0, vy: 0, type: a[4] as number, scale: a[9] as number,
          alpha: a[7] as number, fadeIn: 0, noGravity: false, noLight: false, noLightEmittance: false,
          color: (a[8] as { r: number; g: number; b: number; a: number } | null) ?? null, rotation: 0,
          fx: 0, fy: 0, followPlayer: false, followOnce: false, dyeVid: -1, followEnt: null, attractTo: null };
        spawned.push(d as VDust);
        return d as VDust;
      },
      cloneDust: () => null, spawnParticles: () => {}, playSfxFiles: () => {},
    };
    const view: MountedPlayerView = {
      x: 100, y: 100, w: 20, h: 42, vx: 0, vy: 0, onGround: true, inWater: false,
      facing: 1, inputX: 0, inputJump: false, inputUp: false, inputDown: false,
      prevInputJump: false, gravDir: 1, store: null,
    };
    new MountInstance().setMount(62, view, game as never);
    expect(spawned.length).toBe(100);
    expect(spawned[0].type).toBe(306);
    expect(spawned[0].color).toEqual({ r: 100, g: 227, b: 255, a: 127 });   // :6473
    for (const d of spawned) {
      const r = VanillaDust.alphaOf(d);
      // 渲染语义锁:本体对逐通道色（mR/mG/mB）与 α 全 >0=淡蓝可渲;旧病灶 rgb=0/a≈1=黑剪影
      expect(Math.max(r.rgbv![0], r.rgbv![1], r.rgbv![2])).toBeGreaterThan(0.004);
      expect(r.a).toBeGreaterThan(0.004);
      expect(r.a).toBeLessThanOrEqual(1);
    }
  });
});

// ===================== §2 案2:dash6 滑行尾尘+光晕（体感面清偿） =====================
describe('BJ707-A §2 dash6 滑行尾尘/光晕（:21527-21548 / :21530）', () => {
  /** 确定性 rand:每尘 3 掷序 [scale(Next40), fadeIn(Next20), t3(NextFloat)]
   *  喂 [0.999, 0.999, 0.5] → scale×1.39/fadeIn 0.69/t3=0.125 */
  function seededPool() {
    const calls: Array<{ x: number; y: number; w: number; h: number; type: number; alpha: number; scale: number }> = [];
    const dusts: VDust[] = [];
    const pool: BJ595DustPool = {
      spawn(x: number, y: number, w: number, h: number, type: number, _sx: number, _sy: number, alpha = 0, _color: unknown, scale = 1) {
        calls.push({ x, y, w, h, type, alpha, scale: scale ?? 1 });
        const d = vd306({ type, alpha: alpha ?? 1, scale: scale ?? 1, color: null });
        dusts.push(d);
        return d;
      },
    };
    const seq = [0.999, 0.999, 0.5];
    let k = 0;
    const rand = () => seq[k++ % 3];
    return { calls, dusts, pool, rand };
  }

  it('2a emitDashSlideDust dash6:8×尘306,盒=(x+facing×80,y+12)×(w,h−20) α100,尾焰色 Lerp 两档', () => {
    const { calls, dusts, pool, rand } = seededPool();
    const n = emitDashSlideDust(pool,
      { x: 1000, y: 600, w: 20, h: 46, vx: 0, vy: 0, facing: 1, mount: { type: 62 } }, 6, -1, rand);
    expect(n).toBe(8);
    expect(calls.length).toBe(8);
    for (const c of calls) {
      expect(c).toMatchObject({ x: 1080, y: 612, w: 20, h: 26, type: 306, alpha: 100, scale: 1 });
    }
    // 色档 62/64:Lerp((229,178,255)→White,f³=0.5³=0.125)——XNA Color(float) 0.9/0.7×255 截断
    const d0 = dusts[0];
    expect(d0.noGravity).toBe(true);
    expect(d0.fadeIn).toBeCloseTo(0.5 + Math.floor(0.999 * 20) * 0.01, 10);   // 0.69
    expect(d0.scale).toBeCloseTo(1.39, 10);                  // 1+floor(0.999×40)×0.01
    expect(d0.color).toEqual({ r: Math.trunc(229 + 26 * 0.125), g: Math.trunc(178 + 77 * 0.125), b: 255, a: 255 });
    expect(d0.vx).toBeCloseTo(1.5, 10);                      // spawn 速 0×1.5+facing×1.5
  });

  it('2b Ignis 档（63/65）:Lerp((255,178,127)→White,f³)', () => {
    const { dusts, pool, rand } = seededPool();
    emitDashSlideDust(pool,
      { x: 0, y: 0, w: 20, h: 46, vx: 0, vy: 0, facing: -1, mount: { type: 63 } }, 6, -1, rand);
    expect(dusts[0].color).toEqual({ r: 255, g: Math.trunc(178 + 77 * 0.125), b: Math.trunc(127 + 128 * 0.125), a: 255 });
    expect(dusts[0].vx).toBeCloseTo(-1.5, 10);               // facing −1
  });

  it('2c dash1/3/5 档不受 dash6 支影响（回归面:dash1 仍 2×d31;dash2 死支零尘）', () => {
    const s1 = seededPool();
    const n = emitDashSlideDust(s1.pool, { x: 0, y: 0, w: 20, h: 42, vx: 5, vy: 0 }, 1, -1, s1.rand);
    expect(n).toBe(2);
    expect(s1.calls.every((c) => c.type === 31)).toBe(true);
    const s2 = seededPool();
    expect(emitDashSlideDust(s2.pool, { x: 0, y: 0, w: 20, h: 42, vx: 0, vy: 0 }, 2, -1, s2.rand)).toBe(0);
    expect(s2.calls.length).toBe(0);
  });

  it('2d mountLights 62-65 滑行光晕:dash>0∧dashDelay<0 中心格 (0.5,0.1,0.6)/(0.6,0.3,0.1);门外零光', () => {
    const view = (over: Partial<MountedPlayerView> = {}): MountedPlayerView => ({
      x: 100, y: 100, w: 20, h: 42, vx: 0, vy: 0, onGround: true, inWater: false,
      facing: 1, inputX: 0, inputJump: false, inputUp: false, inputDown: false,
      prevInputJump: false, gravDir: 1, store: null, ...over,
    });
    const mk = (t: number) => { const m = new MountInstance(); m.setMount(t, view()); return m; };
    const ctx = { liquidColor: null, worldSurface: 100, miscCounter: 0, wind: 0, windExposed: false };
    // 滑行拍（dash=6/dashDelay=−1）
    expect(mountLights(mk(62), view({ dash: 6, dashDelay: -1 }), ctx))
      .toEqual([{ tx: Math.trunc(110 / 16), ty: Math.trunc(121 / 16), r: 0.5, g: 0.1, b: 0.6 }]);
    expect(mountLights(mk(63), view({ dash: 6, dashDelay: -1 }), ctx))
      .toEqual([{ tx: 6, ty: 7, r: 0.6, g: 0.3, b: 0.1 }]);               // Ignis 橙
    expect(mountLights(mk(64), view({ dash: 6, dashDelay: -1 }), ctx))
      .toEqual([{ tx: 6, ty: 7, r: 0.5, g: 0.1, b: 0.6 }]);               // Trusty 同紫
    expect(mountLights(mk(65), view({ dash: 6, dashDelay: -1 }), ctx))
      .toEqual([{ tx: 6, ty: 7, r: 0.6, g: 0.3, b: 0.1 }]);
    // 门外:收敛拍（dashDelay=30）/就绪（dashDelay=0）/非冲刺（dash=0）零光
    expect(mountLights(mk(62), view({ dash: 6, dashDelay: 30 }), ctx)).toEqual([]);
    expect(mountLights(mk(62), view({ dash: 6, dashDelay: 0 }), ctx)).toEqual([]);
    expect(mountLights(mk(62), view({ dash: 0, dashDelay: -1 }), ctx)).toEqual([]);
  });
});

// ===================== §3 案2:冷却时序 1:1 判别锁（定谳守卫） =====================
describe('BJ707-A §3 dash6 冷却时序（判语:冷却本体 1:1 无 bug——20/30 逐值）', () => {
  const fakeHooks = (w: World, p: Player, vd: VanillaDust | null) => ({
    world: w, player: p,
    playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
    spawnParticles: () => {}, spawnDust: () => null, spawnDrop: () => null,
    damagePlayer: () => 0, onEnemyKilled: () => {},
    entities: { add: () => {} }, enemies: () => [], vanillaDust: vd ?? undefined,
  });

  function mountedPlayer(): { p: Player; w: World; h: never } {
    const w = new World(200, 60, 72, 'bj707a');
    for (let x = 4; x < 196; x++) w.store.setTileSilent(x, 40, 1);
    const p = new Player(30 * 16, 37 * 16, new Inventory());
    const h = fakeHooks(w, p, null) as never;
    p.mount.setMount(62, p, undefined as never);
    for (let t = 0; t < 30; t++) p.fixedUpdate(1 / 60, h);   // 落地稳定
    return { p, w, h };
  }

  const tick = (p: Player, h: never, ix: number): void => {
    p.inputX = ix; p.inputLeft = ix < 0; p.inputRight = ix > 0;
    p.fixedUpdate(1 / 60, h);
  };

  it('3a 全周期:触发 v0=16 → 滑行（阻尼带内）→ 冷却恰 20 拍 → 就绪;出口 vx=num15=6.5（62 非 hm dashSpeed）', () => {
    const { p, w, h } = mountedPlayer();
    tick(p, h, 1); tick(p, h, 0); tick(p, h, 0); tick(p, h, 0); tick(p, h, 0);
    tick(p, h, 1);
    expect(p.dashDelay).toBe(-1);                            // 发起自证（:21728）
    expect(p.vx).toBe(16);                                   // :21716 16f*dir（撞墙减半档此开阔跑道不达）
    let glide = 0, cooldown = 0, vExit = 0;
    let phase: 'glide' | 'cool' = 'glide';
    for (let t = 0; t < 400; t++) {
      tick(p, h, 1);
      if (phase === 'glide') {
        if (p.dashDelay > 0) { vExit = p.vx; phase = 'cool'; }
        else glide++;
      } else {
        if (p.dashDelay === 0) break;
        cooldown++;
      }
    }
    expect(glide).toBeGreaterThan(20);                       // 滑行带（实测 31≈手算 vanilla 32±摩擦相位）
    expect(glide).toBeLessThan(45);
    expect(cooldown).toBe(19);                               // 冷却=20 拍（含出口拍;:21567 num17=20）
    expect(vExit).toBeCloseTo(6.5, 6);                       // num15=max(accRun=mount.dashSpeed 6.5, maxRun 3)
    expect(p.dashDelay).toBe(0);                             // 就绪
  });

  it('3b 反向收敛:m6Ended → dashDelay=30 + vx×0.3（:21523-21525）+ 当拍零尾尘', () => {
    const { p, w, h: h0 } = mountedPlayer();
    const vd = new VanillaDust();
    const h = { ...(fakeHooks(w, p, vd) as Record<string, unknown>) } as never;
    // 重新稳定一拍（换 hooks 后）
    p.fixedUpdate(1 / 60, h);
    tick(p, h, 1); tick(p, h, 0); tick(p, h, 0); tick(p, h, 0); tick(p, h, 0);
    tick(p, h, 1);
    expect(p.dashDelay).toBe(-1);
    // 同向滑行 3 拍:每拍 +8 尘306
    const count306 = (): number => [...vd.each(true)].filter((d) => d.type === 306).length;
    tick(p, h, 1); const c1 = count306();
    tick(p, h, 1); const c2 = count306();
    expect(c2 - c1).toBe(8);                                 // :21531-21548 8×/拍（曾整缺=0 红）
    // 反向拍:facing 翻转 → m6Ended → dashDelay=30、零新尘;vx×0.3 后出口钳回 num15=6.5
    tick(p, h, -1);
    const c3 = count306();
    expect(p.dashDelay).toBe(30);                            // :21523 收敛 30（非 20）
    expect(c3 - c2).toBe(0);                                 // 收敛拍零尾尘（vanilla else 臂才发尘）
    expect(p.vx).toBeCloseTo(6.5, 6);                        // ×0.3(≈4) → 出口钳 +num15（:21567/:21573）
  });

  it('3c 域锁:冷却倒数逐拍单步（dashDelay 30→29）——防误挂错门/双扣', () => {
    const { p, h } = mountedPlayer();
    tick(p, h, 1); tick(p, h, 0); tick(p, h, 0); tick(p, h, 0); tick(p, h, 0);
    tick(p, h, 1);
    tick(p, h, -1);                                          // 收敛 → 30
    expect(p.dashDelay).toBe(30);
    tick(p, h, 0);
    expect(p.dashDelay).toBe(29);                            // 单步倒数
  });
});
