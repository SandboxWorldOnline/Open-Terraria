// 烟花三件套 + 马桶烟花 1:1 回归（Wiring.cs:1492-1553：
//   case 216 烟花火箭 :1492-1495 → WorldGen.LaunchRocket WorldGen.cs:62184-62206
//   马桶 497 / 椅表 15（frameY/40==1 或 20）:1498-1509 → Projectile 733 ToiletEffect
//   case 335 烟花盒 :1511-1523 → WorldGen.LaunchRocketSmall WorldGen.cs:62208-62222
//   case 338 烟花喷泉 :1525-1553 → Projectile 419-422（aiStyle73）
// 弹体侧 Projectile 167-170/415-418/419-422/733 的 SetDefaults + AI + Kill
//   （Projectile.cs:2291-2300 / 4669-4686 / 7434-7441；AI :25677-25739 / 29369-29510 /
//    49278-49314；Kill :73435-73921）
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Wiring } from '../src/world/Wiring';
import { deviceTable, type DeviceCtx } from '../src/world/wiring/devices';
import { TILE_BY_KEY } from '../src/data/tiles';
import { TrapShot, FW_DUST } from '../src/entities/Dart';
import type { GameHooks } from '../src/entities/types';

type Shot = {
  px: number; py: number; vx: number; vy: number;
  damage: number; kind: string; form: number; anchor?: [number, number];
};
type Burst = { color: string; count: number; speed: number; x: number; y: number };

function makeCtx(opts: { fountainAt?: [number, number][] } = {}) {
  const shots: Shot[] = [];
  const ctx: DeviceCtx = {
    dropItem: () => {}, spawnNpc: () => true, mechSpawnOk: () => true, itemSpawnOk: () => true,
    shootProjectile: (px, py, vx, vy, damage, kind, form = 0, anchor) =>
      shots.push({ px, py, vx, vy, damage, kind, form, anchor }),
    hasFountainAt: (tx, ty) => (opts.fountainAt ?? []).some(([x, y]) => x === tx && y === ty),
    countProjectiles: () => 0,
    doorOpen: () => true, doorClose: () => true, teleportPair: () => {},
    relocateTownNpc: () => true, explode: () => {}, toast: () => {}, sfx: () => {},
    extractinatorPull: () => null, dropItemStack: () => {},
    worldSurface: 100,
  };
  return { ctx, shots };
}

function freshWiring() {
  const world = new World(60, 60, 7, 'open');
  return { world, w: new Wiring(world.store) };
}

/** 放 1×2 烟花火箭（tile 216）：style s → 上格 frameY = s*40、下格 = s*40+18 */
function placeRocket(w: Wiring, ox: number, oy: number, style: number) {
  const t = TILE_BY_KEY['v_216_firework']!;
  w.st.setTileSilent(ox, oy, t, 0, style * 40);
  w.st.setTileSilent(ox, oy + 1, t, 0, style * 40 + 18);
}

/** 放 2×2 烟花盒（tile 335）：frameX/frameY = 格内偏移*18 */
function placeBox(w: Wiring, ox: number, oy: number) {
  const t = TILE_BY_KEY['v_335_fireworksbox']!;
  for (let cx = 0; cx < 2; cx++) {
    for (let cy = 0; cy < 2; cy++) {
      w.st.setTileSilent(ox + cx, oy + cy, t, cx * 18, cy * 18);
    }
  }
}

/** 放 1×2 烟花喷泉（tile 338） */
function placeFountainTile(w: Wiring, ox: number, oy: number) {
  const t = TILE_BY_KEY['v_338_fireworkfountain']!;
  w.st.setTileSilent(ox, oy, t, 0, 0);
  w.st.setTileSilent(ox, oy + 1, t, 0, 18);
}

/** 放 1×2 马桶（tile 497 / 椅表 15 马桶样式）：style s → 上格 frameY = s*40、下格 = s*40+18 */
function placeToilet(w: Wiring, key: string, ox: number, oy: number, style: number) {
  const t = TILE_BY_KEY[key]!;
  w.st.setTileSilent(ox, oy, t, 0, style * 40);
  w.st.setTileSilent(ox, oy + 1, t, 0, style * 40 + 18);
}

