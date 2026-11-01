// 甲虫 buff 族 + 环境光环五缺口补图（2026-08-31 实装批）的纯逻辑面测试。
// 原版权威：Player.cs:10430-10531（两族效果循环）/ :16615-16697（两臂授予）/
// :19922-19946+:20221-20232（强风推力）/ BuffID.cs:343-353（内部名）。
import { describe, it, expect } from 'vitest';
import { BeetleMeter } from '../src/player/BeetleMeter';
import { windPushImpulse } from '../src/entities/Player';
import { BuffType, BUFF_DEFS, buffTypeByVanilla } from '../src/stats/Buffs';

// ---- 风推脉冲（:19922-19940 逐系数） ----
describe('MightyWind windPushImpulse', () => {
  it('微风基速 = sign×0.06', () => {
    expect(windPushImpulse(0.3, false, false)).toBeCloseTo(0.06, 10);
    expect(windPushImpulse(-0.3, false, false)).toBeCloseTo(-0.06, 10);
  });
  it('强风(|wind|>0.5) ×1.37', () => {
    expect(windPushImpulse(0.8, false, false)).toBeCloseTo(0.06 * 1.37, 10);
  });
  it('腾空 ×1.5', () => {
    expect(windPushImpulse(0.8, true, false)).toBeCloseTo(0.06 * 1.37 * 1.5, 10);
  });
  it('持方向键 ×0.8 且钳 ±0.072（:19936-19939）', () => {
    // 强风腾空持键：0.1233×0.8=0.09864 → 钳到 0.072
    expect(windPushImpulse(0.8, true, true)).toBeCloseTo(0.072, 10);
    // 微风持键：0.06×0.8=0.048 不触钳
    expect(windPushImpulse(0.3, false, true)).toBeCloseTo(0.048, 10);
    expect(windPushImpulse(-0.8, true, true)).toBeCloseTo(-0.072, 10);
  });
});

// ---- 甲虫 buff 钉值/换档/换族/衰减（BeetleMeter.pinBuffs） ----
interface FakeBuffs {
  applied: Array<[BuffType, number]>;
  removed: BuffType[];
  live: Map<BuffType, number>;
}
function fakeBuffs(): FakeBuffs & { has(t: BuffType): boolean; apply(t: BuffType, s: number): void; remove(t: BuffType): void } {
  const f = { applied: [] as Array<[BuffType, number]>, removed: [] as BuffType[], live: new Map<BuffType, number>() };
  return {
    ...f,
    has(t: BuffType) { return f.live.has(t); },   // ★BJ745 A16：meter Phase1 派生读面
    apply(t: BuffType, s: number) { f.applied.push([t, s]); f.live.set(t, s); },
    remove(t: BuffType) { f.removed.push(t); f.live.delete(t); },
  };
}

