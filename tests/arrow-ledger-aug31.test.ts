// Arrow.ts 台账清偿批（2026-08-31，approx-registry-2026-08-31.md 武器面④/D 档反例/
// M 级清单）：回归锚——
//   · 巨蜂档（469 Kill 放蜂 Hive Pack 半数 566,1458 P.cs:78058-78081 + Player.cs:12505-12532）
//   · idStaticGroup 组共享免疫（UseGroupStaticImmunity(181) :2686/:6185,:10678-10683）
//   · 毒云互斥推挤距离场（aiStyle92 flag45 支 :33225-33257 两版同段）
//   · 浸微光液浮升/衰变两支（Shimmer() aiStyle==2 支 :22676-22697）
//   · 天顶双锥同拍双发（Player.cs:48092-48119——同拍两掷 Y−600/Y−700,静态轮替退役）
//   · 荆棘球 277 弹跳阈值 lastVelocity.Y>3f（:19838-19845/1457 :19829-19836 两版一致）
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import type { GameHooks } from '../src/entities/types';
import { Arrow } from '../src/entities/Arrow';
import { gameTickCount, pinGameTimeTicks } from '../src/core/GameTime';   // ★BJ704-G10：idStatic GTW 钟钉拨（G1 债②统一）
import { LIQUID_TYPE } from '../src/world/TileStore';

function makeGame(w: World, enemies: unknown[] = [], bucket: unknown[] = []): GameHooks {
  return {
    world: w, player: null as unknown, enemies: () => enemies, critters: () => [],
    projectiles: () => bucket,
    entities: {
      nextId: 1,
      add: (e: unknown) => { bucket.push(e); },
    },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    addLightAt: () => {}, spawnDust: () => ({ x: 0, y: 0, vx: 0, vy: 0 }),
    broadcastParticleOrchestra: () => {},
  } as unknown as GameHooks;
}

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

const TX = 25, TY = 18;                       // 微光液格（世界坐标 400,288 起的 16px 格）

function shimmerCell(): World {
  const w = emptyWorld();
  w.store.setLiquid(TX, TY, 255, LIQUID_TYPE.SHIMMER);
  return w;
}

function playerMock(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { x: 0, y: 0, w: 20, h: 42, cx: 10, cy: 21, facing: 1,
    aimWX: 100, aimWY: 200, dead: false, equipStats: {}, ...over };
}

/** GameHooks.player 是强类型 Player——单测以裸对象替身承载,经 unknown 写入 */
function setPlayer(game: GameHooks, p: Record<string, unknown>): void {
  (game as unknown as { player: unknown }).player = p;
}

function placeInShimmer(a: Arrow): void {
  a.x = TX * 16 + 1 - a.w / 2;
  a.y = TY * 16 + 6 - a.h / 2;               // 心落在液格内
}

describe('台账④ 巨蜂档：469 Kill 放蜂 Hive Pack 半数 566（P.cs:78058-78081+12505-12532）', () => {
  it('无 Hive Pack：全部 181、kb=0、伤=⌊90/3⌋+Next(2)，数量 3..6', () => {
    const bucket: Arrow[] = [];
    const game = makeGame(emptyWorld(), [], bucket);
    setPlayer(game, playerMock({ equipStats: { strongBees: false } }));
    const a = new Arrow(400, 300, 2, -1, 90, 1, 469);
    (a as unknown as { spawnBeeSwarm: (g: GameHooks) => void }).spawnBeeSwarm(game);
    expect(bucket.length).toBeGreaterThanOrEqual(3);      // 偶数拍恒放（i=0/2/4）
    expect(bucket.length).toBeLessThanOrEqual(6);
    for (const b of bucket) {
      expect(b.projId).toBe(181);
      expect(b.knockback).toBe(0);                        // beeKB(0)=KB
      expect(b.pierce).toBe(2);                           // :78079 覆盖表值
      expect(b.frostEligible).toBe(true);                 // ranged=true
      expect(b.damage).toBeGreaterThanOrEqual(30);
      expect(b.damage).toBeLessThanOrEqual(31);           // ⌊damage/3⌋+Next(2)
    }
  });

  it('有 Hive Pack：181/566 双态出现；强蜂 dmg∈base+Next(1,4)、kb=0.5', () => {
    let sawStrong = false;
    let sawWeak = false;
    for (let trial = 0; trial < 40; trial++) {            // ≥120 只蜂,P(全弱)≈2⁻¹²⁰
      const bucket: Arrow[] = [];
      const game = makeGame(emptyWorld(), [], bucket);
      setPlayer(game, playerMock({ equipStats: { strongBees: true } }));
      const a = new Arrow(400, 300, 2, -1, 90, 1, 469);
      (a as unknown as { spawnBeeSwarm: (g: GameHooks) => void }).spawnBeeSwarm(game);
      expect(bucket.length).toBeGreaterThanOrEqual(3);
      for (const b of bucket) {
        if (b.projId === 566) {                           // 强蜂：beeDamage/beeKB 同拍配对
          sawStrong = true;
          expect(b.damage).toBeGreaterThanOrEqual(31);    // Next(1,4)=1..3
          expect(b.damage).toBeLessThanOrEqual(33);
          expect(b.knockback).toBe(0.5);                  // 0.5+KB×1.1(KB=0)
        } else {
          sawWeak = true;
          expect(b.projId).toBe(181);
          expect(b.knockback).toBe(0);
        }
      }
    }
    expect(sawStrong).toBe(true);
    expect(sawWeak).toBe(true);
  });
});