/** 弹体侧桩 Game：记录定向爆花（spawnBurst）与音效；敌怪位置可调（对准爆心） */
function makeGame(world?: World, ex = 150, ey = 150) {
  const bursts: Burst[] = [];
  const sfx: string[] = [];
  const hits: number[] = [];
  const enemy = {
    x: ex, y: ey, w: 20, h: 20, dead: false,
    hurt: (d: number) => { hits.push(d); return true; },
  };
  const game = {
    world: world ?? new World(60, 60, 7, 'open'),
    player: { x: -500, y: -500, w: 20, h: 20, dead: false, cx: -490 },
    enemies: () => [enemy],
    critters: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {}, cutTile: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    spawnBurst: (x: number, y: number, color: string, count: number, speed: number) =>
      bursts.push({ x, y, color, count, speed }),
    playSfx: (n: string) => sfx.push(n), playSfxFiles: () => {},
    showPickupLabel: () => {}, notifyInventoryChanged: () => {},
  } as unknown as GameHooks;
  return { game, bursts, sfx, hits };
}

// ============ 发射参数（Wiring.cs + WorldGen.cs） ============

describe('烟花火箭（case 216 → WorldGen.LaunchRocket WorldGen.cs:62184-62206）', () => {
  it('style 2 → 弹 169 蓝（form 2）：发射位 (x*16+8, y*16+6)、速度 (0,-8)、150 伤、无冷却', () => {
    const { w } = freshWiring();
    const { ctx, shots } = makeCtx();
    placeRocket(w, 10, 20, 2);
    expect(deviceTable(w, ctx, 216, 10, 20)).toBe(true);
    expect(shots).toHaveLength(1);
    const s = shots[0]!;
    expect(s.kind).toBe('fireworkRocket');
    expect(s.form).toBe(2);          // 167 + frameY/40（WorldGen.cs:62197）
    expect(s.px).toBe(10 * 16 + 8);  // :62196 vector.X
    expect(s.py).toBe(20 * 16 + 4 + 2); // vector.Y + 2（:62199）
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(-8);           // :62199
    expect(s.damage).toBe(150);      // :62198
    // 烟花方块是消耗品：1×2 两格发射即移除（:62203-62204）
    expect(w.st.type[w.st.idx(10, 20)]).toBe(0);
    expect(w.st.type[w.st.idx(10, 21)]).toBe(0);
    // 原版 case 216 无 CheckMech（Wiring.cs:1492-1495 直发）：重摆后立即再发
    placeRocket(w, 10, 20, 2);
    deviceTable(w, ctx, 216, 10, 20);
    expect(shots).toHaveLength(2);
  });

  it('点下半格（frameY%40==18）锚点 y 上移（WorldGen.cs:62192-62194）', () => {
    const { w } = freshWiring();
    const { ctx, shots } = makeCtx();
    placeRocket(w, 10, 20, 3); // style 3 → 弹 170 黄
    deviceTable(w, ctx, 216, 10, 21); // 下格 frameY = 3*40+18 = 138
    const s = shots[0]!;
    expect(s.form).toBe(3);
    expect(s.py).toBe(20 * 16 + 6); // y-- 后再发射（与上格触发一致）
    expect(w.st.type[w.st.idx(10, 20)]).toBe(0);
    expect(w.st.type[w.st.idx(10, 21)]).toBe(0);
  });
});

describe('烟花盒（case 335 → WorldGen.LaunchRocketSmall WorldGen.cs:62208-62222）', () => {
  it('2×2 锚点回算：弹 415-418（form 0-3）、(0,-8)、0 伤、发射位 (x*16+16, y*16+2)', () => {
    const { w } = freshWiring();
    const { ctx, shots } = makeCtx();
    placeBox(w, 20, 30);
    expect(deviceTable(w, ctx, 335, 21, 31)).toBe(true); // 右下格触发
    expect(shots).toHaveLength(1);
    const s = shots[0]!;
    expect(s.kind).toBe('fireworksBoxRocket');
    expect(s.form).toBeGreaterThanOrEqual(0); // 415 + rand(4)（WorldGen.cs:62213）
    expect(s.form).toBeLessThan(4);
    expect(s.px).toBe(20 * 16 + 16); // :62212 vector.X
    expect(s.py).toBe(30 * 16 + 2);  // vector.Y + 2（:62215）
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(-8);           // :62215
    expect(s.damage).toBe(0);        // :62214
  });

  it('CheckMech(锚点, 30) 冷却：立即再触发不发，30t 后恢复（Wiring.cs:1518-1520）', () => {
    const { w } = freshWiring();
    const { ctx, shots } = makeCtx();
    placeBox(w, 20, 30);
    deviceTable(w, ctx, 335, 20, 30);
    deviceTable(w, ctx, 335, 20, 30);
    expect(shots).toHaveLength(1);
    for (let i = 0; i < 30; i++) w.updateMech();
    deviceTable(w, ctx, 335, 20, 30);
    expect(shots).toHaveLength(2);
  });
});

