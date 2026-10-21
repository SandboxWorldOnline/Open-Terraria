// ★BJ704-G14（2026-10-21）件2① [g11-trapshot-idstatic 残项①] TrapShot 281
//   usesIDStaticNPCImmunity=10 共享桶归一 + 件2③ 281/162 Kill 精确 FX 面 判别锁。
//  原版（1457 亲读）：
//   · SetDefaults 281（Projectile.cs:3678-3688）：idStaticNPCHitCooldown=10 /
//     usesIDStaticNPCImmunity=true / penetrate=-1。
//   · 头门（Damage_PVE :12595）：flag2 = IsNPCIndexImmuneToProjectileType(
//     immunityIdentity=281, i)——perIDStaticNPCImmunity[281]（:296 全场静态表）
//     ≤GameUpdateCount 才可击。
//   · 命中尾（:14031-14037）：penetrate!=1 → immune[owner]=0（清全局窗）+
//     perIDStaticNPCImmunity[281,victim]=GameUpdateCount+10 ——全场【所有 281】
//     共用一张表（TrapShot 活兔直击 / TrapShot 寿命爆 / Arrow 爆弹态三消费面
//     同表）。旧 TrapShot 私表 hitCdT = 多兔同敌各开一窗=双倍跳伤,随刀归一。
//   · Kill 281（:77327-77389）:Sound4+gore76/77+Item14+尘31×20+尘6×10 双档+
//     gore61-63×4+damage>0 门 128×128 Damage()（idStatic 窗）。
//   · Kill 162（:77391-77453）:Item14+64×64 Damage()+尘31×20+尘6×50+尘6×10+
//     gore×4+144×144 再 Damage()（两段间 immune[owner]=10 窗——162 pen=4≠1 末档）。
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TrapShot } from '../src/entities/Dart';
import { Arrow } from '../src/entities/Arrow';
import { World } from '../src/world/World';
import { pinGameTimeTicks, gameTickCount } from '../src/core/GameTime';

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const dartSrc = () => read('src/entities/Dart.ts');
const arrowSrc = () => read('src/entities/Arrow.ts');

const TILE = 16;

/** 世界 + 全录制 hooks（敌怪 hurt 记账/尘/音/gore 桩） */
function idStaticWorld(enemyIds: number[]) {
  const w = new World(80, 60, 42, 'open');
  w.groundLevel = 42;
  const hurts: Array<{ id: number; dmg: number }> = [];
  const dusts: Array<{ type: number; scale: number; noG: boolean }> = [];
  const sfx: string[] = [];
  const gores: number[] = [];
  const enemies = enemyIds.map((id) => ({
    id, vanillaId: 3, x: 40 * TILE, y: 40 * TILE, w: 24, h: 24, dead: false, iframes: 0,
    hurt: (d: number) => { hurts.push({ id, dmg: d }); return true; },
  }));
  const hooks = {
    world: w,
    player: { x: -500, y: -500, w: 20, h: 42, dead: true, cx: -490, cy: -479, luck: 0,
      buffs: new Set(), inv: {} },
    enemies: () => enemies,
    critters: () => [], npcs: () => [],
    playSfx: (n: string) => { sfx.push(n); },
    playSfxFiles: (ns: string[]) => { sfx.push(...ns); },
    spawnDust: (_x: number, _y: number, _w: number, _h: number, type: number,
      _vx: number, _vy: number, _a: number, _c: unknown, scale = 1, noG = false) => {
      dusts.push({ type, scale, noG });
      return { vx: 1, vy: 1, x: 0, y: 0, alpha: 0, scale: 1, noGravity: false, fadeIn: 0 };
    },
    spawnParticles: () => {}, addDamageNumber: () => {}, onEnemyKilled: () => {},
    spawnDrop: () => null, damagePlayer: (): number => 0, spawnEnemy: () => {},
    notifyInventoryChanged: () => {}, showPickupLabel: () => {},
    entities: { add: () => {}, projectiles: [] as unknown[] },
  } as never;
  return { w, hooks, hurts, dusts, sfx, gores, enemies };
}

