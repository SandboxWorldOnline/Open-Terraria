// ★BJ704-G16（2026-10-21）坐骑域六件+弹幕邻接一件清算第五刀（G15 新登记债①②③④⑥
// + g14-714 白化基面评估）。锚全在 1457 反编译亲读：
// · 债① CCed 物理面（Player.cs:26999-27014 `if (CCed) { TryDismount; vy+=gravity;
//   钳 maxFallSpeed; sandStorm=false; CancelAllJumpVisualEffects; } else {整链}`——
//   坐骑 Hover/Flight 链/翼·火箭·毯链/重力链整段在 else 内）。55/56/61 拒下坐骑者
//   （DONT_DISMOUNT_WHEN_CCED）CCed 中 vanilla 平重力下坠,仓旧 hover() 照跑=-0.001
//   静悬浮。修=干湿坐骑链门+干支空中支门+干重力 CCed 平值覆写+终端/窗让位。
// · 债② Mount.cs:3710-3712 case 52 狼 `if (state==4) state=2` 局部态改写（纯组覆写
//   不写 _frameState）——液体中狼显空中组推进节律（swim/inAir 组同段 12/3/12,唯一
//   行为面=推进速率:游泳 trunc((|vx|+|vy|)/2) 慢速冻结 vs 空中恒 1/tick）。
// · 债③ 干支首跳/瓶跳（含下砸腿）互斥——vanilla :20845-21196 单 if-else-if 链,
//   首支 (sliding||vy==0) 过门时执行恒落普通跳支（:20939-20953）,flag13/瓶族不可达
//   （且 :20931 RefreshDoubleJumps 同拍退款=瓶不实耗）。仓干支首跳门拆独立 if →
//   瓶族/下砸缺 !jumpStartedThisTick 互斥:挂壁+瓶按跳=双发（瓶 charge 实耗+jumpHold
//   落瓶档）;挂壁+↓+重锤符文按跳=下砸后写胜出（vy=16 直坠）vs vanilla 蹬墙跳。
// · 债④ CCed 平重力无 slowFall 档（:27005-27010 平值+单正钳;仓旧 /3 重力+/3 终端）。
// · 债⑥ sandStorm 位承载（:26773-26777 run ×1.5/×2 + :19965 转向门）——窗口=沙暴瓶
//   跳上升段（DoubleJumpVisuals :22099 置位门:isPerformingJump_Sandstorm ∧ 上升中）
//   ∧无翼无坐骑（:26971 清位）。
// · [g14-714-getalpha-whitening] 评估=判语备案（满 stealth 档 G14 落地已逐位近同,
//   白化基面暗光面归 BJ529/BJ668 光照无关弹面族渲染批）——见 memory 判语。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { seededRandom, BATTERY_SEED } from './seeded-rng';
import { MountInstance, FRAME_IN_AIR, FRAME_SWIMMING, type MountedPlayerView } from '../src/entities/Mounts';
import { BuffType } from '../src/stats/Buffs';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

type P = import('../src/entities/Player').Player;

const playerSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Player.ts'), 'utf8');
const mountsSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Mounts.ts'), 'utf8');

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

/** 真实 Player 最小钩桩（bj704g15 同款） */
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

/** 干地世界（地面 ground 行,num6=1 带:ground≥120 且 y≥80 行） */
function makeGroundWorld(seed: string, ground = 150) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, ground, 1, 0, 0);
    w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  }
  return w;
}

/** 立柱世界（墙 col40 rows100-149——钉鞋挂壁域,g15 makeWallWorld 同款） */
function makeWallWorld(seed: string) {
  const w = makeGroundWorld(seed);
  for (let y = 100; y <= 149; y++) w.store.setTileSilent(40, y, 1, 0, 0);
  return w;
}

/** 液池世界（水 rows90-136 cols14-28,池底 137;高 220 保 wetCollision 扫描界） */
function makePoolWorld(seed: string, top = 90, bottom = 137) {
  const w = new World(60, 220, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.WATER);
  }
  return w;
}

async function makePlayer(xPx: number, yPx: number, accVid?: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  const inv = new Inventory();
  if (accVid !== undefined) inv.armor[3] = { id: iid(accVid), stack: 1 };
  return new Player(xPx, yPx, inv);
}

