// ★BJ357 附魔精灵尘（Enchanted Pixie Dust 5662 → MountID.Pixie 61「法埃的形态」）
// 变身链判别面（用户实报「变身不对」定谳=变身坐骑全机制面缺缩盒/禁道具/伴生 buff）：
//   1 缩盒（Mount.cs SetMount :6309-6328 + DelegateMethods.Mount.PixiePlayerSize
//     DelegateMethods.cs:171-175 = 8×14；55 鼠 14×14 :186-189 / 56 蝠 20×18 :166-169）
//     ——底锚、x 重心对齐、无空间检查
//   2 回盒（Dismount :6240-6257）：TryChangingSizeFromBottomCenter(20×42) fit 位
//     （底心锚,上伸优先/余量下伸、左先对半/余量右补 Collision.cs:2495-2543）；
//     1 格高隧道内下坐被拒（CanDismountWithResult :6670-6681——同尺寸盒缩支零探针
//     恒可下,仅变身盒回长 20×42 才走探针）;强制下坐底锚强改（:6254-6258 else 支）
//   3 伴生 buff 384（SetMount :6291 AddBuff(3600) + Player.cs:9968-9971 每 tick 钉
//     10t;Main.cs:9344-9352 无时长字/不入档 = BUFF_NO_TIME_DISPLAY/BUFF_NO_SAVE）
//   4 湿蝠拒上（CanMount :6662）
//   5 控场强制下坐清 buff（Player.cs:26556 frozen → Dismount :6214 ClearBuff）
//   6 拖尾辉尘掷门（Mount.cs UpdateEffects case 61 :5203-5224：偶数视效拍 ×
//     (1/15 旗 ∨ Next(6)+1<|v|)）
//   7 变异锁：MOUNT_PLAYER_SIZE 61 = [8,14] / DontHoldItems 三连 / buff 映射
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import {
  MOUNT_PLAYER_SIZE, MOUNT_SETS, MountInstance,
  tryChangingSizeFromBottomCenter, type MountedPlayerView,
} from '../src/entities/Mounts';
import { BuffType, BUFF_NO_TIME_DISPLAY, BUFF_NO_SAVE, buffTypeByVanilla } from '../src/stats/Buffs';
import { TILE } from '../src/core/constants';

// ---- 测试世界/玩家（mounts.test.ts 同款 harness） ----
const fakeHooks = (w: World, p?: Player) => ({
  world: w, player: p, enemies: () => [], critters: () => [],
  spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
  cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
  spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
  playSfxFiles: () => {}, showPickupLabel: () => {},
});
const mkWorld = (): World => {
  const w = new World(80, 120, 72, 'bj357');
  for (let x = 20; x <= 60; x++) w.store.setTileSilent(x, 80, 1);
  return w;
};
const mkPlayer = (w: World): Player => new Player(30 * 16, 77 * 16, new Inventory());
const tick = (p: Player, w: World, n: number): void => {
  for (let i = 0; i < n; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
};
/** MountInstance 单元测试用的玩家视图桩（setMount/dismount 结构化直改本桩） */
const view = (over: Partial<MountedPlayerView> = {}): MountedPlayerView => ({
  x: 100, y: 100, w: 20, h: 42, vx: 0, vy: 0,
  onGround: true, inWater: false, facing: 1,
  inputX: 0, inputJump: false, inputUp: false, inputDown: false,
  prevInputJump: false, gravDir: 1, store: null, ...over,
});

describe('BJ357 变身坐骑缩盒（Mount.cs SetMount :6309-6328）', () => {
  it('61 妖精：20×42 → 8×14，底锚 + x 重心对齐（PixiePlayerSize DelegateMethods.cs:171-175）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    tick(p, w, 8);                                   // 落地：p.y+p.h = 80*16
    const bx = p.x + p.w / 2, by = p.y + p.h;
    expect(p.w).toBe(20); expect(p.h).toBe(42);      // 前置：正常盒
    expect(p.mount.setMount(61, p)).toBe(true);
    expect(p.w).toBe(8); expect(p.h).toBe(14);
    expect(p.x + p.w / 2).toBeCloseTo(bx);           // 重心不变
    expect(p.y + p.h).toBeCloseTo(by);               // 底锚不变
  });

  it('55 大鼠 14×14 / 56 蝙蝠 20×18（RatPlayerSize :186-189 / BatPlayerSize :166-169）', () => {
    const w = mkWorld();
    const p1 = mkPlayer(w); tick(p1, w, 8);
    expect(p1.mount.setMount(55, p1)).toBe(true);
    expect(p1.w).toBe(14); expect(p1.h).toBe(14);
    const p2 = mkPlayer(w); tick(p2, w, 8);
    expect(p2.mount.setMount(56, p2)).toBe(true);
    expect(p2.w).toBe(20); expect(p2.h).toBe(18);
  });

  it('非变身坐骑（1 鞍）零改盒（原版委派 null 同相）', () => {
    const w = mkWorld();
    const p = mkPlayer(w); tick(p, w, 8);
    expect(p.mount.setMount(1, p)).toBe(true);
    expect(p.w).toBe(20); expect(p.h).toBe(42);
  });

  it('湿蝠拒上（CanMount :6662 m==56 && wet；视图 inWater 近似,登记）', () => {
    const m = new MountInstance();
    expect(m.setMount(56, view({ inWater: true }))).toBe(false);
    expect(m.setMount(56, view({ inWater: false }))).toBe(true);
  });
});

