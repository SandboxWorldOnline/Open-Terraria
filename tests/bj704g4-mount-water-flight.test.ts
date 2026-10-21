// BJ704-G4 判别锁（BJ703-D2b 登记债清偿,2026-10-21）：坐骑水下飞行/悬停/耗尽缓降
// 湿支 vy 链。全部走真实 Player.fixedUpdate（makeHooks 精简桩,同 bj701/bj703d 口径）。
//
// 【定谳锚（1457 反编译亲读）】
//  · 原版坐骑 vy 链（Player.cs:27158-27235 else-if 链）【无湿门】——26940-27245
//    wet 零 token（BJ703-D D2b 定谳锚）：骑乘者湿态照跑 CanHover→Hover /
//    CanFly∧controlJump∧jump==0→Flight()/?耗尽 gravity/3+maxFallSpeed/3。
//  · 重力/maxFallSpeed/jumpSpeed 全 Player 字段：Update 头湿档（水 0.2/5.01,
//    :24595-24625）后 :24884 无条件 ×num6（含湿）;UpdateJumpHeight（:26211→
//    :19746-19757）骑乘覆写在液体档【后】→ 链内 jumpSpeed=坐骑档 mJumpSpd。
//  · 悬停飞行帧态门（Mount.cs Hover :3361-3373）：默认 2∨4;49 仅 4;56=2∨3;
//    61=2∨3∨4（★61 含游泳帧——本刀修,旧 56∨61 合写漏 4）。
//  · 湿面存活表：悬停 8/23/44/48/61（5 蜜蜂/7 飞碟/56 蝙蝠湿拍自动下坐
//    C5-B1;12 猪鲨崽/44 海盗船/49 熔岩鲨 buff 168/279/305 ignoreWater=游泳
//    自由走干路既有链）+飞行 0 驯鹿/2 猪龙/50 史后/54 迅猛龙（闩）。
//  · 配套三刀：①湿支断翅滑翔门补 wingsLogicW>0（原版 :27236 wingsLogic>0,
//    骑乘清零恒不达;旧 `!!eqWet.wing` 骑乘伪触发钳 lMaxFall/3）;②湿重力段
//    让位 mountFlight（原版 else-if 链互斥）;③长跳平台钉（:20823-20838 sustain
//    在原版先于坐骑链=链胜,本仓钉位在支后跑→钉写须让位 mountFlight,计数器照耗）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { seededRandom, BATTERY_SEED } from './seeded-rng';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

type P = import('../src/entities/Player').Player;

/** 真实 Player 最小钩桩（bj701/bj703d 同款） */
function makeHooks(w: World) {
  return {
    world: w, player: null as unknown,
    enemies: () => [], critters: () => [], npcs: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
    spawnParticles: () => {}, spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    addDamageNumber: () => {}, spawnDrop: () => null, damagePlayer: (): number => 0,
    notifyInventoryChanged: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, cutTile: () => {},
  } as never as Parameters<P['fixedUpdate']>[1];
}

/**
 * 深水池世界：water rows [top..bottom-1]、池底 bottom 实心（x 14..28）。
 * groundLevel 显式 200（World 构造缺省 0——num6 走 ±Inf 上钳支非真实公式面,
 * bj703d 夹具同款补全）。num6=1 于 yT ≥ 60+10n5+200/6 ≈ 93.3;0.25 下钳于
 * yT < 60+10n5+200/6×0.25…（太空带池 top=60 实测 num6=0.0899→钳 0.25）。
 * 世界 60×180:底部 offLimit 带（hPx−640=行 140）之上 + 顶界钳 640px（行 40）
 * 之下取水域。 */
function makePoolWorld(seed: string, top: number, bottom: number) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, 0);
  }
  return w;
}

async function makePlayer(yTile: number, wings = false): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  const { ITEM_BY_KEY } = await import('../src/data/items');
  const p = new Player(21 * 16, yTile * 16, new Inventory());
  if (wings) p.inv.armor[3] = { id: ITEM_BY_KEY['vi_493_天使之翼'], stack: 1 };
  return p;
}

/** 骑上指定坐骑（D2/bj703d 口径：直接置 active/type） */
function rideMount(p: P, type: number) {
  p.mount.active = true;
  p.mount.type = type;
}

/** 无跳键沿持跳（jumpEdgePrev 预置真——tick 尾快照会保持,全程无 edge = 不触发
 *  水中起跳门,隔离坐骑链本体） */
