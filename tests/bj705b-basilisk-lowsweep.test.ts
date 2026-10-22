// ★BJ705-B（2026-10-21 用户实报「远古号角坐骑(3771→14 Basilisk)二段跳后平地最高
//  速度 41→63mph」低概率路径穷举）定谳+回归锁。
//
// 定谳链（1457 反编译逐位,全链亲读）：
// · Mount.cs:1648-1697 mounts[14] Basilisk **无 blockExtraJumps 赋值**（字段缺省
//   false,Mount.cs:189）→ 骑乘期瓶族多段跳【放行】（Player.cs:26245-26256 只在
//   BlockExtraJumps=true 才清 canJumpAgain_*;:26257-259 vy==0 RefreshDoubleJumps
//   恢复瓶位）。仓 vanilla-mounts.json '14' 同样无键=faithful。
// · Player.cs:20875-20922 选择序：Basilisk>WoFGoat>Santank>Unicorn>下砸>Sandstorm>
//   Blizzard>Fart>Sail>Cloud——骑 14 持瓶：空中第 1 跳耗坐骑选项（performingJump=
//   'Basilisk'）,第 2 跳耗瓶（performingJump='Blizzard'/'Fart'/'Sail'）。
// · Player.cs:26778-26812 瓶族 boost（Blizzard ×3/×1.5、Fart ×3/×1.75、Sail
//   ×1.5/×1.25）在坐骑 stats 覆写 :26824-26855【之前】——非叠加坐骑（Basilisk
//   CanUseWings=false → flag17 恒假）走 :26852-54 `maxRunSpeed=mount.RunSpeed;
//   runAcceleration=mount.Acceleration` 赋值覆写 → **boost 整体被冲掉,骑乘期零效果**。
// · 仓内次序相反：覆写在 Player.ts:6524-35【先行】,瓶族 boost 线 :6685-88 落在
//   覆写【后】且无 mnt 门 → 骑 14 空中耗瓶跳后 maxRun=8×1.5=12（Blizzard）+
//   runAcc=0.25×3=0.75 过冲 → 弧内 |vx| 峰 ≈12.4-12.7px/t ≈ **62-63mph**——与用户
//   实报 41→63 数值完全吻合的第二活码面（G19 撤线只撤了坐骑族线,瓶族线同位错序
//   残留;G19 前旧码 mountJumpPerforming→×1.5 则是【持续】63mph 面,两同根）。
// · 同族连带（覆写前乘区在仓内全部落在覆写后=骑乘期 live,vanilla 全被 :26852-54
//   冲掉）：翱翔徽章 runAcc×1.75（:26700-03）→ 加速面;荧光体 :26704-10 与暗影套
//   :26711-17 的 maxRun×1.15 → 骑乘平地持续 8×1.15=9.2px/t≈46mph 面;:26826-28
//   `!CanUseWings → runSlowdown=0.2` 平值复位缺失（摩擦面）。本刀一并镜像。
// · 修法：非叠加坐骑骑乘期这些乘区整块跳过（≙被覆写冲掉的净效）;加法坐骑（滚轴
//   鞋 57-60）mulPreAdd 乘叠加前基底（≙ vanilla 先乘后加序,add=0 时退化恒等）。
// · [bj705b-wing-cap] 登记（未修）：:6536-47 翼档 cap 块缺 vanilla :26696
//   `mount.CanUseWings` 门（仓抬 maxRun 而原版只抬 accRunSpeed 的建模差另册）——
//   骑乘+翼 airborne maxRun=max(8,accSpeed≤9)=9px/t≈45mph 瞬态;恶魔翼 492
//   accSpeed=6.25<8 数值死面,幽灵翼 29/32 档可达——归坐骑域 deferred 批
//   （:6728-35 滚轴鞋翼横移等价声明域）。
//
// 仪器（本文件）：
//   §0 定谳复现（修前红/修后绿,A=瓶族 boost,C=荧光体/暗影,控制组=云瓶/沙暴门）
//   §1 决定性随机序列扫描（seeded 可复现,缺省 2400 条快速档;BJ705B_SWEEP 可调）
//   §2 结构锁（源文本锚,防静默回退）
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_BY_KEY } from '../src/data/items';
import { seededRandom } from './seeded-rng';

const ROOT = join(__dirname, '..');
const playerSrc = readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8');

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