describe('BeetleMeter buff 钉值管道', () => {
  // ★BJ745 A16（issue#35,2026-11-01）：buff 单源重构——orbs 每拍由 UpdateBuffs 从
  // 95-100 档 buff 重派生（族守卫读【上拍】族旗）,梯子只 AddBuff 不直写 orbs。
  // 旧用例的「同帧 orbs 跳档/换族当帧剥」期望系旧持久字段模型的语义,按原版逐拍
  // 相重写（换壳 3/0/1 = issue#35 A16 实测锚;派生滞后一拍=UpdateBuffs 先于
  // UpdateArmorSets 的构造性时序）。
  it('猛攻族蓄能爬档 → 钉 98/99/100 当档 5/60 秒,非当档立删;orbs 派生滞后一拍', () => {
    const fb = fakeBuffs();
    const host = { beetleOrbs: 0, buffs: fb };
    const m = new BeetleMeter();
    m.registerHit(500, true);
    m.tick(host, true, false);
    expect(host.beetleOrbs).toBe(0);                       // 本拍只 AddBuff(98),orbs 下拍派生
    expect(fb.live.get(BuffType.BeetleMight1)).toBeCloseTo(5 / 60, 10);
    expect(fb.live.has(BuffType.BeetleMight2)).toBe(false);
    m.tick(host, true, false);
    expect(host.beetleOrbs).toBe(1);                       // UpdateBuffs 从 98 派生（:10506）
    m.registerHit(5000, true);   // counter 跨过 400+1200+3600 = 5200 → 3 档
    m.tick(host, true, false);
    expect(host.beetleOrbs).toBe(1);                       // 换档拍 orbs 仍旧值
    expect(fb.live.get(BuffType.BeetleMight3)).toBeCloseTo(5 / 60, 10);
    expect(fb.live.has(BuffType.BeetleMight1)).toBe(false);   // 换档立删旧档（:16686-16696）
    m.tick(host, true, false);
    expect(host.beetleOrbs).toBe(3);
  });

  it('★A16 换壳胸甲（满 Might 3 → 防御壳）逐拍相 3/0/1（issue#35 实测锚）', () => {
    const fb = fakeBuffs();
    const host = { beetleOrbs: 0, buffs: fb };
    const m = new BeetleMeter();
    // 攒满 Might 3（进攻套在身）
    for (let i = 0; i < 4; i++) { m.registerHit(2000, true); m.tick(host, true, false); }
    m.tick(host, true, false);
    expect(host.beetleOrbs).toBe(3);
    expect(fb.live.has(BuffType.BeetleMight3)).toBe(true);
    // 换壳（防御套）——原版拍末球数 3/0/1：
    m.tick(host, false, true);       // 拍1：族守卫读上拍旗（offense）→Might3 保留,orbs=3
    expect(host.beetleOrbs).toBe(3);
    expect(fb.live.has(BuffType.BeetleMight3)).toBe(true);
    m.tick(host, false, true);       // 拍2：上拍旗=defense →守卫剥 Might3,orbs=0;梯子 AddBuff(95)
    expect(host.beetleOrbs).toBe(0);
    expect(fb.live.has(BuffType.BeetleMight3)).toBe(false);
    expect(fb.live.has(BuffType.BeetleEndurance1)).toBe(true);
    m.tick(host, false, true);       // 拍3：UpdateBuffs 从 95 派生 orbs=1
    expect(host.beetleOrbs).toBe(1);
  });

  it('换族对面族残留：守卫独立剥（上拍族旗不含该族 → 当拍 DelBuff）', () => {
    const fb = fakeBuffs();
    const host: { beetleOrbs: number; buffs: ReturnType<typeof fakeBuffs> } = { beetleOrbs: 0, buffs: fb };
    const m = new BeetleMeter();
    m.tick(host, true, false);       // 猛攻在身一拍（族旗=offense）
    fb.live.set(BuffType.BeetleEndurance2, 5 / 60);   // 预置对面族残留
    m.tick(host, true, false);       // 壳族守卫（上拍旗 offense ≠ defense）→ Endurance2 当拍剥
    expect(fb.live.has(BuffType.BeetleEndurance2)).toBe(false);
  });

  it('双套离身：counter=0 当拍;might 族 buff 一拍滞后剥（族守卫读上拍旗）', () => {
    const fb = fakeBuffs();
    const host = { beetleOrbs: 0, buffs: fb };
    const m = new BeetleMeter();
    m.registerHit(500, true);
    m.tick(host, true, false);       // AddBuff(98),族旗=offense
    m.tick(host, true, false);       // orbs=1 派生
    expect(host.beetleOrbs).toBe(1);
    m.tick(host, false, false);      // 离身拍：守卫读上拍旗（offense）→Might1 保留,orbs=1
    expect(m.stateForTest().counter).toBe(0);               // :16560 counter 当拍清
    expect(host.beetleOrbs).toBe(1);
    m.tick(host, false, false);      // 次拍：上拍旗 none →守卫剥,orbs=0
    expect(host.beetleOrbs).toBe(0);
    expect(fb.live.has(BuffType.BeetleMight1)).toBe(false);
  });

  it('裸宿主（无 buffs）不炸——无 buff 栏则派生恒 0（原版无栏同构）', () => {
    const host = { beetleOrbs: 0 };
    const m = new BeetleMeter();
    m.registerHit(500, true);
    expect(() => m.tick(host, true, false)).not.toThrow();
    expect(host.beetleOrbs).toBe(0);   // AddBuff 无栏可落=派生无源（旧期望 1 系持久字段模型）
  });
});

// ---- 原版 id 映射（BUFF_DEFS.vanillaBuff ↔ 反查桥） ----
describe('甲虫/光环五缺口 原版 id 映射', () => {
  it('甲虫六档 vanillaBuff = 95..100（BuffID.BeetleEndurance1..3/BeetleMight1..3）', () => {
    expect(BUFF_DEFS[BuffType.BeetleEndurance1].vanillaBuff).toBe(95);
    expect(BUFF_DEFS[BuffType.BeetleEndurance2].vanillaBuff).toBe(96);
    expect(BUFF_DEFS[BuffType.BeetleEndurance3].vanillaBuff).toBe(97);
    expect(BUFF_DEFS[BuffType.BeetleMight1].vanillaBuff).toBe(98);
    expect(BUFF_DEFS[BuffType.BeetleMight2].vanillaBuff).toBe(99);
    expect(BUFF_DEFS[BuffType.BeetleMight3].vanillaBuff).toBe(100);
  });
  it('光环五缺口 vanillaBuff = 86/89/147/194/350 且反查桥贯通', () => {
    expect(BUFF_DEFS[BuffType.WaterCandle].vanillaBuff).toBe(86);
    expect(BUFF_DEFS[BuffType.HeartLamp].vanillaBuff).toBe(89);
    expect(BUFF_DEFS[BuffType.MonsterBanner].vanillaBuff).toBe(147);
    expect(BUFF_DEFS[BuffType.WindPushed].vanillaBuff).toBe(194);
    expect(BUFF_DEFS[BuffType.ShadowCandle].vanillaBuff).toBe(350);
    expect(buffTypeByVanilla(194)).toBe(BuffType.WindPushed);
    expect(buffTypeByVanilla(350)).toBe(BuffType.ShadowCandle);
  });
});