/** MountInstance 单测合成视图（g15 makeView 同式） */
function makeView(over: Partial<MountedPlayerView> = {}): MountedPlayerView {
  return {
    x: 0, y: 0, w: 20, h: 42, vx: 0, vy: -1, onGround: false, inWater: false,
    facing: 1, inputX: 0, inputJump: true, inputUp: false, inputDown: false,
    prevInputJump: true, gravDir: 1, store: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A. 债① CCed 物理面:56/61 拒下坐骑者悬停让位（:26999-27014）
// ---------------------------------------------------------------------------
describe('BJ704-G16 A CCed 坐骑悬停让位（:27004-27010）', () => {
  it('A1 干支:蝙蝠 56 空中悬停稳定后冻结——平重力下坠（旧=hover 静悬浮 -0.001）且拒下坐保持骑乘', async () => {
    const w = makeGroundWorld('bj704g16-a1');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 120 * 16);
    p.mount.setMount(56, p);                                    // 蝙蝠（usesHover,拒下坐族）
    let hovered = false;
    for (let t = 0; t < 150; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.mount.frameState === FRAME_IN_AIR && Math.abs(p.vy) < 0.01) { hovered = true; break; }
    }
    expect(hovered).toBe(true);                                 // 悬停收敛（-0.001 静置带）
    p.buffs.apply(BuffType.Frozen, 10);                         // CCed（56∈DONT_DISMOUNT_WHEN_CCED）
    for (let t = 0; t < 8; t++) p.fixedUpdate(1 / 60, game);
    expect(p.ridingMount).toBe(true);                           // 拒下坐（G13 落地面,前提锁）
    expect(p.mount.active).toBe(true);
    // ★锐判别:门在=纯重力 0.4×num6(=1)×8=3.2;门撤(hover 照跑)=悬停钳 -0.2/t
    //   对冲净 +0.2/t ≈1.8——3.0 阈值两侧分明（0.5 阈值两种都过=不判别）
    expect(p.vy).toBeGreaterThanOrEqual(3.0);                   // ★平重力下坠（旧恒 ≈ -0.001 静悬浮）
    expect(p.vy).toBeLessThanOrEqual(3.4);                      // 8 拍 0.4×8=3.2 带宽
  }, 30000);

  it('A2 对照:同夹具不冻结——悬停照常（互斥门不误伤非 CCed 面）', async () => {
    const w = makeGroundWorld('bj704g16-a2');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 120 * 16);
    p.mount.setMount(56, p);
    let hovered = false;
    for (let t = 0; t < 150; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.mount.frameState === FRAME_IN_AIR && Math.abs(p.vy) < 0.01) { hovered = true; break; }
    }
    expect(hovered).toBe(true);
    for (let t = 0; t < 8; t++) p.fixedUpdate(1 / 60, game);
    expect(Math.abs(p.vy)).toBeLessThan(0.05);                  // 悬停静置带保持
  }, 30000);

  it('A3 湿支:仙灵 61 水中悬停冻结——湿档平重力下坠（旧湿链 hover 照跑）', async () => {
    const w = makePoolWorld('bj704g16-a3');
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 110 * 16);
    p.mount.setMount(61, p);                                    // 仙灵（usesHover 含游泳帧态,湿面存活族）
    let hovered = false;
    for (let t = 0; t < 200; t++) {
      p.fixedUpdate(1 / 60, game);
      // 61 强切臂（G15 件⑤）:湿分派 4 → frameState/state=2,悬停门 2/3/4 全域
      if (p.inWater && p.mount.frameState === FRAME_IN_AIR && Math.abs(p.vy) < 0.05) { hovered = true; break; }
    }
    expect(hovered).toBe(true);                                 // 水中悬停收敛
    p.buffs.apply(BuffType.Frozen, 10);
    for (let t = 0; t < 10; t++) p.fixedUpdate(1 / 60, game);
    expect(p.ridingMount).toBe(true);
    expect(p.vy).toBeGreaterThan(0.3);                          // ★湿档 lGrav 0.2×num6 下坠（旧 ≈ -0.001）
  }, 30000);

  it('A4 干支:火箭靴推力脉冲期冻结——推力停+平重力照施（旧=冻结中续推 -0.1/t 上浮）', async () => {
    const w = makeGroundWorld('bj704g16-a4');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 120 * 16);
    for (let t = 0; t < 2; t++) p.fixedUpdate(1 / 60, game);    // 空中（vy>0 下落中）
    expect(p.onGround).toBe(false);
    p.vy = 0; p.rocketDelay = 10;                               // 推力脉冲窗中段（直置字段=点火已发面）
    p.buffs.apply(BuffType.Frozen, 10);
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeGreaterThan(0.2);                          // ★重力 0.4×num6≈0.4（旧:推力 -0.1+grav=0 → -0.1）
    expect(p.rocketDelay).toBe(10);                             // 计数冻结（原版递减在 else 内）
  }, 30000);

  it('A5 湿支:水中推力脉冲期冻结——湿推力停+湿重力照施（旧湿链同病）', async () => {
    const w = makePoolWorld('bj704g16-a5');
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 110 * 16);
    for (let t = 0; t < 5; t++) p.fixedUpdate(1 / 60, game);
    expect(p.inWater).toBe(true);
    // vy=0.5（非 0:湿支 vy==0 回满块会清 rocketDelay=0 → 推力窗夹具死亡）
    p.vy = 0.5; p.rocketDelay = 10;
    p.buffs.apply(BuffType.Frozen, 10);
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeGreaterThan(0.6);                          // ★湿重力 +0.2 → 0.7（门撤=vy 原值 0.5 不动）
    expect(p.rocketDelay).toBe(10);                             // ★计数冻结（推力门撤 → 递减 9）
  }, 30000);

  it('A4b 对照:不冻结——推力照跑（vy 负向）', async () => {
    const w = makeGroundWorld('bj704g16-a4b');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 120 * 16);
    for (let t = 0; t < 2; t++) p.fixedUpdate(1 / 60, game);
    p.vy = 0; p.rocketDelay = 10;
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(0);                               // 推力 -0.1（grav=0 挂起）
    expect(p.rocketDelay).toBe(9);                              // 递减照跑
  }, 30000);
});