const fakeHooks = (w: World, p: unknown) => ({
  world: w, player: p,
  playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
  addDamageNumber: () => {}, spawnParticles: () => {}, spawnDust: () => null,
  spawnDrop: () => null, damagePlayer: (): number => 0, onEnemyKilled: () => {},
  entities: { add: () => {} }, enemies: () => [], critters: () => [], npcs: () => [],
  notifyInventoryChanged: () => {}, spawnEnemy: () => {}, cutTile: () => {},
});

type P = import('../src/entities/Player').Player;

async function mkPlayer(xPx: number, yPx: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  return new Player(xPx, yPx, new Inventory());
}

/** §0 定谳夹具：500×240（★勿用 60-80 格窄世界或 180 高宽世界——bordersMovement
 *  :11735 最小世界豁免门(任一边≤80格)外的大世界有 640px 底界脚钳,180 高世界底界
 *  =2880−640=2240 会把 row150 地面罩进界带=玩家冻结悬空(首版假红根因);240 高
 *  底界 3200>地面 2432 ✓;500 宽=右界 7340 距 700t×8.3px 全程漂移有余) */
function makeGroundWorld(seed: string, ground = 150): World {
  const w = new World(500, 240, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, ground, 1, 0, 0);
    w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  }
  return w;
}

/** A7 湿链宽池（x∈[8,52],底 137——漂移 40 拍不出池） */
function makeWidePoolWorld(seed: string): World {
  const w = new World(64, 220, 44, seed);
  w.groundLevel = 200;
  for (let x = 8; x <= 52; x++) w.store.setTileSilent(x, 137, 1, 0, 0);
  for (let y = 120; y < 137; y++) {
    for (let x = 8; x <= 52; x++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.WATER);
  }
  return w;
}

/** 落地 settle（含骑乘召唤/装备后回地） */
async function settle(p: P, game: unknown, maxT = 120): Promise<void> {
  p.inputX = 0; p.inputJump = false; p.inputDown = false;
  for (let t = 0; t < maxT; t++) { p.fixedUpdate(1 / 60, game as never); if (p.onGround) break; }
}

/** 单发跳键边沿（jumpEdgePrev 尾快照语义,g19 夹具同式） */
function pressJump(p: P, game: unknown): void {
  p.inputJump = true; p.jumpEdgePrev = false;
  p.fixedUpdate(1 / 60, game as never);
  p.inputJump = false;
}

/** 空中等窗耗尽（jumpHold→0 且未落地;上限内未耗尽则等待落地） */
async function drainWindow(p: P, game: unknown, maxT = 90): Promise<void> {
  for (let t = 0; t < maxT; t++) {
    p.fixedUpdate(1 / 60, game as never);
    if ((p.jumpHold === 0 && !p.onGround) || p.onGround) break;
  }
}

/** 弧内+落地全程 |vx| 峰（瓶跳后测量;落地后持续尾独立量） */
async function measureArc(p: P, game: unknown, maxT = 260): Promise<number> {
  let peak = 0;
  for (let t = 0; t < maxT; t++) {
    p.inputX = 1; p.inputJump = false; p.inputDown = false;
    p.fixedUpdate(1 / 60, game as never);
    peak = Math.max(peak, Math.abs(p.vx));
    if (p.onGround && p.jumpHold === 0 && t > 30) break;
  }
  return peak;
}

/** ★BJ705-G23 持跳版弧内峰——[g19-jump-release-zero] 清偿后 tap 跳松键即清窗
 *  （boost 只剩发拍后 1 拍),瓶族 boost 判别面须【持跳过窗】=vanilla 活面
 *  （controlJump 按住时 jump 不清,:20823 sustain 分支）。 */
async function measureArcHeld(p: P, game: unknown, maxT = 260): Promise<number> {
  let peak = 0;
  for (let t = 0; t < maxT; t++) {
    p.inputX = 1; p.inputJump = true; p.inputDown = false;
    p.fixedUpdate(1 / 60, game as never);
    peak = Math.max(peak, Math.abs(p.vx));
    if (p.onGround && p.jumpHold === 0 && t > 30) break;
  }
  p.inputJump = false;
  return peak;
}

