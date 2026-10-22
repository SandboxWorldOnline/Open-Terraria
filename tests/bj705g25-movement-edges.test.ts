// ★BJ705-G25（2026-10-22）登记债清偿·运动域窄边七件（G23 定谳连带,S5 锁全量在
// memory/bj704g23-movement-domain.md）。逐件判语：
//
// 1.[g23-merman-sustain-infinite] 修——原版 :20832-36 merman&&!cart 支【不减计数】
//   （swimTime≤10 刷 30 置换 jump--）=湿态无限 sustain:持跳水中恒钉 -jumpSpeed 连续
//   泳升;旧仓照减=15 拍脉冲化。谓词统一原版裸面（旧复合门 (inWater||inLava)∧
//   !ridingMountSwimFree 两冗余/超窄项退役——merman ⊆ inWater,swimFree 骑乘 vanilla
//   照走本支）。§M 行为锁。
// 2.[g23-wing45-dash-friction] 修——:29557-59 wingsLogic==45∧timeSinceLastDashStarted
//   ≥60 → runSlowdown×6（星盘 4954 掷后 1s 起空中摩擦 ×6）。新字段
//   timeSinceLastDashStarted（:1033;+1 帽 300 :24794-98;dash 发起清 0 :21756/:21771）。
//   §D 行为锁（×6 面+≥60 门+dash 重置）。
// 3.[g23-coast-band-friction] 修——带内滞空（无翼 vx∈[maxRun,accRun) 持向）原版=爬坡
//   分支选中而内门假→【无写滑行保持】;旧仓 canRamp 假折进 else 空气摩擦 0.1/t 衰减
//   =瓶跳弧/滑行出口后横速渐失。分支选择改带内面。§C 行为锁。
// 4.[g23-fullspeed-dashdelay-1457] 修（字段直通收口）——主面（滑行反向制动）BJ524
//   :9504 块已承载;本刀四运动字段（maxRun/accRun/runSlow/runAcc）提升出滑行门+链随
//   !pogoFired 放行=滑行制动块/num15 直通链终值（翼 mult/坐骑平值/沙丘/暗影全入）。
//   残余=滑行期 else 摩擦缺失面（原版有,净效≈阻尼带重叠 2-3 拍）——BJ524 钉值锁
//   滑行纯阻尼时间线在位,新登记 [g25-glide-else-friction] 另刀（须 oracle 时间线
//   重导+BJ524 迁移）。
// 5.[g23-sustain-grapple-freeze] 修——:26692 else-if 门:挂爪/舌缚期 JumpMovement 整段
//   不跑=预算冻结（不流逝/不清零）;旧仓常规支照跑（滑行中烧预算+松键清）。§G 行为锁
//   （伪钩 bj540 H1 同式）。
// 6.[g23-num15-field-face] 修——:21429 出口钳读字段面（翼档 cap/坐骑覆写/沙丘/暗影
//   终值）;旧读 equip 裸面=翼空中滑行出口钳 3 vs 原版翼 accSpeed 9（3 倍面）。§N
//   行为锁。
// 7.[g23-mounted-wingframe-reset] 销案——零玩家可感知:骑禁翼族坐骑期 wings=0 翼不
//   绘制（清位不可见）;唯一差面=飞行中上骑→下骑后翼帧相位差,数拍内自愈。防再登记
//   注在位（S5/bj704g23 锁「零玩家可感知面,不落刀」）。
//
// 判别锁=本文件（§M/§D/§C/§G/§N 行为面+§X 结构锁）;域回归=bj704g23/bj705b
//   （2400 扫描）/bj705/g19/g4/g5/g12-g16/g20/g22/mounts+dash 族（bj524/mv1/bj527/
//   bj540/bj508/mv2/mv3/redblue-r5/bj533/bj474/breath/shimmer）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_BY_KEY } from '../src/data/items';

const ROOT = join(__dirname, '..');
const playerSrc = readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8');

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

type P = import('../src/entities/Player').Player;

async function mkPlayer(xPx: number, yPx: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  return new Player(xPx, yPx, new Inventory());
}

const fakeHooks = (w: World, p: unknown) => ({
  world: w, player: p,
  playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
  addDamageNumber: () => {}, spawnParticles: () => {}, spawnDust: () => null,
  spawnDrop: () => null, damagePlayer: (): number => 0, onEnemyKilled: () => {},
  entities: { add: () => {} }, enemies: () => [], critters: () => [], npcs: () => [],
  notifyInventoryChanged: () => {}, spawnEnemy: () => {}, cutTile: () => {},
});

