// 631 幻象矢贴图朝向锁(用户实报"幻影弓影子箭方向反了,应该镜像翻转"):
// 原版 AI_122 尾 Projectile.cs:35613 rotation = velocity.ToRotation() − π/2(减号)
// ——Projectile_631.png 尖端朝下叉口朝上(已验 PNG),−π/2 把"下向尖端"对齐速度向。
// 曾走默认 +π/2(朝上贴图假设)=整差 180°,左飞视觉朝右。本测试锁三面:
//  ①PROJ_ROT_DOWN 成员=631(629 同支但 0 消费面,登记不入集)
//  ②四基向速度下"尖端方向≡速度方向"的旋转数学(等价 180° 差判别力:+π/2 全红)
//  ③源码结构锁(分支在位+默认支不可达 631)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROJ_ROT_DOWN } from '../src/entities/Arrow';

// canvas rotate(θ) 顺时针:R(θ)·v。尖端在贴图空间朝下 = (0,1)。
function tipDir(vx: number, vy: number): [number, number] {
  const ang = Math.atan2(vy, vx);
  const theta = PROJ_ROT_DOWN.has(631) ? ang - Math.PI / 2 : ang + Math.PI / 2;
  // R(θ)·(0,1) = (−sinθ, cosθ)
  return [-Math.sin(theta), Math.cos(theta)];
}

describe('631 幻象矢贴图朝向(AI_122 :35613 −π/2)', () => {
  it('成员=631 恰一员(629 同支 0 消费面不入集)', () => {
    expect([...PROJ_ROT_DOWN]).toEqual([631]);
  });

  it('四基向速度:尖端方向≡速度方向(旧 +π/2 下全部反向)', () => {
    const cases: Array<[number, number]> = [[-6, 0], [6, 0], [0, -6], [0, 6]];
    for (const [vx, vy] of cases) {
      const [tx, ty] = tipDir(vx, vy);
      // 点积 >0 = 尖端与速度同向;旧 +π/2 公式下点积恒 −1 = 180° 反
      expect(vx * tx + vy * ty).toBeGreaterThan(0);
    }
  });

  it('结构锁:draw 链分支在位且先于默认支', () => {
    const src = readFileSync(new URL('../src/entities/Arrow.ts', import.meta.url), 'utf8');
    expect(src).toContain('const PROJ_ROT_DOWN = new Set([631])');
    // 分支序:PROJ_ROT_DOWN 支必须位于默认支(else 兜底)之前
    // ★BJ731 改判史（2026-10-27）：G10（R2-F13 字面纪律）缺省支 `ang + Math.PI / 2`
    //   改原版字面 1.57f（:58733）——默认支定位锚随迁;G11 件4 加 0.785/π/4 两斜
    //   支仍在 631 支之后（链序语义不变）。
    const downIdx = src.indexOf('PROJ_ROT_DOWN.has(this.projId)');
    const defaultIdx = src.indexOf(': ang + 1.57)');
    expect(downIdx).toBeGreaterThan(0);
    expect(defaultIdx).toBeGreaterThan(downIdx);
    // 减号锁(防回改 +π/2)
    expect(src).toContain('ctx.rotate(ang - Math.PI / 2)');
  });
});
