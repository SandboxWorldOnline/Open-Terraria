// BJ447 蜂蜜对冲 hp 真值整数化（BJ443 姊妹债清偿刀）。
//
// 原版算式锚（1457 反编译 Player.cs 亲读,全链 int 无浮点）：
//   · :1919 `public int lifeRegen` / :1921 `public int lifeRegenCount` —— 流率与
//     账面双 int;
//   · :19212-19219 蜂蜜对冲：`if (honey && lifeRegen < 0) { lifeRegen += 4;
//     if (lifeRegen > 0) lifeRegen = 0; }` —— DoT 在账时每 tick 整数 +4 单位
//     （120 单位 = 1 HP）,钳 ≤0 只作用于当期流量;
//   · :19250-19254 蜂蜜 flat：`lifeRegen += 2`（= 1 HP/s,整数,不被 DoT 清零）;
//   · :19384 `lifeRegenCount += lifeRegen` —— 整数账面累积（延迟弹出账）;
//   · :19407-19412 正兑付 `while (lifeRegenCount >= 120) { -=120; statLife++ }`;
//   · :19478-19482 负兑付 `while (lifeRegenCount <= -120) { num14 = min(count/-120, 4);
//     lifeRegenCount += 120*num14; HurtLifeRegen(num14); }` —— 整 HP 差额延迟弹出。
// 本仓分块架构等价物（Buffs.tick）：honeyOffsetUnits 整数位账,+4 单位/tick 计提
//   （:19214 原式）,兑付按整 HP（120 单位）抵减本 tick 已弹出的 DoT 分块,余数
//   （<120 单位）跨 tick 结转、蜂蜜/DoT 离栏即弃 —— 长期净流率与原版逐单位一致,
//   heal/dotChunkOut 恒整（BJ443 登记债：旧 cancel=2×dt 浮点携分数入 hp 真值面）。
//
// 判别面（变异=摘整数化回浮点 2×dt 计提 → ①③④ 全红）：
//   ① hp/真值恒整数 ② 净额守恒（vs 原版算式锚,±1 延迟弹出容差）
//   ③ DoT 飘字/真值双面整数 ④ 原版 +4/tick 计提节奏对拍（Burning 块 5,5,4 节拍）。
import { describe, expect, it } from 'vitest';
import { BuffState, BuffType } from '../src/stats/Buffs';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';

// ---- 原版算式锚常量（Player.cs 行号见文件头） ----
const VAN_BURNED = -60;      // :19175 burned lifeRegen -= 60（Burning 30 HP/s）
const VAN_ONFIRE = -8;       // :19109 onFire lifeRegen -= 8（OnFire 4 HP/s）
const VAN_VENOM = -30;       // :19081 venom lifeRegen -= 30（Venom 15 HP/s）
const VAN_POISON = -4;       // :19072 poisoned lifeRegen -= 4（Poisoned 2 HP/s）
const VAN_HONEY_OFFSET = 4;  // :19214 honey 对冲 +4（lifeRegen<0 时,每 tick）
const VAN_HONEY_FLAT = 2;    // :19253 honey flat +2（恒在,DoT 后不被清零）
const VAN_CHUNK = 120;       // :19478 lifeRegenCount 负弹出门槛（120 单位 = 1 HP）
const TICKS = 600;           // 10 s 窗口
const DT = 1 / 60;

/** 原版净流率期望（HP/600t 窗口）：Σ(lifeRegen 单位/tick) × 600 ÷ 120 */
const vanFlow = (dotUnits: number, honey: boolean) =>
  ((dotUnits + (honey ? VAN_HONEY_OFFSET + VAN_HONEY_FLAT : 0)) / VAN_CHUNK) * TICKS;

const run = (b: BuffState, ticks: number) => {
  let sum = 0;
  for (let k = 0; k < ticks; k++) sum += b.tick(DT);
  return sum;
};

// ---- Player.fixedUpdate 夹具（同 BJ443;damagePlayer=0 屏蔽外源伤害,hp 变化
//      唯一入口 = buffs.tick 返回值 → :4101/:4103 hp 写入） ----
const fakeHooks = (w: World, p: Player, captured: number[]) => ({
  world: w,
  player: p,
  enemies: () => [],
  critters: () => [],
  spawnDrop: () => null,
  damagePlayer: (): number => 0,
  addDamageNumber: (_x: number, _y: number, a: number) => { captured.push(a); },
  cutTile: () => {},
  onEnemyKilled: () => {},
  spawnEnemy: () => {},
  spawnParticles: () => {},
  notifyInventoryChanged: () => {},
  playSfx: () => {},
  playSfxFiles: () => {},
  showPickupLabel: () => {},
});

// ---- ① hp 真值恒整数 ----

