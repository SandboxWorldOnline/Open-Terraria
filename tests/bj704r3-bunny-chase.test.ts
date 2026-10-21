// ★BJ704-R3 P1②（2026-10-21 红蓝审查）判别锁：614 爆炸兔追险情互换支。
//  定谳：vanilla NPC.cs:54049-54061 对 614 的 num13/num14 槽位【互换写入】——
//  左距入 num14/右距入 num13,守卫跨侧互斥（先见侧独占,两侧槽永不并存）→
//  num15（:54103 同式）反转 → direction=-num15（:54156-54163;flag2=感染种
//  向导专属 :53684,614 恒 false）=【追险情】——爆炸兔冲向敌怪送死引爆=物品
//  1338 武器语义。★仅 NPC 支互换:玩家 stinky 支（:54088-54100）原版无 614
//  特判=照常逃离。旧仓恒逃（BJ703-C D3 只接了危险速度档 1.5/0.1,方向没换）
//  =「跑得快但方向反」。R3 探针实证:右侧僵尸→SW facing=-1 vs 原版应 +1。
//  ★行为判据=接敌距离:追击态会【穿过险情并绕靶往复追击】（过靶 dx 翻号→
//  下一拍再翻向,facing 依拍振荡）——不能用「单调位移+恒 facing」（那是逃逸
//  形状）。逃逸态距离单调不减。★变异自证：M1 回无互换原形 → §1 恰红。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(__dirname, '..');
const NPC_1457 = join(ROOT, '../Terarria1457/Terraria/NPC.cs');
const EXT_MISSING = !existsSync(NPC_1457);
const npc1457 = EXT_MISSING ? '' : readFileSync(NPC_1457, 'utf8');
const enemySrc = readFileSync(join(ROOT, 'src/entities/Enemy.ts'), 'utf8');

const TILE = 16;

function critterWorld() {
  const w = new World(80, 140, 42, 'open');
  w.groundLevel = 42;
  const st = w.store;
  for (let x = 10; x <= 70; x++) st.setTileSilent(x, 60, 2);
  const hooks = {
    world: w, player: null,
    playSfx: () => {}, addDamageNumber: () => {}, spawnParticles: () => {},
    spawnDrop: () => null, damagePlayer: (): number => 0,
    entities: { add: () => {} },
    enemies: () => [] as unknown[],
  } as never;
  return { hooks };
}

function fakeEnemy(x: number, y: number): unknown {
  return {
    dead: false, x, y, w: 20, h: 20, cx: x + 10, cy: y + 10,
    vanillaId: 3, vanilla: { aiStyle: 3, noGravity: false },
    def: { damage: 5, friendly: false },
    noTileCollide: false,
  };
}

function withDanger(hooks: never, src: unknown): never {
  return { ...(hooks as Record<string, unknown>), enemies: () => [src] } as never;
}

/** 无险稳定态（测量期才注入险情——追击判据须以注入拍距离为基线） */
function spawnWalker(vid: number, hooks: never, x = 40): Enemy {
  const e = Enemy.fromVanilla(vid, x * TILE, 58 * TILE)!;
  for (let t = 0; t < 40; t++) e.fixedUpdate(1 / 60, hooks);
  return e;
}

/** 驱动 120t 带 险情 hooks,回 (minDist, facingSet) */
function driveWithDanger(e: Enemy, h: never, dangerCx: number) {
  const dist0 = Math.abs(e.cx - dangerCx);
  let minDist = Infinity;
  const facings = new Set<number>();
  for (let t = 0; t < 120; t++) {
    e.fixedUpdate(1 / 60, h);
    minDist = Math.min(minDist, Math.abs(e.cx - dangerCx));
    facings.add(e.facing);
  }
  return { dist0, minDist, facings };
}