describe('烟花喷泉（case 338，Wiring.cs:1525-1553）', () => {
  it('1×2 锚点回算：弹 419-422 静态发射器 + ai[0]/ai[1] 锚点 + CheckMech 30', () => {
    const { w } = freshWiring();
    const { ctx, shots } = makeCtx();
    placeFountainTile(w, 30, 40);
    expect(deviceTable(w, ctx, 338, 30, 41)).toBe(true); // 下格触发
    expect(shots).toHaveLength(1);
    const s = shots[0]!;
    expect(s.kind).toBe('fireworkFountain');
    expect(s.form).toBeGreaterThanOrEqual(0); // 419 + rand(4)（Wiring.cs:1546）
    expect(s.form).toBeLessThan(4);
    expect(s.px).toBe(30 * 16 + 8); // :1548
    expect(s.py).toBe(40 * 16 + 2); // :1548
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.damage).toBe(0);
    expect(s.anchor).toEqual([30, 40]); // NewProjectile ai0/ai1 = 锚点（:1548）
    // CheckMech 30 冷却（:1538-1540）
    deviceTable(w, ctx, 338, 30, 41);
    expect(shots).toHaveLength(1);
    for (let i = 0; i < 30; i++) w.updateMech();
    deviceTable(w, ctx, 338, 30, 41);
    expect(shots).toHaveLength(2);
  });

  it('同锚点去重（Wiring.cs:1542-1547：已有 aiStyle73 弹在喷则不再生成）', () => {
    const { w } = freshWiring();
    const { ctx, shots } = makeCtx({ fountainAt: [[30, 40]] });
    placeFountainTile(w, 30, 40);
    deviceTable(w, ctx, 338, 30, 40);
    expect(shots).toHaveLength(0); // CheckMech 已注册（:1538）但不生成弹
  });
});

describe('马桶烟花（Wiring.cs:1498-1509，tile 497 与椅表 15 共用）', () => {
  it('tile 497：num68 = j - frameY%40/18 锚点回算 → 弹 733 于 (x*16+8, num68*16+12)', () => {
    const { w } = freshWiring();
    const { ctx, shots } = makeCtx();
    placeToilet(w, 'v_497_toilets', 40, 50, 1); // frameY/40 == 1（马桶带）
    expect(deviceTable(w, ctx, 497, 40, 51)).toBe(true); // 下格：num68 = 51-1 = 50
    expect(shots).toHaveLength(1);
    const s = shots[0]!;
    expect(s.kind).toBe('toiletPop');
    expect(s.px).toBe(40 * 16 + 8);   // :1505
    expect(s.py).toBe(50 * 16 + 12);  // :1505
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.damage).toBe(0);
  });

  it('CheckMech(锚点, 60)（:1503）；椅表 15 的 frameY/40==20 马桶样式同弹', () => {
    const { w } = freshWiring();
    const { ctx, shots } = makeCtx();
    placeToilet(w, 'chair', 40, 50, 20); // 椅表马桶（黄金马桶带）
    deviceTable(w, ctx, 15, 40, 51); // 下格：num68 = 51 - (20*40+18)%40/18 = 50
    expect(shots).toHaveLength(1);
    expect(shots[0]!.kind).toBe('toiletPop');
    expect(shots[0]!.py).toBe(50 * 16 + 12);
    // 60t 冷却：立即再触发不发（上格触发，锚点同为 (40,50)）
    deviceTable(w, ctx, 15, 40, 50);
    expect(shots).toHaveLength(1);
    for (let i = 0; i < 60; i++) w.updateMech();
    deviceTable(w, ctx, 15, 40, 50);
    expect(shots).toHaveLength(2);
    // 非马桶椅（frameY/40 不在 {1,20}）不发射
    const { ctx: c2, shots: s2 } = makeCtx();
    placeToilet(w, 'chair', 44, 50, 0);
    deviceTable(w, c2, 15, 44, 51);
    expect(s2).toHaveLength(0);
  });
});

