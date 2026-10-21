// ★BJ704-G13（2026-10-21）坐骑/毯域五件清算第三刀（G12 新登记债,判别锁+结构锁）。
//  债源：memory/bj704g12-mount-debts2.md「新登记债」五件。锚全在 1457 反编译亲读：
//  · 债1 BUFF_SWIM_FREE 误含 265 火烈鸟：vanilla :9982-9986 只授 canFloatInWater+
//    accFlipper（非 ignoreWater）——表项勘正（131/168/279/305 留集）+canFloatInWater
//    面（湿路由 WetCollision+liqFactor 0.5+TryFloatingInFluid 液面漂,仓内既有链承接）。
//  · 债2 CCed 下坐门缺 TryDismount 双闸：原版 :27004 经 CanDismountWithResult
//    :6682-6696——DontDismountWhenCCed{55,56,61}（MountID.cs:29）豁免 + 20×42 无空间
//    拒;拒下坐拍 Dismount 体内效果（petting :6219-6222/ClearBuff :6214）不发生;
//    拒下坐骑者维护段照跑（UpdateEffects :25855 只挂 mount.Active 无 CCed 门）。
//  · 债3 swimFree buff 的 accFlipper 面（:9974-9998 ignoreWater 族 ∪ 265 并授——
//    湿跳门 flag2 :20795 液中悬空泳跃）+ 湿跳门 wallCling 腿（:20845 sliding 放行）。
//  · 债4 mount 48 updateFrame 双视觉面：case 48 `state=1` 动画组恒走跑动组
//    （:4073-4075）+ 帧计数复位抑制 48/56/61/55（:3613-3640——56 另有冲刺沿复位
//    :3615-3618）。
//  · 债5 tryStartHover 慢Fall 签名陈值复合边例（G12 残余窄面定谳=真债可达：
//    Game.fixedUpdate 序 player.fixedUpdate(:10541) 先于 updateUse(:11181) 召唤 →
//    上拍未骑乘∧slowFall∧干支贴地（gField=/3×gd 改写落盘）→ 同拍召唤 → 次拍
//    upkeep 读带符号陈值）——修=无符号并行快照 gravityFieldFresh（≙原版次拍
//    :24559-:24884 头部重算链值）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { seededRandom, BATTERY_SEED } from './seeded-rng';
import { MountInstance, FRAME_STANDING, FRAME_RUNNING, FRAME_IN_AIR,
  FRAME_SWIMMING, FRAME_DASHING, type MountedPlayerView } from '../src/entities/Mounts';
import { BuffType } from '../src/stats/Buffs';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

type P = import('../src/entities/Player').Player;

const playerSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Player.ts'), 'utf8');
const mountsSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Mounts.ts'), 'utf8');

/** 真实 Player 最小钩桩（bj704g12 同款） */
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

/** 液池世界（bj704g12 同款口径：groundLevel=200,num6=1 于 yT ≥ ~93.3） */
function makePoolWorld(seed: string, top: number, bottom: number, type: number, h = 180) {
  const w = new World(60, h, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, type);
  }
  return w;
}

/** 太空带干地世界（num6 钳 0.25——债5 判别力带：fresh 值 0.1 ≠ 字段初值 0.4） */
function makeSpaceWorld(seed: string, ground = 62) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, ground, 1, 0, 0);
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  return w;
}

/** 干地世界（债5/债2 夹具：地面 rows ground..ground+1,num6=1 带） */
function makeGroundWorld(seed: string, ground = 100) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, ground, 1, 0, 0);
  for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  return w;
}

async function makePlayer(yTile: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  return new Player(21 * 16, yTile * 16, new Inventory());
}

function rideMount(p: P, type: number) {
  p.mount.active = true;
  p.mount.type = type;
}

