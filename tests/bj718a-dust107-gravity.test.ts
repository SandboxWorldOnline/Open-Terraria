// ★BJ718-A（2026-10-25，R17-P2 清偿件 1）尘 107（Terra）重力臂例外行为锁。
// 定谳锚（三版本同文,1456 :1884-1894 / 1457 :1889-1899 / 1458 :1891-1901）：
//   else if (!dust.noGravity && type!=41/44/309) {
//     if (dust.type == 107) dust.velocity *= 0.9f;   // 两轴阻尼（Vector2 标量乘）
//     else dust.velocity.Y += 0.1f; }
// 旧病灶（R17-D1）：SW 重力臂（VanillaDust.ts 重力门）无 107 例外 → 重力档
//   107 尘吃 +0.1 下坠（替两轴 ×0.9 阻尼）。
// 发射方普查（R17「疑均 noGravity」证伪）：
//   ① Minecart.wheelSparkDust sparksTerraFart 支（Minecart.ts:747，DelegateMethods.cs
//     :349-373 TerraFart 矿车绿妖精尘）——noGravity = Next(3)==0（:368）→ 2/3 重力档
//     = 实害面（尘该阻尼慢散却加速下坠）；
//   ② orchestraFx terraBladeFx → swordConeArmDust（orchestraFx.ts:946，TerraBlade
//     :2788-2793 剑尖尘对）——恒 noGravity=true → 重力臂不达 = 无实害（结构锁钉值）。
// 行为锁：合成夹具直调 VanillaDust.update，覆写 spawn 抖动面钉死入池态（clone 同体裁）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VanillaDust, type VDust } from '../src/fx/VanillaDust';

const GAME = join(__dirname, '..');

function spawnPinned(vd: VanillaDust, type: number, noGravity: boolean, vx: number, vy: number): VDust {
  const d = vd.spawn(500, 500, 1, 1, type, 0, 0, 100, null, 1);
  if (!d) throw new Error('spawn rejected（空池首尘不应拒）');
  d.x = 500; d.y = 500; d.vx = vx; d.vy = vy;   // 覆写 NewDust 位/速抖动
  d.scale = 1; d.alpha = 100; d.fadeIn = 0; d.noGravity = noGravity;
  return d;
}

describe('BJ718-A R17-D1：尘 107 重力臂例外（Dust.cs:1889-1899）', () => {
  it('重力档 107：velocity×0.9 两轴（替 +0.1）——旧缺例外在此判红', () => {
    const vd = new VanillaDust();
    const d = spawnPinned(vd, 107, false, 1.5, -2.0);
    vd.update(0, 0, 100000, 100000, 0, 0, null, null, null, null);
    expect(d.vx).toBeCloseTo(1.5 * 0.9, 12);   // 旧缺例外:vx 恒 1.5
    expect(d.vy).toBeCloseTo(-2.0 * 0.9, 12);  // 旧缺例外:vy=−1.9（+0.1）
  });

  it('noGravity 107：重力臂跳过，链 B 兜底 ×0.92（swordConeArmDust 面）', () => {
    const vd = new VanillaDust();
    const d = spawnPinned(vd, 107, true, 1.0, -3.0);
    vd.update(0, 0, 100000, 100000, 0, 0, null, null, null, null);
    // :2407-2413 兜底（type!=304 && noGravity → velocity×0.92）;误吃 +0.1 会得 −2.9
    expect(d.vx).toBeCloseTo(1.0 * 0.92, 12);
    expect(d.vy).toBeCloseTo(-3.0 * 0.92, 12);
  });

  it('对照：非 107 重力档尘照旧 vy+0.1、vx 不动', () => {
    const vd = new VanillaDust();
    const d = spawnPinned(vd, 0, false, 1.5, -2.0);
    vd.update(0, 0, 100000, 100000, 0, 0, null, null, null, null);
    expect(d.vx).toBeCloseTo(1.5, 12);
    expect(d.vy).toBeCloseTo(-2.0 + 0.1, 12);
  });

  it('结构锁：两活发射方 noGravity 态钉值（实害面普查入锁）', () => {
    const minecartSrc = readFileSync(join(GAME, 'src/entities/Minecart.ts'), 'utf8');
    // ① 实害面：sparksTerraFart 107 尘 noGravity=Next(3)==0（DelegateMethods:368，
    //    2/3 重力档 → 行为锁①的可达前提）
    expect(minecartSrc).toContain('1, 1, 107, vx0, vy0, 100');
    expect(minecartSrc).toContain('d.noGravity = rand(0, 3) === 0;');
    const orchSrc = readFileSync(join(GAME, 'src/fx/orchestraFx.ts'), 'utf8');
    // ② 无实害面：swordConeArmDust 恒 noGravity=true（TerraBlade :2790 后置赋值）
    expect(orchSrc).toContain('if (d) { d.noGravity = true; d.scale = scale; }');
  });
});