describe('BJ447 ① hp 真值恒整数', () => {
  it('OnFire+Honey 600 tick：p.hp 每 tick 整数,末值=原版算式锚（-10±1）', () => {
    const w = new World(60, 60, 42, 'bj447a');
    const p = new Player(20 * 16, 27 * 16, new Inventory());
    p.buffs.apply(BuffType.OnFire, 30);
    p.buffs.apply(BuffType.Honey, 30);
    const start = p.hp;
    const captured: number[] = [];
    for (let i = 0; i < TICKS; i++) {
      p.fixedUpdate(DT, fakeHooks(w, p, captured) as never);
      expect(Number.isInteger(p.hp)).toBe(true);
    }
    expect(p.hp).toBeGreaterThan(0);   // 窗口内不死（净 -1 HP/s）
    // 原版锚：(-8 +4 +2)/120 × 600 = -10 HP
    const want = vanFlow(VAN_ONFIRE, true);
    expect(p.hp - start).toBeGreaterThanOrEqual(want - 1);
    expect(p.hp - start).toBeLessThanOrEqual(want + 1);
  });

  it('Burning+Honey（致死 DoT）死亡前 hp 恒整数', () => {
    const w = new World(60, 60, 42, 'bj447b');
    const p = new Player(20 * 16, 27 * 16, new Inventory());
    p.buffs.apply(BuffType.Burning, 30);
    p.buffs.apply(BuffType.Honey, 30);
    for (let i = 0; i < 400 && p.hp > 0; i++) {
      p.fixedUpdate(DT, fakeHooks(w, p, []) as never);
      expect(Number.isInteger(p.hp)).toBe(true);
    }
  });
});

// ---- ② 净额守恒 vs 原版算式锚 ----

describe('BJ447 ② 净额守恒（原版流率算式对拍,±1 延迟弹出容差）', () => {
  const cases: Array<[string, BuffType, number]> = [
    ['Burning', BuffType.Burning, VAN_BURNED],
    ['OnFire', BuffType.OnFire, VAN_ONFIRE],
    ['Venom', BuffType.Venom, VAN_VENOM],
    ['Poisoned', BuffType.Poisoned, VAN_POISON],
  ];
  for (const [name, type, units] of cases) {
    it(`${name}：无蜜=原版 DoT 流率;有蜜=对冲+4/flat+2 合成流率`, () => {
      const plain = new BuffState();
      plain.apply(type, 30);
      const sumPlain = run(plain, TICKS);
      const honey = new BuffState();
      honey.apply(type, 30);
      honey.apply(BuffType.Honey, 30);
      const sumHoney = run(honey, TICKS);

      for (const [sum, want] of [[sumPlain, vanFlow(units, false)], [sumHoney, vanFlow(units, true)]] as const) {
        expect(sum).toBeGreaterThanOrEqual(want - 1);
        expect(sum).toBeLessThanOrEqual(want + 1);
      }
    });
  }

  it('双 DoT（OnFire+Venom）+Honey：合成流率 -160±1（含整数对齐拍）', () => {
    const b = new BuffState();
    b.apply(BuffType.OnFire, 30);
    b.apply(BuffType.Venom, 30);
    b.apply(BuffType.Honey, 30);
    const sum = run(b, TICKS);
    const want = ((VAN_ONFIRE + VAN_VENOM + VAN_HONEY_OFFSET + VAN_HONEY_FLAT) / VAN_CHUNK) * TICKS;
    expect(sum).toBeGreaterThanOrEqual(want - 1);
    expect(sum).toBeLessThanOrEqual(want + 1);
  });
});

// ---- ③ DoT 飘字/真值双面整数 ----

describe('BJ447 ③ DoT 场景飘字/真值双面整数', () => {
  it('真值面：Burning+Honey 每 tick 返回值与 dotChunkOut 恒整数', () => {
    const b = new BuffState();
    b.apply(BuffType.Burning, 30);
    b.apply(BuffType.Honey, 30);
    for (let k = 0; k < 300; k++) {
      const h = b.tick(DT);
      expect(Number.isInteger(h)).toBe(true);
      expect(Number.isInteger(b.consumeDotChunk())).toBe(true);
    }
  });

  it('显示面：真实 fixedUpdate 链飘字金额恒整数（含对冲兑付拍）', () => {
    const w = new World(60, 60, 42, 'bj447c');
    const p = new Player(20 * 16, 27 * 16, new Inventory());
    p.buffs.apply(BuffType.Burning, 30);
    p.buffs.apply(BuffType.Honey, 30);
    const captured: number[] = [];
    for (let i = 0; i < 300; i++) p.fixedUpdate(DT, fakeHooks(w, p, captured) as never);
    expect(captured.length).toBeGreaterThanOrEqual(1);
    for (const v of captured) expect(Number.isInteger(v)).toBe(true);
  });
});

// ---- ④ 原版 +4/tick 计提节奏对拍 ----

