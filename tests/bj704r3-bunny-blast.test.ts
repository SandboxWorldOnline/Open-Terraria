// ★BJ704-R3 P1②b（2026-10-21 红蓝审查+主会话清偿）判别锁：614 爆炸兔死亡爆弹。
//  定谳：vanilla checkDead case 614（NPC.cs:80182-80191）——【任意死因】的兔 614
//  皆炸:NewProjectile(Center,0,0,281,175,kb 0,owner=myPlayer,ai[0]=-2,
//  ai[1]=releaseOwner+1;SpawnedFromStatue→dmg 0)。弹体 AI_049 头（:28651-28656）
//  ai[0]==-2 → hostile+Kill 即灭;Kill case 281（:77327-77384）:FX（Sound4+Item14
//  +gore76/77+61-63 四向+20 尘31+10×2 尘6）∧ dmg>0 → 盒扩 128×128 心保持 →
//  CutTiles（Damage() :12515-18 内建）→ Damage()（idStatic 10）→ 玩家门
//  ai[1]-1==myPlayer（=释放者）∨ getGoodWorld（:14873-77）。
//  ★变异自证：M1 摘 Enemy 死亡支 → §1 红;M2 摘 Arrow 281 分发支 → §2 红;
//  M3 盒 128→28 → §2 远位敌红。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { Arrow } from '../src/entities/Arrow';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(__dirname, '..');
const NPC_1457 = join(ROOT, '../Terarria1457/Terraria/NPC.cs');
const P_1457 = join(ROOT, '../Terarria1457/Terraria/Projectile.cs');
const EXT_MISSING = !existsSync(NPC_1457) || !existsSync(P_1457);
const npc1457 = EXT_MISSING ? '' : readFileSync(NPC_1457, 'utf8');
const proj1457 = EXT_MISSING ? '' : readFileSync(P_1457, 'utf8');
const enemySrc = readFileSync(join(ROOT, 'src/entities/Enemy.ts'), 'utf8');
const arrowSrc = readFileSync(join(ROOT, 'src/entities/Arrow.ts'), 'utf8');

const TILE = 16;

/** 世界+全录制 hooks（entities.add/damagePlayer/音/尘/粒）+可选敌怪表 */
function blastWorld(enemies: unknown[] = []) {
  const w = new World(80, 140, 42, 'open');
  w.groundLevel = 42;
  const st = w.store;
  for (let x = 10; x <= 70; x++) st.setTileSilent(x, 60, 2);
  const rec = {
    spawned: [] as unknown[], playerHits: [] as number[],
    sfx: [] as string[], sfxFiles: [] as string[], dust: 0,
  };
  const playerStub = {
    x: 41 * TILE, y: 58 * TILE, w: 20, h: 42, cx: 41 * TILE + 10, cy: 58 * TILE + 21,
    luck: 0, hp: 400, maxHp: 400, mana: 100, maxMana: 100,
    dead: false, immune: false, buffs: new Set(), addDPS: () => {},
  };
  const hooks = {
    world: w,
    player: playerStub,
    playSfx: (name: string) => { rec.sfx.push(name); },
    playSfxFiles: (names: string[]) => { rec.sfxFiles.push(...names); },
    addDamageNumber: () => {}, spawnParticles: () => {},
    onEnemyKilled: () => {},
    spawnDust: () => { rec.dust++; return null; },
    spawnDrop: () => null,
    damagePlayer: (d: number) => { rec.playerHits.push(d); return 1; },
    entities: { add: (e: unknown) => { rec.spawned.push(e); } },
    enemies: () => enemies,
  } as never;
  return { w, hooks, rec };
}