describe('idStaticGroup 组共享免疫：181/566 UseGroupStaticImmunity(181)（:2686/:6185）', () => {
  const grpOf = (a: Arrow): number => (a as unknown as { idStaticGroup: number }).idStaticGroup;

  it('ctor 注组键 181 与 10t 冷却；同敌窗口内跨实例只结算一颗（含强蜂）', () => {
    const bee1 = new Arrow(95, 95, 0, 0, 10, 0, 181);
    const bee2 = new Arrow(96, 96, 0, 0, 10, 0, 566);     // 强蜂与弱蜂同键
    expect(grpOf(bee1)).toBe(181);                        // immunityIdentity=Type 参数面
    expect(grpOf(bee2)).toBe(181);
    // ★BJ704-G10（G1 债②）：idStaticCheck 墙钟→GTW tick 钟——字段随迁
    //  idStaticCdTicks=10（原 idStaticCdMs=167ms 换算基数退役）
    expect((bee1 as unknown as { idStaticCdTicks: number }).idStaticCdTicks).toBe(10); // 10t

    const w = emptyWorld();
    let hits = 0;
    const foe = {
      x: 85, y: 85, w: 30, h: 30, id: 7, dead: false, iframes: 0,
      hurt: () => { hits++; foe.iframes = 30; return false; },   // 关闭敌侧免工件串扰
    };
    const game = makeGame(w, [foe]);
    bee1.fixedUpdate(1 / 60, game);
    expect(hits).toBe(1);
    foe.iframes = 0;                                      // 排除通用免工件窗干扰
    bee2.fixedUpdate(1 / 60, game);
    expect(hits).toBe(1);                                 // 表级共享窗内第二蜂不再结算

    // ★G10：GTW 钟钉拨（bj209/bj274 判例;原 Date.now+500ms 推钟退役）——
    //  推过 10t 窗（写 t0+10 / 门读 ≤now 同拍恰过）
    const t0 = gameTickCount();
    pinGameTimeTicks(t0 + 10);
    bee2.fixedUpdate(1 / 60, game);
    expect(hits).toBe(2);                                 // 到期后再结算（原语义）
  });

  it('376/604 族不走字段通道：idStaticGroup 保持 null（硬编码支承载）', () => {
    const cloud = new Arrow(95, 95, 0, 0, 10, 0, 604);
    expect(grpOf(cloud)).toBeNull();
    expect(cloud.projId).toBe(604);
  });
});

describe('台账② 毒云互斥推挤距离场（aiStyle92 flag45 支 P.cs:33225-33257）', () => {
  it('相交云对心距随拍增大且沿连线轴背离；不相交云不受推挤仅吃衰减', () => {
    const w = emptyWorld();
    const a1 = new Arrow(400, 300, 0, 0, 10, 0, 511);     // 32×32
    const a2 = new Arrow(420, 308, 0, 0, 10, 0, 512);     // 重叠（Δx=20<32）
    const far = new Arrow(800, 600, 0, 0, 10, 0, 513);    // 独立云
    const gap0 = Math.hypot(a2.cx - a1.cx, a2.cy - a1.cy);
    const fv0x = far.vx;
    const bucket = [a1, a2, far];
    const game = makeGame(w, [], bucket);
    for (let i = 0; i < 30; i++) {
      a1.fixedUpdate(1 / 60, game);
      a2.fixedUpdate(1 / 60, game);
      far.fixedUpdate(1 / 60, game);
    }
    const gap = Math.hypot(a2.cx - a1.cx, a2.cy - a1.cy);
    expect(gap).toBeGreaterThan(gap0);                    // 场分离
    const ux = (a2.cx - a1.cx) / (gap || 1), uy = (a2.cy - a1.cy) / (gap || 1);
    const relV = (a2.vx - a1.vx) * ux + (a2.vy - a1.vy) * uy;
    expect(relV).toBeGreaterThan(0);                      // 相对速度背离
    expect(far.vx).toBeCloseTo(fv0x * Math.pow(0.96, 30), 3);  // 非相交仅 ×0.96/update
  });

  it('重合零向量按 whoAmI 序断向仍分离（:33237-33243）；ord 序唯一', () => {
    const w = emptyWorld();
    const a1 = new Arrow(400, 300, 0, 0, 10, 0, 511);
    const a2 = new Arrow(400.000000001, 300, 0, 0, 10, 0, 511);
    const bucket = [a1, a2];
    const game = makeGame(w, [], bucket);
    a1.fixedUpdate(1 / 60, game);
    a2.fixedUpdate(1 / 60, game);
    expect(Math.hypot(a2.cx - a1.cx, a2.cy - a1.cy)).toBeGreaterThan(0);
    expect(a1.cloudWho !== a2.cloudWho).toBe(true);       // 全场 whoAmI 序
  });
});

