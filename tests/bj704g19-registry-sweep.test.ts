// ★BJ704-G19（2026-10-21）登记簿残项清扫（G16 四笔 + G18 注释锚 + G3 备案三项 +
// 714 暗光基面）。锚全在 1457 反编译亲读：
// · G16 债② 瓶族跳 run 加速（Player.cs:26779-26887 暴雪 ×3/×1.5、屁瓶 ×3/×1.75;
//   :26798-26801 航行瓶 ×1.5/×1.25 同族补全）——门=isPerformingJump_* ∧ hasJumpOption_*
//   ∧ jump 窗口（:26953 jump==0 → CancelAllJumpVisualEffects 收口）∧ 非挂爪
//   （:36776 PlayerFrame 抓钩臂清）/上绳（:26335）。
// · G16 债② 连带定谳：坐骑特殊跳加速四型（:26791-26815）骑乘期整块死码——
//   :26852-26856 非 additive/非 flag17 覆写支必走（唯 SetAsRollerSkate Mount.cs:2578-81
//   置 CanUseWings/MovementStatsAreAdditive）,boost 被坐骑 stats 覆写冲掉;旧仓在
//   覆写后乘=活码,撤消费线。真活面=下坐后残余（山羊/蜥蜴无复位常驻,独角兽/坦克
//   :26953 窗口）——登记 [g19-mountjump-residual] 坐骑域批。
// · G16 债③ 沙暴残项：窗口勘正（sandStorm 位同受 jump 窗口辖）+挂爪/上绳清位
//   （:36776/:26334-35）+4tick 自翻（PlayerFrame :36577-36581 miscCounter%4 ∧
//   itemAnimation==0 → ChangeDir）+瓶卸装 hasJumpOption 门——sandStormVisual 持久位
//   统一承载（Renderer 腿 0/身 6 同窗迁移）。
// · G16 债④ CCed 微残余五笔：(a)落地三件复位零感知销案;(b)stepWingFrame CCed 冻结
//   （vanilla 唯一调用位 :27021 在 CCed 臂 else 内——旧注「:26497 无条件」系误锚）;
//   (c)湿支 rocketDelay2 冻结（:27109-11）; (d)湿支翼火箭合并冻结（:27023-31——
//   落地回满会冲掉 6× 转化量=燃料灭失面）; (e)canRocket CCed 置位零消费销案。
// · G18：playerFrameRows 体内 23 处内联锚勘正（旧世代 :35792-:36208 → 1457
//   PlayerFrame 实测 :36503-:36925;:30271→:30969）。
// · G3 备案三项：①|vx|<0.005 拍位差零感知销案（亚像素）;②松鼠黑化 lai2=0 复核
//   翻案——宿主=TownNPC shimmerRise 完成块（Enemy 域 ai[0]==25 结构性不可达）,
//   D13 后 stuckT 有消费面 → 补 :53811 单笔;③flag14 城镇史莱姆跳水 Enemy 域恒
//   false 销案（IsTownSlime 集零重叠,宿主 TownNPC.ts）。
// · 714 暗光基面（G14 登记 [g14-714-getalpha-whitening]）：GetAlpha :80888-94
//   Lerp(newColor,White,0.8)+A 保留再 ×a2/255 → (0.2·L·n+204)·a2f 逐通道/ga=a2f²。
//   两遍制（BJ668 lerp lift 同构）：基座 0.2·n·a2f 受光 + 抬升 0.8·a2f³ 'lighter'
//   不受光 ≙ vanilla 逐位;无 stealth 恒等档 0.2L+0.8=80% 白底（修暗处 muzzle ~黑）。
import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { seededRandom, BATTERY_SEED } from './seeded-rng';
import { BuffType } from '../src/stats/Buffs';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_DEFS } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

type P = import('../src/entities/Player').Player;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAN = path.join(ROOT, '..', 'Terarria1457');
const playerSrc = readFileSync(path.join(ROOT, 'src/entities/Player.ts'), 'utf8');
const rendererSrc = readFileSync(path.join(ROOT, 'src/render/Renderer.ts'), 'utf8');
const enemySrc = readFileSync(path.join(ROOT, 'src/entities/Enemy.ts'), 'utf8');
const townSrc = readFileSync(path.join(ROOT, 'src/entities/TownNPC.ts'), 'utf8');
const celebSrc = readFileSync(path.join(ROOT, 'src/entities/Celeb2.ts'), 'utf8');
const vanPlayer = readFileSync(path.join(VAN, 'Terraria', 'Player.cs'), 'utf8');
const vanNpc = readFileSync(path.join(VAN, 'Terraria', 'NPC.cs'), 'utf8');

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
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

