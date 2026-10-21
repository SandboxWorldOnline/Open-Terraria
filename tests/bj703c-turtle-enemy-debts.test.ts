// ★BJ703-C（2026-10-21）登记债清算·丛林龟/敌怪域（BJ700-B 的 D1-D6 六件）判别锁。
//
// 逐件定谳（Terarria1457 亲读）：
//  · D1 walkDownSlopePre 被 stepDownGate='never' 连带拦截 → 修：与 'never' 解耦
//    （原版 NPC Collision_WalkDownSlopes 无条件跑 = UpdateCollision 首步 NPC.cs:93667,
//    内门 vy==gravity Collision.cs:1695;flag22 只门 StepDown :54518-21;玩家
//    SlopeDownMovement 仅 mount48/shimmering 豁免 Player.cs:23607）。显式 opt-out =
//    Body.walkDownSlopeOff（玩家载具态保守档=既存行为保留,原版矿车照跑——登记债 D8）。
//  · D2 湿身非龟蛙族小动物重力 0.3/帽 10 → 修：wet 尾置直替全 NPC（:92054-92071
//    water 0.2/7、honey 0.1/4、shimmer 0.15/5.5）。
//  · D3 614 爆炸兔危险档缺 → 修①路由（aiStyle 7 非 CountsAsCritter 面此前落
//    default zombieAI——释放 1338 放出的兔追人非原版;原版 :18879 case 7 一律
//    AI_007 critter 支）+ 修②档头 (type==614)&flag16 → 1.5/0.1（:54427-54431）+
//    修③逃逸档补 friendly 门（:54467——旧注「friendly 恒真」系误读:野生小动物
//    friendly 恒【假】,SubAI :91649-91670 对 87 型 npcCatchable 每 tick 强制清旗）。
//  · D4 LeashedCritter 龟缺湿泳带 → 判语销案：原版拴绳 dummy 恒干
//    （LeashedCritter.CopyToDummy :185 `_dummy.wet = false`）——湿泳带对全部拴绳
//    小动物不可达,SW 干带+双钉实现 = 1:1（TECritterAnchor.cs:79 龟确可拴）。
//  · D5 bestiaryDummyFrameIdx 龟支无状态近似 → 判语销案：图鉴 dummy 输入恒定
//    （UnlockableNPCEntryIcon :99-109 velocity.X=direction×DrawOffset.Velocity、
//    vy=0、wet=IsWet;616/617/625 DrawOffset=Velocity 1 无 IsWet,NPCID.cs:9917-9924/
//    :9989-9994）→ 站定/腾空双钉不可达,状态机退化为 floor(t/9)%8（625 floor(t/8)%6）
//    ——SW 无状态式与原版逐位相等,「近似」实为恒等。
//  · D6 原版小 vx 清零（:91588-91591 |vx|<0.005→0,AI 后/碰撞前全体 NPC）Enemy 侧
//    缺 → 修：AI 分发后共享尾段清零（帧机站定钉同拍面;TownNPC 侧同缺=登记债 D9）。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { TileStore } from '../src/world/TileStore';
import { Enemy } from '../src/entities/Enemy';
import { moveAndCollide, walkDownSlopePre } from '../src/physics/TileCollision';
import { bestiaryDummyFrameIdx } from '../src/render/Renderer';
import { LeashedCritterEntity, PROTOTYPES } from '../src/entities/LeashedCritter';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(__dirname, '..');
const NPC_1457 = join(ROOT, '../Terarria1457/Terraria/NPC.cs');
const NPCID_1457 = join(ROOT, '../Terarria1457/Terraria.ID/NPCID.cs');
const LEASHED_1457 = join(ROOT, '../Terarria1457/Terraria.GameContent.LeashedEntities/LeashedCritter.cs');
const ANCHOR_1457 = join(ROOT, '../Terarria1457/Terraria.GameContent.Tile_Entities/TECritterAnchor.cs');
const EXT_MISSING = !existsSync(NPC_1457);
const npc1457 = EXT_MISSING ? '' : readFileSync(NPC_1457, 'utf8');
const npcId1457 = EXT_MISSING ? '' : readFileSync(NPCID_1457, 'utf8');
const leashed1457 = EXT_MISSING ? '' : readFileSync(LEASHED_1457, 'utf8');
const anchor1457 = EXT_MISSING ? '' : readFileSync(ANCHOR_1457, 'utf8');
const enemySrc = readFileSync(join(ROOT, 'src/entities/Enemy.ts'), 'utf8');
const tcSrc = readFileSync(join(ROOT, 'src/physics/TileCollision.ts'), 'utf8');
const leashedSrc = readFileSync(join(ROOT, 'src/entities/LeashedCritter.ts'), 'utf8');
const playerSrc = readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8');

