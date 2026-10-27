// 1457 宝石七弹运行时行为闸门(2026-08-21):proj-1457-batch.test.ts 锁的是特性位数据面
// (GEM_BOLT_FEATURES/finalizeGemStaffStats),本文件锁 src/entities/Arrow.ts 内六行为的
// 运行时表现(AI_029_GemStaffs :38561-38640 + HandleMovement :18106-18160 + Kill
// :77011-77058 + Colliding :15447-15474)。特性位→弹型:121 紫晶 Homing / 124 翡翠
// FastThenSlow / 597 琥珀 CanBounce / 123 蓝晶 SwirlTwins / 122 黄玉 AoeExplosion /
// 125 红晶 ArPenSpread / 126 钻石 BiggerHitbox。
import { describe, it, expect, vi } from 'vitest';   // ★BJ731:vi=DV 恒等档 mock
import { Arrow } from '../src/entities/Arrow';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

type HurtArgs = [number, number, number, unknown, number?, boolean?, number?, boolean?];
interface StubEnemy extends Record<string, unknown> {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  hurtLog: HurtArgs[];
}

function mkEnemy(id: number, x: number, y: number, w = 16, h = 16): StubEnemy {
  const e = { id, x, y, w, h, dead: false, hurtLog: [] as HurtArgs[] } as StubEnemy;
  e.hurt = (...a: unknown[]) => {
    e.hurtLog.push(a as HurtArgs);
    return false;
  };
  return e;
}