describe('§1 Enemy 死亡支：任意死因 → 281 出生参数（M1 位）', () => {
  it('野兔 die() → Arrow(281, dmg175, form-2, owner256, 心锚−14)', () => {
    const { hooks, rec } = blastWorld();
    const bunny = Enemy.fromVanilla(614, 40 * TILE, 58 * TILE)!;
    bunny.releasedFromItem = false;
    bunny.spawnedFromStatue = false;
    bunny.die(hooks as never);
    expect(rec.spawned).toHaveLength(1);
    const b = rec.spawned[0] as Arrow & { bunnyBlastForm: number; bunnyOwner: number };
    expect(b.projId).toBe(281);
    expect(b.damage).toBe(175);
    expect(b.bunnyBlastForm).toBe(-2);
    expect(b.bunnyOwner).toBe(256);                       // 野兔 255+1
    expect(b.x).toBeCloseTo(bunny.cx - 14, 5);            // Center−28/2（NewProjectile 心位）
    expect(b.y).toBeCloseTo(bunny.cy - 14, 5);
  });
  it('雕像兔 dmg=0;释放兔 owner=1（可炸释放者）', () => {
    const { hooks, rec } = blastWorld();
    const statue = Enemy.fromVanilla(614, 40 * TILE, 58 * TILE)!;
    statue.spawnedFromStatue = true;
    statue.die(hooks as never);
    expect((rec.spawned[0] as Arrow).damage).toBe(0);
    const rel = Enemy.fromVanilla(614, 44 * TILE, 58 * TILE)!;
    rel.releasedFromItem = true;
    rel.die(hooks as never);
    expect((rec.spawned[1] as Arrow & { bunnyOwner: number }).bunnyOwner).toBe(1);
  });
});

describe('§2 Arrow 281 爆炸：128 盒 AOE + FX + 玩家门（M2/M3 位）', () => {
  it('FX 纯净面（无敌在场）:Sound4+Item14+恰 40 尘+owner256 不炸玩家', () => {
    const { hooks, rec } = blastWorld();                  // 敌表空=零目标侧 FX 混入
    const b = new Arrow(40 * TILE, 58 * TILE, 0, 0, 175, 0, 281, {});
    (b as unknown as { bunnyBlastForm: number }).bunnyBlastForm = -2;
    (b as unknown as { bunnyOwner: number }).bunnyOwner = 256;
    b.fixedUpdate(1 / 60, hooks as never);
    expect(b.dead).toBe(true);                            // 即灭（AI_049 -2 → Kill）
    expect(rec.sfx).toContain('killed');                  // :77330 PlaySound(4)
    expect(rec.sfxFiles).toContain('Item_14');            // :77337
    expect(rec.dust).toBe(40);                            // 20 尘31 + 10×2 尘6（恰数）
    expect(rec.playerHits).toHaveLength(0);               // 野兔不可炸玩家（:14873 门）
  });
  it('128 盒 AOE:盒内高血敌掉血/盒外敌无伤', () => {
    const near = Enemy.fromVanilla(3, 41 * TILE, 58 * TILE)!;    // 距爆心 ~26px
    const far = Enemy.fromVanilla(3, 50 * TILE, 58 * TILE)!;     // 距爆心 ~166px > 64
    near.hp = 5000;                                       // 高血靶防死亡 FX 混入
    const { hooks } = blastWorld([near, far]);
    const nearHp0 = near.hp, farHp0 = far.hp;
    const b = new Arrow(40 * TILE, 58 * TILE, 0, 0, 175, 0, 281, {});
    (b as unknown as { bunnyBlastForm: number }).bunnyBlastForm = -2;
    (b as unknown as { bunnyOwner: number }).bunnyOwner = 256;
    b.fixedUpdate(1 / 60, hooks as never);
    expect(b.dead).toBe(true);
    expect(near.hp).toBeLessThan(nearHp0);                // 128 盒内 AOE 结算
    expect(far.hp).toBe(farHp0);                          // 盒外零伤
  });
  it('owner=1（释放者）→ 炸玩家;getGoodWorld 强开野兔面', () => {
    const z0 = Enemy.fromVanilla(3, 41 * TILE, 58 * TILE)!;
    const a = blastWorld([z0]);
    const bA = new Arrow(40 * TILE, 58 * TILE, 0, 0, 175, 0, 281, {});
    (bA as unknown as { bunnyBlastForm: number }).bunnyBlastForm = -2;
    (bA as unknown as { bunnyOwner: number }).bunnyOwner = 1;
    bA.fixedUpdate(1 / 60, a.hooks as never);
    expect(a.rec.playerHits.length).toBe(1);              // 释放者可被炸
    const z1 = Enemy.fromVanilla(3, 41 * TILE, 58 * TILE)!;
    const c = blastWorld([z1]);
    (c.w as unknown as { seedFlags: Record<string, boolean> }).seedFlags = { getGoodWorld: true };
    const bC = new Arrow(40 * TILE, 58 * TILE, 0, 0, 175, 0, 281, {});
    (bC as unknown as { bunnyBlastForm: number }).bunnyBlastForm = -2;
    (bC as unknown as { bunnyOwner: number }).bunnyOwner = 256;
    bC.fixedUpdate(1 / 60, c.hooks as never);
    expect(c.rec.playerHits.length).toBe(1);              // ftw 强开
  });
  it('雕像 dmg=0 → 纯 FX 零伤（敌不掉血不炸玩家）', () => {
    const z = Enemy.fromVanilla(3, 41 * TILE, 58 * TILE)!;
    const { hooks, rec } = blastWorld([z]);
    const hp0 = z.hp;
    const b = new Arrow(40 * TILE, 58 * TILE, 0, 0, 0, 0, 281, {});
    (b as unknown as { bunnyBlastForm: number }).bunnyBlastForm = -2;
    (b as unknown as { bunnyOwner: number }).bunnyOwner = 1;
    b.fixedUpdate(1 / 60, hooks as never);
    expect(b.dead).toBe(true);
    expect(z.hp).toBe(hp0);
    expect(rec.playerHits).toHaveLength(0);
    expect(rec.sfxFiles).toContain('Item_14');            // FX 照放
  });
});