const TILE = 16;

// ---------------------------------------------------------------------------
// 夹具（critter-parity-fixes 同款 80×140 世界;深水池变体给 D2 沉降窗）
// ---------------------------------------------------------------------------
function critterWorld(opts: { deepWater?: boolean } = {}) {
  const w = new World(80, 140, 42, 'open');
  w.groundLevel = 42;
  const st = w.store;
  for (let x = 10; x <= 70; x++) st.setTileSilent(x, 60, 2);      // 地板 y=60
  if (opts.deepWater) {
    // 20..60 列 40..59 行深水（20 深,池底=60 行地板——沉降率/终速双窗）
    for (let x = 20; x <= 60; x++) for (let y = 40; y <= 59; y++) st.setLiquid(x, y, 255, 1);
  }
  const hooks = {
    world: w,
    player: null,
    playSfx: () => {}, addDamageNumber: () => {}, spawnParticles: () => {},
    spawnDrop: () => null, damagePlayer: (): number => 0,
    entities: { add: () => {} },
    enemies: () => [] as unknown[],
  } as never;
  return { w, hooks };
}

/** 危险源桩（damage>0 敌怪 + CanHit 视线——critter-parity-fixes 同款） */
function fakeEnemy(x: number, y: number): unknown {
  return {
    dead: false, x, y, w: 20, h: 20, cx: x + 10, cy: y + 10,
    vanillaId: 3, vanilla: { aiStyle: 3, noGravity: false },
    def: { damage: 5, friendly: false },
    noTileCollide: false,
  };
}

/** hooks.enemies 注入危险源 */
function withDanger(hooks: never, src: unknown): never {
  return { ...(hooks as Record<string, unknown>), enemies: () => [src] } as never;
}

/** 生成 + 落稳定态（spawnWalker 同款） */
function spawnWalker(vid: number, hooks: never, x = 40): Enemy {
  const e = Enemy.fromVanilla(vid, x * TILE, 58 * TILE)!;
  for (let t = 0; t < 40; t++) e.fixedUpdate(1 / 60, hooks);
  return e;
}

