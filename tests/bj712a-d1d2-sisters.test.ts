// ★BJ712-A D1/D2 姊妹面判别锁（2026-10-24 火星暴乱核报第 1 条+弓手唤醒）。
//  D1 火星无人机自爆:vanilla :35795 GetAttackDamage_ScaledByDifficulty(80f)
//  =80/160/240——旧钉死 80 无门。修=getAttackDamageScaledByDifficulty(80, difficulty)。
//  D2 邪教弓手唤醒:vanilla :56794 damage=defDamage（ScaleStats 后快照）。522 缩放
//  链亲读钉死=**120/180/270**（EnemyDamageMultiplier ×2/×3 先乘 → 教徒支 num=0.75
//  remap 钳在专家段;BJ712-A 登记 note 的「90/.../270」classic 端误推 0.75 先乘）;
//  待机段
//  只写 damage=0 不动快照——旧唤醒回写 vanilla 基值 120（专家/大师错,经典巧合对）。
//  修=待机零伤前 WeakMap 快照,唤醒恢复快照。
//  ★M1 变异:自爆回钉死 80 → §1 红;M2 唤醒回 vanilla 基值 → §2 红。
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { getAttackDamageScaledByDifficulty, bindScaleStatsWorld, scaleStatsWorldOf } from '../src/stats/ScaleStats';
import { cultistArcherStandbyAI, cultistArcherWake } from '../src/entities/bossAI_lunar_misc';
import type { GameHooks } from '../src/entities/types';

const GAME = join(__dirname, '..');
const martianSrc = readFileSync(join(GAME, 'src/entities/bossAI_martian.ts'), 'utf8');
const lunarSrc = readFileSync(join(GAME, 'src/entities/bossAI_lunar_misc.ts'), 'utf8');
const van = readFileSync(join(GAME, '../Terarria1457/Terraria/NPC.cs'), 'utf8');

/** 大师世界 hooks+就位玩家桩（难度在 fromVanilla 前定,ScaleStats 读 ctx） */
function masterWorld(px = 40 * TILE, py = 58 * TILE) {
  const w = new World(80, 140, 42, 'open');
  w.groundLevel = 42;
  w.difficulty = 2;                                       // 大师
  for (let x = 10; x <= 70; x++) w.store.setTileSilent(x, 60, 2);
  const player = {
    x: px - 10, y: py - 21, w: 20, h: 42, cx: px, cy: py,
    dead: false, buffs: new Set(),
  };
  bindScaleStatsWorld(scaleStatsWorldOf(w, () => false));   // ★测试须显式绑定（真实游戏=Game.afterWorldLoad;未绑定=CLASSIC_SCALE_WORLD 恒经典）
  return {
    world: w, player,
    playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
    spawnParticles: () => {}, spawnDust: () => null, spawnDrop: () => null,
    damagePlayer: (): number => 0, onEnemyKilled: () => {},
    entities: { add: () => {} },
    enemies: () => [] as unknown[],
  } as never;
}

const TILE = 16;

afterEach(() => { bindScaleStatsWorld(null); });   // 防绑定泄漏进后续测试

describe('§1 D1 火星无人机自爆难度缩放（M1 位）', () => {
  it('大师档:贴身 64px 转自爆 → def.damage=240（旧钉死 80）', () => {
    const h = masterWorld(40 * TILE, 58 * TILE);
    const e = Enemy.fromVanilla(388, 40 * TILE, 58 * TILE)!;   // 火星无人机（difficulty 随世界=2）
    e.fixedUpdate(1 / 60, h);                                   // bInit 首拍（ai0 归 0）
    for (let t = 0; t < 6; t++) e.fixedUpdate(1 / 60, h);       // 贴身转移门（player 在 64px 内）
    expect(e.ai0).toBe(3);                                      // 自爆态已入
    expect(e.def.damage).toBe(getAttackDamageScaledByDifficulty(80, e.difficulty));   // e.difficulty=3(大师 GDL 值域)→240
    expect(e.def.damage).toBe(240);
  });
  it('结构锁+反编译锚', () => {
    expect(martianSrc).toContain('getAttackDamageScaledByDifficulty(80, e.difficulty)');
    expect(martianSrc).not.toMatch(/e\.def\.damage = 80; *\/\/ GetAttackDamage/);
    expect(van).toContain('damage = GetAttackDamage_ScaledByDifficulty(80f);');
  });
});

describe('§2 D2 邪教弓手唤醒缩放恢复（M2 位）', () => {
  it('大师档:522 缩放终值 180 → 待机零伤（快照）→ 唤醒恢复 180（旧回基值 120）', () => {
    const h = masterWorld(10 * TILE, 58 * TILE);
    const e = Enemy.fromVanilla(522, 40 * TILE, 58 * TILE)!;
    expect(e.def.damage).toBe(270);                         // 120×3(EnemyDamageMult) → ×0.75（教徒支 remap 钳专家段）
    cultistArcherStandbyAI(e, h);                           // 待机:快照+零伤
    expect(e.def.damage).toBe(0);
    // ★BJ713-R14 P0 回归锁:多拍待机——无守卫时第 2 拍起快照捕获已置 0 的
    //  def.damage（中毒→唤醒回 0=弓手零接触伤;单拍夹具恰掩盖的盲区）
    cultistArcherStandbyAI(e, h);
    cultistArcherStandbyAI(e, h);
    cultistArcherStandbyAI(e, h);
    expect(e.def.damage).toBe(0);
    cultistArcherWake(e);                                   // 唤醒:恢复快照
    expect(e.def.damage).toBe(270);                         // 非 120/0（M2 回基值=红;R14 P0 无守卫=0 红）
  });
  it('经典对照:522 classic=120,待机/唤醒循环保持（旧码仅经典档巧合对）', () => {
    const w = new World(80, 140, 42, 'open');
    w.groundLevel = 42;
    for (let x = 10; x <= 70; x++) w.store.setTileSilent(x, 60, 2);
    const h = {
      world: w, player: null,
      playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
      spawnParticles: () => {}, spawnDust: () => null, spawnDrop: () => null,
      damagePlayer: (): number => 0, onEnemyKilled: () => {},
      entities: { add: () => {} }, enemies: () => [] as unknown[],
    } as never;
    const e = Enemy.fromVanilla(522, 40 * TILE, 58 * TILE)!;
    expect(e.def.damage).toBe(120);
    cultistArcherStandbyAI(e, h);
    cultistArcherWake(e);
    expect(e.def.damage).toBe(120);
  });
  it('反编译锚:522 教徒支 num=0.75（无 num2）+唤醒 damage=defDamage', () => {
    expect(van).toContain('damage = defDamage;');
    const i = van.indexOf('else if (type == 439 || type == 440 || (type >= 454 && type <= 459) || type == 522 || type == 523)');
    expect(i).toBeGreaterThan(-1);
    const blk = van.slice(i, i + 220);
    expect(blk).toContain('if (type != 522)');
    expect(blk).toContain('num = 0.75;');
    expect(blk).not.toMatch(/num2 = 0\.75;\s*num3 \*= CommonMasterBossLifeReduction;\s*\}\s*num = 0\.75;\s*\}[\s\S]{0,40}num = 0\.75/);   // 522 不吃 num2
  });
});