describe('台账③ 微光气球浸液两支（Shimmer() aiStyle==2 支 :22676-22697）', () => {
  it('浮升差分：浸液 vs 干环境 Δvy 差恰 −0.7（重力项相消）', () => {
    const dryG = makeGame(emptyWorld(), []);
    setPlayer(dryG, playerMock());
    const dry = new Arrow(TX * 16, TY * 16, 0, 0, 50, 0, 936);
    const dryVy0 = dry.vy;
    dry.fixedUpdate(1 / 60, dryG);
    const wetW = shimmerCell();
    wetW.flags['unlockedSlimeRainbowSpawn'] = true;       // 锁定走 else 衰变支
    const wetG = makeGame(wetW, []);
    setPlayer(wetG, playerMock());
    const wet = new Arrow(TX * 16, TY * 16, 0, 0, 50, 0, 936);
    placeInShimmer(wet);
    const wetVy0 = wet.vy;
    wet.fixedUpdate(1 / 60, wetG);
    expect(wet.vy - wetVy0).toBeCloseTo(dry.vy - dryVy0 - 0.7, 5);   // :22677
  });

  it('解锁支：life 钳 5 后 wrapper 递减为 4 且置世界旗,当拍不吃 −20（净 −1）', () => {
    const w = shimmerCell();
    w.flags['unlockedSlimeRainbowSpawn'] = false;
    const game = makeGame(w, []);
    setPlayer(game, playerMock());
    const a = new Arrow(TX * 16, TY * 16, 0, 0, 50, 0, 936);
    placeInShimmer(a);
    const initLife = a.life;
    expect(initLife).toBeGreaterThan(5);
    a.fixedUpdate(1 / 60, game);
    expect(w.flags['unlockedSlimeRainbowSpawn']).toBe(true);         // :22685
    expect(a.life).toBe(4);                               // cap5(:22681)+wrapper−1
  });

  it('加速衰变支：已解锁浸液每拍净 −21（else−20+wrapper）；干环境对照净 −1', () => {
    const dryG = makeGame(emptyWorld(), []);              // 干世界对照
    setPlayer(dryG, playerMock());
    const dry = new Arrow(TX * 16, TY * 16, 0, 0, 50, 0, 936);
    dry.fixedUpdate(1 / 60, dryG);
    expect(dry.life).toBe(3600 - 1);                      // 修复2 缺省寿面

    const w = shimmerCell();
    w.flags['unlockedSlimeRainbowSpawn'] = true;
    const game = makeGame(w, []);
    setPlayer(game, playerMock());
    const wet = new Arrow(TX * 16, TY * 16, 0, 0, 50, 0, 936);
    placeInShimmer(wet);
    wet.fixedUpdate(1 / 60, game);
    expect(wet.life).toBe(3600 - 21);                     // :22697 else 支
  });
});