function makeHooks(enemies: StubEnemy[] = [], store?: TileStore): GameHooks {
  const hooks = {
    world: { store: store ?? new TileStore(200, 120) } as never,
    player: { equipStats: {}, cx: 800, cy: 1440, x: 790, y: 1419, w: 20, h: 42, dead: false } as never,
    enemies: () => enemies,
    critters: () => [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  };
  return hooks as unknown as GameHooks;
}

/** 宝石弹统一出生:grav=0(排除 AI_001 重力链干扰)、life/pierce 显式给基准值 */
function gemBolt(vid: number, x: number, y: number, vx: number, vy: number,
  gem: Record<string, boolean>, opts: { life?: number; pierce?: number; dmg?: number; kb?: number } = {}) {
  return new Arrow(x, y, vx, vy, opts.dmg ?? 100, opts.kb ?? 2, vid,
    { grav: 0, life: opts.life ?? 300, pierce: opts.pierce ?? 1, gem: gem as never });
}

describe('宝石七弹运行时: Homing(121 紫晶,AI_029 :38563-38624)', () => {
  it('视距 500 内有敌 → 速度向量朝目标转向(首步 vy 由 0 变非 0)', () => {
    const g = makeHooks([mkEnemy(1, 800, 800)]);          // 弹心(505,805)距目标 ~303px < 500
    const a = gemBolt(121, 500, 800, 8, 0, { homing: true });
    a.fixedUpdate(1 / 60, g);
    expect(a.vy).not.toBe(0);                             // 已向目标(上方)偏转
    expect(Math.hypot(a.vx, a.vy)).toBeCloseTo(8, 5);     // 转向保速(初速 8 ≥ maxSp 不提速)
  });
  it('视距外(>500)不转向(FindTargetWithLineOfSight 空手)', () => {
    const g = makeHooks([mkEnemy(1, 1400, 800)]);         // 距 ~898px
    const a = gemBolt(121, 500, 800, 8, 0, { homing: true });
    a.fixedUpdate(1 / 60, g);
    expect(a.vy).toBe(0);
    expect(a.vx).toBe(8);
  });
  it('低速(<8)时先提速 ×1.1(rotateTowards 提速档 :38580-38590)', () => {
    const g = makeHooks([mkEnemy(1, 800, 800)]);
    const a = gemBolt(121, 500, 800, 4, 0, { homing: true });
    a.fixedUpdate(1 / 60, g);
    expect(Math.hypot(a.vx, a.vy)).toBeGreaterThan(4.4);  // 4→+0.1→×1.1 ≈ 4.51
  });
});

describe('宝石七弹运行时: FastThenSlow(124 翡翠,:38590-38592 + Finalize :22259)', () => {
  it('恒 ×0.97 减速(8 → 7.76)', () => {
    const g = makeHooks();
    const a = gemBolt(124, 500, 800, 8, 0, { fastThenSlow: true });
    a.fixedUpdate(1 / 60, g);
    expect(a.vx).toBeCloseTo(7.76, 5);
    expect(a.vy).toBeCloseTo(0, 6);
  });
  it('构造期终值化:timeLeft ×2(300→600)+ penetrate +1(1→2)', () => {
    const a = gemBolt(124, 500, 800, 8, 0, { fastThenSlow: true }, { life: 300, pierce: 1 });
    expect(a.life).toBe(600);
    expect(a['pierce']).toBe(2);
  });
});

describe('宝石七弹运行时: SwirlTwins(123 蓝晶,:38583-38589)', () => {
  it('垂直向正弦摆:首步法向偏移 sin(0.1π)×6 ≈ +1.854,切向速度照常', () => {
    const g = makeHooks();
    const a = gemBolt(123, 500, 800, 8, 0, { swirlTwins: true });
    const x0 = a.x, y0 = a.y;
    a.fixedUpdate(1 / 60, g);
    expect(a.x - x0).toBeCloseTo(8, 5);                   // vx=8,vy=0 → 法向纯 Y
    expect(a.y - y0).toBeCloseTo(Math.sin(Math.PI * 2 * 0.05) * 6, 3);
  });
  it('摆动方向随正弦翻转(相位过 π 后反向)', () => {
    const g = makeHooks();
    const a = gemBolt(123, 500, 800, 8, 0, { swirlTwins: true });
    const y0 = a.y;
    for (let i = 0; i < 5; i++) a.fixedUpdate(1 / 60, g);   // t=5: sin(0.6π)−sin(0.5π) < 0
    expect(a.y - y0).toBeLessThan(1.8541 * 5);              // 已回落(非单向漂移)
  });
});

describe('宝石七弹运行时: BiggerHitbox(126 钻石,Colliding :15447-15474)', () => {
  it('命中盒外扩 30px:普通盒够不着的目标可命中', () => {
    // 10×10 弹 x:[500,510];敌 x:[535,551]——裸盒 510>535 假,+30 → 540>535 真
    const e = mkEnemy(1, 535, 795);
    const g = makeHooks([e]);
    const a = gemBolt(126, 500, 795, 0.01, 0, { biggerHitbox: true }, { life: 100, pierce: 5 });
    a.fixedUpdate(1 / 60, g);
    expect(e.hurtLog).toHaveLength(1);
  });
  it('对照:同几何无 biggerHitbox 不命中(外扩非全图命中)', () => {
    const e = mkEnemy(1, 535, 795);
    const g = makeHooks([e]);
    const a = gemBolt(121, 500, 795, 0.01, 0, {}, { life: 100, pierce: 5 });
    a.fixedUpdate(1 / 60, g);
    expect(e.hurtLog).toHaveLength(0);
  });
  it('构造期终值化:penetrate +1(5→6)', () => {
    const a = gemBolt(126, 500, 795, 1, 0, { biggerHitbox: true }, { pierce: 5 });
    expect(a['pierce']).toBe(6);
  });
});

describe('宝石七弹运行时: AoeExplosion(122 黄玉,Kill :77011-77058)', () => {
  it('Kill 时 80px 半径 AoE:近敌吃 ×0.35 伤(100→35)+ kb×0.35,远敌不吃', () => {
    const near = mkEnemy(1, 540, 795);    // 距弹心(505,800) ~35px
    const far = mkEnemy(2, 940, 795);     // ~435px > 80
    const g = makeHooks([near, far]);
    const a = gemBolt(122, 500, 795, 0, 0, { aoeExplosion: true }, { life: 1, dmg: 100, kb: 2 });
    // ★BJ731 改判史（2026-10-27）：AoeExplosion Kill 面走 :12970 DV 掷（BJ723-B
    //   落地面）——0.5 恒等档钉 100→35（未 mock 必漂 29-40）。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      a.fixedUpdate(1 / 60, g);
    } finally { rvi731.mockRestore(); }
    expect(a.dead).toBe(true);            // life 尽走统一消亡口 killNow
    expect(near.hurtLog).toHaveLength(1);
    expect(near.hurtLog[0][0]).toBe(35);              // trunc(100 × 0.35/mult),mult=1
    expect(near.hurtLog[0][1]).toBeCloseTo(0.7, 6);   // sign × kb(2) × 0.35
    expect(far.hurtLog).toHaveLength(0);
  });
  it('爆伤吃 GetDamageMultiplier 乘区:叠 swirlTwins(×0.6) → 0.35/0.6 放大档', () => {
    const near = mkEnemy(1, 540, 795);
    const g = makeHooks([near]);
    const a = gemBolt(122, 500, 795, 0, 0, { aoeExplosion: true, swirlTwins: true }, { life: 1, dmg: 100, kb: 2 });
    // ★BJ731 改判史（2026-10-27）：同上——DV 恒等档钉 58。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      a.fixedUpdate(1 / 60, g);
    } finally { rvi731.mockRestore(); }
    expect(near.hurtLog[0][0]).toBe(58);   // trunc(100 × 0.35/0.6)
  });
});