function holdJumpNoEdge(p: P) {
  p.inputJump = true;
  p.jumpEdgePrev = true;
}

// ---------------------------------------------------------------------------
// A. 悬停族湿支（巫婆扫帚 23：免疲劳 hover,acc 0.16,vMin=-8/vMax=8）
// ---------------------------------------------------------------------------
describe('BJ704-G4 A 悬停族水下 Hover（mount 23,湿支 vy 链 :27158-27235 无湿门）', () => {
  it('A1 静置：vy 收敛 -0.001 钉位（防漂补偿后净位移≈0）,不下沉（无链则湿重力 0.2/t 直坠）', async () => {
    const w = makePoolWorld('bj704g4-a1', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 23);
    p.vy = 1;                       // BJ703-D 判例④：起量避开 vy=0 回充门
    for (let i = 0; i < 12; i++) p.fixedUpdate(1 / 60, game);
    expect(p.inWater).toBe(true);
    expect(p.mount.active).toBe(true);            // 23 不在下坐族（5/7/56）
    expect(p.mount.frameState).toBe(4);           // SWIMMING（分派 :36485 wet→4）
    expect(p.vy).toBeCloseTo(-0.001, 10);         // 悬停钉（:3432-3438 哨兵 + 收敛）
    const y1 = p.y;
    for (let i = 0; i < 5; i++) p.fixedUpdate(1 / 60, game);
    expect(Math.abs(p.y - y1)).toBeLessThan(0.05); // 净钉位（防漂 y+=0.001 抵消 vy）
  }, 30000);

  it('A2 持跳爬升：vy → vMin=-8（2-6(1-r) 满额带）,湿重力 0.2 不掺入（掺入则钉死 ~-0.4 永不到带底）', async () => {
    const w = makePoolWorld('bj704g4-a2', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 23);
    p.vy = 1;
    holdJumpNoEdge(p);
    for (let i = 0; i < 70; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(-8, 6);
    expect(p.mount.frameState).toBe(4);
  }, 30000);

  it('A3 按下潜降：vy → vMax=+8（悬停自带下行带,湿液体钳 lMaxFall=5.01 不得截）', async () => {
    const w = makePoolWorld('bj704g4-a3', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(95);
    rideMount(p, 23);
    p.vy = -0.1;
    p.inputDown = true;
    for (let i = 0; i < 60; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(8, 6);               // >5.01=液体钳未掺入（无链/重力未让位均 5.01 红）
  }, 30000);
});

// ---------------------------------------------------------------------------
// B. 飞行族湿支（驯鹿 0：flightTimeMax 160,jumpSpeed 5.31,非史莱姆=干净臂）
// ---------------------------------------------------------------------------
describe('BJ704-G4 B 飞行族水下 Flight/耗尽缓降（mount 0）', () => {
  it('B1 余能爬升：-0.1/t 至 -jumpSpeed(5.31)×1.5=-7.965 钳,燃料 160 逐拍耗', async () => {
    const w = makePoolWorld('bj704g4-b1', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 0);
    p.mount.flyTime = 160;
    p.vy = -0.1;
    holdJumpNoEdge(p);
    for (let i = 0; i < 85; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(-7.965, 6);          // 坐骑档 jumpSpeed（非液体档 6.01）
    expect(p.mount.flyTime).toBe(160 - 85);       // 逐拍 1 耗,无 vy==0 回充（全程 vy≠0）
    expect(p.mount.frameState).toBe(3);           // FLYING 帧态（分派飞行门 canHover 假族）
  }, 30000);

  it('B2 耗尽缓降：重力=湿档 0.2×num6/3 逐拍累加;深水带(num6=1) vs 太空带池(num6→0.25) 深度比 0.25 精确', async () => {
    // 深水带：rows 90..136（yT≥93.3 → num6=1）
    const wDeep = makePoolWorld('bj704g4-b2d', 90, 137);
    const gDeep = makeHooks(wDeep);
    const pDeep = await makePlayer(130);
    rideMount(pDeep, 0);
    pDeep.mount.flyTime = 0;                      // 耗尽
    pDeep.vy = -0.1;
    holdJumpNoEdge(pDeep);
    for (let i = 0; i < 15; i++) pDeep.fixedUpdate(1 / 60, gDeep);
    // 太空带池：rows 60..66（yT≈63 → num6=0.0899 → 下钳 0.25;行 60>顶界钳行 40 ✓）
    const wSpace = makePoolWorld('bj704g4-b2s', 60, 67);
    const gSpace = makeHooks(wSpace);
    const pSpace = await makePlayer(63);
    rideMount(pSpace, 0);
    pSpace.mount.flyTime = 0;
    pSpace.vy = -0.1;
    holdJumpNoEdge(pSpace);
    for (let i = 0; i < 15; i++) pSpace.fixedUpdate(1 / 60, gSpace);
    const dDeep = pDeep.vy + 0.1;                 // 15×0.2×1/3 = 1.0
    const dSpace = pSpace.vy + 0.1;               // 15×0.2×0.25/3 = 0.25
    expect(pDeep.vy).toBeCloseTo(0.9, 5);
    expect(pSpace.vy).toBeCloseTo(0.15, 5);
    expect(dDeep / dSpace).toBeCloseTo(4, 3);     // 深度比 0.250（num6 乘区判别,同 bj703d 范式）
  }, 30000);

  it('B3 史后坐骑 50 耗尽臂 × slime 浮力 switch 共存（:28195-28207 vy-0.5 与 gravity/3 加法净效）', async () => {
    const w = makePoolWorld('bj704g4-b3', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 50);
    p.mount.flyTime = 0;
    p.vy = -0.1;
    holdJumpNoEdge(p);            // 无 edge=不触水中起跳;湿史莱姆清湿臂照跑（不闸链）
    for (let i = 0; i < 2; i++) p.fixedUpdate(1 / 60, game);
    // 每拍：浮力 -0.5 + 耗尽臂 +0.2/3 → -0.1-2×(0.5-0.0666..67) = -0.96667
    expect(p.vy).toBeCloseTo(-0.1 - 2 * (0.5 - 0.2 / 3), 5);
    // 拍尾寄存器：仓内序=浮力档置 30（湿流程 :5511）→ controlJump 清湿（:6923）
    // → 拍尾 0;原版序=JumpMovement 清（:20813）→ 湿 switch 重置 30（:28196）→
    // 拍尾 30。寄存序差=登记债 #8（块位族）,vy 加法净效不受影响（上式已锁）。
    expect(p.wetSlime).toBe(0);
  }, 30000);
});

// ---------------------------------------------------------------------------
// C. 迅猛龙 54 选择性飞行湿支（allowedToFly 闩,BJ703-D1 域的湿面延伸）
// ---------------------------------------------------------------------------
describe('BJ704-G4 C 迅猛龙 54 水下（canFly=allowedToFly 闩 :2871）', () => {
  it('C1 无翼：闩假 → 链不接管,湿重力 0.2/t 照加（负对照,锁不飞面）', async () => {
    const w = makePoolWorld('bj704g4-c1', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(130, false);
    rideMount(p, 54);
    p.vy = -0.1;
    holdJumpNoEdge(p);
    for (let i = 0; i < 5; i++) p.fixedUpdate(1 / 60, game);
    expect(p.mount.allowedToFly).toBe(false);
    expect(p.vy).toBeCloseTo(-0.1 + 5 * 0.2, 5);  // 常规湿重力（链缺席=原版非飞族湿态）
  }, 30000);

  it('C2 有翼：水中起跳 15 拍平台钉（★G5-①坐骑档 jumpHeight）→ 钉尽后 Flight 接管,爬升钳 -jumpSpeed(6.01)×1.5=-9.015,燃料=wingTimeMax(100) 起算', async () => {
    const w = makePoolWorld('bj704g4-c2', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(130, true);
    rideMount(p, 54);
    p.inputJump = false;
    for (let i = 0; i < 40; i++) p.fixedUpdate(1 / 60, game);   // 沉底稳定（vy==0 回充 100）
    expect(p.mount.allowedToFly).toBe(true);
    expect(p.mount.flyTime).toBe(100);
    p.inputJump = true;                           // 边沿起跳（jumpEdgePrev=false）
    // ★BJ704-G5（G4-①）：骑乘湿态水跳=坐骑档（54 jumpHeight 15,旧液体档 30）
    p.fixedUpdate(1 / 60, game);                  // 跳拍：vy=-6.01（54 jumpSpeed 6.01）
    //   + 同拍湿重力 0.2（原版链序:JumpMovement 跳 → flag19/坐骑链均被 jump>0 拒 →
    //   常规重力臂照加）= -5.81
    expect(p.vy).toBeCloseTo(-6.01 + 0.2, 5);
    expect(p.jumpHold).toBe(15);
    for (let i = 0; i < 109; i++) p.fixedUpdate(1 / 60, game);  // 15 钉拍 + 94 飞拍
    expect(p.vy).toBeLessThanOrEqual(-8.99);      // 爬升帽 -9.015（坐骑档 6.01）
    expect(p.vy).toBeGreaterThanOrEqual(-9.05);
    // 燃料账：跳拍/钉拍（jumpHold>0）链不消费（canFly 门 jump==0）;钉尽起 1/t ×94
    expect(p.mount.flyTime).toBe(100 - 94);
    expect(p.mount.frameState).toBe(3);           // 扇翼帧态（16-20 帧组的态位）
  }, 30000);
});

// ---------------------------------------------------------------------------
// D. 仙灵武库 61（hover 飞行帧态门含游泳 4——Mount.cs :3370-3373 与 56 分立）
// ---------------------------------------------------------------------------
describe('BJ704-G4 D 仙灵 61 水下悬停（Hover :3370-3373 flag2=2∨3∨4）', () => {
  it('D1 水下帧态=SWIMMING(4) 悬停照飞：持跳 vy → vMin=-dashSpeed(4.5)（56/61 特例带）', async () => {
    const w = makePoolWorld('bj704g4-d1', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 61);
    p.vy = 1;
    holdJumpNoEdge(p);
    for (let i = 0; i < 40; i++) p.fixedUpdate(1 / 60, game);
    expect(p.mount.frameState).toBe(2);           // ★G15 case-61 强切后帧态归一 2（Mount.cs:3674-3677 分派 4→2;悬停门 2/3/4 全域含 2=行为零差——G16 批随 vanilla 终态迁移,旧期望 4 系强切前值）
    expect(p.vy).toBeCloseTo(-4.5, 6);            // 61 特例 vMin=-dashSpeed（:3448-3451）
    // 旧 56∨61 合写漏 4 → flyingState 假 → hover 空转 + mountFlight=true 掩重力 → vy 冻结 1
  }, 30000);

  it('D2 蝙蝠 56 对照：游泳帧态不入悬停带（:3366-3369 仅 2∨3）——湿拍下坐族,帧态门保持分立', async () => {
    const w = makePoolWorld('bj704g4-d2', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 56);
    p.vy = 1;
    holdJumpNoEdge(p);
    p.fixedUpdate(1 / 60, game);
    expect(p.mount.active).toBe(false);           // C5-B1 湿拍下坐（:28188-28193 case 56）
  }, 30000);
});

// ---------------------------------------------------------------------------
// F. 断翅滑翔骑乘门（wingsLogicW>0——骑乘清翼恒 0,旧 `!!eqWet.wing` 伪触发）
// ---------------------------------------------------------------------------
describe('BJ704-G4 F 湿支断翅滑翔骑乘门（:27236 wingsLogic>0）', () => {
  it('骑钻头 8 装翼持跳入水减速带：hover 减速逐拍 -0.32,不被旧滑翔钳 lMaxFall/3=1.67 截', async () => {
    const w = makePoolWorld('bj704g4-f1', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(130, true);        // 装天使翼（eqWet.wing 真值面）
    rideMount(p, 8);
    p.vy = 5;
    holdJumpNoEdge(p);
    p.fixedUpdate(1 / 60, game);
    // hover：arm -0.16 + 带钳 -0.16 → 5-0.32=4.68（骑乘 wingsLogicW=0 → 滑翔臂不得钳 1.67）
    expect(p.vy).toBeCloseTo(4.68, 5);
  }, 30000);
});

// ---------------------------------------------------------------------------
// G. 长跳平台钉让位（JumpMovement sustain :20823-20838 先于坐骑链=链胜）
// ---------------------------------------------------------------------------
describe('BJ704-G4 G 水中起跳后 hover 接管（平台钉让位 mountFlight,计数器照耗）', () => {
  it('骑扫帚 23 池底起跳：跳拍 vy=-4/jumpHold=10（★G5-①坐骑档）;次拍起 hover 接管（vy=-4.16 而非钉 -4）,jumpHold 照耗', async () => {
    const w = makePoolWorld('bj704g4-g1', 90, 137);
    const game = makeHooks(w);
    const p = await makePlayer(134.375);          // 池底贴齐（y=2150,bottom=2192=池底顶;
                                                  // 悬空 6px 会被免疲劳贴地臂 0.001 起浮成
                                                  // 悬停钉态,vy≠0 → 起跳门永闭）
    rideMount(p, 23);
    p.inputJump = false;
    for (let i = 0; i < 6; i++) p.fixedUpdate(1 / 60, game);   // 贴底稳定（vy==0,免疲劳贴地臂）
    expect(p.vy).toBe(0);
    p.inputJump = true;                           // 边沿 → 水中起跳门（vy==0）
    p.fixedUpdate(1 / 60, game);                  // 跳拍：★G5-① vy=-4（扫帚坐骑档 4,
    //  旧液体档 6.01）,jumpHold=10（坐骑档 10,旧 30）
    expect(p.vy).toBeCloseTo(-4, 5);
    expect(p.jumpHold).toBe(10);
    p.fixedUpdate(1 / 60, game);                  // 次拍：hover 接管（frameState 已切 4）
    expect(p.vy).toBeCloseTo(-4 - 0.16, 5);       // -4.16（钉位让位;旧钉恒 -4 红）
    expect(p.jumpHold).toBe(9);                   // 计数器照耗（原版 jump-- 无条件）
  }, 30000);
});

// ---------------------------------------------------------------------------
// H. 结构锁（源文本锚——防静默回退;BJ703d 结构锁同式）
// ---------------------------------------------------------------------------
describe('BJ704-G4 H 结构锁（Player.ts/Mounts.ts 源文本锚）', () => {
  const playerSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Player.ts'), 'utf8');
  const mountsSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Mounts.ts'), 'utf8');

  it('湿支坐骑 vy 链在位（湿段锚点之间,含 canHover/canFly/flight/耗尽臂四件）', () => {
    const wetStart = playerSrc.indexOf('★湿态翅膀核心');
    const wetEnd = playerSrc.indexOf('断翅滑翔');
    expect(wetStart).toBeGreaterThan(0);
    expect(wetEnd).toBeGreaterThan(wetStart);
    const wetBody = playerSrc.slice(wetStart, wetEnd);
    expect(wetBody).toContain('★BJ704-G4（BJ703-D2b 登记债清偿');
    expect(wetBody).toContain('if (mnt2.canHover(this)) {');
    expect(wetBody).toContain('mnt2.canFly(this) && this.inputJump && this.jumpHold === 0');
    expect(wetBody).toContain('if (mnt2.flight()) {');
    expect(wetBody).toContain('this.vy += mountGFieldW / 3 * gd;');
    expect(wetBody).toContain('const capW = lMaxFall / 3;');
    // ★BJ704-G5（G4-⑤a）：重力源并轨 lGrav（tier×num6 字段,上方 G5 段统一乘）
    expect(wetBody).toContain('const mountGFieldW = lGrav;');
    // 爬升臂用坐骑档 mJumpSpd（非液体档 lJSpd——UpdateJumpHeight 骑乘后覆写序）
    expect(wetBody).toContain('let js = mJumpSpd;');
  });

  it('湿重力段让位门 + 滑翔骑乘门 + 平台钉让位门（三处门表达式逐字）', () => {
    expect(playerSrc).toContain('if (!flying && !mountFlight && (this.rocketDelay === 0 || this.cced)) {');   // ★G16 CCed 平重力放行（vanilla :27005 无湿门）
    expect(playerSrc).toContain('!!eqWet.wing && wingsLogicW > 0 && this.wingTime <= 0');
    expect(playerSrc).toContain('if (this.inputJump && !mountFlight) {');
  });

  it('Mounts.ts 61 飞行帧态门与 56 分立（:3370-3373 vs :3366-3369）', () => {
    expect(mountsSrc).toContain(
      'flyingState = this.frameState === FRAME_IN_AIR || this.frameState === FRAME_FLYING\n        || this.frameState === FRAME_SWIMMING;');
    // 56 保持不含游泳（分立锁:防再度合写）
    const m56 = mountsSrc.match(/if \(this\.type === 56\) \{[\s\S]*?\}/);
    expect(m56).not.toBeNull();
    expect(m56![0]).not.toContain('FRAME_SWIMMING');
  });
});