/** 500×240 干地世界（G23 同式;bordersMovement 底界脚钳不罩 row150 地面） */
function makeGroundWorld(seed: string, ground = 150): World {
  const w = new World(500, 240, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, ground, 1, 0, 0);
    w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  }
  return w;
}

/** 80×80 深水池世界（wetCollision 探针 j 钳 st.h−40——水行须 <40 行;bj524 判例） */
function makePoolWorld(seed: string): World {
  const w = new World(80, 80, 11, seed);
  for (let x = 2; x < 78; x++) {
    w.store.setTileSilent(x, 40, 1, 0, 0);
    w.store.setTileSilent(x, 41, 1, 0, 0);
    for (let y = 24; y < 40; y++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.WATER);
  }
  return w;
}

async function settle(p: P, game: unknown, maxT = 120): Promise<void> {
  p.inputX = 0; p.inputJump = false; p.inputDown = false;
  for (let t = 0; t < maxT; t++) { p.fixedUpdate(1 / 60, game as never); if (p.onGround) break; }
}

/** 注入面（Game.ts 同序,bj524 同式）：controlDash 电平 + releaseDash 置位臂 */
function injectDash(p: P, held: boolean): void {
  p.inputDash = held;
  p.releaseDash ||= !p.inputDash;
}

// ---------------------------------------------------------------------------
// §M 件1 merman 无限 sustain（:20832-36 不减计数）
// ---------------------------------------------------------------------------
describe('BJ705-G25 §M merman 持跳湿态无限 sustain（:20832-36 if/else 同体）', () => {
  it('M1 海神贝壳(497) 深水持跳:jumpHold 恒 15 不流逝+vy 恒钉（修前 15 拍耗尽=泳升脉冲化）', async () => {
    const w = makePoolWorld('g25-m1');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(40 * 16, 40 * 16 - 48);
    p.hp = 500;
    p.inv.armor[3] = { id: iid(497), stack: 1 };      // Neptune's Shell（accfx 497.merman）
    await settle(p, game);
    expect(p.inWater).toBe(true);                     // 前置自证：深水浸没
    expect(p.merman).toBe(true);                     // 前置自证：变身态置位
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game as never);            // fire 拍（湿跳门 vy==0）
    expect(p.jumpHold).toBe(15);                     // merman 液体档跳跃参数保持干燥档（:24602 只改 gravity/maxFall）
    for (let t = 0; t < 40; t++) {                   // 持跳 40 拍（远超 15 拍预算）
      p.inputJump = true;
      p.fixedUpdate(1 / 60, game as never);
    }
    p.inputJump = false;
    expect(p.jumpHold, '★merman&&!cart 支不流逝（修前 15 拍耗尽 → 0）').toBe(15);
    expect(p.vy, 'vy 恒钉 -jumpSpeed（修前重力回升 ≈-3）').toBeLessThan(-4.9);
    expect(p.inWater, '40 拍上升仍在水内（夹具前提：5.01×40=200px < 16 格水深）').toBe(true);
    expect(p.swimTime, 'swimTime≤10 刷 30 保持活体（泳姿动画链）').toBeGreaterThan(0);
  }, 30000);
});