describe('BJ357 回盒与下坐门（Dismount :6240-6257 / CanDismountWithResult :6670-6681）', () => {
  it('TryChangingSizeFromBottomCenter 单元：开阔地 8×14→20×42 底心锚（上伸 28/左右各 6）', () => {
    const w = mkWorld();
    const st = w.store as unknown as Parameters<typeof tryChangingSizeFromBottomCenter>[0];
    // 妖精站在地表：底 y=1280，盒 8×14 → y=1266
    const out = tryChangingSizeFromBottomCenter(st, 30 * TILE + 6, 80 * TILE - 14, 8, 14, 20, 42);
    expect(out).not.toBeNull();
    expect(out!.w).toBe(20); expect(out!.h).toBe(42);
    expect(out!.y + out!.h).toBe(80 * TILE);                       // 底锚
    expect(out!.x + out!.w / 2).toBe(30 * TILE + 6 + 4);           // 重心 = 原 8 盒重心
  });

  it('开阔地下坐回 20×42（Dismount :6240-6257 fit 位）', () => {
    const w = mkWorld();
    const p = mkPlayer(w); tick(p, w, 8);
    const bx = p.x + p.w / 2, by = p.y + p.h;
    p.mount.setMount(61, p);
    p.mount.dismount(p);
    expect(p.w).toBe(20); expect(p.h).toBe(42);
    expect(p.x + p.w / 2).toBeCloseTo(bx, 5);
    expect(p.y + p.h).toBeCloseTo(by, 5);
  });

  it('1 格高隧道：妖精可容身（14<16）但下坐被拒（42 长不出 → FailedNoSpace）', () => {
    const w = mkWorld();
    for (let x = 26; x <= 34; x++) w.store.setTileSilent(x, 78, 1);   // 顶棚：79 行剩 16px 净空
    const p = mkPlayer(w); tick(p, w, 8);
    expect(p.mount.setMount(61, p)).toBe(true);
    expect(p.h).toBe(14);
    expect(p.y + p.h).toBeCloseTo(80 * TILE, 5);                     // 妖精站在隧道底
    expect(p.mount.canDismount(p)).toBe(false);                      // 20×42 回长不出
    expect(p.mount.tryDismount(p)).toBe(false);
    expect(p.ridingMount).toBe(true);                                // 仍骑乘
    // 强制下坐（QuickMount 三连败链 Game.tryDismountMount → dismount）：
    // 底锚强改 20×42（:6254-6258 else 支,可嵌墙原版同语义）
    p.mount.dismount(p);
    expect(p.w).toBe(20); expect(p.h).toBe(42);
    expect(p.y + p.h).toBeCloseTo(80 * TILE, 5);                     // 底锚强改
  });

  it('同尺寸盒（非变身骑）下坐恒可（缩支零探针=原版 TryChangingSize 同相）', () => {
    const w = mkWorld();
    for (let x = 26; x <= 34; x++) w.store.setTileSilent(x, 77, 1);   // 头顶加顶棚
    const p = mkPlayer(w); tick(p, w, 8);
    p.mount.setMount(1, p);
    expect(p.mount.canDismount(p)).toBe(true);                       // 20×42→20×42 零探针
  });
});