function makeGroundWorld(seed: string, ground = 150) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, ground, 1, 0, 0);
    w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  }
  return w;
}

function makePoolWorld(seed: string, top = 90, bottom = 137) {
  const w = new World(60, 220, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.WATER);
  }
  return w;
}

async function makePlayer(xPx: number, yPx: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  return new Player(xPx, yPx, new Inventory());
}

/** 双段跳夹具：落地→首跳（松键耗窗）→空中瓶跳沿（g16 E1 同式） */
async function fireBottleJump(seed: string, bottleVid: number) {
  const w = makeGroundWorld(seed);
  const game = makeHooks(w);
  const p = await makePlayer(30 * 16, 140 * 16);
  p.inv.armor[4] = { id: iid(bottleVid), stack: 1 };
  for (let t = 0; t < 60; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
  expect(p.onGround).toBe(true);
  p.inputJump = true; p.jumpEdgePrev = false;                 // 首跳
  p.fixedUpdate(1 / 60, game);
  p.inputJump = false;
  for (let t = 0; t < 60; t++) { p.fixedUpdate(1 / 60, game); if (p.jumpHold === 0) break; }
  p.inputJump = true; p.jumpEdgePrev = false;                 // 空中瓶跳沿
  p.fixedUpdate(1 / 60, game);
  return { p, game };
}

// ---------------------------------------------------------------------------
// A. G16 债②：瓶族跳 run 加速（行为面）
// ---------------------------------------------------------------------------
describe('BJ704-G19 A 瓶族跳 run 加速（:26779-26801）', () => {
  it('A1 暴雪瓶跳:窗口内横移 ×3 加速/×1.5 帽（maxVx>4.2;旧=恒 ~3.04 无加速）', async () => {
    const { p, game } = await fireBottleJump('g19-a1', 987);
    expect(p.performingJump).toBe('Blizzard');
    p.inputX = 1;
    let maxVx = 0;
    for (let t = 0; t < 120; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.jumpHold > 0) maxVx = Math.max(maxVx, p.vx);
      if (p.onGround) break;
    }
    expect(maxVx).toBeGreaterThan(4.2);      // ×3 加速 ×1.5 帽 4.5（窗口 23 拍可达）
    expect(maxVx).toBeLessThan(5.1);         // 帽上界（一步过冲 ≤4.74+余量）
  }, 30000);

  it('A2 屁瓶跳:×3/×1.75 帽 5.25（窗口 30 拍可达;区别于暴雪 1.5 档）', async () => {
    const { p, game } = await fireBottleJump('g19-a2', 1724);
    expect(p.performingJump).toBe('Fart');
    p.inputX = 1;
    let maxVx = 0;
    for (let t = 0; t < 120; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.jumpHold > 0) maxVx = Math.max(maxVx, p.vx);
      if (p.onGround) break;
    }
    expect(maxVx).toBeGreaterThan(4.8);      // ×1.75 帽 5.25
    expect(maxVx).toBeLessThan(5.8);
  }, 30000);

  it('A3 航行瓶跳:窗口末 vx（×1.5 加速档 19 拍 ≈2.3）vs 云瓶（0.08×11 拍 ≈0.9）', async () => {
    const sail = await fireBottleJump('g19-a3a', 3201);
    expect(sail.p.performingJump).toBe('Sail');
    sail.p.inputX = 1;
    let sailEnd = 0;
    for (let t = 0; t < 120; t++) {
      sail.p.fixedUpdate(1 / 60, sail.game);
      sailEnd = sail.p.vx;
      if (sail.p.jumpHold === 0 || sail.p.onGround) break;
    }
    const cloud = await fireBottleJump('g19-a3b', 53);
    expect(cloud.p.performingJump).toBe('Cloud');
    cloud.p.inputX = 1;
    let cloudEnd = 0;
    for (let t = 0; t < 120; t++) {
      cloud.p.fixedUpdate(1 / 60, cloud.game);
      cloudEnd = cloud.p.vx;
      if (cloud.p.jumpHold === 0 || cloud.p.onGround) break;
    }
    expect(sailEnd).toBeGreaterThan(cloudEnd + 0.7);   // 2.28 vs 0.88 量级
  }, 30000);

  it('A4 结构锁:三瓶加速线+窗口/挂爪/上绳门+jumpOpts 实时门（变异恰红锚）', () => {
    expect(playerSrc).toContain("if (this.performingJump === 'Blizzard' && eqM.jumpOpts.includes('Blizzard')) { runAcc *= 3; maxRun *= 1.5; }");
    expect(playerSrc).toContain("else if (this.performingJump === 'Fart' && eqM.jumpOpts.includes('Fart')) { runAcc *= 3; maxRun *= 1.75; }");
    expect(playerSrc).toContain("else if (this.performingJump === 'Sail' && eqM.jumpOpts.includes('Sail')) { runAcc *= 1.5; maxRun *= 1.25; }");
    expect(playerSrc).toContain('if (this.jumpHold > 0 && !this.grappling[0] && !this.pulley) {');
  });

  it('A5 坐骑加速撤线锁:骑乘期死码定谳——旧 mountJumpPerforming 消费线绝迹', () => {
    expect(playerSrc).not.toContain('mountJumpPerforming) { runAcc');
    expect(playerSrc).not.toContain('MOUNT_JUMP_BOOST_PERMANENT');
    expect(playerSrc).toContain('this.mount.mountJumpPerforming = true;');   // 状态位保留（帧域/测试锁）
    expect(playerSrc).toContain('g19-mountjump-residual');                   // 残余真活面登记在案
    // vanilla 实证：覆写支在 boost 块后（骑乘期非 additive 非 flag17 必走）
    const iBoost = vanPlayer.indexOf('isPerformingJump_Unicorn && hasJumpOption_Unicorn');
    const iReplace = vanPlayer.indexOf('maxRunSpeed = mount.RunSpeed;');
    expect(iBoost).toBeGreaterThan(-1);
    expect(iReplace).toBeGreaterThan(iBoost);
  });
});

