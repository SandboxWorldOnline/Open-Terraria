// ★BJ717-A（2026-10-25）R13 清偿·玩家运动域九件判别锁（F1-F10,F5 销案）。
//
// 【oracle 双证（F1 硬门槛）】vanilla-headless harness（game/tools/voracle/SimHarness.cs,
//   真 TerrariaServer.exe 1.4.5.8 dedServ 路径无头驱动,netMode=2 槽 0 假玩家+脚本控制,
//   逐拍 TSV 金标 tests/golden/bj717a-vanilla-movement-oracle.tsv）:
//   · S1 全持跳:起跳拍 vy=-4.61、平台拍 vy=-4.61 恒 16 拍（钉:20831→重力:27556→积分
//     :28385 序）,apex=98.07px=6.13 格——SW 修前 108.7px（钉在重力后,平台拍恒 -5.01）。
//   · S3 Blizzard 瓶:fire 拍 jump=22（(int) 截断）原值,sustain 次拍起 22→0。
//   · S4 变态刀:stealth 静止 0.02/t→0(≈50t),满潜行 maxRun 3→1.5/accRun=1.5,run 收敛 ~1.5;
//     stealth=0 时移动【不回升】（:25957 `if (stealth > 0)` 门——vanilla quirk,仓同构）。
//   · S5 弹跳棒 43:空中 runSlow=0.2 摩擦照常（:26718-21 零摩擦臂被 :26828 !CanUseWings
//     →runSlowdown=0.2 平值复位覆写=两版死码）→R13-F5 销案。
//   · S6 飞毯:激活次拍起 maxRun=4.5/runAcc=0.1,vx 收敛 4.58。
//   · S7/S7b 火箭靴:下砸中重按拒点火（rocketTime 恒 7/delay 恒 0）,无下砸对照 7→6/delay=9。
//   · S8c merman+骑 49 液中持跳:swimTime 10→29 周期刷新（钉副作用无条件）,vy 由坐骑
//     悬停接管 -5.9 恒速（坐骑链后置覆写钉值=两写并存）。
// 【仓侧探针复核】/tmp/bj717a-postfix（run-diag）：修后 S1 逐拍 vy/jumpHold 与 oracle
//   逐位一致,apex=98.07px 逐位吻合。
// 域回归:g23(13)/g25(13)/g26(7)/bj705b(15+§1 2400 扫描)/g19/g4/g5/g12-g16/g20/g22/
//   mounts/bj524/bj527/bj533/bj540/redblue-r5/basilisk×2/mv1/bj559 全绿（高度表 −2→−1
//   与 g4 C2 94→95 飞拍随刀迁移=F6/F1 相位语义）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_BY_KEY } from '../src/data/items';
import { seededRandom, BATTERY_SEED } from './seeded-rng';

beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const playerSrc = readFileSync(path.join(ROOT, 'src/entities/Player.ts'), 'utf8');
const oracleTsv = readFileSync(path.join(ROOT, 'tests/golden/bj717a-vanilla-movement-oracle.tsv'), 'utf8');

type P = import('../src/entities/Player').Player;

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid)!;
  const id = ITEM_BY_KEY[k];
  if (id === undefined) throw new Error(`vid ${vid} 未注册`);
  return id;
};

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

/** 500×240 平地世界（bj705b 夹具判例:底界脚钳不罩 row150 地面;500 宽漂移有余） */
function makeGroundWorld(seed: string, ground = 150): World {
  const w = new World(500, 240, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, ground, 1, 0, 0);
    w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  }
  return w;
}

/** 深水池世界（g4 makePoolWorld 同款） */
function makePoolWorld(seed: string, top: number, bottom: number) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, 0);
  }
  return w;
}

async function mkPlayer(xPx: number, yPx: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  return new Player(xPx, yPx, new Inventory());
}

const T = 1 / 60;
const tick = (p: P, w: World) => p.fixedUpdate(T, makeHooks(w));

async function settleGround(p: P, w: World, n = 120) {
  for (let t = 0; t < n; t++) { tick(p, w); if (p.onGround) break; }
  for (let t = 0; t < 10; t++) tick(p, w);
}

