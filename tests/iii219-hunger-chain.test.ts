// IIII219：The Constant/天顶饥饿链单元测试（Buffs 域）。
// 真值锚 = 反编译 1458 Player.cs：UpdateStarvingState :12240-12262 / UpdateHungerBuffs
// :12186-12238 / 极饿流干 :19255-19276+:19458-19477 / IsFedState 换档 AddBuff :5269-5277 /
// TryToResetHungerToNeutral :12169-12184（消费面 蘑菇 5 :52513、蛋奶酒 1912 :52507）。
// ★链形态定谳（1456 :11677-11735 与 1458 逐字同构）：332→(≤2t)→333→(≤2t)→334【恒 5t
//   无自持重钉】→到期→UpdateStarvingState 重授 332——极饿是周期性 5t 毛刺（AddBuff
//   的 IsFedState 换档 :5269 删旧 fed 态,333 不残留重钉 334）。极饿流干账
//   （lifeRegenCount）在毛刺间由自然回复正项回收（:19382 无条件累加 + :19398 正项
//   兑付,满血照走）→ 单毛刺 −20≪−num13 不出伤;本仓同构（R5-F7 已废双通道）。
//   H7/H8 的「持续极饿」是接线验证态（人为续钉 334 = vanilla lifeRegenCount 已深负
//   时的流干语义),非自然可达态——vanilla 自然循环同样永不出伤。
// 天顶域 = Main.dontStarveWorld（seedFlags.theConstant,getfixedboi 七依赖含 DontStarve）。
import { describe, it, expect } from 'vitest';
import { BuffState, BuffType } from '../src/stats/Buffs';

const DT = 1 / 60;

/** 恒定世界 BuffState（zenith/remix 组合档） */
function makeBuffs(opts: { theConstant?: boolean; remix?: boolean; maxHp?: number } = {}) {
  const b = new BuffState();
  b.dontStarveWorld = opts.theConstant ?? true;
  b.remixHunger = !!(opts.remix ?? true);
  b.starvingMaxHp = opts.maxHp ?? 100;
  return b;
}

/** 推进链到极饿毛刺（332→333→334） */
function toStarving(b: BuffState): void {
  b.tick(DT);
  b.set(BuffType.NeutralHunger, 0.04); b.tick(DT);   // ≤2t → 333（换档删 332）
  b.set(BuffType.Hunger, 0.04); b.tick(DT);          // ≤2t → 334（换档删 333）
}