// ---------------------------------------------------------------------------
// B. G16 债③：沙暴窗口/自翻/清位面
// ---------------------------------------------------------------------------
describe('BJ704-G19 B 沙暴残项（窗口勘正+4tick 自翻+挂爪/上绳/卸装清位）', () => {
  it('B1 窗口收口:jumpHold 耗尽后（仍在上升减速尾）转向解锁（旧=锁到 vy≥0）', async () => {
    const { p, game } = await fireBottleJump('g19-b1', 857);
    expect(p.performingJump).toBe('Sandstorm');
    let sawRisingPostWindow = false;
    for (let t = 0; t < 120; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.jumpHold === 0 && p.vy < 0 && !p.onGround) { sawRisingPostWindow = true; break; }
      if (p.onGround) break;
    }
    expect(sawRisingPostWindow).toBe(true);          // 前提：窗外上升减速尾存在（窗 45<全程 ~58）
    p.inputX = -1;                                    // 窗外按反向
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game);
    expect(p.facing).toBe(-1);                        // ★解锁（旧实现锁到 vy≥0）
  }, 30000);

  it('B2 4tick 自翻:沙暴窗内无输入/无挥舞 → facing 振荡（旧=恒定）', async () => {
    const { p, game } = await fireBottleJump('g19-b2', 857);
    expect(p.facing).toBe(1);
    let flips = 0, last = p.facing;
    for (let t = 0; t < 20; t++) {
      p.fixedUpdate(1 / 60, game);
      if (p.facing !== last) { flips++; last = p.facing; }
      if (p.onGround || p.jumpHold === 0) break;
    }
    expect(flips).toBeGreaterThanOrEqual(2);          // 20 拍含 ≥4 个 4tick 相位拍
    expect(flips).toBeLessThanOrEqual(6);
  }, 30000);

  it('B3 自翻 itemAnimation 门:挥舞窗内（itemAnimTicks>0）不翻', async () => {
    const { p, game } = await fireBottleJump('g19-b3', 857);
    for (let t = 0; t < 12; t++) {
      p.itemAnimTicks = 9;                             // 每拍压满（vanilla itemAnimation==0 门）
      p.fixedUpdate(1 / 60, game);
      if (p.onGround) break;
    }
    expect(p.facing).toBe(1);                          // 12 拍零翻转（含 ≥2 个相位拍）
  }, 30000);

  it('B4 挂爪清位:grappling[0] 置位拍 → performingJump 清（:36776/:26335）', async () => {
    const { p, game } = await fireBottleJump('g19-b4', 857);
    expect(p.performingJump).toBe('Sandstorm');
    p.inputJump = false;                                // 松跳（防 :22915 收爪链先行摘钩——
    p.grappleReleaseJump = false;                       //  收爪后 vanilla 同不清位,判别面失真）
    (p.grappling as unknown[])[0] = { latched: true } as never;   // grapCount=0 → 力环零圈,仅真值门面
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBeNull();               // isPerformingJump_* 全灭
    expect(p.sandStormVisual).toBe(false);             // 视觉位同灭
  }, 30000);

  it('B5 Renderer 同窗迁移:腿 0/身 6 改读 sandStormVisual（旧 performingJump 键控）', () => {
    expect(rendererSrc).toContain('if (p.sandStormVisual) legs = 0;');
    expect(rendererSrc).toContain('p.sandStormVisual || p.carpetFlying) body = 6');
    expect(rendererSrc).not.toContain("p.performingJump === 'Sandstorm') legs = 0");
  });

  it('B6 结构锁:sandStormActive 完整门+自翻/清位两写位+持久位', () => {
    expect(playerSrc).toContain("eqM.jumpOpts.includes('Sandstorm') && this.jumpHold > 0");
    expect(playerSrc).toContain('this.sandStormVisual = sandStormActive;');
    expect(playerSrc).toContain('if (this.grappling[0] || this.pulley) this.performingJump = null;');
    expect(playerSrc).toMatch(/this\.miscCounter % 4 === 0/);
    expect(playerSrc).toMatch(/this\.itemAnimTicks <= 0 && this\.useTime <= 0\) this\.facing = -this\.facing;/);
  });

  it('B7 vanilla 实证:自翻块/抓钩清位/上绳清位锚', () => {
    const iFlip = vanPlayer.indexOf('if (miscCounter % 4 == 0 && itemAnimation == 0)');
    expect(iFlip).toBeGreaterThan(-1);
    expect(vanPlayer.slice(iFlip - 200, iFlip)).toContain('if (sandStorm)');
    expect(vanPlayer.slice(iFlip, iFlip + 120)).toContain('ChangeDir(direction * -1)');
    const iGrapple = vanPlayer.indexOf('else if (grappling[0] >= 0)');
    expect(iGrapple).toBeGreaterThan(-1);
    expect(vanPlayer.slice(iGrapple, iGrapple + 200)).toContain('CancelAllJumpVisualEffects');
  });
});