// ============ 弹体（Projectile SetDefaults + AI + Kill） ============

describe('烟花火箭弹体 167-170（SetDefaults Projectile.cs:2291-2300 + AI :25677-25739 + Kill :73435）', () => {
  it('14×14 / timeLeft 45 / 无重力直线上升，45 tick 到点爆花 + Item14 + 192×192 伤害盒', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（烟花爆盒首掷 ×1.0）
    // 爆心 ≈ (207, -145)：敌怪摆在盒内（±96，:73912-73920）
    const { game, bursts, sfx, hits } = makeGame(undefined, 130, -180);
    const p = new TrapShot(200, 200, 0, -8, 150, 'fireworkRocket', 0);
    expect(p.w).toBe(14); // SetDefaults :2293
    expect(p.life).toBe(45); // :2297
    let ticks = 0;
    while (!p.dead && ticks < 100) { p.fixedUpdate(1, game); ticks++; }
    expect(ticks).toBe(45); // 45 tick 后 Kill
    // 上升无重力（AI_034 不改 velocity）
    expect(p.y).toBeCloseTo(200 - 44 * 8, 6);
    // Kill：SoundID.Item14（:73437）+ 红尘四档爆花（:73439-73473 共 400 尘）
    expect(sfx).toContain('explosion');
    const total = bursts.reduce((n, b) => n + b.count, 0);
    expect(total).toBe(400);
    expect(bursts.every((b) => b.color === FW_DUST.d130_red)).toBe(true);
    // 192×192 伤害盒（:73912-73920）→ 150 伤结算
    expect(hits).toEqual([150]);
  });

  it('撞块同样 Kill 爆花（tileCollide=true）', () => {
    const world = new World(60, 60, 7, 'open');
    const { game, bursts, sfx } = makeGame(world);
    // 弹心 (207,199) 上移后落 (12,12) 格：置石迫其撞块爆花
    world.store.setTileSilent(12, 12, TILE_BY_KEY['stone']!);
    const p = new TrapShot(200, 200, 0, -8, 150, 'fireworkRocket', 0);
    let ticks = 0;
    while (!p.dead && ticks < 100) { p.fixedUpdate(1, game); ticks++; }
    expect(ticks).toBe(1);
    expect(sfx).toContain('explosion');
    expect(bursts.reduce((n, b) => n + b.count, 0)).toBe(400);
  });
});

describe('烟花盒弹体 415-418（SetDefaults Projectile.cs:4669-4676 + Kill :73663-73898）', () => {
  it('timeLeft 45 / damage 0 = 纯视觉：爆花照发但不结算伤害（:73912-73920 damage 0）', () => {
    const { game, bursts, hits } = makeGame();
    const p = new TrapShot(200, 200, 0, -8, 0, 'fireworksBoxRocket', 0);
    expect(p.life).toBe(45); // :4674
    let ticks = 0;
    while (!p.dead && ticks < 100) { p.fixedUpdate(1, game); ticks++; }
    expect(ticks).toBe(45);
    // 红 415（:73663-73710）：30×rand(5,9) 臂尘 + 100 补充尘 → 250-340 粒量级
    const total = bursts.reduce((n, b) => n + b.count, 0);
    expect(total).toBeGreaterThanOrEqual(250);
    expect(total).toBeLessThanOrEqual(340);
    expect(hits).toHaveLength(0); // damage 0 → 不 hurt
  });
});