/** 落地续跑持续 |vx| 峰（240t 定向跑,无跳） */
async function sustainedRun(p: P, game: unknown): Promise<number> {
  let peak = 0;
  for (let t = 0; t < 240; t++) {
    p.inputX = 1; p.inputJump = false; p.inputDown = false;
    p.fixedUpdate(1 / 60, game as never);
    peak = Math.max(peak, Math.abs(p.vx));
  }
  return peak;
}

// ---------------------------------------------------------------------------
// §0 定谳复现：骑 14 持瓶——空中坐骑跳(performingJump='Basilisk')后空中瓶跳
//    （performingJump='Blizzard'/…）的 boost 消费线在骑乘期必须死（vanilla :26852-54
//    覆写冲掉镜像）。修前：Blizzard≈12.4-12.7(62-63mph)/Fart≈14.4/Sail≈10.3。
// ---------------------------------------------------------------------------
describe('BJ705-B §0A 骑乘瓶跳 boost 面（63mph 实报路径）', () => {
  async function mountedBottleArc(seed: string, bottleVid: number): Promise<{ arc: number; sustained: number; pj: string | null }> {
    const w = makeGroundWorld(seed);
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[4] = { id: iid(bottleVid), stack: 1 };
    await settle(p, game);
    expect(p.mount.setMount(14, p)).toBe(true);
    expect(p.mount.jumpOption).toBe('Basilisk');
    await sustainedRun(p, game);                      // 灌满 extraJumps/mountJumpReady,vx≈8.2
    pressJump(p, game);                               // 首跳（地面）
    await drainWindow(p, game);
    pressJump(p, game);                               // 空中坐骑跳（二段）
    expect((p as unknown as { performingJump: string | null }).performingJump).toBe('Basilisk');
    await drainWindow(p, game);
    pressJump(p, game);                               // 空中瓶跳（三段——blockExtraJumps=false 放行）
    const pj = (p as unknown as { performingJump: string | null }).performingJump;
    // ★BJ705-G23:持跳版弧（tap 版松键即清窗=boost 1 拍即死无判别力;vanilla 活面=
    // controlJump 按住时窗不清——沙暴/瓶 boost 骑乘灭门判别须持跳过窗）
    const arc = await measureArcHeld(p, game);
    const sustained = await sustainedRun(p, game);
    return { arc, sustained, pj };
  }

  it('A1 暴雪瓶（987）:骑乘瓶跳后弧内 |vx| 峰 ≤8.8（vanilla 零 boost 镜像;修前≈12.4-12.7=62-63mph）', async () => {
    const { arc, sustained, pj } = await mountedBottleArc('bj705b-a1', 987);
    expect(pj).toBe('Blizzard');                      // 瓶跳实触发（湿干链任一）
    expect(arc).toBeLessThanOrEqual(8.8);
    expect(sustained).toBeLessThanOrEqual(8.8);       // 落地续跑不残留
  }, 30000);

  it('A2 屁瓶（1724）:×1.75 档同灭（修前≈14.4=72mph）', async () => {
    const { arc, pj } = await mountedBottleArc('bj705b-a2', 1724);
    expect(pj).toBe('Fart');
    expect(arc).toBeLessThanOrEqual(8.8);
  }, 30000);

  it('A3 航行瓶（3201）:×1.25 档同灭（修前≈10.3=51mph）', async () => {
    const { arc, pj } = await mountedBottleArc('bj705b-a3', 3201);
    expect(pj).toBe('Sail');
    expect(arc).toBeLessThanOrEqual(8.8);
  }, 30000);

  it('A4 云瓶（53）控制组:无加速线,骑乘瓶跳前后极速不变', async () => {
    const { arc, pj } = await mountedBottleArc('bj705b-a4', 53);
    expect(pj).toBe('Cloud');
    expect(arc).toBeLessThanOrEqual(8.6);
  }, 30000);

  it('A5 沙暴瓶（857）控制组:!ridingMount 门在位（门除=×2 16px/t 变异恰红锚）', async () => {
    const { arc, pj } = await mountedBottleArc('bj705b-a5', 857);
    expect(pj).toBe('Sandstorm');
    expect(arc).toBeLessThanOrEqual(8.8);
  }, 30000);

  it('A6 交叉污染:空中瓶跳后【中途上骑】（setMount 14 mid-air）boost 同灭（修前≈12.4）', async () => {
    const w = makeGroundWorld('bj705b-a6');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[4] = { id: iid(987), stack: 1 };      // 未骑乘态瓶跳 boost=vanilla 活面（3×1.5=4.5）
    await settle(p, game);
    pressJump(p, game);                               // 首跳
    await drainWindow(p, game);
    pressJump(p, game);                               // 空中瓶跳（未骑乘）
    expect((p as unknown as { performingJump: string | null }).performingJump).toBe('Blizzard');
    expect(p.mount.setMount(14, p)).toBe(true);       // 窗口中途上骑
    const arc = await measureArc(p, game);
    expect(arc).toBeLessThanOrEqual(8.8);             // 上骑即死（vanilla 覆写冲掉）
  }, 30000);

  it('A7 湿链:池中骑乘瓶跳（wet 分支 :7279 置 performingJump）boost 同灭', async () => {
    const w = makeWidePoolWorld('bj705b-a7');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(20 * 16, 125 * 16);
    p.inv.armor[4] = { id: iid(987), stack: 1 };
    for (let t = 0; t < 240; t++) { p.inputX = 0; p.fixedUpdate(1 / 60, game as never); if (p.vy === 0) break; }
    expect(p.mount.setMount(14, p)).toBe(true);
    for (let t = 0; t < 60; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }
    pressJump(p, game);                               // 池底首跳（vy===0 湿门）
    await drainWindow(p, game);
    pressJump(p, game);                               // 湿坐骑跳
    await drainWindow(p, game);
    pressJump(p, game);                               // 湿瓶跳（:7279）
    expect((p as unknown as { performingJump: string | null }).performingJump).toBe('Blizzard');
    const arc = await measureArc(p, game);
    expect(arc).toBeLessThanOrEqual(8.8);
  }, 30000);
});