// ---------------------------------------------------------------------------
// C. G16 债④：CCed 微残余（b/c 修+a/d/e 销案锁）
// ---------------------------------------------------------------------------
describe('BJ704-G19 C CCed 微残余五笔', () => {
  it('C1 (b) 翼帧机 CCed 冻结:冻结拍 wingFrame 不动（旧=照跑;vanilla :27021 在 else 内）', async () => {
    const w = makeGroundWorld('g19-c1');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(492), stack: 1 };      // 恶魔之翼（wing=1,genericTail 族）
    for (let t = 0; t < 60; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
    expect(p.onGround).toBe(true);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    // sustain 段（jumpHold>0）帧机以 jump 位推帧;6 拍后帧 ∈{2,3}（≠ fall 帧 1——
    // 冻结判别锐化:旧码冻结中 vy≠0/jump 位照跑,帧必离开 2/3）
    for (let t = 0; t < 6; t++) p.fixedUpdate(1 / 60, game);
    const frozenAt = p.wingFrame;
    expect([2, 3]).toContain(frozenAt);               // 前提：冻结拍帧在循环带内（非 fall 帧位）
    p.buffs.apply(BuffType.Frozen, 8 / 60);            // CCed 8 拍（apply 秒制;sustain 余 ~8 拍照入冻结窗）
    for (let t = 0; t < 8; t++) p.fixedUpdate(1 / 60, game);
    expect(p.wingFrame).toBe(frozenAt);                // ★冻结（旧 genericTail/jump 位照推,帧必变）
    expect(p.cced).toBe(true);                         // 前提：冻结窗内确为 CCed
    let resumed = false;                               // 解冻续走（落定 idle/再推帧,90 拍窗内必动）
    for (let t = 0; t < 90; t++) { p.fixedUpdate(1 / 60, game); if (p.wingFrame !== frozenAt) { resumed = true; break; } }
    expect(resumed).toBe(true);
  }, 30000);

  it('C2 (c) 湿支 rocketDelay2 CCed 冻结（:27109-11 else 内）;非冻结照减（前提）', async () => {
    const w = makePoolWorld('g19-c2');
    const game = makeHooks(w);
    const p = await makePlayer(20 * 16, 80 * 16);      // 落入水池
    for (let t = 0; t < 90; t++) { p.fixedUpdate(1 / 60, game); if (p.inWater) break; }
    expect(p.inWater).toBe(true);
    p.rocketDelay2 = 20;
    for (let t = 0; t < 5; t++) p.fixedUpdate(1 / 60, game);
    expect(p.rocketDelay2).toBeLessThan(20);           // 对照：非 CCed 递减（前提）
    p.rocketDelay2 = 20;
    p.buffs.apply(BuffType.Frozen, 30);
    for (let t = 0; t < 5; t++) p.fixedUpdate(1 / 60, game);
    expect(p.rocketDelay2).toBe(20);                   // ★冻结（旧湿支照减）
  }, 30000);

  it('C3 (a)(d)(e) 销案判语锁:零感知定谳注在案（防再登记）+湿侧两门结构锁', () => {
    expect(playerSrc).toContain('WingFrame(flag19)');            // (b) 勘正锚
    expect(playerSrc).toContain('G16 债④d 湿侧');                 // (d) 合并冻结注
    expect(playerSrc).toContain('G16 债④c 湿侧');                 // (c) 锁窗冻结注
    expect(playerSrc).toContain('if (!this.cced && wingsW > 0 && eqWet.rocketBoots > 0 && this.vy !== 0 && this.rocketTime > 0) {');   // (d) 门
    expect(playerSrc).toContain('if (this.rocketDelay2 > 0 && !this.cced) this.rocketDelay2--;');                                       // (c) 门
    expect(playerSrc).toContain('if (wingsLogicW > 0 && !this.cced) {');                                                                // (b) 湿支门（干支 C1 行为面的结构孪生）
    expect(playerSrc).toContain('if (this.onGround) {');          // (a) 三件复位原位（判语在记忆档:
    //   消费面全灭——CCed 中 inputJump 压死+解冻拍本块归零;唯一理论残余=解冻拍 thrust
    //   续燃 ≤10 拍,双窄窗亚秒级,低于感知阈）
  });
});

