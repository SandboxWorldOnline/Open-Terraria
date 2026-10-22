// BJ706-A 三案判别锁（用户实报 DD2 域）：
//   刀1 小妖魔滑翔怪 574/575「出传送门后一直往上飞+贴图倒转」——AI_108 悬空向量
//      num2 上抬偏移曾错写进单位向量域（normalize(Δ)×num − UnitY×num2）,任意目标距
//      >4px 即恒近垂直 → vx≈0.0004 钉死、visAngle=−π/2 直上（贴图随速度角同倒）。
//      原版 cs:66296-66300 vector2 = Normalize(Δ − UnitY×num2)×num（原差域）。
//   刀2 枯萎兽 568/569 + 德拉肯 570/571「一直倒着走」——AI_107 族帧档曾走 Renderer
//      通用 fighter 档（ai===107 → 行走 2..frames-1/站定 0/腾空 frames-1）,把各族
//      攻击/灵气帧行当行走帧播（枯萎兽 60% 帧、德拉肯 43% 帧）+腾空/站定帧全错。
//      修 = Enemy.dd2WalkerFindFrame（FindFrame 专属 case 逐字,NPC.cs:67793-68608）
//      → customFrameIdx；本测试锁各族帧行矩阵 + 滑翔怪水平逼近面。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Enemy } from '../src/entities/Enemy';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const W = 220, H = 160, FLOOR = 120;

function makeWorld(): World {
  const w = new World(W, H, 7, 'bj706a-test');
  const st = w.store;
  w.groundLevel = 50;
  for (let x = 0; x < W; x++) {
    st.setTile(x, FLOOR, 1);
    st.setTile(x, FLOOR + 1, 1);
  }
  return w;
}

type Proj = { x: number; y: number; w: number; h: number };

function makeHooks(world: World, playerAt: { x: number; y: number }) {
  const enemies: Enemy[] = [];
  const projectiles: Proj[] = [];
  let tickN = 0;
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: 'enemies' | 'projectiles') => {
      const ent = e as { id: number };
      ent.id = em.nextId++;
      if (bucket === 'enemies') enemies.push(e as Enemy);
      else projectiles.push(e as Proj);
    },
  };
  const px = playerAt.x * TILE, py = playerAt.y * TILE;
  const player = {
    x: px, y: py, w: 20, h: 42, cx: px + 10, cy: py + 21,
    vx: 0, vy: 0, hp: 400, maxHp: 400, dead: false, useTime: 1,
    aabbOverlaps: () => false,
  };
  const hooks = {
    world, player,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    entities: em,
  } as unknown as GameHooks;
  return { hooks, enemies, projectiles, em, player, get tick() { return tickN; } };
}

type Harness = ReturnType<typeof makeHooks>;

function spawn(h: Harness, id: number, tx: number, ty: number): Enemy {
  const e = Enemy.fromVanilla(id, tx * TILE, ty * TILE)!;
  e.y = FLOOR * TILE - e.h;            // 底边贴地（中心锚换算,dd2-walker.test 同款）
  e.id = h.em.nextId++;
  h.enemies.push(e);
  return e;
}

function tick(h: Harness, n: number, only?: Enemy[]): void {
  for (let i = 0; i < n; i++) {
    for (const e of only ?? h.enemies) {
      if (!e.dead) e.fixedUpdate(1 / 60, h.hooks);
    }
  }
}

/** 直驱私有帧机（dd2WalkerFindFrame 只读 vx/vy/facing/ai0/ai1,无 game 依赖） */
type FrameStepper = { dd2WalkerFindFrame(): void };
const step = (e: Enemy, n = 1): void => {
  const s = e as unknown as FrameStepper;
  for (let i = 0; i < n; i++) s.dd2WalkerFindFrame();
};

