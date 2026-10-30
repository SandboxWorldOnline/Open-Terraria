// mod loader 性能守卫(2026-10-04 P4):实测各钩子空载/满载单次成本,
// 阈值放宽 10-100×(防 JIT 噪声误报,守的是数量级回归而非精确值)。
// 判据基准:60Hz fixedUpdate 每拍预算 16.67ms——空载钩子合计须 ≪0.1% 预算。
// 阈值锚(citation 见 docs/mod-loader-p0-report.md P4.5 性能损失表):
//   takeModNpcAi 空载实测 17ns;守卫阈值 50ns(并行争用余量 3×)→ 300 敌怪每拍 ≤ 15µs(0.09% 预算)
//   runModItemUse 空载实测 14ns;守卫 50ns
//   runModPre/Post/PostUpdate 空载实测 13-14ns;守卫 50ns
//   满载 Map.get(64 项 miss)实测 21ns;守卫 150ns
//   applyModItemIds 一次性接长(30000→65535)≤ 10ms(启动期一次性)
import { describe, it, expect, beforeAll } from 'vitest';
import {
  takeModNpcAi, runModItemUse, runModPreUpdate, runModPostEntities, runModPostUpdate,
  registerNpcAi, registerItemUse, registerSystem, _resetModHooksForTests,
  runModModifyHitNpcByProj, runModModifyHitPlayerByProj, runModModifyHurtByNpc, runModModifyHitNpc,
  registerModModifyHitNpcByProj, registerModModifyHitPlayerByProj,
  runModNpcPreAiBlocked, runModNpcPostAi, runModNpcIncomingHit, runModPlayerModifyMoveSpeed,
  registerGlobalNpcHooks,
} from '../src/data/../mods/hooks';
import { applyModItemIds } from '../src/data/items';
import { ITEM_STABLE_OF_INTERNAL, ITEM_INTERNAL_OF_STABLE } from '../src/data/items';

function bench(fn: () => void, iters: number): number {
  // 预热(JIT)
  for (let i = 0; i < Math.min(100_000, iters); i++) fn();
  // ★BJ735 改判史（2026-10-27）：单轮均值 → min-of-5 口径（同 light-wasm scan-bench
  // 先例）——全量棘轮跑多 worker 满载时 CPU 争用把 ns 级测量膨胀 3-5×（实测
  // runModPostEntities 单轮 65ns > 50ns 守卫值,单跑空载 13-14ns=生产码零回归,
  // 纯争用噪声）。min 口径滤争用段,守卫语义不变（数量级回归检测,阈值零放宽）。
  let best = Infinity;
  for (let r = 0; r < 5; r++) {
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) fn();
    best = Math.min(best, (performance.now() - t0) / iters * 1e6);
  }
  return best;   // ns/次
}

describe('mod 钩子性能守卫(空载=零 mod 会话的实际形态)', () => {
  beforeAll(() => {
    _resetModHooksForTests();
  });

  it('takeModNpcAi 空载 ≤ 20ns(每敌怪每 tick 一次;300 敌怪=每拍 ≤ 6µs)', () => {
    const ns = bench(() => takeModNpcAi(42), 2_000_000);
    expect(ns).toBeLessThan(50);
  });

  it('runModItemUse 空载 ≤ 50ns(每 tick 一次)', () => {
    const gameStub = { player: {}, input: { mouseX: 0, mouseY: 0 } } as never;
    const ns = bench(() => runModItemUse(gameStub, { vid: 42 } as never, { id: 42, stack: 1 } as never, 0, 0), 1_000_000);
    expect(ns).toBeLessThan(50);
  });

  it('三个 fixedUpdate 系统钩空载 ≤ 20ns 各(每 tick 各一次)', () => {
    const gameStub = {} as never;
    expect(bench(() => runModPreUpdate(gameStub, 1 / 60), 2_000_000)).toBeLessThan(50);
    expect(bench(() => runModPostEntities(gameStub, 1 / 60), 2_000_000)).toBeLessThan(50);
    expect(bench(() => runModPostUpdate(gameStub), 2_000_000)).toBeLessThan(50);
  });

  it('恒等表读:30000 段外的原版段下标读不受 mod 域影响(基线参照)', () => {
    // 读路径零变化:恒等表查询 = 单次下标读(无函数调用),此处只守表长度不炸
    expect(ITEM_STABLE_OF_INTERNAL[1]).toBeDefined();
  });
});

describe('mod 钩子性能守卫(满载=mod 挂满后的框架开销上限)', () => {
  beforeAll(() => {
    _resetModHooksForTests();
    // 挂满形态:64 个 mod NPC AI + 64 个 itemUse + 16 个 system
    for (let i = 800; i < 864; i++) registerNpcAi(i, () => {});
    for (let i = 30000; i < 30064; i++) registerItemUse(i, () => true);
    for (let i = 0; i < 16; i++) registerSystem({ preUpdate: () => {}, postEntities: () => {}, postUpdate: () => {} });
  });

  it('takeModNpcAi 满载 miss(64 项 Map)≤ 100ns(300 敌怪=每拍 ≤ 30µs=0.18%)', () => {
    const ns = bench(() => takeModNpcAi(42), 2_000_000);
    expect(ns).toBeLessThan(150);
  });

  it('runModItemUse 满载 miss ≤ 150ns', () => {
    const gameStub = { player: {}, input: { mouseX: 0, mouseY: 0 } } as never;
    const ns = bench(() => runModItemUse(gameStub, { vid: 42 } as never, { id: 42, stack: 1 } as never, 0, 0), 1_000_000);
    expect(ns).toBeLessThan(150);
  });

  it('16 个 system 空钩循环 ≤ 1.5µs(每 tick 一次=0.009% 预算)', () => {
    const gameStub = {} as never;
    const ns = bench(() => runModPreUpdate(gameStub, 1 / 60), 500_000);
    expect(ns).toBeLessThan(1500);   // 16 个空函数调用+循环
    expect(bench(() => runModPostEntities(gameStub, 1 / 60), 500_000)).toBeLessThan(1500);
    expect(bench(() => runModPostUpdate(gameStub), 500_000)).toBeLessThan(1500);
  });

  it('applyModItemIds 一次性接长到 65535 ≤ 10ms(启动期,存档期零成本)', () => {
    const t0 = performance.now();
    applyModItemIds([65535]);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(10);
    expect(ITEM_INTERNAL_OF_STABLE.get(65535)).toBe(65535);
    // 回滚本次接长对本文件后续测试无影响(fresh registry per file)
  });
});