// ---------------------------------------------------------------------------
// B. 债④ CCed 平重力（slowFall 边例:无 /3 档无 /3 终端）
// ---------------------------------------------------------------------------
describe('BJ704-G16 B CCed 平重力 vs slowFall（:27005-27010）', () => {
  it('B1 羽落+冻结同持:全重力坠落（40 拍 vy>5;旧 slowFall /3 档钳 ~3.34）', async () => {
    const w = makeGroundWorld('bj704g16-b1');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 80 * 16);               // num6≈0.6 带
    p.buffs.apply(BuffType.Featherfall, 30);
    p.buffs.apply(BuffType.Frozen, 30);
    for (let t = 0; t < 40; t++) p.fixedUpdate(1 / 60, game);
    expect(p.onGround).toBe(false);                             // 未落地（~192px < 1120px）
    expect(p.vy).toBeGreaterThan(5);                            // ★0.24×40≈9.6（旧:0.08×40≈3.2 钳 3.34）
  }, 30000);

  it('B2 对照:仅羽落不冻结——/3 缓坠钳保持（~3.34）', async () => {
    const w = makeGroundWorld('bj704g16-b2');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 80 * 16);
    p.buffs.apply(BuffType.Featherfall, 30);
    for (let t = 0; t < 40; t++) p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeGreaterThan(2.5);                          // 缓坠中
    expect(p.vy).toBeLessThan(4);                               // /3 终端带（10.01/3≈3.34）
  }, 30000);
});