// ---------------------------------------------------------------------------
// §0C 同族连带：荧光体（5107）/暗影套（102/101/100）的覆写前乘区在骑乘期必须被
//    覆写冲掉（vanilla :26704-17 < :26852-54）。修前持续 8×1.15=9.2px/t≈46mph。
// ---------------------------------------------------------------------------
describe('BJ705-B §0C 骑乘覆写前乘区（荧光体/暗影套 maxRun×1.15）', () => {
  it('C1 荧光体（5107 配饰）:骑 14 平地持续极速 ≤8.5（vanilla 冲掉;修前≈9.2=46mph）', async () => {
    const w = makeGroundWorld('bj705b-c1');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[4] = { id: iid(5107), stack: 1 };
    await settle(p, game);
    expect((p as unknown as { equipStats: { magiluminescence: boolean } }).equipStats.magiluminescence).toBe(true);
    expect(p.mount.setMount(14, p)).toBe(true);
    const sustained = await sustainedRun(p, game);
    expect(sustained).toBeLessThanOrEqual(8.5);
  }, 30000);

  it('C2 暗影套（102/101/100）:骑 14 平地持续极速 ≤8.5（vanilla 冲掉;修前≈9.4=47mph）', async () => {
    const w = makeGroundWorld('bj705b-c2');
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[0] = { id: iid(102), stack: 1 };
    p.inv.armor[1] = { id: iid(101), stack: 1 };
    p.inv.armor[2] = { id: iid(100), stack: 1 };
    await settle(p, game);
    const es = (p as unknown as { equipStats: { maxRunMul: number } }).equipStats;
    expect(es.maxRunMul).toBe(1.15);                  // 套装生效前提（未骑乘面本就 vanilla 活码）
    expect(p.mount.setMount(14, p)).toBe(true);
    const sustained = await sustainedRun(p, game);
    expect(sustained).toBeLessThanOrEqual(8.5);
  }, 30000);
});