describe('BJ357 坐骑伴生 buff（SetMount :6291 + Player.cs:9968-9971 钉时）', () => {
  it('骑 61 每 tick 重钉法埃的形态 384 ≈ 10t（无时长字/不入档表已收）', () => {
    const w = mkWorld();
    const p = mkPlayer(w); tick(p, w, 8);
    p.mount.setMount(61, p);
    tick(p, w, 3);
    expect(p.buffs.has(BuffType.PixieMount)).toBe(true);
    const left = p.buffs.active.get(BuffType.PixieMount)!;
    expect(left).toBeCloseTo(10 / 60, 6);                            // 钉 10t（≈0s 无字）
    expect(BUFF_NO_TIME_DISPLAY.has(384)).toBe(true);                // Main.cs:9347
    expect(BUFF_NO_SAVE.has(384)).toBe(true);                        // Main.cs:9350
    expect(BUFF_NO_TIME_DISPLAY.has(374)).toBe(true);
    expect(BUFF_NO_SAVE.has(374)).toBe(true);
    expect(BUFF_NO_TIME_DISPLAY.has(377)).toBe(true);
    expect(BUFF_NO_SAVE.has(377)).toBe(true);
    expect(buffTypeByVanilla(384)).toBe(BuffType.PixieMount);
  });

  it('控场（冰冻）61 仙灵拒下坐保骑保 buff（★BJ704-G13 债2 判据翻正:MountID.cs:29 '
    + 'DontDismountWhenCCed{55,56,61}——CanDismountWithResult :6686-6690 FailedCCed;'
    + '旧判据「冰冻强制下坐」系仓内直调 dismount 期行为,与 vanilla 相反）', () => {
    const w = mkWorld();
    const p = mkPlayer(w); tick(p, w, 8);
    p.mount.setMount(61, p);
    tick(p, w, 1);
    expect(p.buffs.has(BuffType.PixieMount)).toBe(true);
    p.buffs.apply(BuffType.Frozen, 1);
    tick(p, w, 1);
    expect(p.ridingMount).toBe(true);               // FailedCCed 拒下坐（55/56/61 变身骑族豁免）
    expect(p.buffs.has(BuffType.PixieMount)).toBe(true);   // Dismount 未跑=ClearBuff 不发生
    // 下坐清伴生 buff 面改由湿拍路径承载（56 蝙蝠湿拍 TryDismount :28183——
    // bj704g13 B4 拒下坐清偿对照;CCed+变身骑族在 vanilla 结构性不可达本面）
  });
});

describe('BJ357 拖尾辉尘掷门（Mount.cs UpdateEffects case 61 :5203-5224）', () => {
  const mkCtx = (miscCounter: number, spy: { calls: number }) => ({
    scutlixTargets: [], los: () => false,
    miscCounter,
    pixieTrailDust: (a: { x: number; y: number; mul: number; pvx: number; pvy: number;
      color: { r: number; g: number; b: number; a: number } }) => {
      void a; spy.calls++;
    },
    fishron: { hp: 100, maxHp: 100, inWater: false, inLava: false, inHoney: false,
      dripping: false, raining: false, windExposed: false },
  });
  it('|v|=10 > 6 → 每偶数拍必发 1 粒；奇数拍不发（timeForVisualEffects%2 门）', () => {
    const w = mkWorld();
    const p = mkPlayer(w); tick(p, w, 8);
    p.mount.setMount(61, p);
    const spy = { calls: 0 };
    const st = w.store as unknown as MountedPlayerView['store'];
    p.vx = 10;                                        // Next(6)+1 ≤ 6 < 10 恒真
    const v = view({ x: p.x, y: p.y, w: p.w, h: p.h, vx: 10, store: st });
    p.mount.updateMountEffects(v, mkCtx(2, spy) as never);
    expect(spy.calls).toBe(1);
    p.mount.updateMountEffects(v, mkCtx(3, spy) as never);
    expect(spy.calls).toBe(1);                        // 奇数拍零发
  });
  it('静止（|v|=0）下偶数拍仍按 1/15 旗概率发——掷门存在（统计上不恒发）', () => {
    const w = mkWorld();
    const p = mkPlayer(w); tick(p, w, 8);
    p.mount.setMount(61, p);
    const spy = { calls: 0 };
    const st = w.store as unknown as MountedPlayerView['store'];
    const v = view({ x: p.x, y: p.y, w: p.w, h: p.h, store: st });
    for (let i = 0; i < 200; i++) p.mount.updateMountEffects(v, mkCtx(2 * (i % 2), spy) as never);
    expect(spy.calls).toBeGreaterThan(0);             // 1/15 旗命中过
    expect(spy.calls).toBeLessThan(200);              // 但非每拍（Next(6)+1≥1=|v| 拒）
  });
});

describe('BJ357 变异锁（数据面）', () => {
  it('MOUNT_PLAYER_SIZE 61=[8,14] 55=[14,14] 56=[20,18]；DontHoldItems={55,56,61}', () => {
    expect(MOUNT_PLAYER_SIZE[61]).toEqual([8, 14]);
    expect(MOUNT_PLAYER_SIZE[55]).toEqual([14, 14]);
    expect(MOUNT_PLAYER_SIZE[56]).toEqual([20, 18]);
    expect(MOUNT_SETS.DontHoldItems?.[55]).toBe(true);
    expect(MOUNT_SETS.DontHoldItems?.[56]).toBe(true);
    expect(MOUNT_SETS.DontHoldItems?.[61]).toBe(true);
    expect(MOUNT_SETS.PlayerIsHidden?.[61]).toBe(true);
  });
});