// ---------------------------------------------------------------------------
// F1【P0】持跳平台段钉/重力序：钉（JumpMovement :26945）→重力（:27556）→积分
// ---------------------------------------------------------------------------
describe('BJ717-A F1 持跳平台段钉位=重力前（oracle S1:平台拍 vy=-js+grav=-4.61 恒）', () => {
  it('全持跳逐拍 vy：起跳拍与平台拍均 -4.61（旧=平台拍 -5.01 钉胜重力）,计数器 fire 拍原值', async () => {
    const w = makeGroundWorld('bj717a-f1a');
    const p = await mkPlayer(30 * 16, 140 * 16);
    await settleGround(p, w);
    const y0 = p.y;
    p.inputJump = true; p.jumpEdgePrev = false;
    tick(p, w);
    expect(p.vy).toBeCloseTo(-4.61, 5);        // fire 拍（-5.01+0.4）
    expect(p.jumpHold).toBe(15);               // fire 拍 sustain 不跑（F6 同拍互斥）
    for (let t = 1; t <= 15; t++) {
      tick(p, w);
      expect(p.vy).toBeCloseTo(-4.61, 5);   // 钉→重力→积分（oracle 逐位,逐拍断言）
      expect(p.jumpHold).toBe(15 - t);
    }
    tick(p, w);
    expect(p.vy).toBeCloseTo(-4.21, 5);        // 钉尽拍起 ballistic
    let apex = y0;
    for (let t = 0; t < 200; t++) { tick(p, w); if (p.y < apex) apex = p.y; if (p.onGround && t > 20) break; }
    p.inputJump = false;
    expect(y0 - apex).toBeCloseTo(98.07, 1);   // oracle S1 apex=98.07px=6.13 格（旧 108.7）
  });

  it('tap 跳：fire 拍 -4.61 后即 ballistic（松键即清=平台段止）', async () => {
    const w = makeGroundWorld('bj717a-f1b');
    const p = await mkPlayer(30 * 16, 140 * 16);
    await settleGround(p, w);
    p.inputJump = true; p.jumpEdgePrev = false;
    tick(p, w);
    expect(p.vy).toBeCloseTo(-4.61, 5);
    p.inputJump = false;
    tick(p, w);
    expect(p.jumpHold).toBe(0);                // 松键即清（G23）
    expect(p.vy).toBeCloseTo(-4.61 + 0.4 + 0.01, 5);   // 无钉=重力衰减+松键微衰减 0.01（:22435-46,oracle S2 ballistic 起点）
  });
});

// ---------------------------------------------------------------------------
// F2【P1】飞毯横移加速（:26813-17 覆写前乘区,读上一拍 carpetFrame）
// ---------------------------------------------------------------------------
describe('BJ717-A F2 飞毯横移 ×1.25/×1.5（oracle S6:maxRun 4.5/runAcc 0.1,vx 收敛 4.58）', () => {
  it('毯飞持右：激活次拍起 vx 越过裸装帽 3（旧=3.06 恒,2/3 速）', async () => {
    const w = makeGroundWorld('bj717a-f2');
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(934), stack: 1 };   // Flying Carpet
    await settleGround(p, w);
    // 短跳→松→下落中重按=毯激活（CarpetMovement :22027 canCarpet∧controlJump）
    p.inputJump = true; p.jumpEdgePrev = false;
    for (let t = 0; t < 3; t++) { p.inputX = 1; tick(p, w); }
    p.inputJump = false;
    for (let t = 0; t < 22; t++) { p.inputX = 1; tick(p, w); }   // 上升+坠
    expect(p.carpetTime).toBe(0);
    expect(p.vy).toBeGreaterThan(0);                 // 下落中
    p.inputJump = true;                              // 毯激活沿
    tick(p, w);
    expect(p.carpetFlying).toBe(true);
    expect(p.carpetTime).toBe(299);
    // 激活后持续持右 60 拍：maxRun 3×1.5=4.5 → vx 收敛 >4.2（旧 3.06）
    let maxVx = 0;
    for (let t = 0; t < 60; t++) { p.inputX = 1; tick(p, w); maxVx = Math.max(maxVx, p.vx); }
    p.inputJump = false; p.inputX = 0;
    expect(maxVx).toBeGreaterThan(4.2);
    expect(maxVx).toBeLessThanOrEqual(4.7);          // oracle 收敛 4.58
  });

  it('carpetFramePrev 快照序：先快照后清零（读上一拍展开态≙:26813 滞后一拍）', () => {
    expect(playerSrc).toContain('this.carpetFramePrev = this.carpetFlying;\n    this.carpetFlying = false;');
    expect(playerSrc).toContain('if (this.carpetFramePrev && !mntWipeBoost) {');
    expect(playerSrc).toContain('runAcc = mulPreAdd(runAcc, 1.25, additiveAcc);');
    expect(playerSrc).toContain('maxRun = mulPreAdd(maxRun, 1.5, additiveRun);');
  });
});