// ---------------------------------------------------------------------------
// §D 件2 翼 45（星盘）掷后摩擦 ×6（:29557-59 × timeSinceLastDashStarted）
// ---------------------------------------------------------------------------
describe('BJ705-G25 §D 星盘(4954) 掷后 60t 空中横移摩擦 ×6', () => {
  it('D1 无输入空中衰减:ts≥60 → 8 拍内归零（×6=0.6/t）;ts<60 → 缓衰 ≥3（0.1/t）', async () => {
    const w = makeGroundWorld('g25-d1');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(4954), stack: 1 };     // Celestial Starboard（wing 45）
    await settle(p, game);
    p.fixedUpdate(1 / 60, game as never);             // 静置 1 拍回满 wingTime（G23 夹具判例）
    p.timeSinceLastDashStarted = 100;                 // 种子:掷后 ≥60t（>1s 未冲）
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game as never);             // fire
    p.inputJump = false;
    p.fixedUpdate(1 / 60, game as never);
    for (let t = 0; t < 12; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }   // 空中横移（翼 cap:accRun=8,爬坡加速）
    p.inputX = 0;
    const v0 = Math.abs(p.vx);
    expect(v0).toBeGreaterThan(3);                    // 前置自证：横速已入带（>maxRun 3）
    for (let t = 0; t < 8; t++) p.fixedUpdate(1 / 60, game as never);   // 无输入衰减 8 拍
    expect(Math.abs(p.vx), '★×6 摩擦（0.6/t×8=4.8 → 钳 0;修前 0.1/t ≈v0−0.8）').toBeLessThan(1.5);
  }, 30000);

  it('D1b 门界对照:ts=0（刚冲完）同 8 拍缓衰 ≥3（≥60 门在位——门除=0.6/t 必红）', async () => {
    const w = makeGroundWorld('g25-d1b');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(4954), stack: 1 };
    await settle(p, game);
    p.fixedUpdate(1 / 60, game as never);
    p.timeSinceLastDashStarted = 0;                   // 种子:刚冲完（8 拍内 0→8 <60）
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game as never);
    p.inputJump = false;
    p.fixedUpdate(1 / 60, game as never);
    for (let t = 0; t < 12; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }
    p.inputX = 0;
    for (let t = 0; t < 8; t++) p.fixedUpdate(1 / 60, game as never);
    expect(Math.abs(p.vx), '掷后 1s 内正常摩擦 0.1/t（v0≈3.7−0.8;×6 误挂=钳 0 必红）').toBeGreaterThan(2.5);
  }, 30000);

  it('D2 冲刺发起拍清 0 + 逐拍 +1 帽 300（:21756/:21771 × :24794-98）', async () => {
    const w = makeGroundWorld('g25-d2');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };     // Shield of Cthulhu（dash2）
    await settle(p, game);
    p.timeSinceLastDashStarted = 100;
    p.facing = 1;
    injectDash(p, false);
    p.fixedUpdate(1 / 60, game as never);             // 臂位拍（releaseDash 置位）
    injectDash(p, true);
    p.fixedUpdate(1 / 60, game as never);             // 发起拍（dashDelay=-1）
    expect(p.dashDelay).toBe(-1);                     // 发起自证
    expect(p.timeSinceLastDashStarted, '★发起拍清 0（:21756/:21771）').toBe(0);
    injectDash(p, false);
    p.fixedUpdate(1 / 60, game as never);
    expect(p.timeSinceLastDashStarted, '逐拍 +1（:24794）').toBe(1);
    p.timeSinceLastDashStarted = 299;
    p.fixedUpdate(1 / 60, game as never);
    expect(p.timeSinceLastDashStarted, '帽 300（:24795-97）').toBe(300);
  }, 30000);
});

// ---------------------------------------------------------------------------
// §C 件3 带内滞空滑行保持（:20091/:20121 分支选中内门假 → 无写）
// ---------------------------------------------------------------------------
describe('BJ705-G25 §C 带内滞空 coast（无翼 vx∈[maxRun,accRun) 持向无摩擦）', () => {
  it('C1 赫靴(54) 空中 vx=5∈[3,6) 持向 15 拍:恒 5（修前 else 摩擦 →3.5）;帽外 6.5 照衰减', async () => {
    const w = makeGroundWorld('g25-c1');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(54), stack: 1 };       // Hermes Boots（accRunSpeed 6 → 带 [3,6)）
    await settle(p, game);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game as never);             // fire
    p.inputJump = false;
    p.fixedUpdate(1 / 60, game as never);             // 空中沿（松键清窗）
    p.vx = 5;                                         // 种子带内（ dash 出口/瓶 boost 弧同位面）
    for (let t = 0; t < 15; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }
    expect(p.vx, '★带内滞空无写滑行保持（修前 else 摩擦 0.1/t → ≈3.5）').toBeCloseTo(5, 5);
    // 对照臂 1：帽外（vx>accRun 6）持向 → else 摩擦照衰减（分支结构锁）
    p.vx = 6.5;
    for (let t = 0; t < 3; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }
    expect(Math.abs(p.vx), '超 accRun 持向 → 超帽回落摩擦（≠coast）').toBeLessThan(6.5);
    // 对照臂 2：带下（vx<maxRun 3）持向 → 全速段加速（≠coast）
    p.vx = 2;
    for (let t = 0; t < 6; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }
    expect(p.vx, '带下持向 → 全速段加速向 maxRun（≠coast）').toBeGreaterThan(2.3);
    p.inputX = 0;
  }, 30000);

  it('C2 地面带内照爬坡（canRamp vy==0 支不受 coast 改动——ramp 语义守恒）', async () => {
    const w = makeGroundWorld('g25-c2');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(54), stack: 1 };
    await settle(p, game);
    p.vx = 5;                                         // 地面带内（vy==0 → canRamp 真）
    for (let t = 0; t < 20; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }
    expect(p.vx, '地面带内 ×0.2 爬坡向 accRun 6（+0.32/20t;coast 化=恒 5 必红）').toBeGreaterThan(5.2);
    p.inputX = 0;
  }, 30000);
});