describe('台账④ 天顶双锥同拍双发（Player.cs:48092-48119）', () => {
  it('首发槽实现于 Y−600 并【同拍】补生 Y−700 次锥；补发 shell 退役；次挥复位', () => {
    const w = emptyWorld();
    const bucket: Arrow[] = [];
    const game = makeGame(w, [], bucket);
    setPlayer(game, playerMock({ cx: 400, cy: 1450 }));   // 场内高空：Y−700 不越界
    const pcY = 1450;

    const s1 = new Arrow(500, 1500, 3, 4, 40, 2, 337);    // 首发 shell（ctor 置 pending）
    s1.fixedUpdate(1 / 60, game);                         // 自校正子步（extraUpdates=1→第2子步已积分一步）
    expect(s1.dead).toBe(false);
    expect(Math.abs(s1.y - (pcY - 600))).toBeLessThanOrEqual(40);    // 本弹=i=0 锥（±子步积分+重力加速）
    expect(bucket.length).toBe(1);                        // 同拍补生次锥已入桶（未更新,严格位）
    const cone1 = bucket[0];
    expect(cone1.y).toBeCloseTo(pcY - 700, 0);            // i=1 锥 Y−700
    expect(cone1.pinFrame !== null && cone1.pinFrame !== undefined).toBe(true);
    expect(cone1.pinFrame!).toBeGreaterThanOrEqual(0);    // rand.Next(5) 面
    expect(cone1.pinFrame!).toBeLessThan(5);
    // 双锥速度域：归一 ×speed(10)，抖动每轴 ≤40×0.02=0.8（两轴独立加号）
    const spd1 = Math.hypot(s1.vx, s1.vy);
    const spdC = Math.hypot(cone1.vx, cone1.vy);
    expect(spd1).toBeLessThanOrEqual(10 + 0.8 * Math.SQRT2);
    expect(spdC).toBeLessThanOrEqual(10 + 0.8 * Math.SQRT2);

    const s2 = new Arrow(510, 1504, 3, 4, 40, 2, 337);    // 同挥 multishot 补发
    s2.fixedUpdate(1 / 60, game);
    expect(s2.dead).toBe(true);                           // 时间锁静默退役(无第三锥)
    expect(bucket.length).toBe(1);

    const s3 = new Arrow(505, 1502, 3, 4, 40, 2, 337);    // 下一挥首拍
    s3.fixedUpdate(1 / 60, game);
    expect(s3.dead).toBe(false);
    expect(Math.abs(s3.y - (pcY - 600))).toBeLessThanOrEqual(40);    // 高度节奏复位(±子步积分)
    expect(bucket.length).toBe(2);                        // 又一对(退役锥不重复计)
  });
});

describe('台账⑥ 荆棘球 277 弹跳阈值 lastVelocity.Y>3f（:19838-19845 两版一致）', () => {
  // 场地几何：地表 y=3040；球心初置于 row189(3024..3039) 空气带、底缘近触地面——
  // 回退探测「身后格」为空气 ⇒ 白盒等价于「入撞帧」语境。注：X 支探测在 vx≠0 时
  // 才有实体语义（vx=0 时身后格=本格恒通过,x 反向拍对 0 无感）；两用例均给 vx≠0
  it('轻着陆 1<vy≤3 → 落定滚动（vy=0+摩擦 ×0.97），不弹起', () => {
    const game = makeGame(emptyWorld(), []);
    const b = new Arrow(392, 3020, 0.5, 2, 10, 0, 277, { thornBounce: true });
    expect(b.cy).toBeLessThan(3040);                      // 心在空气中（row189）
    (b as unknown as { thornBounceOff: (g: GameHooks) => boolean }).thornBounceOff(game);
    expect(b.vy).toBe(0);                                 // 落定滚动档（vy>1 false 后 settle）
    expect(b.vx).toBeCloseTo(-0.45 * 0.97, 5);            // X 反 ×0.9 → settle 摩擦 ×0.97
  });

  it('静止滚动耗尽 |vx|≤0.01 → 自灭；重击 vy>3 → ×−0.9 反弹不落定', () => {
    const game = makeGame(emptyWorld(), []);
    const still = new Arrow(392, 3020, 0.005, 1, 10, 0, 277, { thornBounce: true });
    (still as unknown as { thornBounceOff: (g: GameHooks) => boolean }).thornBounceOff(game);
    expect(still.dead).toBe(true);                        // 静止自灭（本仓承载件）

    const b = new Arrow(392, 3020, 0, 4, 10, 0, 277, { thornBounce: true });
    (b as unknown as { thornBounceOff: (g: GameHooks) => boolean }).thornBounceOff(game);
    expect(b.vy).toBeCloseTo(-3.6, 5);                    // lastVy 4 → ×−0.9

    const c = new Arrow(392, 3020, 3, 1, 10, 0, 277, { thornBounce: true });
    (c as unknown as { thornBounceOff: (g: GameHooks) => boolean }).thornBounceOff(game);
    expect(c.vy).toBe(0);                                 // vy≤3 走 settle（旧门 vy>1 会弹起=B 差）
    expect(c.vx).toBeCloseTo(-2.7 * 0.97, 5);             // X 反 ×0.9 → settle 摩擦 ×0.97
  });
});
