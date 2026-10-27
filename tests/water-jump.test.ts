// 水中跳跃原版对齐（Player.cs JumpMovement :20384-20510 + 重力链 :24130-24155，
// 2026-08-16 对齐批）：
// ① 起跳门 = vy==0（踩底/水行站立）或脚蹼族湿态任意时刻，均须按键边沿——
//   头露出水面【不是】起跳条件（踩水悬停 vy≠0 跳不出去，旧自制门已废）
// ② 水中跳 = -6.01 + jumpHold 30 平台段（湿/干同链 sustain 钉速；起跳帧与 sustain
//   互斥 :20384/:20405——平台段全长 = 起跳帧 + 30 sustain 帧）
// ③ 液体参数档：水 0.2/5 / 蜂蜜 0.1/3（跳参数保持干燥档）/ 人鱼 0.3/7 /
//   三叉戟 0.25/6 + 5.51/25（↑键 0.1/2 浮升）
// ④ 基础玩家无水中上浮输入（无脚蹼只下沉）——旧 accel 游泳已废
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';

const hooks = (w: World, p?: Player): GameHooks => ({
  world: w, player: p, enemies: () => [], critters: () => [],
  spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
  cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
  spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
  playSfxFiles: () => {}, showPickupLabel: () => {},
}) as never;

/** 水池世界：底部实心行 y=85，y 60-84 灌液体（深池防短测内触底）。
 *  ★高 200 而非 100：WetCollision 扫描窗钳 maxTilesY-40（Collision.cs:1598-1602
 *  1:1）——高 100 时钳位 60 把 y 60-84 的水池整个排除在湿判定外（原版世界
 *  1200+ 高此钳位永不触发，属小测试世界伪影） */
function poolWorld(liquid = 1): World {
  const w = new World(80, 200, 11, 'pool');
  for (let x = 0; x < 80; x++) {
    w.store.setTileSilent(x, 85, 1);
    for (let y = 60; y < 85; y++) w.store.setLiquid(x, y, 255, liquid);
  }
  return w;
}

/** 深水池下沉中采样（不触底）：y 起 65 格，n tick 后仍在沉降 */
function sink(w: World, p: Player, n: number): void {
  for (let i = 0; i < n; i++) p.fixedUpdate(1 / 60, hooks(w, p));
}

describe('水中跳跃原版对齐（JumpMovement :20405-20496）', () => {
  it('踩底起跳：vy==0 + 按键边沿 → -6.01 + jumpHold 30（水档 :24154-24155）', () => {
    const w = poolWorld();
    const p = new Player(40 * 16, 65 * 16, new Inventory());
    p.inputJump = false;
    sink(w, p, 400);                      // 沉底 vy==0
    expect(p.inWater).toBe(true);
    expect(p.vy).toBe(0);
    p.inputJump = true;                   // 边沿
    p.fixedUpdate(1 / 60, hooks(w, p));
    // 起跳帧 vy=-6.01（重力 +0.2 后 sustain 同帧互斥不跑 → -5.81？——本仓重力在
    // 起跳后同帧施加：-6.01+0.2=-5.81；下帧起 sustain 钉回。取 -5.81。
    expect(p.vy).toBeCloseTo(-5.81, 5);
    expect(p.jumpHold).toBe(30);          // 起跳帧不消费（if/else 互斥 :20384/:20405）
    p.inputJump = false;
  });

  it('按住跳平台段：后续 30t vy 恒 -5.81（钉→重力→积分序,:20391 每 tick 重置）', () => {
    const w = poolWorld();
    const p = new Player(40 * 16, 65 * 16, new Inventory());
    p.inputJump = false;
    sink(w, p, 400);
    p.inputJump = true;
    p.fixedUpdate(1 / 60, hooks(w, p));   // 起跳帧
    // ★BJ731 改判史（2026-10-27）：BJ713-R13 P0/BJ717-A F1（vanilla-headless
    //   oracle 逐位认证）翻正持跳平台段序=钉(:26945/:20391)→重力(:27556)→积分
    //   (:28385)——逐拍末态 vy=−js+grav=−6.01+0.2=−5.81 恒;旧期望 −6.01「钉胜
    //   重力（重力加完再钉）」为 P0 前旧序。恒 −5.81 本身即钉位证明（无钉则
    //   每拍再 −0.2 持续衰减）。同款判语见 bj717a-movement-r13 F1（−4.61 恒）。
    for (let i = 0; i < 30; i++) {
      p.fixedUpdate(1 / 60, hooks(w, p));
      expect(p.vy).toBeCloseTo(-5.81, 5); // 钉速不衰减（每拍钉 -6.01 后重力 +0.2）
    }
    expect(p.jumpHold).toBe(0);           // 30 sustain 帧耗尽
    p.inputJump = false;
  });

  it('沉降中（vy≠0、无脚蹼）：按跳不起跳不上浮——原版水面/水中均无起跳权', () => {
    const w = poolWorld();
    const p = new Player(40 * 16, 65 * 16, new Inventory());
    p.inputJump = false;
    sink(w, p, 30);                       // 沉降中 vy>0
    const vy0 = p.vy;
    expect(vy0).toBeGreaterThan(0);
    p.inputJump = true;                   // 边沿但 vy≠0 且无脚蹼 → 门不过
    p.fixedUpdate(1 / 60, hooks(w, p));
    // 无起跳无 accel 游泳：vy 只向终端推进（+0.2 后钳 5.01）
    expect(p.vy).toBeCloseTo(Math.min(vy0 + 0.2, 5.01), 4);
    expect(p.jumpHold).toBe(0);
    p.inputJump = false;
  });

  it('水物理档：重力 0.2/终端 5.01（:24153-24155 maxFallSpeed+=0.01）', () => {
    const w = poolWorld();
    const p = new Player(40 * 16, 65 * 16, new Inventory());
    p.inputJump = false;
    sink(w, p, 60);                       // 0.2×60=12 → 已钳终端
    expect(p.vy).toBeCloseTo(5.01, 4);
  });

  it('蜂蜜档：重力 0.1/终端 3.01（honeyWet :24133-24135 + :24637 maxFallSpeed += 0.01f——★SW-RB14d 终端四档补齐后重锚）', () => {
    const w = poolWorld(3);
    const p = new Player(40 * 16, 65 * 16, new Inventory());
    p.inputJump = false;
    sink(w, p, 80);                       // 0.1×80=8 → 钳 3+0.01(:24637 无条件加)
    expect(p.inWater).toBe(true);         // inWater 含蜂蜜
    expect(p.vy).toBeCloseTo(3.01, 4);
  });

  it('蜂蜜踩底跳：速度保持干燥档（原版 honeyWet 分支不覆写 jumpSpeed）', () => {
    const w = poolWorld(3);
    const p = new Player(40 * 16, 65 * 16, new Inventory());
    p.inputJump = false;
    sink(w, p, 400);
    expect(p.vy).toBe(0);
    p.inputJump = true;
    p.fixedUpdate(1 / 60, hooks(w, p));
    // 干燥档基速 5.01（PLAYER_JUMP_SPEED，= 原版 :19301 jumpSpeed 5.01f）起跳后
    // +0.1 蜂蜜重力 = -4.91——比水档 6.01 慢（honeyWet 不覆写跳参，原版行为）
    expect(p.vy).toBeCloseTo(-5.01 + 0.1, 5);
    p.inputJump = false;
  });
});