// ---------------------------------------------------------------------------
// §G 件5 挂爪期 sustain 冻结（:26692 else-if 门——不流逝/不清零）
// ---------------------------------------------------------------------------
describe('BJ705-G25 §G 挂爪期跳预算冻结（JumpMovement 整段不跑）', () => {
  /** 伪钩（bj540 H1 同式 latched 形;tick 尾清表 → 逐拍重挂。projType 取普通钩 8
   *  ——446 反重力钩无输入时目标=锚下 200px 会把玩家拉回地面（探针定谳）,普通钩
   *  目标=锚点质心=玩家上方 100px 恒 −11 上拉=悬空态可维持）。 */
  const fakeHook = (p: P): void => {
    (p as unknown as { grappling: (object | null)[] }).grappling[0] = {
      ai0: 2, projType: 8, x: p.x, y: p.y - 100, cx: p.cx, cy: p.cy - 100, rot: 0,
    };
    (p as unknown as { grapCount: number }).grapCount = 1;
  };

  it('G1 跳窗中挂钩:持跳不流逝+松键不清零+收爪续跑（修前照烧/照清）', async () => {
    const w = makeGroundWorld('g25-g1');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    await settle(p, game);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game as never);             // fire（jumpHold=15）
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game as never);   // 持 3（12）
    expect(p.jumpHold).toBe(12);
    (p as unknown as { grappleReleaseJump: boolean }).grappleReleaseJump = false;
    // ≙ vanilla releaseJump=!controlJump 逐拍尾刷新（UpdateControlHuffs :29312+ 全支跑）
    // ——持跳期 false=不触收爪释放臂（仓内臂位只在非挂钩支刷新=陈值,测试种 vanilla 态）
    for (let t = 0; t < 5; t++) {
      fakeHook(p);
      p.inputJump = true;
      p.fixedUpdate(1 / 60, game as never);
    }
    expect(p.jumpHold, '★挂爪期持跳不流逝（修前 −5 → 7）').toBe(12);
    for (let t = 0; t < 3; t++) {
      fakeHook(p);
      p.inputJump = false;
      p.fixedUpdate(1 / 60, game as never);
    }
    expect(p.jumpHold, '★挂爪期松键不清零（:26692 整段不跑;修前 release-clear → 0）').toBe(12);
    // 收爪后（无钩拍）持跳:冻结余量续跑（12 → 11,非重新起跳 15）
    p.inputJump = true;
    p.fixedUpdate(1 / 60, game as never);
    expect(p.jumpHold, '收爪续跑=冻结余量续耗（≠清零重起）').toBe(11);
    p.inputJump = false;
  }, 30000);
});

// ---------------------------------------------------------------------------
// §N 件6 num15 字段面（:21429 出口钳读链终值）
// ---------------------------------------------------------------------------
describe('BJ705-G25 §N 滑行出口钳字段面（翼 accSpeed 入 num15）', () => {
  it('N1 太阳翼(3468,accSpeed 9)+克盾(3097) 空中冲刺:滑行出口 vx=9（修前裸装面=3）', async () => {
    const w = makeGroundWorld('g25-n1');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(3468), stack: 1 };     // 太阳翼（slot 29:accSpeed 9）
    p.inv.armor[4] = { id: iid(3097), stack: 1 };     // Shield of Cthulhu（dash2）
    await settle(p, game);
    p.fixedUpdate(1 / 60, game as never);             // 静置 1 拍回满 wingTime
    p.inputJump = true; p.jumpEdgePrev = false;
    for (let t = 0; t < 10; t++) p.fixedUpdate(1 / 60, game as never);   // 持跳 10 拍（保弧长）
    p.inputJump = false;
    p.facing = 1;
    injectDash(p, false);
    p.fixedUpdate(1 / 60, game as never);             // 臂位拍
    injectDash(p, true);
    p.fixedUpdate(1 / 60, game as never);             // 空中发起（vx=14.5,dashDelay=-1）
    expect(p.dashDelay).toBe(-1);
    expect(p.vy).toBeLessThan(0);                     // 前置自证:上升段（vy≠0=翼 cap 活）
    injectDash(p, false);
    let exitTick = -1;
    for (let t = 0; t < 40; t++) {
      p.fixedUpdate(1 / 60, game as never);
      if (p.dashDelay > 0) { exitTick = t; break; }
    }
    expect(exitTick, '滑行须在 40 拍内落冷却档（0.985/0.94 阻尼 ≈18 拍）').toBeGreaterThan(0);
    expect(p.vx, '★出口钳=num15=max(accRun 字段面 9, maxRun 3)（修前 equip 裸面=3）').toBe(9);
  }, 30000);
});