/** gore 桩（newGore 全录——GorePiece 直入需 DOM 资产,测试桩经全局替换不可行,
 *  改走计数断言:尘/音面按恰数锁,gore 面在源锚 §0 锁 newGore 调用形态） */
/** ★共享桶是模块级单表（ID_STATIC_TABLES——生产同表,测试间残留窗会串扰）：
 *  逐测单调推钟（前测窗 必然 早于 本测基线）=窗隔离,免清表旁路 */
let g14Clock = 1000;
beforeEach(() => {
  g14Clock += 1000;
  pinGameTimeTicks(g14Clock);
});

// ================================================================ §0 源锚/结构锁
describe('§0 源锚（共享桶单源 / 私表停笔 / Kill 精确面）', () => {
  it('[A] idStaticCheck 导出（Arrow 单源）+ Dart 直击消费位（★G22：blast 位参数化 idStaticKey）', () => {
    expect(arrowSrc()).toMatch(/export function idStaticCheck\(projId/);
    const s = dartSrc();
    expect(s).toContain("import { prefetchProjectiles, BULLET_KILL_SFX, projFrameCount, idStaticCheck } from './Arrow';");
    expect(s.match(/idStaticCheck\(281, /g)?.length).toBe(1);   // 直击环（blast 位=G22 idStaticKey 参数,烟花 167-170 共表）
    expect(s).toContain('if (!idStaticCheck(idStaticKey, (e as unknown as { id?: number }).id ?? -1, idCd)) continue;');
  });
  it('[B] 私表停笔（afterHit bunny 分流）+ iframes 前置读门', () => {
    const s = dartSrc();
    expect(s).toContain('if (this.windowGate && !bunnyIdStatic) this.hitCdT.set(k, 10);');
    expect(s).toMatch(/if \(bunnyIdStatic\) \{\s*\n\s*if \(\(\(e as unknown as \{ iframes\?: number \}\)\.iframes \?\? 0\) > 0\) continue;/);
  });
  it('[C] Kill 281 精确面锚（Sound4/gore76·77/尘恰数/128 盒 idStatic 窗）', () => {
    const s = dartSrc();
    expect(s).toContain("game.playSfx('killed', 1, cx, cy);");
    expect(s).toMatch(/GorePiece\.newGore\(76,/);
    expect(s).toMatch(/GorePiece\.newGore\(77,/);
    expect(s).toContain('this.blastDamage(game, cx, cy, 64, 281);');   // :77374-77384（G22：idStatic 键参数化）
  });
  it('[D] Kill 162 精确面锚（两段盒 32→72 / 尘 20+50+10 / gore ±1.5）', () => {
    const s = dartSrc();
    expect(s).toContain('this.blastDamage(game, cx, cy, 32);     // :77393-77400 第一段 64×64');
    expect(s).toContain('this.blastDamage(game, cx, cy, 72);     // :77445-77452 第二段 144×144');
    expect(s).toMatch(/for \(let i = 0; i < 50; i\+\+\)/);
    expect(s).toContain('1.5 * kxC');
  });
  it('[E] blastDamage 窗双轨（idStaticKey 参数 / 162 私表窗）+ damage<=0 头门', () => {
    const s = dartSrc();
    expect(s).toContain('private blastDamage(game: GameHooks, cx: number, cy: number, r: number, idStaticKey = 0): void {');
    expect(s).toContain('if (this.damage <= 0) return;');
    expect(s).toContain('if (this.windowGate && !idStaticKey) this.hitCdT.set(e as unknown as object, 10);');
  });
});

// ================================================================ §1 直击共享桶
describe('§1 281 直击：全场共享桶（多兔同敌 10t 一跳）', () => {
  it('[A] 同拍双兔同敌：只结算一只（旧私表=双跳）', () => {
    const { hooks, hurts } = idStaticWorld([7]);
    const b1 = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 350, 'bunny');
    const b2 = new TrapShot(40 * TILE + 1, 40 * TILE, -5, 0, 350, 'bunny');
    b1.fixedUpdate(1, hooks);
    b2.fixedUpdate(1, hooks);
    expect(hurts).toHaveLength(1);            // 共享桶：第二只被头门拒
    expect(hurts[0]!.dmg).toBe(350);
  });
  it('[B] 窗外到期（10t）再击；窗内三连拒', () => {
    const { hooks, hurts } = idStaticWorld([7]);
    const b = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 350, 'bunny');
    b.fixedUpdate(1, hooks);
    expect(hurts).toHaveLength(1);
    b.fixedUpdate(1, hooks);                  // 窗内（1t）——但同弹 hitCdT 已停用,共享桶拒
    expect(hurts).toHaveLength(1);
    pinGameTimeTicks(gameTickCount() + 11);   // +11t > 10t 窗
    b.fixedUpdate(1, hooks);
    expect(hurts).toHaveLength(2);
  });
  it('[C] iframes>0 敌：拒收不落桶账（dealContacts :444 同位）', () => {
    const { hooks, hurts, enemies } = idStaticWorld([7]);
    (enemies[0] as unknown as { iframes: number }).iframes = 5;
    const b = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 350, 'bunny');
    b.fixedUpdate(1, hooks);
    expect(hurts).toHaveLength(0);
    (enemies[0] as unknown as { iframes: number }).iframes = 0;
    pinGameTimeTicks(gameTickCount() + 20);   // 桶未写 → 立即可击（拒收零落账）
    b.fixedUpdate(1, hooks);
    expect(hurts).toHaveLength(1);
  });
  it('[D] 跨载体同表：TrapShot 直击后 Arrow 281 爆弹同窗拒,窗外结算', () => {
    const { hooks, hurts } = idStaticWorld([7]);
    const b = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 350, 'bunny');
    b.fixedUpdate(1, hooks);
    expect(hurts).toHaveLength(1);
    // Arrow 爆弹态（Enemy 614 死亡爆弹同款 281——R3 刀5 载体）
    const blast = new Arrow(40 * TILE, 40 * TILE, 0, 0, 175, 0, 281, {});
    (blast as unknown as { bunnyBlastForm: number }).bunnyBlastForm = -2;
    (blast as unknown as { bunnyOwner: number }).bunnyOwner = 256;
    blast.fixedUpdate(1 / 60, hooks);
    expect(blast.dead).toBe(true);            // 爆弹即灭（FX 已放）
    expect(hurts).toHaveLength(1);            // 同一敌被共享桶拒（perIDStatic[281] 单表）
    pinGameTimeTicks(gameTickCount() + 11);
    const blast2 = new Arrow(40 * TILE, 40 * TILE, 0, 0, 175, 0, 281, {});
    (blast2 as unknown as { bunnyBlastForm: number }).bunnyBlastForm = -2;
    (blast2 as unknown as { bunnyOwner: number }).bunnyOwner = 256;
    blast2.fixedUpdate(1 / 60, hooks);
    expect(hurts).toHaveLength(2);            // 窗外结算
  });
});

// ================================================================ §2 寿命爆精确面
describe('§2 281/162 timeLeft 尽爆（Kill 精确 FX + 伤害窗）', () => {
  it('[A] 281：Sound4+Item14+尘 31×20 / 6×10 双档（恰 40 尘）+ 128 盒共享桶窗', () => {
    const { hooks, hurts, dusts, sfx } = idStaticWorld([7]);
    const b = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 350, 'bunny');
    (b as unknown as { life: number }).life = 1;    // 直逼寿终（600t 快进等价）
    b.fixedUpdate(1, hooks);
    expect(b.dead).toBe(true);
    expect(sfx).toContain('killed');                // :77330 PlaySound(4)
    expect(sfx).toContain('explosion');             // :77341 Item14
    expect(dusts.filter((d) => d.type === 31).length).toBe(20);       // :77342-47
    expect(dusts.filter((d) => d.type === 6 && d.scale === 2.5 && d.noG).length).toBe(10);   // :77348-53
    expect(dusts.filter((d) => d.type === 6 && d.scale === 1.5 && !d.noG).length).toBe(10);  // :77354-58
    expect(hurts).toHaveLength(1);                  // 128 盒内结算（damage 350>0 门）
    // 同敌共享桶已写：二发寿终爆同拍拒
    const b2 = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 350, 'bunny');
    (b2 as unknown as { life: number }).life = 1;
    b2.fixedUpdate(1, hooks);
    expect(hurts).toHaveLength(1);
  });
  it('[B] 162：Item14+尘 31×20 / 6×50 / 6×10（恰 80 尘）+ 两段盒各敌恰一跳', () => {
    // 内盒敌（距心 <32）+ 外环敌（距心 32..72）——两段 Damage 各结算一次,内盒敌不二跳
    const w = new World(80, 60, 42, 'open');
    const hurts: number[] = [];
    const dusts: Array<{ type: number; scale: number; noG: boolean }> = [];
    const sfx: string[] = [];
    const inner = { id: 1, vanillaId: 3, x: 40 * TILE, y: 40 * TILE, w: 20, h: 20, dead: false, iframes: 0,
      hurt: (d: number) => { hurts.push(d); return true; } };
    const outer = { id: 2, vanillaId: 3, x: 40 * TILE + 48, y: 40 * TILE, w: 20, h: 20, dead: false, iframes: 0,
      hurt: (d: number) => { hurts.push(d); return true; } };
    const hooks = {
      world: w,
      player: { x: -500, y: -500, w: 20, h: 42, dead: true, cx: -490, cy: -479, luck: 0, buffs: new Set() },
      enemies: () => [inner, outer],
      critters: () => [], npcs: () => [],
      playSfx: (n: string) => { sfx.push(n); },
      playSfxFiles: (ns: string[]) => { sfx.push(...ns); },
      spawnDust: (_x: number, _y: number, _w: number, _h: number, type: number,
        _vx: number, _vy: number, _a: number, _c: unknown, scale = 1, noG = false) => {
        dusts.push({ type, scale, noG });
        return { vx: 1, vy: 1, x: 0, y: 0, alpha: 0, scale: 1, noGravity: false, fadeIn: 0 };
      },
      spawnParticles: () => {}, addDamageNumber: () => {}, onEnemyKilled: () => {},
      spawnDrop: () => null, damagePlayer: (): number => 0, spawnEnemy: () => {},
      notifyInventoryChanged: () => {}, showPickupLabel: () => {},
      entities: { add: () => {}, projectiles: [] as unknown[] },
    } as never;
    const p = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 300, 'cannonball');
    (p as unknown as { life: number }).life = 1;
    p.fixedUpdate(1, hooks);
    expect(p.dead).toBe(true);
    expect(sfx).toContain('explosion');
    expect(sfx).not.toContain('killed');            // 162 无 PlaySound(4)（:77391 只 Item14）
    expect(dusts.filter((d) => d.type === 31).length).toBe(20);
    expect(dusts.filter((d) => d.type === 6 && d.scale === 2.5 && d.noG).length).toBe(50);   // :77413-19
    expect(dusts.filter((d) => d.type === 6 && d.scale === 1.5 && !d.noG).length).toBe(10);  // :77420-26
    expect(hurts.sort((a, b2) => a - b2)).toEqual([300, 300]);   // 内+外各一跳
    // 内盒敌两段间免疫窗：单独再爆一发（无共享窗,但本发两段内窗已证——恰两跳非三跳）
  });
  it('[C] 281 寿命爆 damage=0（雕像档不可达于 TrapShot,门守卫）:纯 FX 零伤', () => {
    const { hooks, hurts, sfx } = idStaticWorld([7]);
    const b = new TrapShot(40 * TILE, 40 * TILE, 5, 0, 0, 'bunny');
    (b as unknown as { life: number }).life = 1;
    b.fixedUpdate(1, hooks);
    expect(b.dead).toBe(true);
    expect(sfx).toContain('killed');                // FX 照放（:77327 块整体无 damage 门）
    expect(hurts).toHaveLength(0);                  // :77374 damage>0 门
  });
});