// ---------------------------------------------------------------------------
// C. 债③ 干支首跳/瓶跳/下砸互斥（:20845-21196 单链）
// ---------------------------------------------------------------------------
describe('BJ704-G16 C 首跳互斥（!jumpStartedThisTick）', () => {
  it('C1 挂壁+云瓶按跳:单蹬墙跳,瓶不实耗（旧=同拍双发:瓶 charge 尽+jumpHold 落 ×0.75 档）', async () => {
    const w = makeWallWorld('bj704g16-c1');
    const game = makeHooks(w);
    const p = await makePlayer(40 * 16 - 20, 145 * 16, 976);    // 钉鞋 2（tier2 驻停）;墙脚落地
    p.inv.armor[4] = { id: iid(53), stack: 1 };                 // 云朵瓶 → jumpOpts ['Cloud']
    for (let t = 0; t < 40; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
    p.fixedUpdate(1 / 60, game);                                // 稳定拍（跳跃段读上拍 onGround,刷新滞后 1 拍）
    expect(p.onGround).toBe(true);
    expect(p.extraJumps.length).toBe(1);                        // 落地刷新:瓶 charge 在身
    p.inputJump = true; p.jumpEdgePrev = false;                 // 首跳（沿墙直上,非瓶跳）
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBeNull();                        // 首跳=普通跳
    p.inputJump = false; p.inputX = 1;                          // 松跳;按向墙
    let clung = false;
    for (let t = 0; t < 60; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.wallCling) { clung = true; break; }                 // 顶点后下坠段 tier2 挂壁
    }
    expect(clung).toBe(true);
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game);    // 驻停稳定
    p.inputJump = true; p.jumpEdgePrev = false;                 // 跳键沿（挂壁中）
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(-3);                              // 蹬墙跳（-jumpSpeed）
    expect(p.vx).toBe(-3);                                      // G15 反踢保持
    expect(p.extraJumps.length).toBe(1);                        // ★瓶不实耗（旧=0,:20931 同拍退款语义）
    expect(p.performingJump).toBeNull();                        // ★未落瓶支（旧='Cloud'）
    expect(p.jumpHold).toBeGreaterThan(5);                      // 普通 jumpHeight 档（旧=×0.75 瓶档更短）
  }, 30000);

  it('C2 挂壁+↓+重锤符文按跳:蹬墙跳优先（vanilla 首支 sliding 落普通跳）;旧=下砸后写胜出 vy=16', async () => {
    const w = makeWallWorld('bj704g16-c2');
    const game = makeHooks(w);
    const p = await makePlayer(40 * 16 - 20, 145 * 16, 976);
    p.inv.armor[4] = { id: iid(5465), stack: 1 };               // 重锤符文（hasDeadCellsDownDash）
    for (let t = 0; t < 40; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
    expect(p.onGround).toBe(true);
    expect(p.equipStats.hasDeadCellsDownDash).toBe(true);       // 符文在身（前提锁）
    p.inputJump = true; p.jumpEdgePrev = false;                 // 首跳
    p.fixedUpdate(1 / 60, game);
    p.inputJump = false; p.inputX = 1;
    let clung = false;
    for (let t = 0; t < 60; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.wallCling) { clung = true; break; }
    }
    expect(clung).toBe(true);
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game);
    p.inputDown = true;                                         // 按住 ↓（下砸触发条件齐）
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(-3);                              // ★蹬墙跳（旧=下砸 16 直坠）
    expect(p.vx).toBe(-3);                                      // 反踢
    expect(p.isDownDashing).toBe(false);                        // ★下砸未触发（旧=true）
  }, 30000);

  it('C3 对照:空中（无挂壁）+云瓶跳沿——瓶跳照发（互斥不误伤）', async () => {
    const w = makeGroundWorld('bj704g16-c3');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 145 * 16);
    p.inv.armor[4] = { id: iid(53), stack: 1 };
    for (let t = 0; t < 40; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
    p.fixedUpdate(1 / 60, game);                                // 稳定拍
    expect(p.onGround).toBe(true);
    expect(p.extraJumps.length).toBe(1);
    p.inputJump = true; p.jumpEdgePrev = false;                 // 首跳
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(-3);
    p.inputJump = false;
    for (let t = 0; t < 30; t++) { p.fixedUpdate(1 / 60, game); if (p.jumpHold === 0) break; }
    p.inputJump = true; p.jumpEdgePrev = false;                 // 空中再按（沿）
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBe('Cloud');                     // 瓶支照发
    expect(p.extraJumps.length).toBe(0);                        // charge 实耗
  }, 30000);
});