// ---------------------------------------------------------------------------
// 刀1：AI_108 悬空向量（小妖魔滑翔怪 + 埃特尼亚飞龙同链）
// ---------------------------------------------------------------------------
describe('BJ706-A 刀1：AI_108 悬空向量原差域（cs:66296-66300）', () => {
  it('574 小妖魔滑翔怪：同高水晶 40 格外 → 90t 水平位移 >30px（修前 vx≈0.0004 钉死直上）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 20, y: 118 });       // 玩家远离（>200px 不夺标）
    const crystal = spawn(h, 548, 90, 117);          // 水晶在右端
    const e = spawn(h, 574, 50, 117);
    e.y = crystal.cy - e.h / 2;                      // 与水晶同高（dy≈0,角度门恒 false → 走逼近支）
    const x0 = e.x;
    tick(h, 90, [e]);
    expect(e.dead).toBe(false);
    const dx = e.x - x0;
    // 修前：hvx=normalize(4,−400)*4 ≈ 0.04 → 90t 水平位移 <0.1px;修后 hover=(2.83,−2.83)
    expect(dx).toBeGreaterThan(30);
    expect(e.vx).toBeGreaterThan(1);
    // 直上钉死面：vy 不得突破悬空上界（−10 钳只对目标在上方支;同高支 −0.2 附加不触发）
    expect(e.vy).toBeGreaterThan(-10);
  });

  it('574 悬空向量方向锁：同高目标 → vx:|vy| ≈ dx/400（初值 640/400=1.6 的斜向逼近）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 20, y: 118 });
    const crystal = spawn(h, 548, 90, 117);
    const e = spawn(h, 574, 50, 117);
    e.y = crystal.cy - e.h / 2;
    tick(h, 60, [e]);
    // hover=normalize((dx,dy−400))×4：同高 40 格外初值 (640,−400) → vx:|vy|=1.6;
    // 随右移+上浮 dy 增、dx 减,60t 比值仍横占主导（修前 vx≈0.0004 → 比值≈0.0002）
    const ratio = e.vx / Math.abs(e.vy);
    expect(ratio).toBeGreaterThan(1.0);
    expect(ratio).toBeLessThan(2.4);
  });

  it('558 埃特尼亚飞龙：同链修后 90t 水平位移 >15px（num=3 档）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 20, y: 118 });
    spawn(h, 548, 90, 117);
    const e = spawn(h, 558, 50, 117);
    const x0 = e.x;
    tick(h, 90, [e]);
    expect(e.x - x0).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// 刀2：DD2 walker 族帧机（FindFrame 专属 case 逐字,NPC.cs:67793-68608）
// ---------------------------------------------------------------------------
describe('BJ706-A 刀2：枯萎兽 568/569 帧档（cs:67793-68025）', () => {
  it('行走带 0-6（56 wrap）,不漏入灵气带 7-16', () => {
    const e = Enemy.fromVanilla(568, 0, 0)!;
    e.vx = 1.4; e.vy = 0; e.facing = 1; e.ai0 = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 120; i++) { step(e); seen.add(e.customFrameIdx!); }
    for (const f of seen) expect(f).toBeGreaterThanOrEqual(0), expect(f).toBeLessThanOrEqual(6);
    expect(seen.size).toBeGreaterThanOrEqual(5);     // 动画真实推进
    expect(e.customFrameIdx).not.toBeNull();
  });
  it('站定=6 / 腾空=4 / 逆行=4（backslide 门）', () => {
    const e = Enemy.fromVanilla(568, 0, 0)!;
    e.vx = 0; e.vy = 0; e.ai0 = 0;
    step(e);
    expect(e.customFrameIdx).toBe(6);
    e.vy = 3; step(e);
    expect(e.customFrameIdx).toBe(4);
    e.vy = 0; e.vx = -1; e.facing = 1; step(e);      // facing 与 vx 反号 → 逆行档
    expect(e.customFrameIdx).toBe(4);
  });
  it('灵气态梯（ai0>0）：7,8,9,10 循环 → 长驻持 14', () => {
    const e = Enemy.fromVanilla(568, 0, 0)!;
    e.vx = 0; e.vy = 0; e.ai0 = 110; e.ai1 = 0;
    step(e);
    expect(e.customFrameIdx).toBe(7);                // fc<5 → 缺省 7
    step(e, 24);                                     // fc=25 → q=5 → 7+(5%4)=8
    expect(e.customFrameIdx).toBe(8);
    step(e, 270);                                    // fc≥270 → 持 14
    expect(e.customFrameIdx).toBe(14);
    step(e, 30);
    expect(e.customFrameIdx).toBe(14);               // 终态不回卷
  });
});