// ---------------------------------------------------------------------------
// F3【P1】火箭靴点火门 !isDownDashing（:27069 第 7 项=CanUseBootFlyingAbilities :3972）
// ---------------------------------------------------------------------------
describe('BJ717-A F3 火箭靴点火门拒下砸（oracle S7/S7b）', () => {
  async function dropFromHeight(p: P, w: World) {
    // row 100：num6=1 全重力带（row<94 太空带 num6 钳 0.25=重力 0.1 会污染终端坠）
    (p as unknown as { y: number }).y = 100 * 16;
    p.vy = 0; p.jumpHold = 0;
    for (let t = 0; t < 32; t++) tick(p, w);       // 坠至 vy=10.01（终端）
  }
  it('S7 下砸中重按：拒点火（rocketTime 恒 7/rocketDelay 恒 0;旧=点火 7→6 反抽）', async () => {
    const w = makeGroundWorld('bj717a-f3a');
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(128), stack: 1 };      // Rocket Boots
    p.inv.armor[4] = { id: iid(5465), stack: 1 };     // Dead Cells Ram Rune
    await settleGround(p, w);
    await dropFromHeight(p, w);
    expect(p.vy).toBeGreaterThan(9);                  // 终端坠落中
    // 下砸触发（jump 边沿+↓,vy≠0,!mount）
    p.inputJump = true; p.jumpEdgePrev = false; p.inputDown = true;
    tick(p, w);
    expect(p.isDownDashing).toBe(true);
    expect(p.rocketTime).toBe(7);
    // 松 2 拍再按住（probe2 实报形态）
    p.inputJump = false;
    tick(p, w); tick(p, w);
    p.inputJump = true; p.jumpEdgePrev = false;
    for (let t = 0; t < 6; t++) { p.inputDown = true; tick(p, w); }
    expect(p.isDownDashing).toBe(true);               // 持到落地
    expect(p.rocketTime).toBe(7);                     // ★拒点火（vanilla :27069 门）
    expect(p.rocketDelay).toBe(0);
    expect(p.vy).toBeGreaterThan(9);                  // 继续终端坠（非 -0.6/t 反抽）
    p.inputJump = false; p.inputDown = false;
  });

  it('S7b 对照：无下砸重按照常点火（rocketTime 7→6/rocketDelay 递减）', async () => {
    const w = makeGroundWorld('bj717a-f3b');
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(128), stack: 1 };
    await settleGround(p, w);
    await dropFromHeight(p, w);
    p.inputJump = true; p.jumpEdgePrev = false;
    tick(p, w);
    expect(p.rocketTime).toBe(6);                     // 点火
    expect(p.rocketDelay).toBe(9);                    // 同拍推力递减
    expect(p.isDownDashing).toBe(false);
    p.inputJump = false;
  });
});

// ---------------------------------------------------------------------------
// F4【P2】变态刀 3106 潜行移速惩罚（:26818-23,oracle S4:满潜行 maxRun 减半+accRun 压平）
// ---------------------------------------------------------------------------
describe('BJ717-A F4 变态刀潜行移速减半（oracle S4:maxRun 1.5/accRun 1.5/run 收敛 ~1.5）', () => {
  it('满潜行持刀跑：vx 收敛 ≤1.6（旧=3.04 恒,移速面零消费）', async () => {
    const w = makeGroundWorld('bj717a-f4');
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.slots[0] = { id: iid(3106), stack: 1 };
    p.inv.selected = 0;
    await settleGround(p, w);
    for (let t = 0; t < 90; t++) tick(p, w);          // 静止衰减 0.02/t → stealth→0
    expect(p.stealth).toBe(0);
    let maxVx = 0;
    for (let t = 0; t < 150; t++) { p.inputX = 1; tick(p, w); maxVx = Math.max(maxVx, p.vx); }
    p.inputX = 0;
    expect(p.stealth).toBe(0);                        // vanilla quirk:stealth=0 移动不回升（:25957 门）
    expect(maxVx).toBeLessThanOrEqual(1.7);           // oracle 收敛 ~1.5（旧 3.04）
    expect(maxVx).toBeGreaterThan(1.2);
  });
});