// ---------------------------------------------------------------------------
// §0D 扫描仪第二路径（未骑乘域）：翼档 cap × 瓶族 boost 叠乘。vanilla
//    WingAirLogicTweaks 只抬 accRunSpeed（:29536-55;未骑乘 CanUseWings 恒真
//    :574-83）——boost 乘未抬的 maxRunSpeed,顶速经慢爬坡支到 cap（恶魔翼 6.25）。
//    修前仓内 cap 抬 maxRun 且 boost 在后乘 → 6.25×1.75=10.94px/t≈54.7mph。
// ---------------------------------------------------------------------------
describe('BJ705-B §0D 未骑乘翼×瓶 boost 叠乘（扫描仪第二路径）', () => {
  /** 带初速版:先跑满(≈3px/t)再跳——静止起跳的 29 拍窗口 ×0.24=6.96 恰在 7.0 界下
   *  无判别力(首版 M8 变异漏红根因);初速 3+0.24×29≈9.96 → 红裕度 3px/t。
   *  ★BJ705-G23:瓶跳后【持跳】过窗（松键即清窗后 tap 版只剩 1 拍 boost 无判别力）;
   *  首跳窗耗尽判 jumpHold===0 在松键清零下 1 拍即达（相位无害——瓶跳仍空中沿）。 */
  async function runningBottleArc(seed: string, bottleVid: number): Promise<number> {
    const w = makeGroundWorld(seed);
    const game = fakeHooks(w, null);
    const p = await mkPlayer(30 * 16, 140 * 16);
    p.inv.armor[3] = { id: iid(492), stack: 1 };      // 恶魔翼（wing=1,accSpeed 6.25）
    p.inv.armor[4] = { id: iid(bottleVid), stack: 1 };
    await settle(p, game);
    for (let t = 0; t < 120; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); }   // 跑满 ≈3
    pressJump(p, game);                               // 首跳（跑动中）
    for (let t = 0; t < 90; t++) { p.inputX = 1; p.fixedUpdate(1 / 60, game as never); if ((p.jumpHold === 0 && !p.onGround) || p.onGround) break; }
    pressJump(p, game);                               // 空中瓶跳
    return await measureArcHeld(p, game);
  }

  it('D1 恶魔翼(492)+屁瓶(1724)空中瓶跳:弧内峰 ≤7.0（vanilla 顶速 ≈6.25 经 ramp;修前≈10.9=54.7mph）', async () => {
    const arc = await runningBottleArc('bj705b-d1', 1724);
    expect(arc).toBeLessThanOrEqual(7.0);
  }, 30000);

  it('D2 恶魔翼+暴雪瓶(987):同面 ≤7.0（修前 6.25×1.5=9.4≈47mph）', async () => {
    const arc = await runningBottleArc('bj705b-d2', 987);
    expect(arc).toBeLessThanOrEqual(7.0);
  }, 30000);
});

// ---------------------------------------------------------------------------
// §1 决定性随机序列扫描（seeded 可复现）。变量：跳键按下/释放拍位与时长、二段/三段
//    跳时机、方向翻转、湿态（过池）、装备（瓶五型/翼/荧光体/暗影套）、上骑时机
//    （地面/空中中途上骑/不上骑）。断言：全程 |vx| 峰 ≤8.9 + 落地续跑 240t 峰 ≤8.8
//    （maxRun=8+0.25 加速过冲锯齿峰≈8.3;瓶族 boost 面=12+、G19 旧形态=12.5 持续）。
//    BJ705B_SWEEP 环境变量可调条数（缺省 2400 快速档;≥5200 为全量扫档）。
// ---------------------------------------------------------------------------
const SWEEP_N = Number(process.env.BJ705B_SWEEP ?? 2400);
const BOTTLES = [0, 53, 987, 1724, 3201, 857] as const;   // none/Cloud/Blizzard/Fart/Sail/Sandstorm