describe('BJ706-A 刀2：德拉肯 570/571 帧档（cs:68482-68526）', () => {
  it('行走带 2-9（64 wrap）,站定=9,腾空=1', () => {
    const e = Enemy.fromVanilla(570, 0, 0)!;
    e.vx = 0.77; e.vy = 0; e.facing = 1; e.ai0 = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 120; i++) { step(e); seen.add(e.customFrameIdx!); }
    for (const f of seen) expect(f).toBeGreaterThanOrEqual(2), expect(f).toBeLessThanOrEqual(9);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    e.vx = 0; step(e);
    expect(e.customFrameIdx).toBe(9);
    e.vy = -3; step(e);
    expect(e.customFrameIdx).toBe(1);
  });
  it('攻击带 10-15@5t（帧 14 持 35t）,ai1==59 复位重排', () => {
    const e = Enemy.fromVanilla(570, 0, 0)!;
    e.vx = 0; e.vy = 0; e.ai0 = 3; e.ai1 = 60;
    step(e, 17);
    expect(e.customFrameIdx).toBe(13);               // 推进在 5t 界上：5→11,10→12,15→13
    step(e, 3);
    expect(e.customFrameIdx).toBe(14);               // 20t 界 → 帧 14 长持窗（35t）
    step(e, 35);
    expect(e.customFrameIdx).toBe(15);               // fc≥55 → 15 终态
    e.ai1 = 59; step(e);                             // 复位字面量（:68487）
    expect(e.customFrameIdx).toBe(10);
  });
});

describe('BJ706-A 刀2：哥布林 552/投弹手 555/标枪手 561/骷髅 566 帧档', () => {
  it('552 哥布林：走 0-7/站 9/腾 8/攻 10-13@6t', () => {
    const e = Enemy.fromVanilla(552, 0, 0)!;
    e.vx = 1; e.vy = 0; e.facing = 1; e.ai0 = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 130; i++) { step(e); seen.add(e.customFrameIdx!); }
    for (const f of seen) expect(f).toBeGreaterThanOrEqual(0), expect(f).toBeLessThanOrEqual(7);
    e.vx = 0; step(e);
    expect(e.customFrameIdx).toBe(9);
    e.vy = 1; step(e);
    expect(e.customFrameIdx).toBe(8);
    e.vy = 0; e.ai0 = 44; step(e, 7);
    expect(e.customFrameIdx).toBe(11);               // 6t/帧
  });
  it('555 投弹手：走 2-9/站 0/腾 1/攻门 ai1>0&&ai0>0 带 10-16', () => {
    const e = Enemy.fromVanilla(555, 0, 0)!;
    e.vx = 1; e.vy = 0; e.facing = 1; e.ai0 = 0; e.ai1 = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 130; i++) { step(e); seen.add(e.customFrameIdx!); }
    for (const f of seen) expect(f).toBeGreaterThanOrEqual(2), expect(f).toBeLessThanOrEqual(9);
    e.vx = 0; step(e);
    expect(e.customFrameIdx).toBe(0);
    e.vy = 1; step(e);
    expect(e.customFrameIdx).toBe(1);
    e.vy = 0; e.ai0 = 3; e.ai1 = 42; step(e, 13);
    expect(e.customFrameIdx).toBe(12);               // 6t/帧,带 10-16
  });
  it('561 标枪手：走 0-7/站 9/腾 8/攻带 10-13（ai1==89 复位）', () => {
    const e = Enemy.fromVanilla(561, 0, 0)!;
    e.vx = 1; e.vy = 0; e.facing = 1; e.ai0 = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 130; i++) { step(e); seen.add(e.customFrameIdx!); }
    for (const f of seen) expect(f).toBeGreaterThanOrEqual(0), expect(f).toBeLessThanOrEqual(7);
    e.vx = 0; e.vy = 0; e.ai0 = 3; e.ai1 = 90; step(e, 7);
    expect(e.customFrameIdx).toBe(11);
    e.ai1 = 89; step(e);
    expect(e.customFrameIdx).toBe(10);
  });
  it('566 骷髅：走 0-7/站 0/腾 8（无攻击带）', () => {
    const e = Enemy.fromVanilla(566, 0, 0)!;
    e.vx = 1; e.vy = 0; e.facing = 1; e.ai0 = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 130; i++) { step(e); seen.add(e.customFrameIdx!); }
    for (const f of seen) expect(f).toBeGreaterThanOrEqual(0), expect(f).toBeLessThanOrEqual(7);
    e.vx = 0; step(e);
    expect(e.customFrameIdx).toBe(0);
    e.vy = -1; step(e);
    expect(e.customFrameIdx).toBe(8);
  });
});