// ---------------------------------------------------------------------------
// D. 债② case 52 狼局部态改写（Mount.cs:3710-3712）
// ---------------------------------------------------------------------------
describe('BJ704-G16 D 狼 52 游泳分派→空中组（:3710-3712）', () => {
  it('D1 液体分派态 4 慢速:空中组恒 1/tick 推进（旧游泳组 trunc(0)=0 冻结）;frameState 留 4', () => {
    const m = new MountInstance();
    m.setMount(52, makeView());
    for (let i = 0; i < 13; i++) m.updateFrame(makeView({ vx: 0, vy: 0 }), FRAME_SWIMMING, 0, 0);
    expect(m.frameState).toBe(FRAME_SWIMMING);                  // ★局部量改写不落 frameState（原版字面）
    expect(m.frame).toBe(13);                                   // 12（inAirFrameStart 钳入）+1@第 13 拍（旧:恒 12）
  }, 30000);

  it('D2 干支分派态 2 不受扰（case 52 仅 4→2 改写）', () => {
    const m = new MountInstance();
    m.setMount(52, makeView());
    for (let i = 0; i < 13; i++) m.updateFrame(makeView({ vy: -1 }), FRAME_IN_AIR, 0, -1);
    expect(m.frameState).toBe(FRAME_IN_AIR);
    expect(m.frame).toBe(13);                                   // 空中组原路径（同速率）
  }, 30000);
});

// ---------------------------------------------------------------------------
// E. 债⑥ sandStorm run 加速 + 转向门（:26773-26777 / :19965）
// ---------------------------------------------------------------------------
describe('BJ704-G16 E sandStorm 位（run ×1.5/×2 + 转向门）', () => {
  it('E1 沙暴瓶跳上升段:横移上限翻倍（maxVx>4;旧帽 ~3.04）', async () => {
    const w = makeGroundWorld('bj704g16-e1');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 140 * 16);
    p.inv.armor[4] = { id: iid(857), stack: 1 };                // 沙暴瓶 → jumpOpts ['Sandstorm']
    for (let t = 0; t < 40; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
    expect(p.onGround).toBe(true);
    p.inputJump = true; p.jumpEdgePrev = false;                 // 首跳
    p.fixedUpdate(1 / 60, game);
    p.inputJump = false;
    for (let t = 0; t < 40; t++) { p.fixedUpdate(1 / 60, game); if (p.jumpHold === 0) break; }
    p.inputJump = true; p.jumpEdgePrev = false;                 // 空中瓶跳沿（沙暴）
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBe('Sandstorm');                 // 沙暴跳成立（前提锁）
    expect(p.extraJumps.length).toBe(0);
    p.inputX = 1;                                               // 上升段全程持 →（加速窗口）
    let maxVx = 0, sawSandstorm = false;
    for (let t = 0; t < 200; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.performingJump === 'Sandstorm' && p.vy < 0) sawSandstorm = true;
      maxVx = Math.max(maxVx, p.vx);
      if (p.vy >= 0 || p.onGround) break;                       // 顶点/落地收窗
    }
    expect(sawSandstorm).toBe(true);
    expect(maxVx).toBeGreaterThan(4);                           // ★×2 帽 6（旧:恒 ~3.04）
    expect(maxVx).toBeLessThan(7);                              // 帽上界（×2+过冲 ~6.1）
  }, 30000);

  it('E2 对照:云瓶跳（非沙暴）上升段——常规帽 ~3.04 保持', async () => {
    const w = makeGroundWorld('bj704g16-e2');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 140 * 16);
    p.inv.armor[4] = { id: iid(53), stack: 1 };                 // 云瓶
    for (let t = 0; t < 40; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
    expect(p.onGround).toBe(true);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    p.inputJump = false;
    for (let t = 0; t < 40; t++) { p.fixedUpdate(1 / 60, game); if (p.jumpHold === 0) break; }
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBe('Cloud');
    p.inputX = 1;
    let maxVx = 0;
    for (let t = 0; t < 200; t++) {
      p.fixedUpdate(1 / 60, game);
      maxVx = Math.max(maxVx, p.vx);
      if (p.vy >= 0 || p.onGround) break;
    }
    expect(maxVx).toBeLessThan(3.2);                            // 常规帽（+过冲 ~3.04）
  }, 30000);

  it('E3 沙暴跳上升段转向门:按反向键朝向锁定（:19965 !sandStorm）;顶点后解锁', async () => {
    const w = makeGroundWorld('bj704g16-e3');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 140 * 16);
    p.inv.armor[4] = { id: iid(857), stack: 1 };
    for (let t = 0; t < 40; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    p.inputJump = false;
    for (let t = 0; t < 40; t++) { p.fixedUpdate(1 / 60, game); if (p.jumpHold === 0) break; }
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBe('Sandstorm');
    expect(p.facing).toBe(1);
    p.inputX = -1;                                              // 上升段按反向（facing 锁 1）
    // ★BJ704-G19 期望迁移：沙暴跳 4tick 自翻已建模（PlayerFrame :36577-36581）——
    //   窗内 facing 由自翻振荡（vanilla 相）;为保转向门判别纯净,挥舞窗压满压制自翻
    //   （itemAnimTicks>0 → 自翻门关,见 g19 B3 的门行为测）+itemUseTurn 直置
    //   （:6738 门 useTurn 豁免臂——animBusy 下转向放行,字段为静态缺省无逐拍重算）
    p.itemUseTurn = true;
    for (let t = 0; t < 12; t++) { p.itemAnimTicks = 9; p.fixedUpdate(1 / 60, game); }
    expect(p.vy).toBeLessThan(0);                               // 仍在上升段
    expect(p.facing).toBe(1);                                   // ★转向门（旧:翻 -1;自翻已压制）
    for (let t = 0; t < 200; t++) {                             // 过顶点（自翻照压——
      p.itemAnimTicks = 9;                                      //   窗内余拍 facing 保持判别纯净）
      p.fixedUpdate(1 / 60, game);
      if (p.vy >= 0) break;
    }
    p.itemAnimTicks = 9;
    p.fixedUpdate(1 / 60, game);
    expect(p.facing).toBe(-1);                                  // 窗外解锁（jumpHold==0 → 门开,vy<0 段即可翻;★G19 窗口勘正后解锁点=窗口末非顶点）
  }, 30000);
});