describe('BJ705-B §1 随机序列扫描（骑 14 状态空间穷举）', () => {
  it(`±${SWEEP_N} 条 seeded 序列:全程峰 ≤8.9 ∧ 落地续跑峰 ≤8.8`, async () => {
    const w = new World(1200, 240, 44, 'bj705b-sweep');
    w.groundLevel = 200;
    for (let x = 0; x < w.w; x++) {
      w.store.setTileSilent(x, 150, 1, 0, 0);
      w.store.setTileSilent(x, 151, 1, 0, 0);
    }
    for (let y = 120; y < 150; y++) {                 // 池（x∈[130,170)——向右跑 ~60t 入水）
      for (let x = 130; x < 170; x++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.WATER);
    }
    const game = fakeHooks(w, null);
    const { Player: PCtor } = await import('../src/entities/Player');
    const { Inventory } = await import('../src/items/Inventory');
    const worstAll = { v: 0, seq: -1 }, worstTail = { v: 0, seq: -1 };
    // 覆盖度计数(仪器灵敏度自证:骑乘瓶跳实触发数是 M2 变异恰红的前提)
    let covMountedBottleJump = 0, covMountJump = 0, covWetTicks = 0, covMidairMount = 0, covUnmountedBottle = 0;
    let sawMountedBottleThisSeq = false, sawUnmountedBottleThisSeq = false;
    for (let seq = 0; seq < SWEEP_N; seq++) {
      sawMountedBottleThisSeq = false;
      sawUnmountedBottleThisSeq = false;
      const rnd = seededRandom(0x705B000 + seq);      // 每序列独立播种（可复现定位）
      const bottle = BOTTLES[Math.floor(rnd() * BOTTLES.length)];
      const wings = rnd() < 0.25;
      const magi = !wings && bottle === 0 && rnd() < 0.2;
      const shadow = rnd() < 0.2;
      const mountMode = rnd() < 0.7 ? 'ground' : rnd() < 0.85 ? 'midair' : 'none';
      const p = new PCtor(100 * 16, 140 * 16, new Inventory());
      if (bottle) p.inv.armor[4] = { id: iid(bottle), stack: 1 };
      if (wings) p.inv.armor[3] = { id: iid(492), stack: 1 };   // 恶魔翼 accSpeed=6.25<8（[bj705b-wing-cap] 死面）
      if (magi) p.inv.armor[4] = { id: iid(5107), stack: 1 };
      if (shadow) {
        p.inv.armor[0] = { id: iid(102), stack: 1 };
        p.inv.armor[1] = { id: iid(101), stack: 1 };
        p.inv.armor[2] = { id: iid(100), stack: 1 };
      }
      for (let t = 0; t < 90; t++) { p.fixedUpdate(1 / 60, game as never); if (p.onGround) break; }
      if (mountMode === 'ground') p.mount.setMount(14, p);
      let mounted = mountMode === 'ground';
      const midairAt = mountMode === 'midair' ? 60 + Math.floor(rnd() * 200) : -1;
      // 输入状态机
      let dir = rnd() < 0.5 ? 1 : -1;
      let hold = 0, downT = 0, peakAll = 0;
      for (let t = 0; t < 340; t++) {
        if (rnd() < 0.012) dir = rnd() < 0.15 ? 0 : (rnd() < 0.5 ? 1 : -1);
        if (hold === 0 && rnd() < 0.02) hold = 2 + Math.floor(rnd() * 13);
        if (downT === 0 && rnd() < 0.003) downT = 5 + Math.floor(rnd() * 16);
        p.inputX = dir; p.inputJump = hold > 0; p.inputDown = downT > 0;
        if (hold > 0) hold--;
        if (downT > 0) downT--;
        p.fixedUpdate(1 / 60, game as never);
        if (!mounted && t === midairAt && !p.onGround) { p.mount.setMount(14, p); mounted = true; covMidairMount++; }
        const pjNow = (p as unknown as { performingJump: string | null }).performingJump;
        if (pjNow === 'Basilisk') covMountJump++;
        else if (pjNow && pjNow !== 'Basilisk') {
          if (mounted) sawMountedBottleThisSeq = true;
          else sawUnmountedBottleThisSeq = true;
        }
        if ((p as unknown as { wet: boolean }).wet) covWetTicks++;
        peakAll = Math.max(peakAll, Math.abs(p.vx));
      }
      // 落地 settle（≤400t）+ 定向续跑 240t
      const tailDir = p.vx >= 0 ? 1 : -1;
      for (let t = 0; t < 400; t++) {
        p.inputX = 0; p.inputJump = false; p.inputDown = false;
        p.fixedUpdate(1 / 60, game as never);
        if (p.onGround && p.jumpHold === 0) break;
      }
      let peakTail = 0;
      for (let t = 0; t < 240; t++) {
        p.inputX = tailDir; p.inputJump = false; p.inputDown = false;
        p.fixedUpdate(1 / 60, game as never);
        peakTail = Math.max(peakTail, Math.abs(p.vx));
      }
      if (sawMountedBottleThisSeq) covMountedBottleJump++;
      if (sawUnmountedBottleThisSeq) covUnmountedBottle++;
      if (peakAll > worstAll.v) { worstAll.v = peakAll; worstAll.seq = seq; }
      if (peakTail > worstTail.v) { worstTail.v = peakTail; worstTail.seq = seq; }
      expect.soft(peakAll, `seq#${seq} 全程峰超限（瓶=${bottle} 翼=${wings} 暗影=${shadow} mount=${mountMode}）`).toBeLessThanOrEqual(8.9);
      expect.soft(peakTail, `seq#${seq} 续跑峰超限（瓶=${bottle} 翼=${wings} 暗影=${shadow} mount=${mountMode}）`).toBeLessThanOrEqual(8.8);
    }
    console.log(`[bj705b-sweep] n=${SWEEP_N} worstAll=${worstAll.v.toFixed(3)}@#${worstAll.seq} worstTail=${worstTail.v.toFixed(3)}@#${worstTail.seq} | 覆盖:骑乘瓶跳=${covMountedBottleJump} 骑乘坐骑跳拍=${covMountJump} 未骑瓶跳=${covUnmountedBottle} 空中上骑=${covMidairMount} 湿拍=${covWetTicks}`);
  }, 600000);
});

