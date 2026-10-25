// 鲨鱼龙卷伤害链回归（2026-08-21 定谳批）。
// 原版链：龙卷由 SharknadoBolt 385 Kill 弹生弹（Projectile.cs :4919 段）——
// 基础值生成处难度分支：小 384 = expertMode?25:40、大 386 = expertMode?50:80；
// 命中走 Damage_EVP（:13770-13781）= hostileProjectileDamage 乘区
// （旅程0.5/经典1/专家2/大师3）× 通用敌弹 ×2。
// 终值：经典 80/160、专家 100/200、大师 150/300。
// 曾烤死经典终值 80/160 = 专家/大师低伤、旅程双倍伤。
import { describe, it, expect, vi, afterEach } from 'vitest';
afterEach(() => { vi.restoreAllMocks(); });   // ★BJ712-C
import { DukeSharknadoTornado } from '../src/entities/bossAI_duke_moonlord';

/** 构造龙卷并让本地玩家与其重叠跑 1 tick，捕获 damagePlayer 伤害 */
function hitDamage(big: boolean, difficulty: number): number {
  const src = { id: 1, dead: false };
  const t = new DukeSharknadoTornado(100 * 16, 100 * 16, big, src as never);
  const captured: number[] = [];
  const game = {
    world: { difficulty, store: { inBounds: () => false, isSolid: () => false } },
    player: { dead: false, cx: 100 * 16, cy: 100 * 16, w: 16, h: 16 },
    damagePlayer: (dmg: number): number => { captured.push(dmg); return 0; },
  };
  t.fixedUpdate(1 / 60, game as never);
  return captured[0] ?? -1;
}

describe('鲨鱼龙卷伤害链（385 弹生弹 + Damage_EVP）', () => {
  it('四档难度终值表（小/大）', () => {
  // ★BJ712-C：DamageVar 首掷入参包装（P.cs:14904）后链带 ±15% 掷——mock 0.5
  // = tier 0 档（×1.0）,表值即掷中值;掷形面由 tests/bj712c-martian-dmg 三掷形承载
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(hitDamage(false, 0)).toBe(80);    // 经典 40×1×2
    expect(hitDamage(true, 0)).toBe(160);    // 经典 80×1×2
    expect(hitDamage(false, 1)).toBe(100);   // 专家 25×2×2
    expect(hitDamage(true, 1)).toBe(200);    // 专家 50×2×2
    expect(hitDamage(false, 2)).toBe(150);   // 大师 25×3×2
    expect(hitDamage(true, 2)).toBe(300);    // 大师 50×3×2
  });

  it('attacker 传 src Enemy（死亡归因），非数字（火星飞碟同款事故防线）', () => {
    let attacker: unknown = 'unset';
    const src = { id: 7, dead: false };
    const t = new DukeSharknadoTornado(100 * 16, 100 * 16, false, src as never);
    const game = {
      world: { difficulty: 0, store: { inBounds: () => false, isSolid: () => false } },
      player: { dead: false, cx: 100 * 16, cy: 100 * 16, w: 16, h: 16 },
      damagePlayer: (_d: number, _x: number, _y: number, a: unknown): number => { attacker = a; return 0; },
    };
    t.fixedUpdate(1 / 60, game as never);
    expect(attacker).toBe(src);
  });
});
