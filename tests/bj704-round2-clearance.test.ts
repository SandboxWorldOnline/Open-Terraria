// ★BJ704 二轮审查清偿判别锁（R9-P1×2 + R12-P2-1,2026-10-21 主会话）。
//  · R9-P1-1：614 跳跃第二 ×1.2 缺 TownCritter 门（:54754 原=vy<0∧TownCritter∧!rat;
//    D7 集判据刀漏同 AI 第五消费面 → 614 干跳 -7.2 vs 原版 -6.0）
//  · R9-P1-2：D10 friendly 投影对静态 true 捕获型错档 → 蚯蚓族玩家永不可打
//    （原版 SubAI :91649-70 每拍强写 friendly=(窗>0),静态位被完全覆写;
//    真投影 = catchable ? 窗 : 静态）
//  · R12-P2-1：巨贝 496/497 走态 FindFrame 双段双增量（case :70776-846 先 += 且
//    ≥24 回卷,尾段 :78093+ 再 += 覆写帙）——走态 ~2×速、帧 4 仅 ~1t 闪现;
//    153/154 单增量勿连坐。
//  ★变异自证：M1 回 `!rat` 恒乘 → §1 红;M2 回静态∪窗 → §2 红;M3 摘 shellyDouble
//  第一增量 → §3 红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { playerCanHitEnemy } from '../src/entities/projTargets';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(__dirname, '..');
const enemySrc = readFileSync(join(ROOT, 'src/entities/Enemy.ts'), 'utf8');
const projTargetsSrc = readFileSync(join(ROOT, 'src/entities/projTargets.ts'), 'utf8');

const TILE = 16;

function hooksWith(player: unknown, enemies: unknown[] = []) {
  const w = new World(80, 140, 42, 'open');
  w.groundLevel = 42;
  const st = w.store;
  for (let x = 10; x <= 70; x++) st.setTileSilent(x, 60, 2);
  return {
    world: w,
    player,
    playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
    spawnParticles: () => {}, spawnDust: () => null, spawnDrop: () => null,
    damagePlayer: (): number => 0, onEnemyKilled: () => {},
    entities: { add: () => {} },
    enemies: () => enemies,
  } as never;
}

const PLAYER_STUB = {
  x: 10 * TILE, y: 58 * TILE, w: 20, h: 42, cx: 10 * TILE + 10, cy: 58 * TILE + 21,
  luck: 0, hp: 400, maxHp: 400, mana: 100, maxMana: 100,
  dead: false, immune: false, buffs: new Set(), addDPS: () => {},
};

describe('§1 614 跳跃无第二乘（M1 位）', () => {
  it('墙驱 1 格障碍跳:46 兔 ×1.2 跳更高 vs 614 原值（差 ≥0.8=乘法门判别）', () => {
    const mk = (vid: number) => {
      const w = new World(80, 140, 42, 'open');
      w.groundLevel = 42;
      const st = w.store;
      for (let x = 10; x <= 70; x++) st.setTileSilent(x, 60, 2);   // 地板
      // 两层墙栈（rows 58+59,col 41-42）:贴地行走者 num27=59 → t4(58)=T,t5(57)=F
      // → 「1-格墙」支 vy=-5（真 1 层墙=StepUp 台阶不跳;探测列=center+15px→tile 41）
      st.setTileSilent(41, 58, 1); st.setTileSilent(42, 58, 1);
      st.setTileSilent(41, 59, 1); st.setTileSilent(42, 59, 1);
      const hooks = {
        world: w, player: null,
        playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
        spawnParticles: () => {}, spawnDust: () => null, spawnDrop: () => null,
        damagePlayer: (): number => 0, onEnemyKilled: () => {},
        entities: { add: () => {} }, enemies: () => [] as unknown[],
      } as never;
      const e = Enemy.fromVanilla(vid, 40 * TILE, 58 * TILE)!;
      e.ai0 = 1;                                   // 行走态原地沉降（站立态有 restSpot 钉=悬空 16px 假地形）
      for (let t = 0; t < 40; t++) { e.vx = 0; e.fixedUpdate(1 / 60, hooks); }
      e.x = 40 * TILE; e.y = 960 - e.h;            // 沉降漂移归位（bottom=960 贴地,num27=59）
      e.ai0 = 1; e.ai1 = 90; e.vx = 1; e.facing = 1;
      return { e, hooks };
    };
    const a = mk(614), b = mk(46);
    a.e.fixedUpdate(1 / 60, a.hooks);
    b.e.fixedUpdate(1 / 60, b.hooks);
    expect(a.e.vy).toBeGreaterThan(-6);            // 614 障碍跳 -5 原值（含重力上浮;不乘）
    expect(b.e.vy).toBeLessThan(a.e.vy - 0.8);     // 46 ×1.2=-6（TownCritter 门）
  });
});

describe('§2 蚯蚓窗外可打（M2 位）', () => {
  it('357 蚯蚓：窗内 catchFriendly=true 免打;窗外（计数耗尽）→ playerCanHitEnemy=true', () => {
    const worm = Enemy.fromVanilla(357, 40 * TILE, 58 * TILE)!;
    expect(worm.def.friendly).toBe(true);                    // 静态 true 捕获型（病灶前提）
    worm.catchImmunityT = 50; worm.catchFriendly = true;     // 窗内
    expect(playerCanHitEnemy(worm as never, hooksWith(PLAYER_STUB) as GameHooks, 0)).toBe(false);
    worm.catchImmunityT = 0; worm.catchFriendly = false;     // 窗外（SubAI 稳态）
    expect(playerCanHitEnemy(worm as never, hooksWith(PLAYER_STUB) as GameHooks, 0)).toBe(true);   // 旧投影恒 false=永不可打
    const z = Enemy.fromVanilla(3, 40 * TILE, 58 * TILE)!;   // 非捕获敌怪不受辖
    expect(playerCanHitEnemy(z as never, hooksWith(PLAYER_STUB) as GameHooks, 0)).toBe(true);
  });
});

describe('§3 巨贝双增量节拍（M3 位）', () => {
  it('proto 直驱 13 步（vx=1）:496 双增量过 24 已回卷（3.3）vs 153 单增量 14.3 未回卷', () => {
    const h = hooksWith(null);
    const step = (vid: number) => {
      const e = Enemy.fromVanilla(vid, 40 * TILE, 58 * TILE)!;
      e.ai0 = 0; e.vy = 0; e.vx = 1;
      const fn = (e as unknown as { tortoiseFindFrameStep: () => void }).tortoiseFindFrameStep;
      for (let t = 0; t < 13; t++) fn.call(e);
      return (e as unknown as { tortoiseFrameT: number }).tortoiseFrameT;
    };
    expect(step(496)).toBeCloseTo(3.3, 5);         // 12 拍 case 侧 25.3≥24 回卷→0,尾段 1.1;13 拍 3.3
    expect(step(153)).toBeCloseTo(14.3, 5);        // 单增量 13×1.1（无 case 块不回卷）
  });
});

describe('§4 结构锁', () => {
  it('三刀形态在位', () => {
    expect(enemySrc).toContain('!rat && (this.vanillaId !== null && TOWN_CRITTER_IDS.has(this.vanillaId))) this.vy *= 1.2');
    expect(projTargetsSrc).toContain('const friendlyEff = vid !== undefined && vid !== null && NPC_CATCHABLE.has(vid)');
    expect(enemySrc).toContain('const shellyDouble = vid === 496 || vid === 497;');
    expect(enemySrc).toContain('if (this.tortoiseFrameT >= 24) this.tortoiseFrameT = 0;   // :70807-70810 case 侧 ≥24 回卷');
  });
});