describe('§3 结构锁', () => {
  it('Enemy 死亡支/AI_049 分发支/盒扩 128 形态在位', () => {
    expect(enemySrc).toContain('bunnyBlastForm = -2;');
    expect(enemySrc).toMatch(/vanillaId === 614[\s\S]{0,200}new Arrow\(this\.cx - 14, this\.cy - 14/);
    expect(arrowSrc).toContain('this.bunnyBlastExplode(game);');
    expect(arrowSrc).toContain('this.w = 128; this.h = 128;');
    expect(arrowSrc).toContain('cutTilesBox(game, this.x, this.y, this.w, this.h, 281)');
  });
});

describe('§4 反编译锚（外部源在位时）', () => {
  it('checkDead case 614 / AI_049 -2 / Kill 128 盒 / 玩家门', () => {
    if (EXT_MISSING) return;
    const i = npc1457.indexOf('int num2 = 175;');   // checkDead case 614 体内（首现唯此块）
    expect(i).toBeGreaterThan(-1);
    const blk = npc1457.slice(i - 40, i + 460);
    expect(blk).toContain('int num2 = 175;');
    expect(blk).toContain('if (SpawnedFromStatue)');
    expect(blk).toMatch(/NewProjectile\([\s\S]{0,200}281, num2, 0f, Main\.myPlayer, -2f, releaseOwner \+ 1/);
    const j = proj1457.indexOf('else if (aiStyle == 49)');
    const a49 = proj1457.slice(j, j + 400);
    expect(a49).toContain('if (this.ai[0] == -2f)');
    expect(a49).toMatch(/hostile = true;\s*Kill\(\);/);
    const k = proj1457.indexOf('num757 = Gore.NewGore');   // Kill() 281 支内（:77332,num757 全卷唯一）
    expect(k).toBeGreaterThan(-1);
    const kb = proj1457.slice(k - 200, k + 3300);   // 四向 gore 60+ 行后才是盒扩段,窗口放宽
    expect(kb).toContain('else if (type == 281)');         // Kill() else-if 链支（非 switch case）
    expect(kb).toContain('if (ai[0] != -3f)');
    expect(kb).toContain('width = 128;');
    expect(kb).toContain('height = 128;');
    expect(kb).toContain('if (ai[0] == -2f)');
    expect(kb).toContain('Damage();');
    expect(proj1457).toContain('flag = ai[1] - 1f == (float)myPlayer;');   // :14873
  });
});