// ---------------------------------------------------------------------------
// D. G3 备案三项（Enemy 域两销案 + TownNPC 宿主修正落地）
// ---------------------------------------------------------------------------
describe('BJ704-G19 D G3 备案三项', () => {
  it('D1 ①|vx|<0.005 拍位差:销案判语锁（亚像素,勿再登记）', () => {
    expect(enemySrc).toContain('销案锁死（G3 备案①「|vx|<0.005 拍位差」');
    expect(enemySrc).toContain('可感知面=零,正式销案');
  });
  it('D2 ③flag14 城镇史莱姆跳水:Enemy 域恒 false 销案锁（宿主 TownNPC）', () => {
    expect(enemySrc).toContain('销案锁死（G3 备案③');
    expect(enemySrc).toContain('结构性不可达');
  });
  it('D3 ②松鼠黑化 lai2=0:宿主修正（TownNPC shimmerRise 完成块）+stuckT 复位落地', () => {
    expect(townSrc).toContain('this.stuckT = 0;');
    expect(townSrc).toContain(':53811 localAI[2]=0');
    expect(townSrc).toContain('G3 备案②');
    // vanilla 实证：完成块 ai/localAI 全清 + 变体翻转 + Teleport
    const iDone = vanNpc.indexOf('ai[1] >= 75f && shimmerTransparency <= 0f');
    expect(iDone).toBeGreaterThan(-1);
    const seg = vanNpc.slice(iDone, iDone + 700);
    expect(seg).toContain('localAI[2] = 0f;');
    expect(seg).toContain('townNpcVariationIndex = ((townNpcVariationIndex != 1)');
    expect(seg).toContain('Teleport(position, 12);');
  });
});