describe('BJ447 ④ 原版算式锚对拍（+4 单位/t 计提、120 单位兑 1HP 的延迟弹出节奏）', () => {
  // ★BJ739 B09 改判史（2026-10-31,issue #29）：蜂蜜对冲自 BJ447 的「块兑付账
  //  （honeyOffsetUnits,块 5 在兑付拍被抵减为 4）」改为【流量域】原版形态——
  //  :19212-19219 `if (honey && lifeRegen < 0) { lifeRegen += 4; 钳 ≤0 }` 作用在
  //  每tick流量上（Burning+Honey = -56 单位/t 而非 -60）,分块弹出恒原额 5、
  //  节拍放缓（-600 门槛每 ~10.7t 一块）;净流率两模型逐单位一致（② 的守恒锁
  //  继续承重）。旧 5,5,4 节拍断言随刀退役,换 5,5,5… 流量域节拍
  it('Burning(块5)+Honey：分块恒 5、每 ~10.7t 一块（流量域 -56/t）;净流率精确', () => {
    const b = new BuffState();
    b.apply(BuffType.Burning, 30);
    b.apply(BuffType.Honey, 30);
    // 跑到绝对第 t tick,返回该 tick 的 [真值 heal, 分块]（绝对拍计数,可乱序调）
    let ran = 0;
    let pops = 0;
    const at = (t: number): [number, number] => {
      let heal = 0;
      let chunk = 0;
      while (ran < t) {
        heal = b.tick(DT);
        chunk = b.consumeDotChunk();
        if (chunk > 0) pops += chunk;
        ran++;
      }
      return [heal, chunk];
    };
    // 流量 -56 单位/t（:19175 -60 + :19214 +4）→ -600 门槛首块在 t11（-616）
    expect(at(10)).toEqual([0, 0]);     // -560 未到门槛
    expect(at(11)).toEqual([-5, 5]);    // -616 → 弹 5（余 -16）
    expect(at(21)).toEqual([0, 0]);     // -16-56×10=-576 < 600——t21 无块
    expect(at(22)).toEqual([-5, 5]);    // -632 → 弹 5（余 -32）
    // t60：本拍无 DoT 块（块序 11/22/33/43/54/64…）恰逢 flat +1HP 兑付拍 → heal +1
    const [h60] = at(60);
    expect(h60).toBe(1);
    expect(pops % 5).toBe(0);           // 全部块=5（旧模型的 4 块型已退役）
    expect(pops).toBeGreaterThanOrEqual(25);   // 60t ≥ 5 块（~10.7t/块）
  });

  it('Poisoned(块1)+Honey：每 30t 的 DoT 块被 1:1 兑付（2HP/s 对冲 2HP/s）,净流=flat+1HP/s', () => {
    const b = new BuffState();
    b.apply(BuffType.Poisoned, 30);
    b.apply(BuffType.Honey, 30);
    let sum = 0;
    for (let k = 0; k < TICKS; k++) sum += b.tick(DT);
    // 原版：(-4 +4 +2)/120 × 600 = +10 HP —— 对冲后无净 DoT,只剩 flat
    const want = vanFlow(VAN_POISON, true);
    expect(sum).toBeGreaterThanOrEqual(want - 1);
    expect(sum).toBeLessThanOrEqual(want + 1);
  });
});

// ---- 债注（BJ447 登记 → ★BJ451 已定谳清偿 2026-10-03,判别面见
//       tests/bj451-dot-chunk-flush.test.ts）----
// 分块显示账结转：当 flat 弹出拍与「残余未兑分块」拍对齐使 buffHeal 恰为 0 时
// （如 OnFire+Venom+Honey 的 t60 邻域,视 1/60 浮点累积漂移 ±1t）,
// Player.fixedUpdate 的 `buffHeal < 0` 消费门不冲刷 dotChunkOut → 残块结转到
// 下一负 heal 拍合并弹出（净额守恒,仅显示时点后移数拍）。旧浮点对冲 cancel
// 恒带分数尘 → heal 恒偏离 0 → 每拍必冲刷,结转面近似不可达;BJ447 整数化后
// 对齐拍确定性可达。
// ★BJ451 定谳（1457 Player.cs 亲读）：原版负兑付 :19478 `while (lifeRegenCount
// <= -120)` 每 tick 无条件查账（:19384 全流量合一本账）,兑付条件=账面值跨门槛,
// 与当拍流量符号无关（:19436 灼烧 -600 环退出残账 ∈(-600,-120],熄火后下一拍由
// :19478 通用环即时兑付——可在正流量拍弹字,证伪「只在负 heal 拍弹」）;结转仅
// 存在于低于门槛的尘埃,整 HP（≥120 单位当量）账面债当拍必兑。本仓 dotChunkOut
// 整 HP 口径 >0 ⟺ 已跨门槛 → 结转=原版账面不可能态,非本相。修 = Player 消费门
// 加 dotActiveTick 支（纯显示面,hp 写入面零改动）,弹字块移出 heal 写入分支独立
// 冲刷;BJ443 显示面金标经评估无需重产（冲刷位移动对其断言恒等,见 bj451 套件
// 回归）。