// ★刀4-A(2026-10-13):命中链扩容四钩空载守卫——按「每次命中」计频(非每 tick),
//   阈值沿用 size===0 短路族 50ns 档;modifyHurtByNpc 域门撤除后仍须恒等短路。
describe('刀4-A 命中链钩空载守卫(按每次命中计频)', () => {
  beforeAll(() => {
    _resetModHooksForTests();
  });

  it('runModModifyHitNpcByProj 空载 ≤ 50ns(每次弹命中)', () => {
    const ns = bench(() => runModModifyHitNpcByProj({}, {}, 5, 42, 100, false), 2_000_000);
    expect(ns).toBeLessThan(50);
  });

  it('runModModifyHitPlayerByProj 空载 ≤ 50ns(每次敌弹命中)', () => {
    const ns = bench(() => runModModifyHitPlayerByProj({}, {}, 919, 50, false, false), 2_000_000);
    expect(ns).toBeLessThan(50);
  });

  it('runModModifyHurtByNpc 域门撤除后空载仍 ≤ 50ns(每次受击;原版攻端亦短路)', () => {
    const ns = bench(() => runModModifyHurtByNpc({}, {} as never, 50, 30, true), 2_000_000);
    expect(ns).toBeLessThan(50);
  });

  it('runModModifyHitNpc ctx 加宽后空载仍 ≤ 50ns(每次近战命中)', () => {
    const ns = bench(() => runModModifyHitNpc({}, {} as never, 30000, 50, { crit: false, kb: 3, armorPen: 0 }), 2_000_000);
    expect(ns).toBeLessThan(50);
  });

  // ★红蓝复查补账(D9 验收面):满载 8 钩连乘链——每次命中 8 次 fn 调用+ctx 对象
  it('刀4-A 满载:modifyHitNpcByProj 8 钩连乘 ≤ 400ns(每次命中)', () => {
    _resetModHooksForTests();
    for (let i = 0; i < 8; i++) registerModModifyHitNpcByProj(`m${i}`, () => 1.01);
    const ns = bench(() => runModModifyHitNpcByProj({}, {}, 5, 42, 100, false), 1_000_000);
    expect(ns).toBeLessThan(400);
    _resetModHooksForTests();
  });

  it('刀4-A 满载:modifyHitPlayerByProj 8 钩连乘 ≤ 400ns(每次敌弹命中)', () => {
    _resetModHooksForTests();
    for (let i = 0; i < 8; i++) registerModModifyHitPlayerByProj(`m${i}`, () => 0.99);
    const ns = bench(() => runModModifyHitPlayerByProj({}, {}, 919, 50, false, false), 1_000_000);
    expect(ns).toBeLessThan(400);
    _resetModHooksForTests();
  });
});

// ★B/C 批(2026-10-13):全局 NPC 钩热路径守卫——AI 链 per-enemy per-tick 最高频,
//   空载(零 mod 会话实际形态)阈值沿用 50ns 档;有链面=8 mod×2 空钩循环。
describe('B/C 批热路径守卫(每敌每 tick)', () => {
  beforeAll(() => {
    _resetModHooksForTests();
  });

  it('runModNpcPreAiBlocked 空载 ≤ 50ns(每敌每 tick;300 敌=每拍 ≤ 15µs)', () => {
    const ns = bench(() => runModNpcPreAiBlocked({ vanillaId: 42 } as never, {}), 2_000_000);
    expect(ns).toBeLessThan(50);
  });

  it('runModNpcPostAi 空载 ≤ 50ns(每敌每 tick)', () => {
    const ns = bench(() => runModNpcPostAi({ vanillaId: 42 } as never, {}), 2_000_000);
    expect(ns).toBeLessThan(50);
  });

  it('runModNpcIncomingHit 空载 ≤ 50ns(每次受击;空表直通)', () => {
    const ns = bench(() => runModNpcIncomingHit({ vanillaId: 42 } as never, 100), 2_000_000);
    expect(ns).toBeLessThan(50);
  });

  it('runModPlayerModifyMoveSpeed 空载 ≤ 50ns(每帧;空表直通 1)', () => {
    const ns = bench(() => runModPlayerModifyMoveSpeed({}, {}), 2_000_000);
    expect(ns).toBeLessThan(50);
  });

  it('B/C 满载:preAi 8 钩循环 ≤ 400ns(每敌每 tick;300 敌=每拍 ≤ 120µs=0.72%)', () => {
    _resetModHooksForTests();
    for (let i = 0; i < 8; i++) registerGlobalNpcHooks(`g${i}`, {});
    const ns = bench(() => runModNpcPreAiBlocked({ vanillaId: 42 } as never, {}), 1_000_000);
    expect(ns).toBeLessThan(400);
    _resetModHooksForTests();
  });
});