// ---------------------------------------------------------------------------
// E. 714 暗光基面两遍制（G14 登记 [g14-714-getalpha-whitening] 清偿）
// ---------------------------------------------------------------------------
describe('BJ704-G19 E 714 两遍制（基座受光+抬升不受光 ≙ vanilla）', () => {
  class FakeCanvas {
    width = 0; height = 0;
    getContext() {
      return new Proxy({ imageSmoothingEnabled: false } as Record<string, unknown>, {
        get: (t, k) => (k in t ? t[k as string] : () => undefined),
        set: (t, k, v) => { t[k as string] = v; return true; },
      }) as unknown as CanvasRenderingContext2D;
    }
  }
  const fakeImg = (w: number, h: number) => ({ width: w, height: h }) as never;
  const mkCtx = () => {
    const draws: Array<{ tex: unknown; ga: number; gco: string }> = [];
    let gaNow = 1, gcoNow = 'source-over';
    const ctx = {
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
      set imageSmoothingEnabled(_: boolean) {},
      set globalAlpha(v: number) { gaNow = v; },
      set globalCompositeOperation(v: string) { gcoNow = v; },
      drawImage(tex: unknown) { draws.push({ tex, ga: gaNow, gco: gcoNow }); },
    } as unknown as CanvasRenderingContext2D;
    return { ctx, draws };
  };
  beforeAll(() => {
    (globalThis as { document?: unknown }).document = {
      createElement: (): FakeCanvas => new FakeCanvas(),
    };
  });
  const rangedDefIdx = (() => {
    for (let i = 0; i < ITEM_DEFS.length; i++) {
      const d = ITEM_DEFS[i];
      if (d && (d.vid ?? -1) >= 0 && itemCombat(d.vid!)?.ranged === true) return i;
    }
    return -1;
  })();
  const mkOwner = (stealth: number, shroomite: boolean) => ({
    stealth, equipStats: { shroomiteSet: shroomite, vortexSet: false },
    inv: { heldItem: () => ({ id: rangedDefIdx }) }, cx: 100, cy: 100, facing: 1, dead: false,
  });
  const muzzleOf = async (projId: 714 | 615, owner: unknown) => {
    const { Celeb2Muzzle } = await import('../src/entities/Celeb2');
    return new Celeb2Muzzle(owner as never, projId, () => true, () => ({ x: 200, y: 100 }), () => true);
  };

  it('E1 无 stealth:基座 0.2 烘焙+ga=1,抬升队列 0.8 lighter（暗处 80% 白底）', async () => {
    const { setProjSpriteOverride } = await import('../src/entities/Arrow');
    const raw = fakeImg(22, 154);
    setProjSpriteOverride(714, raw as never);
    const mz = await muzzleOf(714, mkOwner(1, false));
    const { ctx, draws } = mkCtx();
    const queue: Array<(c: CanvasRenderingContext2D) => void> = [];
    mz.draw({ ctx, projFullbrightQueue: queue } as never, {} as never);
    expect(draws).toHaveLength(1);                       // 基座单笔
    expect(draws[0]!.ga).toBe(1);                        // 无 stealth a2f=1（显式写）
    expect(draws[0]!.tex).not.toBe(raw);                // 0.2 烘焙换源（tintedTex 51/51/51）
    expect(queue).toHaveLength(1);                       // ★抬升入队
    const base2 = mkCtx();
    queue[0]!(base2.ctx);
    expect(base2.draws).toHaveLength(1);
    expect(base2.draws[0]!.gco).toBe('lighter');         // 加算（光照后不受光）
    expect(base2.draws[0]!.ga).toBeCloseTo(0.8, 6);      // 0.8·a2f³,无 stealth a2f=1
    expect(base2.draws[0]!.tex).toBe(raw);               // 原图（抬升笔不烘焙）
  }, 30000);

  it('E2 stealth0.5:基座 ga=a2f²+烘焙 0.2·n·a2f;抬升 0.8·a2f³ lighter', async () => {
    const { setProjSpriteOverride } = await import('../src/entities/Arrow');
    const raw = fakeImg(22, 154);
    setProjSpriteOverride(714, raw as never);
    const mz = await muzzleOf(714, mkOwner(0.5, true));
    const { ctx, draws } = mkCtx();
    const queue: Array<(c: CanvasRenderingContext2D) => void> = [];
    mz.draw({ ctx, projFullbrightQueue: queue } as never, {} as never);
    const a2f = Math.trunc(255 * 0.5) / 255;            // a2=(int)(255×0.5)=127
    expect(draws[0]!.ga).toBeCloseTo(a2f * a2f, 6);     // A=a2²/255（G14 锁面保持）
    expect(draws[0]!.tex).not.toBe(raw);
    const base2 = mkCtx();
    queue[0]!(base2.ctx);
    expect(base2.draws[0]!.ga).toBeCloseTo(0.8 * a2f * a2f * a2f, 6);   // ★0.8·a2f³
    expect(base2.draws[0]!.gco).toBe('lighter');
  }, 30000);

  it('E3 615 对照:默认档不进抬升队列（G14 行为保持）', async () => {
    const { setProjSpriteOverride } = await import('../src/entities/Arrow');
    const raw = fakeImg(22, 154);
    setProjSpriteOverride(615, raw as never);
    const mz = await muzzleOf(615, mkOwner(1, false));
    const { ctx, draws } = mkCtx();
    const queue: Array<(c: CanvasRenderingContext2D) => void> = [];
    mz.draw({ ctx, projFullbrightQueue: queue } as never, {} as never);
    expect(draws).toHaveLength(1);
    expect(draws[0]!.tex).toBe(raw);                    // 原图直画
    expect(queue).toHaveLength(0);                      // 无抬升
  }, 30000);

  it('E4 结构锁:两遍制代数锚（基座/抬升/恒等档三面;旧单遍制绝迹）', () => {
    expect(celebSrc).toContain('Math.trunc(255 * 0.2 * nCh[0] * a2f)');
    expect(celebSrc).toContain('liftCeleb = 0.8 * a2f * a2f * a2f;');
    expect(celebSrc).toContain('projFullbrightQueue?.push');
    expect(celebSrc).not.toContain('* 0.2 + 204');
  });
});