describe('IIII219 饥饿链（332→333→334 毛刺循环）', () => {
  it('H1 非constant 世界三态不入栏（UpdateBuffs :9959 总门）', () => {
    const b = makeBuffs({ theConstant: false });
    for (let i = 0; i < 120; i++) b.tick(DT);
    expect(b.active.has(BuffType.NeutralHunger)).toBe(false);
  });

  it('H2 constant 无 fed-state → 授 332（remix 组合 28800t=480s,:12251）', () => {
    const b = makeBuffs();
    b.tick(DT);
    expect(b.active.get(BuffType.NeutralHunger)).toBeCloseTo(480, 1);
  });

  it('H3 非 remix constant 档 18000t=300s（:12255）', () => {
    const b = makeBuffs({ remix: false });
    b.tick(DT);
    expect(b.active.get(BuffType.NeutralHunger)).toBeCloseTo(300, 1);
  });

  it('H4 332≤2t → 333 480s 且换档删 332（AddBuff IsFedState :5269）+ hungry 事件', () => {
    const b = makeBuffs();
    const events: string[] = [];
    b.onHungerEvent = (k) => events.push(k);
    b.tick(DT);
    b.set(BuffType.NeutralHunger, 0.04);
    b.tick(DT);
    expect(b.active.has(BuffType.NeutralHunger)).toBe(false);   // 333 换档删 332
    expect(b.active.get(BuffType.Hunger)).toBeCloseTo(480, 1);
    expect(events.filter((e) => e === 'hungry').length).toBe(1);  // 表情 147
  });

  it('H5 333≤2t → 334 恒 5t + starving 事件（:12219-12223）', () => {
    const b = makeBuffs();
    const events: string[] = [];
    b.onHungerEvent = (k) => events.push(k);
    toStarving(b);
    expect(b.active.has(BuffType.Starving)).toBe(true);
    expect(b.active.get(BuffType.Starving)!).toBeLessThanOrEqual(5 / 60 + 1e-9);
    expect(b.active.has(BuffType.Hunger)).toBe(false);            // 换档删 333
    expect(events.filter((e) => e === 'starving').length).toBe(1);  // 表情 148 + Hungry 音
  });

  it('H6 334 持续不自灭（★BJ739 B02 改判：TimeLeftDoesNotDecrease 表,issue #29）', () => {
    // 旧「毛刺 5t 到期 → 332 重授」循环重启 = 缺递减门时期的近似;原版 334 在
    // BuffID.cs:22 不递减表——极饿持续到食物/蘑菇重置（tryToResetHungerToNeutral）
    const b = makeBuffs();
    toStarving(b);
    for (let i = 0; i < 10; i++) b.tick(DT);
    expect(b.active.has(BuffType.Starving)).toBe(true);           // 持续
    expect(b.active.get(BuffType.Starving)).toBeCloseTo(5 / 60, 9);  // 时长钉 5t
    expect(b.active.has(BuffType.NeutralHunger)).toBe(false);     // 不重播 332
    b.tryToResetHungerToNeutral();
    expect(b.active.has(BuffType.Starving)).toBe(false);          // 蘑菇/蛋奶酒重置可清
  });

  it('H7 持续极饿流干（接线验证）：100hp → num12=2 HP 每 60t 一跳（:19458-19477）', () => {
    const b = makeBuffs({ maxHp: 100 });
    toStarving(b);
    let hp = 100;
    for (let i = 0; i < 121; i++) {
      b.set(BuffType.Starving, 5 / 60);       // 人为续钉（= vanilla count 已深负的流干态）
      const heal = b.tick(DT);
      if (heal < 0) hp = Math.max(0, hp + heal);
    }
    expect(hp).toBe(96);                       // 120t 恰两跳（60t/跳）
  });

  it('H8 沙漠/雪原 ×2（:19465 starvingZoneBoost）', () => {
    const b = makeBuffs({ maxHp: 100 });
    b.starvingZoneBoost = true;
    toStarving(b);
    let hp = 100;
    for (let i = 0; i < 61; i++) {
      b.set(BuffType.Starving, 5 / 60);
      const heal = b.tick(DT);
      if (heal < 0) hp = Math.max(0, hp + heal);
    }
    expect(hp).toBe(96);                       // 60t 恰一跳 dmg=num12×2=4
  });

  it('H9 喂饱剥离三态（IsFedState :5269）+ fed 期不重授 332', () => {
    const b = makeBuffs();
    toStarving(b);
    b.apply(BuffType.WellFed, 60);
    expect(b.active.has(BuffType.Starving)).toBe(false);
    expect(b.active.has(BuffType.Hunger)).toBe(false);
    expect(b.active.has(BuffType.WellFed)).toBe(true);
    for (let i = 0; i < 60; i++) b.tick(DT);
    expect(b.active.has(BuffType.NeutralHunger)).toBe(false);
  });

  it('H10 TryToResetHungerToNeutral：三态清零、链回 332 满档（:12169-12184）', () => {
    const b = makeBuffs();
    toStarving(b);
    b.tryToResetHungerToNeutral();
    expect(b.active.has(BuffType.Hunger)).toBe(false);
    expect(b.active.has(BuffType.Starving)).toBe(false);
    b.tick(DT);                                 // 下拍 UpdateStarvingState 重授
    expect(b.active.get(BuffType.NeutralHunger)).toBeCloseTo(480, 1);
  });

  it('H11 死亡冻结：dead 期链不推进不转移（UpdateDead 无 UpdateBuffs）', () => {
    const b = makeBuffs();
    b.tick(DT);
    b.hungerPlayerAlive = false;                // Player.fixedUpdate 写 !dead
    b.set(BuffType.NeutralHunger, 0.04);
    for (let i = 0; i < 10; i++) b.tick(DT);
    expect(b.active.has(BuffType.Hunger)).toBe(false);   // 转移被冻结
  });

  it('H12 极饿毛刺间流干账清零（vanilla lifeRegenCount 回收 :19382/:19398）', () => {
    const b = makeBuffs({ maxHp: 100 });
    // 12 轮完整毛刺循环（每轮 ~13t）——若累加账跨毛刺结转（每毛刺 −1/60 HP）,
    // 12 轮攒 −0.2 → 续钉后 ~6t 内提前出首跳;清账正确则首跳仍在整 60t 档
    for (let c = 0; c < 12; c++) { toStarving(b); for (let i = 0; i < 10; i++) b.tick(DT); }
    toStarving(b);
    let hp = 100;
    let firstHitTick = -1;
    for (let i = 0; i < 61; i++) {
      b.set(BuffType.Starving, 5 / 60);
      const heal = b.tick(DT);
      if (heal < 0 && firstHitTick < 0) firstHitTick = i;
      if (heal < 0) hp = Math.max(0, hp + heal);
    }
    expect(firstHitTick).toBeGreaterThanOrEqual(58);   // 账从零起算（无跨毛刺结转）
    expect(firstHitTick).toBeLessThanOrEqual(60);
    expect(hp).toBe(98);
  });
});