/** MountInstance 单测合成视图（bj704g12 makeView 同式） */
function makeView(over: Partial<MountedPlayerView> = {}): MountedPlayerView {
  return {
    x: 0, y: 0, w: 20, h: 42, vx: 0, vy: -1, onGround: false, inWater: false,
    facing: 1, inputX: 0, inputJump: true, inputUp: false, inputDown: false,
    prevInputJump: true, gravDir: 1, store: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A. 债1 BUFF_SWIM_FREE 误含 265 火烈鸟（表项勘正+canFloatInWater 面）
// ---------------------------------------------------------------------------
describe('BJ704-G13 A 火烈鸟 265 非 ignoreWater（:9982-9986 canFloatInWater+accFlipper）', () => {
  it('A1 结构锁：swimFree 集=131/168/279/305（265 移出）;flipper 集=五件并授 accFlipper', () => {
    expect(mountsSrc).toContain('const BUFF_SWIM_FREE = new Set([131, 168, 279, 305]);');
    expect(mountsSrc).toContain('const BUFF_FLIPPER = new Set([131, 168, 265, 279, 305]);');
    expect(mountsSrc).not.toContain('BUFF_SWIM_FREE = new Set([131, 168, 265');   // 旧表形状禁回潮
  });

  it('A2 火烈鸟水中=湿路由（liqFactor 0.5,旧 1）+TryFloatingInFluid 上浮（10 拍 vy≤−1.5;旧直沉 +2）', async () => {
    const w = makePoolWorld('bj704g13-a2', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(130);                 // 中池深水（心位 ≪ 液面）
    rideMount(p, 37);
    p.vy = 0;
    for (let i = 0; i < 10; i++) p.fixedUpdate(1 / 60, game);
    expect(p.ridingMountSwimFree).toBe(false);       // 债1 判别：火烈鸟非 swimFree
    expect(p.liqFactor).toBe(0.5);                   // :28309 num110 湿档（旧 ignoreWater=1）
    expect(p.vy).toBeLessThanOrEqual(-1.5);          // :23655 深水上浮 −0.4/t（净 −0.2/t 含湿重力）
    expect(p.hp).toBe(p.maxHp);                      // 全程无溺水伤害（面顶漂,头不没顶）
  });

  it('A3 火烈鸟液面漂（TryFloatingInFluid 钉线）:近面起步 80 拍稳定在液面带（心位 ±22px）', async () => {
    const w = makePoolWorld('bj704g13-a3', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(94);                  // 近液面（cy≈1525,面 1444）
    rideMount(p, 37);
    p.vy = 0;
    for (let i = 0; i < 80; i++) p.fixedUpdate(1 / 60, game);
    // 液面 = 池顶行底 −trunc(200/16)=91×16−12=1444（GetWaterLine :1536-38 同式）
    const waterline = 91 * 16 - 12;
    // :23651-52 心位 −6（骑 37）,稳态钉线 cy ≈ wl.line−2 附近（±22px 容差带）
    expect(Math.abs(p.cy - (waterline - 2))).toBeLessThanOrEqual(22);
    expect(p.vy).toBeGreaterThanOrEqual(-3.5);       // 钉线臂 :23666 钳 −3
    expect(p.vy).toBeLessThanOrEqual(8.5);           // 钉线正向瞬态（=line−num2,原版无正向钳同构）
    expect(p.inWater).toBe(true);                    // 稳态盒底仍浸液（非弹出干态）
  });

  it('A4 对照：海龟 131 仍 swimFree（liqFactor 1 免降速,防水档重力照走）', async () => {
    const w = makePoolWorld('bj704g13-a4', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 4);                                 // 海龟 buff 131
    p.vy = 0;
    for (let i = 0; i < 5; i++) p.fixedUpdate(1 / 60, game);
    expect(p.ridingMountSwimFree).toBe(true);
    expect(p.liqFactor).toBe(1);                     // ignoreWater 位移因子（:28309）
  });
});

// ---------------------------------------------------------------------------
// B. 债2 CCed 下坐门 TryDismount 双闸（DontDismountWhenCCed{55,56,61}+20×42 空间）
// ---------------------------------------------------------------------------
describe('BJ704-G13 B CCed 下坐双闸（:6682-6696 CanDismountWithResult）', () => {
  it('B1 冰冻骑老鼠 55：CCed 豁免拒下坐（mount.active 保持）——旧直调 dismount 必下', async () => {
    const w = makeGroundWorld('bj704g13-b1');
    const game = makeHooks(w);
    const p = await makePlayer(96);
    p.mount.setMount(55, p);                          // 变身鼠（盒 14×14,MOUNT_PLAYER_SIZE）
    expect(p.mount.active).toBe(true);
    p.buffs.apply(BuffType.Frozen, 10);
    p.fixedUpdate(1 / 60, game);
    expect(p.buffs.has(BuffType.Frozen)).toBe(true);
    expect(p.mount.active).toBe(true);                // FailedCCed（MountID.cs:29 {55,56,61}）
    expect(p.ridingMount).toBe(true);
    // 拒下坐骑者维护照跑（UpdateEffects :25855 只挂 mount.Active）——帧态机存活证据
    expect(p.mount.frameState).toBeDefined();
  });

  it('B2 冰冻骑钻头 8（开阔地）：双闸通过 → 下坐（mount.active=false）', async () => {
    const w = makeGroundWorld('bj704g13-b2');
    const game = makeHooks(w);
    const p = await makePlayer(96);
    p.mount.setMount(8, p);
    p.buffs.apply(BuffType.Frozen, 10);
    p.fixedUpdate(1 / 60, game);
    expect(p.mount.active).toBe(false);               // 20×42 同盒零探针恒可下（BJ357 判例）
    expect(p.ridingMount).toBe(false);
  });

  it('B3 单元：canDismountWithResult 三道——cced（55）/nospace（湿蝙蝠窄廊）/ok', async () => {
    const m = new MountInstance();
    const st = (() => {
      const w = makeGroundWorld('bj704g13-b3');
      return w.store;
    })();
    // 开阔地蝙蝠（盒 20×18）：可下（空间探针过）
    m.setMount(56, makeView());
    expect(m.canDismountWithResult(makeView({ cced: false }))).toBe('ok');
    // CCed 蝙蝠：FailedCCed 首闸（判据序在空间探针前）
    expect(m.canDismountWithResult(makeView({ cced: true }))).toBe('cced');
    // 窄廊（2 格高 32px,顶 row61 实心/底 row64 实心）：20×42 目标盒容不下 → nospace
    for (let x = 14; x <= 28; x++) {
      st.setTileSilent(x, 61, 1, 0, 0);
      st.setTileSilent(x, 64, 1, 0, 0);
    }
    const m2 = new MountInstance();
    m2.setMount(56, makeView({ store: st as never, x: 21 * 16, y: 62 * 16, w: 20, h: 18 }));
    expect(m2.canDismountWithResult(makeView({ store: st as never, x: 21 * 16, y: 62 * 16, w: 20, h: 18 }))).toBe('nospace');
  });

  it('B4 湿蝙蝠窄廊：拒下坐整链不发生（伴生 buff 383 不清——旧形状拒下坐仍清）', async () => {
    // 廊道：顶 61 实心/水 62-63/底 64 实心（蝙蝠盒 20×18 容于 32px,20×42 下坐盒不容）
    const w = new World(60, 180, 44, 'bj704g13-b4');
    w.groundLevel = 200;
    for (let x = 14; x <= 28; x++) {
      w.store.setTileSilent(x, 61, 1, 0, 0);
      w.store.setTileSilent(x, 64, 1, 0, 0);
    }
    for (let y = 62; y <= 63; y++) {
      for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.WATER);
    }
    const game = makeHooks(w);
    const p = await makePlayer(62);
    p.mount.setMount(56, p);
    p.buffs.apply(BuffType.BatMount, 60);             // 伴生 buff 377（Dismount :6214 清偿面）
    expect(p.mount.active).toBe(true);
    p.fixedUpdate(1 / 60, game);
    expect(p.inWater).toBe(true);
    expect(p.mount.active).toBe(true);                // :28183 TryDismount 忽略返回值=拒下坐保持骑乘
    expect(p.buffs.has(BuffType.BatMount)).toBe(true);// ★G13 连带：ClearBuff 在 Dismount 体内=拒下坐不清（旧形状误清）
  });

  it('B5 结构锁：DONT_DISMOUNT_WHEN_CCED 表+CCed 门首闸序+CCed 下坐门走 canDismount', () => {
    expect(mountsSrc).toContain('const DONT_DISMOUNT_WHEN_CCED = new Set([55, 56, 61]);');
    expect(mountsSrc).toContain("if (DONT_DISMOUNT_WHEN_CCED.has(this.type) && (p.cced ?? false)) return 'cced';");
    expect(playerSrc).toContain('if (this.mount.canDismount(this)) {');
    expect(playerSrc).not.toContain('this.mount.dismount(this, game);\n        if (prevBuff');   // 旧直调形状退役
  });
});

// ---------------------------------------------------------------------------
// C. 债3 accFlipper 面（坐骑 buff 授脚蹼）+ 湿跳门 wallCling 腿
// ---------------------------------------------------------------------------
describe('BJ704-G13 C 湿跳门补全（flag2 :20795 骑乘臂 + :20845 sliding 腿）', () => {
  it('C1 海龟骑乘者液中悬空泳跃（buff 131 授 accFlipper——旧 flipperJump 恒假不可达）', async () => {
    const w = makePoolWorld('bj704g13-c1', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 4);                                  // 海龟（buff 131→accFlipper :9974-9976）
    p.vy = 1;                                         // 悬空下沉中（vy≠0=踩底门关）
    p.inputJump = true; p.jumpEdgePrev = false;       // 跳键沿
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(0);                     // flag2∧flag3 :20845 放行 → 泳跃 vy=−lJSpd
    expect(p.jumpHold).toBeGreaterThan(0);            // jump=jumpHeight（坐骑档 12）
    expect(p.swimTime).toBe(29);                      // :20859-20862 flag4 置 30,同拍 :8067 递减 → 29
  });

  it('C2 火烈鸟骑乘者同面（buff 265 亦授 accFlipper,按↓下潜仍有脚蹼）', async () => {
    const w = makePoolWorld('bj704g13-c2', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    rideMount(p, 37);
    p.vy = 1;
    p.inputDown = true;                               // 下潜（ShouldFloatInWater 假——浮液臂不授）
    p.inputJump = true; p.jumpEdgePrev = false;
    for (let i = 0; i < 3; i++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(0);                     // BUFF_FLIPPER 无条件臂（非 :13115 浮液面门）
  });

  it('C3 湿态贴墙滑蹬墙跳（:20845 sliding 放行——旧湿门 vy===0 独腿拒绝）', async () => {
    const w = makePoolWorld('bj704g13-c3', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    p.vy = 1;
    p.wallCling = true;                               // 上拍贴墙滑位（湿支无清零段,读上拍值=干支门同承载）
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(0);                     // sliding 腿放行 → 标准跳 vy=−lJSpd
  });

  it('C4 结构锁：flipperOn 骑乘臂+湿门 wallCling 腿（★G15 后湿门带 autoJump 臂）', () => {
    expect(playerSrc).toContain('|| (this.ridingMount && this.mount.flipperMount)');
    expect(playerSrc).toContain('&& (this.vy === 0 || this.wallCling || flipperJump || justClearedWetSlime)) {');
  });
});

// ---------------------------------------------------------------------------
// D. 债4 mount 48 updateFrame 双视觉面（case 48 跑动组+复位抑制族）
// ---------------------------------------------------------------------------
describe('BJ704-G13 D updateFrame 48/56/61/55 视觉面（:3613-3640+:4073-4075）', () => {
  it('D1 暗黑魔法书 48 空中分派恒走跑动组（frame 推进 0-5 循环;旧空中组钉 0 帧）', () => {
    const m = new MountInstance();
    m.setMount(48, makeView());
    for (let i = 0; i < 20; i++) m.updateFrame(makeView({ vy: -8 }), FRAME_IN_AIR, 0, -8);
    // 跑动组速率 = Max(0.5, |v|×0.125)=1/t,rFD=8 → 20 拍 frame=2（0→1@8→2@16）
    expect(m.frame).toBe(2);
    expect(m.frameState).toBe(FRAME_IN_AIR);          // 组覆写不改帧态字段（vanilla `state=1` 局部量）
  });

  it('D2 48 地↔空切换帧计数保持（:3621-3624 入 1/2 不清;非表坐骑对照清零）', () => {
    const m48 = new MountInstance();
    m48.setMount(48, makeView());
    m48.updateFrame(makeView(), FRAME_RUNNING, 0, 0);
    m48.updateFrame(makeView(), FRAME_RUNNING, 0, 0);
    m48.updateFrame(makeView(), FRAME_RUNNING, 0, 0);   // counter 1.5（跑动组 0.5/t）
    const cBefore = (m48 as unknown as { frameCounter: number }).frameCounter;
    expect(cBefore).toBeGreaterThan(0);
    // 1→2 抑制不清（组覆写后仍走跑动组 +0.5）→ counter = cBefore+0.5（旧无条件清零=0.5）
    m48.updateFrame(makeView({ vy: -1 }), FRAME_IN_AIR, 0, -1);
    expect((m48 as unknown as { frameCounter: number }).frameCounter).toBeCloseTo(cBefore + 0.5, 5);
    // 对照：非表坐骑（兔子 1）同切换 → 清零后仅新组增量
    const m1 = new MountInstance();
    m1.setMount(1, makeView());
    m1.updateFrame(makeView({ vx: 4 }), FRAME_RUNNING, 4, 0);
    m1.updateFrame(makeView({ vx: 4 }), FRAME_RUNNING, 4, 0);
    m1.updateFrame(makeView({ vx: 4 }), FRAME_RUNNING, 4, 0);
    expect((m1 as unknown as { frameCounter: number }).frameCounter).toBe(12);                // 跑动组速率 |vx|=4
    m1.updateFrame(makeView({ vy: -1 }), FRAME_IN_AIR, 4, 0);
    expect((m1 as unknown as { frameCounter: number }).frameCounter).toBe(1);                 // 清零 + 空中组 +1
  });

  it('D3 56 冲刺沿复位（:3615-3618 dash 结束 5→2 清;★G15 强切臂后冲刺中分派 2→5 组=dashing 帧）', () => {
    const m = new MountInstance();
    m.setMount(56, makeView());
    for (let i = 0; i < 3; i++) m.updateFrame(makeView({ dash: 6, dashDelay: -1 }), FRAME_DASHING, 4, 0);
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(12);                 // 冲刺组速率 |vx|=4
    // 冲刺持续中分派 2：G15 case 56 强切臂（:3698-3706 dash>0∧delay<0 → frameState/state=5）
    //  → 组=dashing +4（旧无强切臂=抑制保 12+1 空中组——G13 期望已随 vanilla 终态翻正）
    m.updateFrame(makeView({ dash: 6, dashDelay: -1 }), FRAME_IN_AIR, 4, 0);
    expect(m.frameState).toBe(FRAME_DASHING);        // 强切臂写帧态字段
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(16);                 // 12 + dashing 组 4
    m.updateFrame(makeView({ dash: 6, dashDelay: -1 }), FRAME_DASHING, 4, 0);
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(20);                 // 5→5 无切换,继续 +4
    // 冲刺结束（dash=0）分派 2：沿复位清零 + 强切臂归一 2 → 空中组 +1
    m.updateFrame(makeView({ dash: 0, dashDelay: 20 }), FRAME_IN_AIR, 4, 0);
    expect(m.frameState).toBe(FRAME_IN_AIR);
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(1);                  // 沿复位清零后仅新组增量（旧无沿复位=4+1=5）
  });

  it('D4 55 sliding 腿（:3633 state==2∧sliding 抑制;非 sliding 清零;★G15 强切臂 sliding→跑动组）', () => {
    const m = new MountInstance();
    m.setMount(55, makeView());
    for (let i = 0; i < 3; i++) m.updateFrame(makeView(), FRAME_STANDING, 0, 0);
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(3);                  // 站立组 +1/t
    m.updateFrame(makeView({ sliding: true, vy: -1 }), FRAME_IN_AIR, 0, 0);
    expect(m.frameState).toBe(FRAME_RUNNING);        // G15 case 55 强切臂（:3680-3684 sliding → 1）
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(3);                  // 入 2∧sliding 抑制保 3 + 跑动组 rate=|vx|=0（旧无强切臂=空中组 +1）
    for (let i = 0; i < 3; i++) m.updateFrame(makeView(), FRAME_STANDING, 0, 0);
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(3);                  // 1→0 清零后重新累计
    m.updateFrame(makeView({ sliding: false, vy: -1 }), FRAME_IN_AIR, 0, 0);
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(1);                  // 无 sliding → 清零（+空中组 1）
  });

  it('D5 61 入 1/4/2 抑制、入 3 清零（:3629-3632;★G15 强切臂 4→2 归一）', () => {
    const m = new MountInstance();
    m.setMount(61, makeView());
    for (let i = 0; i < 3; i++) m.updateFrame(makeView(), FRAME_STANDING, 0, 0);
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(3);
    m.updateFrame(makeView({ vy: -1 }), FRAME_SWIMMING, 0, -1);
    expect(m.frameState).toBe(FRAME_IN_AIR);         // G15 case 61 强切臂（:3669-3678 分派 4 → 2）
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(4);                  // 入 4 抑制保 3 + 空中组 +1（旧无强切臂=游泳组 trunc(1/2)=0 → 3）
    for (let i = 0; i < 3; i++) m.updateFrame(makeView(), FRAME_STANDING, 0, 0);
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(3);
    m.updateFrame(makeView({ vy: -1 }), 3, 0, -1);   // FRAME_FLYING：61 抑制表不含 3
    expect((m as unknown as { frameCounter: number }).frameCounter).toBe(1);                  // 清零 + 飞行组 +1
  });

  it('D6 结构锁：case 48 组覆写+复位抑制块', () => {
    expect(mountsSrc).toContain('case 48:');
    expect(mountsSrc).toContain('state = FRAME_RUNNING;');
    expect(mountsSrc).toContain('let resetCounter = true;');
    expect(mountsSrc).toContain("if (this.type === 55 && (state === FRAME_RUNNING || state === FRAME_DASHING || state === FRAME_SWIMMING");
    expect(mountsSrc).toContain('const dashing56 = (p.dash ?? 0) > 0 && (p.dashDelay ?? 0) < 0;');
  });
});

// ---------------------------------------------------------------------------
// E. 债5 tryStartHover 无符号重力通道（慢Fall 签名陈值复合边例）
// ---------------------------------------------------------------------------
describe('BJ704-G13 E tryStartHover 慢Fall 陈值（gravityFieldFresh 并行快照）', () => {
  it('E1 复合边例端到端（太空带 num6=0.25）：slowFall 贴地拍（gField=0.1/3 改写）→召唤 UFO→起飞冲量读无符号 0.1', async () => {
    const w = makeSpaceWorld('bj704g13-e1', 62);      // num6 钳 0.25 带（≠字段初值 0.4=判别力）
    const game = makeHooks(w);
    const p = await makePlayer(58);
    p.buffs.apply(BuffType.Featherfall, 600);         // slowFall（干支尾部 /3 签名改写门）
    // 落地收敛（slowFall 0.033/t 缓降;落地拍 vy=0=触发门前提——先跑再判,初始 vy=0 非落地）
    let landed = false;
    for (let i = 0; i < 90; i++) {
      p.fixedUpdate(1 / 60, game);
      if (p.onGround && p.vy === 0) { landed = true; break; }
    }
    expect(landed).toBe(true);
    expect(p.vy).toBe(0);
    expect(p.onGround).toBe(true);
    expect(p.gField).toBeCloseTo(0.1 / 3, 5);         // 带符号陈值在盘（债面存在性证明）
    expect(p.gFieldUnsigned).toBeCloseTo(0.1, 5);     // 并行快照不掺改写（0.4×0.25）
    // 同拍召唤（Game.fixedUpdate 序=物理后 updateUse;测试直调等价）
    p.mount.setMount(7, p);                           // UFO（usesHover,canHover 无帧态门=新召唤即真）
    p.inputUp = true; p.jumpEdgePrev = false; p.upEdgePrev = false;   // ↑沿（★G15 起读 upEdgePrev 通道）
    p.mount.upkeep(p);                                // tryStartHover（upkeep 物理相前）
    expect(p.vy).toBeCloseTo(-(0.16 + 0.1 + 0.001), 5);   // −(accel+fresh+0.001)（旧读 /3 值=−0.194）
  });

  it('E2 对照（太空带）：非 slowFall 贴地拍 gField=gFieldUnsigned（无改写,两通道同值 0.1）', async () => {
    const w = makeSpaceWorld('bj704g13-e2', 62);
    const game = makeHooks(w);
    const p = await makePlayer(58);
    for (let i = 0; i < 90; i++) {
      p.fixedUpdate(1 / 60, game);
      if (p.onGround && p.vy === 0) break;
    }
    expect(p.gField).toBeCloseTo(0.1, 5);
    expect(p.gFieldUnsigned).toBeCloseTo(0.1, 5);
  });

  it('E4 湿拍通道锁：池底湿态拍 fresh 通道=湿档 0.2（湿支写位在盘—— defends 撤写位变异）', async () => {
    const w = makePoolWorld('bj704g13-e4', 90, 137, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(130);
    let grounded = false;
    for (let i = 0; i < 90; i++) {
      p.fixedUpdate(1 / 60, game);
      if (p.onGround && p.vy === 0) { grounded = true; break; }
    }
    expect(grounded).toBe(true);                      // 池底贴地（湿档重力 0.2/t 缓沉到位）
    expect(p.gField).toBeCloseTo(0.2, 5);             // 湿档×num6（水 0.2,无慢Fall 改写）
    expect(p.gFieldUnsigned).toBeCloseTo(0.2, 5);     // ★湿支写位：fresh 通道跟湿档（撤写位=陈干值 0.4）
    p.mount.setMount(7, p);                           // 水中召唤 UFO（蜜蜂 5 才拒,7 可上）
    p.inputUp = true; p.jumpEdgePrev = false; p.upEdgePrev = false;   // ↑沿（★G15 通道）
    p.mount.upkeep(p);
    expect(p.vy).toBeCloseTo(-(0.16 + 0.2 + 0.001), 5);   // 湿档 fresh 冲量（撤湿写位=−0.561 陈干值）
  });

  it('E3 结构锁：两终值写位并行快照+tryStartHover fresh 读链', () => {
    expect(playerSrc).toContain('this.gFieldUnsigned = lGrav;');
    expect(playerSrc).toContain('this.gFieldUnsigned = GRAVITY * num6;');
    expect(mountsSrc).toContain('p.gravityFieldFresh ?? p.gravityField ?? DEFAULT_GRAVITY');
  });
});

// ---------------------------------------------------------------------------
// F. 新登记债负锁（★G15 已清偿债1 → 负锁退役翻正;判语见记忆档）
// ---------------------------------------------------------------------------
describe('BJ704-G13 F 登记债负锁（判语锚,防误翻案）', () => {
  it('F1 墙跳 vx 反踢（:20950-20953）——G15（bj704g15-mount-debts4）已清偿,负锁翻正', () => {
    expect(playerSrc).toContain('this.vx = 3 * -this.slideDir');   // 干湿两支（G15 债①）
  });
});