// ---------------------------------------------------------------------------
// F5【P2·销案】弹跳棒 43 空中零摩擦=R13 误读（:26718-21 死码,:26828 覆写）
// ---------------------------------------------------------------------------
describe('BJ717-A F5 销案：mount43 空中摩擦=0.2 照常（oracle S5:runSlow=0.2,vx 衰减）', () => {
  it('骑 43 空中无键：vx 衰减（零摩擦假说=永持 8.0 → 必红）', async () => {
    const w = makeGroundWorld('bj717a-f5');
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.mount.setMount(43, p);
    await settleGround(p, w);
    for (let t = 0; t < 90; t++) { p.inputX = 1; tick(p, w); }   // 加速
    const vxAir0 = Math.abs(p.vx);
    expect(vxAir0).toBeGreaterThan(3);
    p.inputJump = true; p.jumpEdgePrev = false;       // 起跳
    tick(p, w);
    p.inputJump = false; p.inputX = 0;
    const vxAtHop = Math.abs(p.vx);
    for (let t = 0; t < 8; t++) tick(p, w);           // 空中无键 8 拍
    expect(Math.abs(p.vx)).toBeLessThan(vxAtHop - 0.4);   // 摩擦衰减（零摩擦=恒定必红）
  });

  it('结构锁：:26718-21 零摩擦臂不移植（防再登记）', () => {
    expect(playerSrc).not.toMatch(/type === 43[^\n]*\n[^\n]*runSlow = 0/);
    expect(playerSrc).toContain('「空中零摩擦」\n    //   系 R13 误读,不移植。');
  });
});

