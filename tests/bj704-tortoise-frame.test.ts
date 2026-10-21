// ★BJ704（2026-10-21 用户实报「巨型陆龟某些行动模式贴图倒着走+正常行走时
//  边走边缩龟壳」）判别锁。
//  定谳：AI_039 陆龟族（153/154/496/497）仓内【零 FindFrame 路由】——
//  ① 倒走=态 3 旋冲 visAngle 累计经 justHit 直跳态 0 后无人清角（原版 FindFrame
//    态 0 头 :78097 `rotation=0f` 每帧复位=唯一回收点,仓内缺失 → 残留 π 量级
//    累计角倒挂行走）;
//  ② 缩壳混播=渲染层无专支落通用年龄循环,8 帧表连播走带(0-4)+缩壳带(5-7)
//    （533 支同病先例）。
//  修=Enemy.tortoiseFindFrameStep（NPC.cs:78093-78162 逐字:type≠417;态 0
//  rotation=0+|vx|×1.1 带 6/12/18/24/32→帧 0-4,vy<0 锁 0;态 1 缩壳 5→6→7;
//  态 5 出壳 7→6→5;态 3/4 恒壳 7）+findFrameRotation 接线+Renderer 帧行读取支。
//  ★变异自证：M1 摘态 0 visAngle=0 → §2 红;M2 摘 findFrameRotation 接线 → §1 红。
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
const rendererSrc = readFileSync(join(ROOT, 'src/render/Renderer.ts'), 'utf8');

const TILE = 16;

function tortoiseWorld() {
  const w = new World(80, 140, 42, 'open');
  w.groundLevel = 42;
  const st = w.store;
  for (let x = 10; x <= 70; x++) st.setTileSilent(x, 60, 2);
  const hooks = {
    world: w,
    player: null,
    playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
    spawnParticles: () => {}, spawnDust: () => null, spawnDrop: () => null,
    damagePlayer: (): number => 0, onEnemyKilled: () => {},
    entities: { add: () => {} },
    enemies: () => [] as unknown[],
  } as never;
  return { hooks };
}

type Tortoise = Enemy & { tortoiseFrame: number; tortoiseFrameT: number; visAngle: number; ai0: number; ai1: number; justHitT: number };

function spawnTortoise(vid: number, hooks: never, x = 40): Tortoise {
  return Enemy.fromVanilla(vid, x * TILE, 58 * TILE)! as Tortoise;
}

describe('§1 走带帧机（M2 位:接线在,帧不入缩壳带）', () => {
  it('态 0 行走:帧恒在走带 0-4,按 |vx|×1.1 带推进（旧通用循环=8 帧连播混壳带）', () => {
    const { hooks } = tortoiseWorld();
    const e = spawnTortoise(153, hooks);
    for (let t = 0; t < 40; t++) e.fixedUpdate(1 / 60, hooks);   // 落地稳定态（态 0）
    expect(e.ai0).toBe(0);
    const seen: number[] = [];
    for (let t = 0; t < 90; t++) {
      e.vx = 2;                                                   // 恒速行走驱动
      e.fixedUpdate(1 / 60, hooks);
      seen.push(e.tortoiseFrame);
    }
    expect(Math.max(...seen)).toBeLessThanOrEqual(4);             // 走带 0-4（壳带 5-7 恒不达=主诉②）
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    expect(new Set(seen).size).toBeGreaterThanOrEqual(4);         // 带内推进（|vx|×1.1=2.2/t,90t 足够走满带）
    expect(e.visAngle).toBe(0);                                   // 态 0 逐帧清（主诉①回收点）
  });
  it('态 1 缩壳递进 5→6→7;态 5 出壳反序 7→6→5;态 3 恒壳 7', () => {
    const { hooks } = tortoiseWorld();
    const e = spawnTortoise(153, hooks);
    for (let t = 0; t < 10; t++) e.fixedUpdate(1 / 60, hooks);
    e.ai0 = 1; e.ai1 = 5; e.fixedUpdate(1 / 60, hooks);
    expect(e.tortoiseFrame).toBe(5);                             // ai1<10
    e.ai1 = 15; e.fixedUpdate(1 / 60, hooks);
    expect(e.tortoiseFrame).toBe(6);                             // 10≤ai1<20
    e.ai1 = 25; e.fixedUpdate(1 / 60, hooks);
    expect(e.tortoiseFrame).toBe(7);                             // ≥20
    e.ai0 = 5; e.ai1 = 5; e.fixedUpdate(1 / 60, hooks);
    expect(e.tortoiseFrame).toBe(7);                             // 出壳反序
    e.ai1 = 25; e.fixedUpdate(1 / 60, hooks);
    expect(e.tortoiseFrame).toBe(5);
    e.ai0 = 3; e.fixedUpdate(1 / 60, hooks);
    expect(e.tortoiseFrame).toBe(7);                             // 旋冲恒壳
  });
});

describe('§2 倒走根因：justHit 出旋冲残角回收（M1 位）', () => {
  it('态 3 累计 π 角 + justHit 直跳态 0 → 下一帧 visAngle=0（旧缺复位=倒挂行走）', () => {
    const { hooks } = tortoiseWorld();
    const e = spawnTortoise(153, hooks);
    for (let t = 0; t < 10; t++) e.fixedUpdate(1 / 60, hooks);
    e.ai0 = 3; e.ai1 = 40;
    e.visAngle = Math.PI;                                        // 旋冲累计角（:8035 累计面）
    e.justHitT = 2;                                              // justHit（hurt 置 2 同源）
    e.fixedUpdate(1 / 60, hooks);                                // tortoiseAI:justHit → ai0=0
    expect(e.ai0).toBe(0);                                       // 直跳态 0（不经态 5）
    e.fixedUpdate(1 / 60, hooks);                                // findFrameRotation 态 0 → visAngle=0
    expect(e.visAngle).toBe(0);                                  // 残角回收（主诉①）
    expect(e.tortoiseFrame).toBeLessThanOrEqual(4);              // 回走带
  });
});

describe('§3 结构锁', () => {
  it('findFrameRotation 接线+帧机形态+Renderer 帧行支', () => {
    expect(enemySrc).toContain('tortoiseFindFrameStep();   // ★BJ704 陆龟族帧机+态 0 rotation 复位');
    expect(enemySrc).toContain('this.visAngle = 0;                                   // :78097');
    expect(enemySrc).toContain('this.tortoiseFrameT += Math.abs(this.vx) * 1.1;');
    expect(rendererSrc).toContain('id === 153 || id === 154 || id === 496 || id === 497');
    expect(rendererSrc).toContain('tortoiseFrame: number }).tortoiseFrame');
  });
});

describe('§4 反编译锚（外部源在位时）', () => {
  it('FindFrame aiStyle 39:type≠417 门/态 0 rotation=0/带 6-12-18-24-32/壳带 5-7', () => {
    if (EXT_MISSING) return;
    const i = npc1457.indexOf('if (aiStyle == 39 && type != 417)');
    expect(i).toBeGreaterThan(-1);
    const blk = npc1457.slice(i, i + 1200);
    expect(blk).toContain('rotation = 0f;');                     // :78097
    expect(blk).toContain('frameCounter += Math.Abs(velocity.X) * 1.1f;');
    for (const b of ['frameCounter < 6.0', 'frameCounter < 12.0', 'frameCounter < 18.0', 'frameCounter < 24.0', 'frameCounter < 32.0']) {
      expect(blk).toContain(b);
    }
    expect(blk).toMatch(/frame\.Y = num \* 5/);                  // 壳带 5-7
    expect(blk).toMatch(/frame\.Y = num \* 7/);
  });
});