// ---------------------------------------------------------------------------
// F. 结构锁（判别锁的源面锚定——变异恰红见 /tmp/bj704g16-mutations.mjs）
// ---------------------------------------------------------------------------
describe('BJ704-G16 F 结构锁', () => {
  it('F1 债③ 互斥:瓶族门+下砸门均带 !jumpStartedThisTick', () => {
    expect(playerSrc).toContain('!mountJumpFired && !downDashFired && !jumpStartedThisTick');
    expect(playerSrc).toContain('!mountJumpFired && !jumpStartedThisTick && vyAtJumpGate !== 0');
  });
  it('F2 债① 坐骑链门（干+湿）', () => {
    expect(playerSrc.match(/if \(mnt2 && !this\.cced\) \{/g)?.length).toBe(2);
  });
  it('F3 债① 干支空中支门+CCed 平重力覆写+cartRamp 窗+终端钳门', () => {
    expect(playerSrc).toContain('} else if (!this.cced) {');
    expect(playerSrc).toContain('if (this.cced) grav = GRAVITY;');
    expect(playerSrc).toContain('!this.cced && grav !== 0 && this.cartRampTime > 0');
    expect(playerSrc.match(/!this\.cced && !\(this\.ridingMount && this\.mount\.type === 5\)/g)?.length).toBe(2);
  });
  it('F4 债① 湿支:推力门+重力放行', () => {
    expect(playerSrc).toContain('if (this.rocketDelay > 0 && !this.cced) {');
    expect(playerSrc).toContain('(this.rocketDelay === 0 || this.cced)');
  });
  it('F5 债② case 52 组覆写（不写 frameState）', () => {
    expect(mountsSrc).toContain('case 52:');
    expect(mountsSrc).toContain('if (state === FRAME_SWIMMING) state = FRAME_IN_AIR;');
  });
  it('F6 债⑥ sandStorm 承载:加速线+两转向门', () => {
    expect(playerSrc).toContain('if (sandStormActive) { runAcc *= 1.5; maxRun *= 2; }');
    expect(playerSrc.match(/&& !sandStormActive\) this\.facing = ix/g)?.length).toBe(2);
  });
});