// ---------------------------------------------------------------------------
// F. G18：playerFrameRows 体内锚勘正（23 处;vanilla 实证抽检）
// ---------------------------------------------------------------------------
describe('BJ704-G19 F G18 内联锚勘正', () => {
  it('F1 勘正锚在案（新世代 1457 PlayerFrame 实测带）', () => {
    for (const a of [':36503-36518', ':36520-36528', ':36532-36537', ':36538-36561',
      ':36541-36544', ':36534/:36563', ':36577-36589', ':36592-36725', ':36738-36753',
      ':36742-36745', ':36758-36763', ':36754-36757', ':36764-36767', ':36768-36772',
      ':36773-36809', ':36810-36812', ':36813-36832', ':36848-36865', ':36872-36901',
      ':36907-36920', ':36921-36925', ':30969']) {
      expect(rendererSrc).toContain(a);
    }
  });
  it('F2 旧世代原形绝迹（勘正后残存=再勘漏;「旧 :xxx」勘误注除外）', () => {
    // 括号原形（勘误注里旧号无开括号前缀,不误中）
    for (const a of ['（:35792-35805）', '（:35807-35810）', '（:35817-35847）', '（:35865-35877）',
      '（:35879-36018）', '（:36025-36040）', '（:36052-36055）', '（:36098-36100',
      '（:36184-36186）', '（:36195-36208', '（:30271）']) {
      expect(rendererSrc).not.toContain(a);
    }
    // 行尾原形（// 前缀+行尾,勘误注内为「旧 :xxx」无 // 前缀）
    for (const a of ['// :36036\n', '// :36042-36049\n', '// :36042-36045（物品本身不画）',
      '// :36056-36060（矿车=3）', '// :36061-36096\n', '// :36102-36119\n',
      '// :36135-36155\n', '// :36202-36206\n']) {
      expect(rendererSrc).not.toContain(a);
    }
  });
  it('F3 vanilla 实证抽检:八处锚与 1457 逐位对齐', () => {
    const van = vanPlayer.split('\n');
    const at = (n: number) => van[n - 1] ?? '';
    expect(at(36503)).toContain('if (swimTime > 0)');
    expect(at(36520)).toContain('else if (velocity.Y != 0f || grappling[0] > -1)');
    expect(at(36577)).toContain('if (sandStorm)');
    expect(at(36592)).toContain('(itemAnimation > 0) & flag6');
    expect(at(36738)).toContain('holdStyle == 1');
    expect(at(36839)).toContain('sandStorm || carpetFrame >= 0');
    expect(at(36907)).toContain('if (legs == 140)');
    expect(at(36921)).toContain('legs == 217');
  });
});
