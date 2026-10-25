// ★BJ710-B（2026-10-24 用户转报实报「专家模式星云激光进防御前 260 vs Wiki 200」）判别锁。
//  定谳：原版 Projectile.cs:33871-33883（case 574 环绕眼射 576 激光）——
//  `num823=576; num824=65; if (Main.expertMode) num824=50;`——专家档基础伤 50
//  覆写（Main.expertMode 在大师档亦真=专家/大师双档 50;经典 65）。仓内旧硬编码
//  65 无门 → 专家 65×2×2=260 偏高 30%（Wiki 200=50×2×2）。修=LunarOrb 线发位
//  mainExpertMode 门。★M1 变异：回硬编码 65 → §1 红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');
const src = readFileSync(join(GAME, 'src/entities/bossAI_lunar_misc.ts'), 'utf8');
const van = readFileSync(join(VAN, 'Terraria', 'Projectile.cs'), 'utf8');

describe('§1 仓内门（M1 位）', () => {
  it('线发 576 伤害=mainExpertMode ? 50 : 65（专家/大师 50,经典/旅程 65）', () => {
    expect(src).toContain('const dmg576 = mainExpertMode(game.world) ? 50 : 65;   // :33878-33882');
    expect(src).not.toMatch(/\(dx \/ d\) \* 8, \(dy \/ d\) \* 8, 65, 0, 576,/);   // 旧硬编码零残留
  });
});

describe('§2 反编译锚', () => {
  it('case 574：576 弹 + 65 基伤 + expertMode 50 覆写', () => {
    const i = van.indexOf('case 574:');
    expect(i).toBeGreaterThan(-1);
    const blk = van.slice(i, i + 400);
    expect(blk).toContain('num823 = 576;');
    expect(blk).toContain('num824 = 65;');
    expect(blk).toMatch(/if \(Main\.expertMode\)\s*\{\s*num824 = 50;/);
  });
  it('数值闭环：50×2×2=200（Wiki 专家值）vs 旧 65×2×2=260（实报值）', () => {
    expect(50 * 2 * 2).toBe(200);
    expect(65 * 2 * 2).toBe(260);
  });
});