// ---------------------------------------------------------------------------
// A. 原版活体锚（1457 直读,漂移即爆红）
// ---------------------------------------------------------------------------
describe.skipIf(EXT_MISSING)('BJ703-C 原版锚（D1/D2/D3/D4/D5/D6）', () => {
  it('D1:NPC UpdateCollision 首步无条件 Collision_WalkDownSlopes;flag22 只门 StepDown', () => {
    const i = npc1457.indexOf('private void UpdateCollision()');
    const body = npc1457.slice(i, i + 400);
    expect(body).toMatch(/Collision_WalkDownSlopes\(\);\s*bool lava = Collision_LavaCollision/);
    // flag22 消费面 = 仅 StepDown（:54513-54521）
    const j = npc1457.indexOf('bool flag22 = true;', npc1457.indexOf('private void AI_007'));
    expect(npc1457.slice(j, j + 400)).toMatch(
      /if \(!flag22 && velocity\.Y == 0f\)\s*\{\s*Collision\.StepDown/);
  });
  it('D2:UpdateNPC_UpdateGravity wet 尾置直替三档（water 0.2/7、honey 0.1/4、shimmer 0.15/5.5）', () => {
    const i = npc1457.indexOf('private void UpdateNPC_UpdateGravity');
    const body = npc1457.slice(i, i + 2600);
    expect(body).toMatch(/if \(wet\)\s*\{\s*if \(shimmerWet\)\s*\{\s*gravity = 0\.15f;\s*maxFallSpeed = 5\.5f;/);
    expect(body).toMatch(/else if \(honeyWet\)\s*\{\s*gravity = 0\.1f;\s*maxFallSpeed = 4f;/);
    expect(body).toMatch(/else\s*\{\s*gravity = 0\.2f;\s*maxFallSpeed = 7f;/);
  });
  it('D3:档头 (type==614)&flag16 → 1.5/0.1;逃逸档 friendly 门(:54467)', () => {
    const i = npc1457.indexOf('float num22 = 1f;');
    const body = npc1457.slice(i, i + 900);
    expect(body).toMatch(/if \(\(type == 614\) & flag16\)\s*\{\s*num22 = 1\.5f;\s*num23 = 0\.1f;/);
    expect(body).toMatch(/if \(friendly && \(flag16 \| flag21\)\)\s*\{\s*num22 = 1\.5f;/);
  });
  it('D3:野生小动物 friendly 恒假——SubAI 对 npcCatchable 每 tick 强制清旗(:91649-91670)', () => {
    const def = npc1457.indexOf('private void SubAI_HandleTemporaryCatchableNPCPlayerInvulnerability()');
    const body = npc1457.slice(def, def + 700);
    expect(body).toMatch(/Main\.npcCatchable\[type\]/);
    expect(body).toMatch(/friendly = false;/);
    // 免疫窗 true 支须包在 catchableNPCTempImmunityCounter > 0 计数内
    expect(body).toMatch(/if \(catchableNPCTempImmunityCounter > 0\)\s*\{\s*catchableNPCTempImmunityCounter--;\s*friendly = true;/);
  });
  it('D4:拴绳 dummy 恒干(CopyToDummy `_dummy.wet = false`)+龟可拴(TECritterAnchor 616/617)', () => {
    expect(leashed1457).toMatch(/_dummy\.wet = false;/);
    expect(anchor1457).toMatch(/SetPrototypeCollection\(TurtleLeashedCritter\.Prototype, 616, 617\);/);
  });
  it('D5:图鉴 DrawOffset 616/617 Velocity=1 无 IsWet;dummy FindFrame 门 = portrait/hovered', () => {
    const i = npcId1457.indexOf('616,\n\t\t\t\t\tnew NPCBestiaryDrawModifiers(0)');
    const body = npcId1457.slice(i, i + 400);
    expect(body).toMatch(/Velocity = 1f/);
    expect(body).not.toMatch(/IsWet/);
    const u = readFileSync(join(ROOT, '../Terarria1457/Terraria.GameContent.Bestiary/UnlockableNPCEntryIcon.cs'), 'utf8');
    expect(u).toMatch(/if \(!num\.HasValue && \(settings\.IsPortrait \|\| settings\.IsHovered\)\)/);
    expect(u).toMatch(/_npcCache\.velocity\.X = \(float\)_npcCache\.direction \* num4;/);
  });
  it('D6:AI 后/碰撞前全体 NPC 小 vx 清零（|vx|<0.005 → 0）', () => {
    expect(npc1457).toMatch(
      /if \(\(double\)velocity\.X < 0\.005 && \(double\)velocity\.X > -0\.005\)\s*\{\s*velocity\.X = 0f;/);
  });
});

// ---------------------------------------------------------------------------
// B. D1:walkDownSlopePre 与 'never' 解耦（单驱 + 集成）
// ---------------------------------------------------------------------------
describe('BJ703-C D1:WalkDownSlope 预备阶段解耦', () => {
  /** 45° 下行坡（slope1 右行下行）世界：高台 G 行、坡格 sx、低地 G+1 行 */
  function slopeWorld() {
    const w = new World(60, 60, 7, 'slope');
    w.groundLevel = 30;
    const st = w.store;
    const G = 30, sx = 40;
    for (let x = 34; x <= 52; x++) for (let y = G - 3; y <= G + 3; y++) st.setTile(x, y, 0);
    for (let x = 34; x <= 52; x++) st.setTile(x, G + 2, 1);       // 安全地板
    for (let x = 34; x <= sx - 1; x++) st.setTile(x, G, 1);       // 高台
    for (let x = sx + 1; x <= 52; x++) st.setTile(x, G + 1, 1);   // 低处地面
    st.setTile(sx, G, 1);
    st.setSlope(sx, G, 1);                                        // slope1（右行下行）
    return { w, st, G, sx };
  }

  function slopeBody(st: TileStore, over: Record<string, unknown> = {}) {
    const { G, sx } = { G: 30, sx: 40 };
    return {
      x: sx * TILE + 8,            // 坡格中段（depth=8,对角面上）
      y: G * TILE - 12,            // feet = G*16+8 = 对角面
      w: 20, h: 20,
      vx: 2, vy: 0.3,              // 贴地 NPC 重力后态（原版 vy==gravity 内门）
      onGround: true, hitWall: false, hitHead: false,
      stepUp: true, stepDownGate: 'never' as const,   // AI_007 flag22 恒真档
      ...over,
    } as never as Parameters<typeof walkDownSlopePre>[0];
  }

  it("★'never' 档照跑:坡面候选 → vy += |vx|（旧 'never' 连带拦截 = 本刀病灶）", () => {
    const { w } = slopeWorld();
    const b = slopeBody(w.store);
    walkDownSlopePre(b, w, true);
    expect(b.vy).toBeCloseTo(2.3, 6);      // 0.3 + |vx| 2
  });
  it('walkDownSlopeOff=true（玩家载具态保守档）→ 跳过', () => {
    const { w } = slopeWorld();
    const b = slopeBody(w.store, { walkDownSlopeOff: true });
    walkDownSlopePre(b, w, true);
    expect(b.vy).toBeCloseTo(0.3, 6);
  });
  it("空中态（wasGround=false）'never' 体仍被内门拦——不复活旧「低空按压」", () => {
    const { w } = slopeWorld();
    const b = slopeBody(w.store, { onGround: false, vy: 0.3 });
    walkDownSlopePre(b, w, false);
    expect(b.vy).toBeCloseTo(0.3, 6);
  });
  it('★集成:龟 617 下坡贴地（对角同步,无腾空断带）——' + 'never' + ' 档小动物复活面', () => {
    const { w, st, G, sx } = slopeWorld();
    const hooks = {
      world: w, player: null,
      playSfx: () => {}, addDamageNumber: () => {}, spawnParticles: () => {},
      spawnDrop: () => null, damagePlayer: (): number => 0,
      entities: { add: () => {} }, enemies: () => [] as unknown[],
    } as never;
    const e = Enemy.fromVanilla(617, (sx - 4) * TILE, (G - 1) * TILE - 4)!;
    e.facing = 1;
    // 落稳高台 + 强制走态朝坡（spawnWalker 语义）
    for (let t = 0; t < 40; t++) e.fixedUpdate(1 / 60, hooks);
    e.ai0 = 1; e.ai1 = 999999; e.ai2 = 0; e.lai3 = -1;
    e.facing = 1; e.vx = 0.5; e.vy = 0;
    e.critterHomeX = sx - 4;
    let airTicks = 0, maxLag = 0;
    for (let t = 0; t < 260; t++) {
      e.fixedUpdate(1 / 60, hooks);
      if (e.x < (sx - 1) * TILE || e.x > (sx + 3) * TILE) continue;   // 坡过渡窗
      if (!e.onGround) airTicks++;
      // 对角面滞后:feet 与坡面理论深度差
      const depth = Math.max(0, Math.min(16, e.x + e.w / 2 - sx * TILE));
      const surf = G * TILE + depth;
      maxLag = Math.max(maxLag, e.y + e.h - surf);
    }
    expect(e.x).toBeGreaterThan((sx + 2) * TILE);   // 越过坡抵达低地
    // 全程贴地（≤1 = 坡底/平地接缝 0.2px 半像素缝 1 拍,原版同位接缝;
    // 旧无预备阶段 = 重力 0.3 < 对角 0.5 速率 → 持续滞后腾空断带）
    expect(airTicks).toBeLessThanOrEqual(1);
    expect(maxLag).toBeLessThan(6);                 // 对角同步（旧 = 每 tick 8-16px 阶梯坠）
  });
});

// ---------------------------------------------------------------------------
// C. D2:湿身小动物重力（water 0.2/帽 7——非龟蛙族 + 龟蛙蜜/微光档）
// ---------------------------------------------------------------------------
describe('BJ703-C D2:湿身小动物重力 wet 三档', () => {
  it('★兔 46 深水沉降:每 tick +0.2(旧 0.3)、终速帽 7(旧 10)', () => {
    const { hooks } = critterWorld({ deepWater: true });
    // 水面贴顶出生（中心小盒半浸 → 入水初速≈0,沉降窗全程可采）
    const e = Enemy.fromVanilla(46, 40 * TILE, 39 * TILE)!;
    const wetArr: boolean[] = [], groundArr: boolean[] = [], vyArr: number[] = [];
    for (let t = 0; t < 150; t++) {
      e.fixedUpdate(1 / 60, hooks);
      wetArr.push(e.wet); groundArr.push(e.onGround); vyArr.push(e.vy);
    }
    const deltas: number[] = [];
    let maxVy = 0;
    for (let t = 1; t < vyArr.length; t++) {
      if (wetArr[t] && wetArr[t - 1] && !groundArr[t] && !groundArr[t - 1]
        && vyArr[t] > 0 && vyArr[t - 1] > 0 && vyArr[t] < 7) {
        deltas.push(vyArr[t] - vyArr[t - 1]);
      }
      if (wetArr[t] && !groundArr[t]) maxVy = Math.max(maxVy, vyArr[t]);
    }
    expect(deltas.length).toBeGreaterThan(15);
    for (const d of deltas) expect(Math.abs(d - 0.2)).toBeLessThan(1e-6);   // 重力步 0.2（旧 0.3）
    expect(maxVy).toBeGreaterThan(6.5);      // 确实沉到帽
    expect(maxVy).toBeLessThanOrEqual(7 + 1e-9);   // 帽 7（旧实现冲 10）
  });
  it('结构锁:townCritterWalkAI 重力行 = wet 三档直替(非 pinSurface 门)', () => {
    expect(enemySrc).toMatch(/const wetGrav = this\.shimmerWet \? 0\.15 : this\.honeyWet \? 0\.1 : 0\.2;/);
    expect(enemySrc).toMatch(/this\.vy = wet\s*\?\s*Math\.min\(this\.vy \+ wetGrav, wetCap\)/);
    expect(enemySrc).not.toMatch(/pinSurface \? 0\.2 : ENEMY_GRAVITY/);   // 旧形退役
  });
});

// ---------------------------------------------------------------------------
// D. D3:614 爆炸兔路由 + 危险档 + 逃逸档 friendly 门
// ---------------------------------------------------------------------------
describe('BJ703-C D3:614 路由/危险档/逃逸档 friendly 门', () => {
  it('★路由:释放的 614 遇险【追险情】(BJ704-R3 P1② 改判:互换支=追;旧落 default zombieAI 不识险/旧测钉逃离已随判重铸)', () => {
    const { hooks } = critterWorld();
    const danger = fakeEnemy(46 * TILE, 58 * TILE);          // 右侧 80px 敌怪
    const h = withDanger(hooks, danger);
    const e = spawnWalker(614, h, 40);
    // ★追击判据=接敌距离（追击态穿过险情绕靶往复,facing 依拍振荡不可钉恒值;
    //  逃逸形=距离单调不减恒 ≥dist0）。判别锁详 tests/bj704r3-bunny-chase.test.ts
    let minDist = Infinity;
    const dangerCx = 46 * TILE + 10;
    for (let t = 0; t < 120; t++) {
      e.fixedUpdate(1 / 60, h);
      minDist = Math.min(minDist, Math.abs(e.cx - dangerCx));
    }
    expect(minDist).toBeLessThan(45);         // 到达险情=追（旧逃逸形恒 ≥90）
  });
  it('★危险档:614+险 → 帽 1.5/加速 0.1(无险 = 家族默认 1/0.07)', () => {
    const { hooks } = critterWorld();
    const danger = fakeEnemy(46 * TILE, 58 * TILE);
    const hD = withDanger(hooks, danger);
    const e = spawnWalker(614, hD, 38);      // 危险源 200px 感知窗内（~120px）
    let peak = 0;
    for (let t = 0; t < 150; t++) { e.fixedUpdate(1 / 60, hD); peak = Math.max(peak, Math.abs(e.vx)); }
    expect(peak).toBeGreaterThan(1.4);       // 1.5 档在跑（旧缺档=1.0）
    expect(peak).toBeLessThanOrEqual(1.65);

    const e2 = spawnWalker(614, hooks, 38);  // 无险:默认 1/0.07
    let peak2 = 0;
    for (let t = 0; t < 150; t++) { e2.fixedUpdate(1 / 60, hooks); peak2 = Math.max(peak2, Math.abs(e2.vx)); }
    expect(peak2).toBeGreaterThan(0.9);
    expect(peak2).toBeLessThanOrEqual(1.1);
  });
  it('★逃逸档 friendly 门:兔 46+险 → 族速 1.0（旧无门 = 1.5+残血×0.9 冲 1.5+）', () => {
    const { hooks } = critterWorld();
    const danger = fakeEnemy(46 * TILE, 58 * TILE);
    const h = withDanger(hooks, danger);
    const e = spawnWalker(46, h, 38);       // 危险源 200px 感知窗内（~130px）
    // ★BJ704-G3 D10 勘误（2026-10-21）：逃逸档 friendly 门现读运行时窗位
    //  （catchFriendly——npcCatchable 型自然出生首 90t true,SubAI :91649-91670
    //   窗外强写 false）。本测【窗外稳态】须先耗尽 90t 窗（spawnWalker 40t +
    //   此处 60t = 100t > 91）再测族速——窗内原版本就有 1.5+残血×0.9 加成
    //   （BJ704-G3 新判别锁另测窗内面）
    for (let t = 0; t < 60; t++) e.fixedUpdate(1 / 60, h);
    e.hp = 1;                                // 残血——旧逃逸档会加成到 1.5+0.9×0.8≈2.2
    let peak = 0;
    for (let t = 0; t < 150; t++) { e.fixedUpdate(1 / 60, h); peak = Math.max(peak, Math.abs(e.vx)); }
    expect(peak).toBeGreaterThan(0.9);       // 确实在走（危险调向生效）
    expect(peak).toBeLessThanOrEqual(1.1);   // 族速 1.0（窗外野生 friendly=false,原版语义）
  });
  it('结构锁:档头 614&danger 1.5/0.1 + 逃逸档 friendly 门', () => {
    expect(enemySrc).toMatch(/if \(vid === 614 && danger\) \{\s*maxX = 1\.5; acc = 0\.1;/);
    // ★BJ704-G3 D10：friendly 门改读静态位∪运行时窗位（NPC.friendly 当前值语义）
    expect(enemySrc).toMatch(
      /if \(\(\(this\.vanilla\?\.friendly \?\? false\) \|\| this\.catchFriendly\) && \(danger \|\| drowning\)\) \{/);
  });
});

// ---------------------------------------------------------------------------
// E. D4/D5:销案判语的守卫锁（拴绳龟恒干带 / 图鉴折叠恒等式）
// ---------------------------------------------------------------------------
describe('BJ703-C D4/D5:销案守卫（拴绳恒干 + 图鉴折叠恒等）', () => {
  it('D4:拴绳龟 616 帧机 = 干带 9t/帧 + 站定/腾空双钉（dummy 恒 wet=false → 无湿泳带）', () => {
    const e = new LeashedCritterEntity(10, 10, 616, PROTOTYPES.turtle, 12345);
    e.vx = 1; e.vy = 0; e.direction = 1;
    for (let t = 0; t < 8; t++) e.findFrame();
    expect(e.frame).toBe(0);                 // 8 拍仍在帧 0
    e.findFrame();                           // 第 9 拍进帧 1
    expect(e.frame).toBe(1);
    e.vy = 1; e.findFrame();                 // 腾空钉帧行 8
    expect(e.frame).toBe(8);
    e.vy = 0; e.vx = 0; e.findFrame();       // 站定钉帧 0
    expect(e.frame).toBe(0);
    // 结构锁:龟支无 wet/isAquatic 分支（= 原版 CopyToDummy 恒干语义,加湿带反而漂移）
    const i = leashedSrc.indexOf('case 616: case 617: {');
    const body = leashedSrc.slice(i, leashedSrc.indexOf('break;', i));
    expect(body).not.toMatch(/isAquatic|this\.wet/);
  });
  it('D5:图鉴龟折叠 = floor(t/9)%8(616/617)/floor(t/8)%6(625)——与状态机退化态逐位相等', () => {
    // DrawOffset Velocity=1 → |vx|=1 恒走;wet=false;vy=0 → 双钉不可达
    expect(bestiaryDummyFrameIdx(616, 7, 0, 1, 14, false)).toBe(0);
    expect(bestiaryDummyFrameIdx(616, 7, 8, 1, 14, false)).toBe(0);
    expect(bestiaryDummyFrameIdx(616, 7, 9, 1, 14, false)).toBe(1);
    expect(bestiaryDummyFrameIdx(616, 7, 63, 1, 14, false)).toBe(7);
    expect(bestiaryDummyFrameIdx(616, 7, 64, 1, 14, false)).toBe(7);   // 帧 7 保持 63..71
    expect(bestiaryDummyFrameIdx(616, 7, 71, 1, 14, false)).toBe(7);
    expect(bestiaryDummyFrameIdx(616, 7, 72, 1, 14, false)).toBe(0);   // 72 拍回卷（floor(72/9)=8 %8）
    expect(bestiaryDummyFrameIdx(616, 7, 80, 1, 14, false)).toBe(0);   // 帧 0 保持 72..80
    expect(bestiaryDummyFrameIdx(616, 7, 81, 1, 14, false)).toBe(1);
    expect(bestiaryDummyFrameIdx(625, 7, 7, 1, 12, false)).toBe(0);
    expect(bestiaryDummyFrameIdx(625, 7, 8, 1, 12, false)).toBe(1);    // 625 阈 7 → 8t/帧
    expect(bestiaryDummyFrameIdx(625, 7, 47, 1, 12, false)).toBe(5);
    expect(bestiaryDummyFrameIdx(625, 7, 48, 1, 12, false)).toBe(0);   // 回卷
    expect(bestiaryDummyFrameIdx(616, 7, 5, 0, 14, false)).toBe(0);    // 站定帧 0
  });
});

// ---------------------------------------------------------------------------
// F. D6:小 vx 清零（僵立 ×0.8 衰减链残尾不再多活 1 拍）
// ---------------------------------------------------------------------------
describe('BJ703-C D6:|vx|<0.005 → 0（AI 分发后共享尾段）', () => {
  it('★僵立态 ai0=8:vx 0.006 → ×0.8=0.0048 → 当拍清零（旧 = 残尾多活 1 拍）', () => {
    const { hooks } = critterWorld();
    const e = spawnWalker(46, hooks, 40);
    e.ai0 = 8; e.ai1 = 999;      // 僵立支（:54682-54711 vx×0.8/tick）
    e.vx = 0.006;
    e.fixedUpdate(1 / 60, hooks);
    expect(e.vx).toBe(0);        // 0.0048 < 0.005 → 清零（无清零 = 0.0048）
  });
  it('大 vx 不受影响（0.5 保持 ×0.8 衰减）', () => {
    const { hooks } = critterWorld();
    const e = spawnWalker(46, hooks, 40);
    e.ai0 = 8; e.ai1 = 999;
    e.vx = 0.5;
    e.fixedUpdate(1 / 60, hooks);
    expect(e.vx).toBeCloseTo(0.4, 6);
  });
  it('结构锁:Enemy 共享尾段清零行 + Player 载具态 walkDownSlopeOff 灌入', () => {
    expect(enemySrc).toMatch(/if \(this\.vx < 0\.005 && this\.vx > -0\.005\) this\.vx = 0;/);
    expect(playerSrc).toMatch(/this\.walkDownSlopeOff = this\.onTrack \|\| this\.ridingCart \|\| flag28Fx \|\| flag29Fx \|\| this.shimmering;/);
    expect(tcSrc).toMatch(/if \(b\.walkDownSlopeOff === true\) return;/);
    expect(tcSrc).not.toMatch(/if \(gate === 'never'\) return;/);   // 旧连带拦截退役
  });
});