describe('烟花喷泉弹体 419-422（SetDefaults Projectile.cs:4679-4686 + AI_073 :29369-29510）', () => {
  it('4×4 / timeLeft 3600 / 每 tick 2 粒火花；锚点 338 被拆即 Kill（:29371-29377）', () => {
    const { world, w } = freshWiring();
    const { game, bursts } = makeGame(world);
    placeFountainTile(w, 30, 40);
    const p = new TrapShot(30 * 16 + 8, 40 * 16 + 2, 0, 0, 0, 'fireworkFountain', 0, [30, 40]);
    expect(p.w).toBe(4); // SetDefaults :4681
    expect(p.life).toBe(600); // ★I 批:NewProjectile 内联表 :11035-11050 四连 timeLeft=600(SetDefaults 未覆写=复位 3600 后被覆写)
    for (let t = 0; t < 5; t++) p.fixedUpdate(1, game);
    expect(bursts).toHaveLength(5); // 每 tick 2 粒（:29386 num627<2）
    expect(bursts.every((b) => b.count === 2)).toBe(true);
    expect(bursts.every((b) => b.color === FW_DUST.d222_yellow)).toBe(true); // 419 黄（:29393 尘 222）
    expect(bursts[0]!.speed).toBeCloseTo(2, 6); // num625 = 2（:29378-29383 满寿命档）
    expect(p.dead).toBe(false);
    // 拆掉喷泉方块 → 下一 tick Kill
    world.store.setTileSilent(30, 40, 0);
    world.store.setTileSilent(30, 41, 0);
    p.fixedUpdate(1, game);
    expect(p.dead).toBe(true);
    expect(bursts).toHaveLength(5); // Kill 帧不再喷
  });

  it('421 蓝：timeLeft%10==0 追加 9 粒扇面（:29455-29475）；末 60t 出速衰减（:29378-29383）', () => {
    const { world, w } = freshWiring();
    const { game, bursts } = makeGame(world);
    placeFountainTile(w, 30, 40);
    const p = new TrapShot(30 * 16 + 8, 40 * 16 + 2, 0, 0, 0, 'fireworkFountain', 2, [30, 40]);
    for (let t = 0; t < 10; t++) p.fixedUpdate(1, game);
    // 10 tick 内恰有一次 life%10==0（life 3590 → 3599 间 3590 命中一次）
    const fans = bursts.filter((b) => b.count === 9);
    expect(fans).toHaveLength(1);
    expect(bursts.filter((b) => b.count === 2).every((b) => b.color === FW_DUST.d221_blue)).toBe(true);
    // 衰减档：life 压到 30 → sp = 2*30/60 = 1
    p.life = 31;
    bursts.length = 0;
    p.fixedUpdate(1, game);
    expect(bursts[0]!.speed).toBeCloseTo(1, 6);
  });
});

describe('马桶水花弹体 733（SetDefaults Projectile.cs:7434-7441 + AI_153 :49278-49314）', () => {
  it('2×2 隐形发射器：首帧 6 尘、随后 10 帧 2 尘（共 26），第 12 帧自杀', () => {
    const { game, bursts } = makeGame();
    const p = new TrapShot(40 * 16 + 8, 50 * 16 + 12, 0, 0, 0, 'toiletPop');
    expect(p.w).toBe(2); // SetDefaults :7435
    let ticks = 0;
    while (!p.dead && ticks < 100) { p.fixedUpdate(1, game); ticks++; }
    expect(ticks).toBe(12); // ai[0] 0..10 共 11 帧发射，ai[0]=11 → Kill（:49284-49287）
    const water = bursts.filter((b) => b.color === FW_DUST.d216_water);
    expect(water).toHaveLength(11); // 1×6 尘帧 + 10×2 尘帧（:49299-49305）
    expect(water.reduce((n, b) => n + b.count, 0)).toBe(26);
    expect(water[0]!.count).toBe(6); // 首帧 6 粒（:49292-49294 num=6）
    expect(p.dead).toBe(true);
  });
});

describe('尘色表对表（Dust.cs:2204-2226 发光 RGB → hex）', () => {
  it('130-134 爆花尘：光照系数 (1,.5,.4)/(.4,1,.6)/(.3,.5,1)/(.9,.9,.3) + 金 134', () => {
    expect(FW_DUST.d130_red).toBe('#FF8066');   // Lighting 1.0/0.5/0.4（Dust.cs:2209-2211）
    expect(FW_DUST.d131_green).toBe('#66FF99'); // 0.4/1.0/0.6（:2213-2215）
    expect(FW_DUST.d132_blue).toBe('#4D80FF');  // 0.3/0.5/1.0（:2217-2219）
    expect(FW_DUST.d133_yellow).toBe('#E6E64D'); // 0.9/0.9/0.3（:2221-2223）
    expect(FW_DUST.d134_gold).toBe('#FFF2A8');  // 未入光照表（:2204 只列 130-133）
  });
});