describe('BJ706-A 刀2：小妖精地面型 572/573 三态帧档（cs:68263-68328）', () => {
  it('常态：走 0-7/站 0/腾 16；冲锋态（ai1==1）：走 8-15/站 8/腾 17；点火态恒 8', () => {
    const e = Enemy.fromVanilla(572, 0, 0)!;
    e.vx = 1; e.vy = 0; e.facing = 1; e.ai0 = 0; e.ai1 = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 130; i++) { step(e); seen.add(e.customFrameIdx!); }
    for (const f of seen) expect(f).toBeGreaterThanOrEqual(0), expect(f).toBeLessThanOrEqual(7);
    e.vx = 0; step(e);
    expect(e.customFrameIdx).toBe(0);
    e.vy = 1; step(e);
    expect(e.customFrameIdx).toBe(16);
    e.vy = 0; e.ai1 = 1;                             // 冲锋态
    const seen2 = new Set<number>();
    e.vx = 1;
    for (let i = 0; i < 130; i++) { step(e); seen2.add(e.customFrameIdx!); }
    for (const f of seen2) expect(f).toBeGreaterThanOrEqual(8), expect(f).toBeLessThanOrEqual(15);
    e.vx = 0; step(e);
    expect(e.customFrameIdx).toBe(8);
    e.vy = 1; step(e);
    expect(e.customFrameIdx).toBe(17);
    e.vy = 0; e.ai1 = 0; e.ai0 = 40;                 // 点火态（ai0>0&&ai1==0）
    step(e, 10);
    expect(e.customFrameIdx).toBe(8);
  });
});

describe('BJ706-A 刀2：端到端——真实 AI 驱动下行走带不漏入攻击带', () => {
  it('枯萎兽 568 向远处水晶行进 240t：帧恒在 0-6（修前 customFrameIdx 恒 null→通用档 2-16 混播）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 20, y: 118 });
    spawn(h, 548, 200, 117);                         // 水晶 150 格外（>600px 触发距 → 持续行走）
    const e = spawn(h, 568, 50, 117);
    tick(h, 240, [e]);
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) { tick(h, 1, [e]); seen.add(e.customFrameIdx!); }
    expect(e.customFrameIdx).not.toBeNull();
    for (const f of seen) expect(f).toBeGreaterThanOrEqual(0), expect(f).toBeLessThanOrEqual(6);
    expect(Math.abs(e.vx)).toBeGreaterThan(0.1);     // 确在行走（非站定帧面）
  });
  it('德拉肯 570 同场景：帧恒在 2-9', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 20, y: 118 });
    spawn(h, 548, 200, 117);
    const e = spawn(h, 570, 50, 117);
    tick(h, 240, [e]);
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) { tick(h, 1, [e]); seen.add(e.customFrameIdx!); }
    for (const f of seen) expect(f).toBeGreaterThanOrEqual(2), expect(f).toBeLessThanOrEqual(9);
    expect(Math.abs(e.vx)).toBeGreaterThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// 结构锁：两处修复的源文本锚（防静默回退）
// ---------------------------------------------------------------------------
describe('BJ706-A 结构锁（源文本锚）', () => {
  const gameDir = fileURLToPath(new URL('../src/', import.meta.url));
  it('bossAI_dd2.ts 悬空向量 = 原差域式（dy − hoverUp,非单位向量域 vy1 − hoverUp）', () => {
    const src = readFileSync(`${gameDir}entities/bossAI_dd2.ts`, 'utf8');
    expect(src).toContain('let hvx = dx, hvy = dy - p.hoverUp;');
    expect(src).not.toContain('hvy = vy1 - p.hoverUp');
  });
  it('Enemy.ts：DD2 walker 14 型分派 + 帧机在场（564/565 魔法师与 620 鲨不入）', () => {
    const src = readFileSync(`${gameDir}entities/Enemy.ts`, 'utf8');
    expect(src).toContain('(vid >= 552 && vid <= 557) || (vid >= 561 && vid <= 563) || (vid >= 566 && vid <= 573)');
    expect(src).toContain('dd2WalkerFindFrame(): void');
    expect(src).toContain('this.customFrameIdx = f;');
  });
});