// ---------------------------------------------------------------------------
// §X 结构锁（源文本锚——变异恰红锚）
// ---------------------------------------------------------------------------
describe('BJ705-G25 §X 结构锁', () => {
  it('X1 merman 支:谓词统一+不流逝（:20832-36 if/else 同体）', () => {
    expect(playerSrc).toContain('const mermanSustain = this.merman && !this.ridingCart;   // :20832 原文读 merman 变身态');
    expect(playerSrc).toContain('if (!mermanSustain) this.jumpHold--;');
    expect(playerSrc).not.toContain('!this.ridingMountSwimFree');   // 旧复合门超窄项绝迹
  });

  it('X2 翼 45 摩擦:×6 行+字段三站（声明/递增/双清零）', () => {
    expect(playerSrc).toContain('if (wingCapFired && wingsLogicEff === 45 && this.timeSinceLastDashStarted >= 60) runSlow *= 6;');
    expect(playerSrc).toContain('timeSinceLastDashStarted = 0;   // ★BJ705-G25 :21756/:21771 发起拍清 0（G25 [g23-wing45-dash-friction]）');
    expect(playerSrc.match(/this\.timeSinceLastDashStarted = 0;/g)?.length).toBe(2);   // dash6+配饰两发起位
    expect(playerSrc).toContain('this.timeSinceLastDashStarted++;');
    expect(playerSrc).toContain('if (this.timeSinceLastDashStarted >= 300) this.timeSinceLastDashStarted = 300;');
  });

  it('X3 带内 coast 分支形（:20091/:20121 选支+内门包裹）+ 四字段提升', () => {
    expect(playerSrc).toContain('} else if (ix > 0 ? this.vx < accRun : this.vx > -accRun) {');
    expect(playerSrc).toContain('[g23-coast-band-friction] 清偿');
    expect(playerSrc).toContain('if (!pogoFired) {');
    expect(playerSrc).toContain('let maxRun = PLAYER_WALK_MAX * speedMult;');
    expect(playerSrc).toContain('let accRun = eqM.accRunSpeed || 3;');
    expect(playerSrc).toContain('let runSlow = RUN_SLOWDOWN * eqM.runSlowMul;');
    expect(playerSrc).toContain('let runAcc = RUN_ACCELERATION * (duneBoost ? 1.75 : 1)');
  });

  it('X4 num15 字段面+滑行制动字段直通（旧 equip 裸面式绝迹）', () => {
    expect(playerSrc).toContain('const num15 = Math.max(accRun, maxRun);');
    expect(playerSrc).not.toContain('Math.max(eq.accRunSpeed > 0 ? eq.accRunSpeed : 3');
    expect(playerSrc).toContain('this.dashMovement(game, eqM, ix, maxRun, accRun, runSlow, runAcc);');
    expect(playerSrc.match(/this\.dashMovement\(game, eqM, 0, maxRun, accRun, runSlow, runAcc\);/g)?.length).toBe(3);   // 绳支三站 ix=0（纯阻尼,无输入贡献）
  });

  it('X5 挂爪冻结门+滑行 else 摩擦清偿（G26 落地）+件7 销案注', () => {
    expect(playerSrc).toContain('&& !this.grappling[0] && !this.buffs.has(BuffType.TheTongue)) {');
    // ★BJ705-G26 迁移:[g25-glide-else-friction] 登记→清偿（HM else 摩擦支落地,
    //   判别锁=tests/bj705g26-glide-else-friction.test.ts;形态锁=标签 3 处全带「清偿」）
    expect(playerSrc.match(/\[g25-glide-else-friction\]/g)?.length).toBe(3);   // 定义注+持键臂注+无键臂注
    expect(playerSrc.match(/\[g25-glide-else-friction\] 清偿/g)?.length).toBe(3);
    expect(playerSrc).toContain('const glideElseFriction = (): void => {');
    expect(playerSrc).toContain('[g23-mounted-wingframe-reset] 销案');
  });
});