// ---------------------------------------------------------------------------
// §2 结构锁（源文本锚——变异恰红锚 M2/M3/M5/M6 + G19 撤线守卫延续）
// ---------------------------------------------------------------------------
describe('BJ705-B §2 结构锁', () => {
  it('S1 瓶族 boost 线带非叠加骑乘灭门（mntWipeBoost）+ mulPreAdd 加法序 + ★BJ705-G23 翼档 cap 1:1（只抬 accRun,maxRun 不动;boostBase 补丁基底已退役）', () => {
    expect(playerSrc).toContain('if (this.jumpHold > 0 && !this.grappling[0] && !this.pulley && !mntWipeBoost) {');
    expect(playerSrc).toContain("this.performingJump === 'Blizzard' && eqM.jumpOpts.includes('Blizzard')");
    expect(playerSrc).toContain('maxRun = mulPreAdd(maxRun, 1.5, additiveRun)');
    expect(playerSrc).toContain('maxRun = mulPreAdd(maxRun, 1.75, additiveRun)');
    expect(playerSrc).toContain('maxRun = mulPreAdd(maxRun, 1.25, additiveRun)');
    // cap 块 1:1 锚（:26696 门 + :29550-52 只抬不压）——防 maxRun 回潮/门撤除变异
    expect(playerSrc).toContain('if (eqM.wing && this.vy !== 0 && !this.merman && mntCanWings) {');
    expect(playerSrc).toContain('} else if (ws.accSpeed !== -1 && ws.accSpeed > accRun - additiveDash) {');
    expect(playerSrc).toContain('accRun = ws.accSpeed + additiveDash;   // :29550-52 只抬不压;maxRun 不动');
    expect(playerSrc).toContain('wingCapFired = true;');
  });

  it('S2 覆写前乘区同族三处灭门（翱翔徽章/荧光体/暗影套）+ runSlow 平值复位（★BJ705-G25:声明提升出滑行门,let→赋值同式）', () => {
    expect(playerSrc).toContain('if (eqM.empressBrooch && !mntWipeBoost) runAcc = mulPreAdd(runAcc, 1.75, additiveAcc);');
    expect(playerSrc).toContain('if (this.onGround && eqM.magiluminescence && !mntWipeBoost) {');
    expect(playerSrc).toContain('if ((eqM.runAccMul !== 1 || eqM.maxRunMul !== 1) && !mntWipeBoost) {');
    expect(playerSrc).toContain('runSlow = mntSlowFlat ? RUN_SLOWDOWN : RUN_SLOWDOWN * eqM.runSlowMul;');
    expect(playerSrc).toContain('mntWipeBoost = !mnt.movementStatsAdditive;');
    expect(playerSrc).toContain('mntSlowFlat = MOUNT_DATA[String(mnt.type)]?.CanUseWings !== true;');
  });

  it('S3 G19 撤线守卫延续（mountJumpPerforming 无 maxRun 消费线）+ 定谳注在位', () => {
    expect(playerSrc).not.toMatch(/mountJumpPerforming[^;]*\)\s*\{[^}]*maxRun\s*\*=/);
    expect(playerSrc).not.toMatch(/maxRun\s*\*=\s*1\.5[^)]*mountJumpPerforming/);
    expect(playerSrc).toContain('骑乘期整块');
  });
});