// ---------------------------------------------------------------------------
// F6【P2】瓶/坐骑跳臂 jumpStartedThisTick（fire 拍 sustain 不跑;oracle S3:jump=22 原值）
// ---------------------------------------------------------------------------
describe('BJ717-A F6 瓶跳 fire 拍 sustain 不跑（oracle S3:Blizzard fire 拍 jump=22 原值）', () => {
  it('干地暴雪瓶空中二段跳：fire 拍 jumpHold=Math.round(15×1.5)=23 原值,次拍 22', async () => {
    const w = makeGroundWorld('bj717a-f6');
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(987), stack: 1 };      // Blizzard in a Bottle
    await settleGround(p, w);
    p.inputJump = true; p.jumpEdgePrev = false;
    tick(p, w);
    expect(p.jumpHold).toBe(15);
    p.inputJump = false;
    for (let t = 0; t < 18; t++) tick(p, w);          // 上升到坠
    expect(p.vy).not.toBe(0);
    p.inputJump = true; p.jumpEdgePrev = false;       // 瓶臂
    tick(p, w);
    expect(p.performingJump).toBe('Blizzard');
    expect(p.jumpHold).toBe(23);                      // ★fire 拍原值（旧=22 同拍 −1;vanilla (int)=22,Math.round=+1t 既有登记偏差不动）
    tick(p, w);
    expect(p.jumpHold).toBe(22);                      // 次拍起递减
    p.inputJump = false;
  });

  it('四臂结构锁（湿坐骑/湿瓶/干坐骑/干瓶）', () => {
    const marks = playerSrc.match(/jumpStartedThisTick = true;\s+\/\/ ★BJ717-A F6/g) ?? [];
    expect(marks.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// F7【P2】pogo 拍参数链照跑（HM 早退只豁免整合段;:26694-26888 链在 HM 前）
// ---------------------------------------------------------------------------
describe('BJ717-A F7 pogo 拍参数链（弹跳臂=HM 头 :19909-21 return,参数链在其前照跑）', () => {
  it('结构锁：!pogoFired 门只辖整合段（参数链含毯/刀臂在其外）', () => {
    const carpetArm = playerSrc.indexOf('if (this.carpetFramePrev && !mntWipeBoost) {');
    const knifeArm = playerSrc.indexOf('if (this.heldPsychoKnife && this.stealth < 1 && !mntWipeBoost) {');
    const integrationGate = playerSrc.indexOf('if (!pogoFired) {');
    expect(carpetArm).toBeGreaterThan(-1);
    expect(knifeArm).toBeGreaterThan(-1);
    expect(integrationGate).toBeGreaterThan(-1);
    // 参数链（毯/刀=链尾段）必须在整合门【前】=pogo 拍照跑
    expect(carpetArm).toBeLessThan(integrationGate);
    expect(knifeArm).toBeLessThan(integrationGate);
    // 整合门恰一处（旧整链门形绝迹）
    expect((playerSrc.match(/if \(!pogoFired\) \{/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F8【P2】mermanSustain swimTime 刷新无条件（oracle S8c:骑 49 液中持跳 10→29 周期刷新）
// ---------------------------------------------------------------------------
describe('BJ717-A F8 merman sustain swimTime 刷新去 mountFlight 门', () => {
  it('人鱼+骑 49 池中持跳：swimTime 周期刷新（旧=被 !mountFlight 门吞,30 拍后归 0）', async () => {
    const w = makePoolWorld('bj717a-f8', 90, 137);
    const game = makeHooks(w);
    const p = await mkPlayer(21 * 16, 130 * 16);
    p.inv.armor[3] = { id: iid(497), stack: 1 };      // Neptune's Shell
    p.mount.setMount(49, p);                          // LavaShark（悬停族）
    for (let t = 0; t < 90; t++) p.fixedUpdate(T, game);   // 沉底+变身
    expect(p.merman).toBe(true);
    expect(p.wet || p.inWater).toBe(true);
    p.inputJump = true; p.jumpEdgePrev = false;
    const samples: number[] = [];
    let sawRefresh = false; let sawLow = false;
    for (let t = 0; t < 46; t++) {
      p.fixedUpdate(T, game);
      samples.push(p.swimTime);
      if (p.swimTime <= 10) sawLow = true;
      if (sawLow && p.swimTime >= 28) sawRefresh = true;   // ≤10 后再见 ≥28=刷新
    }
    p.inputJump = false;
    expect(sawLow).toBe(true);        // 递减到刷新阈
    expect(sawRefresh).toBe(true);    // ★10→30 刷新发生（旧=门吞后单调归 0）
  });
});

// ---------------------------------------------------------------------------
// F9【P2】湿支 hover 族谓词 tryingToHoverDown（TryingToHoverDown :3920-27 锁存）
// ---------------------------------------------------------------------------
describe('BJ717-A F9 湿支 hover 谓词读锁存位（Click 悬停锁存+湿态漏触）', () => {
  it('湿态+hover 翼+锁存（inputDown=false）：flag19 悬浮臂照跑（wingTime 消耗;旧=裸 inputDown 门漏触）', async () => {
    const w = makePoolWorld('bj717a-f9', 90, 137);
    const game = makeHooks(w);
    const p = await mkPlayer(21 * 16, 130 * 16);
    p.inv.armor[3] = { id: iid(1866), stack: 1 };    // Hoverboard（wing slot 22,hover+FLAP_HOVER_SET）
    for (let t = 0; t < 30; t++) p.fixedUpdate(T, game);
    expect(p.inWater).toBe(true);
    expect(p.equipStats.wing?.hover).toBe(true);
    const { options } = await import('../src/core/Options');
    const savedMode = options.data.hoverControl;
    options.data.hoverControl = 'click';             // Click 档=锁存可驻留（Hold 档每拍双清）
    let t1 = 0; let t2 = 0;
    try {
    p.wingTime = 100;                                 // 燃料在
    p.inputJump = true; p.jumpEdgePrev = true;        // 持跳无沿（隔离起跳门）
    p.inputDown = false;                              // ★不按↓
    p.vy = 0.5;                                       // vy≠0（vy==0 会双清锁存 :25475-78）
    p.jumpHold = 5;                                   // 压死 flag19 第一子句（…∧jumpHold===0）→ 只剩 hover 子句可达
    p.tryKeepingHoveringDown = true;                  // ★锁存位在（Click 悬停模式;getter=inputDown∨锁存）
    p.fixedUpdate(T, game);
    t1 = p.wingTime;
    // 对照：锁存位清+不按↓ → hover 子句拒（wingTime 不动）
    p.wingTime = 100;
    p.jumpHold = 5;
    p.tryKeepingHoveringDown = false;
    p.fixedUpdate(T, game);
    t2 = p.wingTime;
    } finally { options.data.hoverControl = savedMode; }
    p.inputJump = false;
    expect(t1).toBeLessThan(100);                     // ★锁存触发悬浮臂（wingMovement 消耗 wingTime;旧=inputDown 门恒漏）
    expect(t2).toBe(100);                             // 对照：无锁存无↓=臂不跑
  });

  it('结构锁：湿支两臂（flag19 悬浮/缓降）均读 tryingToHoverDown', () => {
    expect(playerSrc).toContain('FLAP_HOVER_SET.has(wingsLogicW) && this.inputJump && this.tryingToHoverDown && this.wingTime > 0');
    expect(playerSrc).toContain('eqWet.wing?.hover && this.tryingToHoverDown && this.inputJump && this.wingTime > 0 && !this.merman');
  });
});

// ---------------------------------------------------------------------------
// F10【P2】坐骑 hover 副作用让位火箭推力（:27158 else-if 互斥）
// ---------------------------------------------------------------------------
describe('BJ717-A F10 推力期坐骑链不跑（flyTime/fatigue 不烧）', () => {
  it('点火后上骑：推力期 fatigue 恒 0（旧=悬停链照跑,flyTime/fatigue 静默消耗）', async () => {
    const w = makeGroundWorld('bj717a-f10');
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(128), stack: 1 };      // Rocket Boots
    await settleGround(p, w);
    // 短跳+空中点火
    p.inputJump = true; p.jumpEdgePrev = false;
    tick(p, w);
    p.inputJump = false;
    for (let t = 0; t < 16; t++) tick(p, w);
    p.inputJump = true; p.jumpEdgePrev = false;
    tick(p, w);
    expect(p.rocketTime).toBe(6);
    expect(p.rocketDelay).toBe(9);                    // 推力脉冲期
    // 推力期上骑（悬停族 23 巫婆扫帚）
    p.mount.setMount(23, p);
    for (let t = 0; t < 7; t++) { p.inputJump = true; tick(p, w); }
    expect(p.rocketDelay).toBeGreaterThan(0);         // 仍在推力窗内
    expect(p.mount.flyTime).toBe(0);                  // ★未消费（旧=hover() 每拍 flyTime--/fatigue 累积）
    expect(p.mount.fatigue).toBe(0);
    expect(p.vy).toBeLessThan(0);                     // 推力模型在升（非悬停钉 -0.001 冻结）
    p.inputJump = false;
  });

  it('结构锁：两支坐骑链门均带 rocketDelay===0（g16 F2 迁移面之外的判别补充）', () => {
    expect((playerSrc.match(/if \(mnt2 && !this\.cced && this\.rocketDelay === 0\) \{/g) ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// oracle 金标在位（vanilla-headless 逐拍 TSV——防清理/防篡改的最小锁）
// ---------------------------------------------------------------------------
describe('BJ717-A oracle 金标（vanilla-headless harness 产物）', () => {
  it('TSV 在位且含关键判读行（逐列解析:S1 平台拍 vy=-4.61/S3 瓶拍 jump=22/S6 毯 maxRun=4.5/S7 拒点火/S7b 对照）', () => {
    const lines = oracleTsv.trim().split('\n').slice(1).map((l) => l.split('\t'));
    // 列序与 harness Rec() 一致:0 scen 1 t 5 vy 6 jump 11 maxRun 16 rocketTime 17 rocketDelay 23 swimTime
    const row = (scen: string, t: number) =>
      lines.find((c) => c[0] === scen && Number(c[1]) === t && c[28] !== 'settle');
    expect(row('S1', 0)).toBeDefined();
    expect(Number(row('S1', 0)![5])).toBeCloseTo(-4.61, 3);          // 起跳拍
    expect(Number(row('S1', 1)![5])).toBeCloseTo(-4.61, 3);          // 平台拍（钉→重力序）
    expect(Number(row('S1', 15)![6])).toBe(0);                        // 15 钉拍耗尽
    expect(Number(row('S3', 20)![6])).toBe(22);                       // Blizzard fire 拍 jump=22（(int) 截断）
    expect(Number(row('S3', 21)![5])).toBeCloseTo(-4.61, 3);          // 瓶平台拍同 -4.61
    expect(Number(row('S6', 26)![11])).toBeCloseTo(4.5, 3);           // 毯带 maxRun=3×1.5
    expect(Number(row('S7', 26)![16])).toBe(7);                       // 下砸中重按:拒点火
    expect(Number(row('S7', 26)![17])).toBe(0);
    expect(Number(row('S7b', 26)![16])).toBe(6);                      // 对照:点火
    expect(Number(row('S7b', 26)![17])).toBe(9);
  });
});