describe('宝石七弹运行时: CanBounce(597 琥珀,HandleMovement :18112-18150)', () => {
  it('构造期终值化:penetrate +2(5→7)', () => {
    const a = gemBolt(597, 500, 800, 8, 0, { canBounce: true }, { pierce: 5 });
    expect(a['pierce']).toBe(7);
  });

  // ★产品 bug 备案(2026-08-21,只记录不修):反弹分支死代码——
  //   Arrow.ts:1260 `if (this.hitHead || this.hitWall || this.onGround)` 三旗在 Arrow
  //   上无任何写入点:Arrow 不走 moveAndCollide(src/physics/TileCollision.ts 唯一写入
  //   点),自身位移是裸 `this.x += this.vx`(:1219)后查中心格;全仓对 Arrow 置这三旗的
  //   代码为零(仅 DD2 boss 自身 AI 写自己的 hitWall)。→ 琥珀法珠/琥珀长袍臂(597/4256)
  //   撞块直接走通用消亡口,无 ×0.8 法向反弹、无 penetrate--,1457 CanBounce 行为整段不可达。
  it('撞实心块:法向 ×0.8 反弹 + penetrate--(不消亡)', () => {
    const st = new TileStore(200, 120);
    for (let x = 40; x < 60; x++) st.setTile(x, 49, 1);   // 弹飞行线 y 行铺实心
    const g = makeHooks([], st);
    const a = gemBolt(597, 40 * 16, 49 * 16 + 8, 8, 0, { canBounce: true }, { life: 100, pierce: 5 });
    a.fixedUpdate(1 / 60, g);                             // 首步即入实心格
    expect(a.dead).toBe(false);                           // 反弹不消亡
    expect(a.vx).toBeCloseTo(-6.4, 5);                    // ×(-0.8)
    expect(a['pierce']).toBe(6);                          // penetrate--
  });

});

describe('宝石七弹运行时: ArPenSpread(125 红晶,构造期 armorPen+4)', () => {
  it('armorPen +4(FinalizeProjectile_GemStaves :22280-22282)', () => {
    const a = gemBolt(125, 500, 800, 8, 0, { arPenSpread: true });
    expect(a.armorPen).toBe(4);
    const plain = gemBolt(121, 500, 800, 8, 0, { homing: true });
    expect(plain.armorPen).toBe(0);
  });
});