describe('§1 614 追险情（M1 位:互换支行为面）', () => {
  it('右侧敌怪 → 614 接敌（minDist 大幅缩短,过靶往复;旧逃离形=距离单调不减）', () => {
    const { hooks } = critterWorld();
    const e = spawnWalker(614, hooks, 40);
    const h = withDanger(hooks, fakeEnemy(46 * TILE, 58 * TILE));
    const { minDist } = driveWithDanger(e, h, 46 * TILE + 10);
    expect(minDist).toBeLessThan(45);          // 到达险情（逃逸形恒 ≥dist0≈90+）
  });
  it('左侧敌怪 → 614 接敌（双侧镜像）', () => {
    const { hooks } = critterWorld();
    const e = spawnWalker(614, hooks, 40);
    const h = withDanger(hooks, fakeEnemy(34 * TILE, 58 * TILE));
    const { minDist } = driveWithDanger(e, h, 34 * TILE + 10);
    expect(minDist).toBeLessThan(45);
  });
  it('非 614 小动物（46 兔）→ 不接敌（minDist≈dist0,逃离原语义不变）', () => {
    const { hooks } = critterWorld();
    const e = spawnWalker(46, hooks, 40);
    const h = withDanger(hooks, fakeEnemy(46 * TILE, 58 * TILE));
    const { dist0, minDist } = driveWithDanger(e, h, 46 * TILE + 10);
    expect(minDist).toBeGreaterThan(dist0 - 10);   // 无任何接近拍（逃逸=距离不减）
  });
});

describe('§2 结构锁（M1 位:槽位互换形态）', () => {
  it('NPC 支带 swap614 双行互换;玩家 stinky 支【无】互换（原版 quirk）', () => {
    // NPC 支（互换,恰各 1 处）:
    expect(enemySrc).toContain('const swap614 = vid === 614;');
    expect((enemySrc.match(/\{ if \(swap614\) rightDelta = dx; else leftDelta = dx; \}/g) ?? []).length).toBe(1);
    expect((enemySrc.match(/\{ if \(swap614\) leftDelta = dx; else rightDelta = dx; \}/g) ?? []).length).toBe(1);
    // 玩家 stinky 支（直赋原形各恰 1 行=该支两行;NPC 支若回退直赋则计数 2 → 红）
    expect((enemySrc.match(/if \(dx < 0 && \(leftDelta === -1 \|\| dx > leftDelta\)\) leftDelta = dx;/g) ?? []).length).toBe(1);
    expect((enemySrc.match(/if \(dx > 0 && \(rightDelta === -1 \|\| dx < rightDelta\)\) rightDelta = dx;/g) ?? []).length).toBe(1);
  });
  it('num15 式与 facing 三消费位不动锚（互换在槽位不在公式）', () => {
    expect(enemySrc).toContain('dangerDir = leftDelta === -1 ? 1');
    expect((enemySrc.match(/this\.facing = -dangerDir;/g) ?? []).length).toBe(2);
    expect(enemySrc).toContain('if (this.facing === -dangerDir)');
  });
});

describe('§3 反编译锚（外部源在位时）', () => {
  it('614 互换块/num15 式/flag2 感染种向导专属', () => {
    if (EXT_MISSING) return;
    // 互换块锚=扫描段独有的 num14=num18 写位（SetDefaults 的 if(type==614) 无此面）
    const i = npc1457.indexOf('num14 = num18');
    expect(i).toBeGreaterThan(-1);
    const blk = npc1457.slice(Math.max(0, i - 250), i + 400);
    expect(blk).toContain('if (type == 614)');   // 互换确在 614 特判块内
    expect(blk).toMatch(/if \(num18 < 0f && \(num13 == -1f \|\| num18 > num13\)\)/);
    expect(blk).toMatch(/if \(num18 > 0f && \(num14 == -1f \|\| num18 < num14\)\)/);
    expect(blk).toMatch(/num13 = num18;\s*num16 = m;/);
    // num15 同式（互换消费面）
    expect(npc1457).toContain('num15 = ((num13 == -1f) ? 1 : ((num14 != -1f) ? (num14 < 0f - num13).ToDirectionInt() : (-1)))');
    // flag2 置位=感染种向导专属（:53684 Main.infectedSeed && type == 20）
    const k = npc1457.indexOf('if (Main.infectedSeed && type == 20)');
    expect(k).toBeGreaterThan(-1);
    expect(npc1457.slice(k, k + 200)).toContain('flag2 = true');
  });
});
