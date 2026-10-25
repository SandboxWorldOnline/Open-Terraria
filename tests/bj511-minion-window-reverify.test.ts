// ★BJ511（2026-10-04）召唤物攻击窗锁其他武器复验——「雀杖攻击时荆鞭/冰雪回旋镖不造伤」
//  （BJ436 用户复报同域第二发;BJ436 落刀后 contact 环历经 BJ475①/490③/491②/492①/
//  496③ 多轮改造,以盘上现役形复验）。
//  定谳链（Terarria1457/Terraria/Projectile.cs 亲读;1458 同支 :7831-7843 零变更）：
//   · 原版雀杖召唤弹 759（BabyBird,AI_158 :49643）SetDefaults（:7831-7843）：
//     penetrate=-1 + usesLocalNPCImmunity=true + localNPCHitCooldown=15 =【local 族】
//     ——命中写梯走 usesLocal 主支（:14175-14179）immune[owner]=0【清窗不开窗】,
//     节流全由弹内局部私表（per-proj localNPCImmunity）承担 ⇒ 原版雀杖攻击【不锁】
//     其他武器。
//   · 本仓病灶：MinionProj CONTACT_CD_TABLE 缺 759 → contactResolve(759) 落缺省
//     CONTACT_PLAYER_WINDOW(-2 族) → 通用飞行尾 contact(game,dmg0)（无 cdIn 实参形）
//     每次命中经 Enemy.hurt 通用档写 iframes=10【开玩家全局窗】=BJ436 主病灶同形。
//  两武器被锁面（现役形亲读）：
//   · 荆鞭 4913/弹 914（Snapthorn,DefaultToWhip usesLocal 族）：WhipProj.ts 前置窗门
//     （Damage_PVE_Inner :12635-12639 1:1,iframes>0 整跳 continue）→ 窗内鞭链全不跑。
//   · 冰雪回旋镖 670/弹 113（aiStyle 3,penetrate=-1 无局部旗=-2 族）：hitEnemies 外环
//     走逐弹 hitCd.peek（playerImmune=false）,但 hurt 落地 pierce=0（hurtPierce 缺省）
//     → Enemy.hurt :14560 `pierce!==1 && iframes>0` 门拒 → 窗内零伤。
//  面向敌靶（5049 僵尸 vid 3）两武器同窗内均零伤=用户组合复现。
//  判别力（旧码必红项）：
//   §F 复现面：雀杖命中 iframes=0（旧码=10 必红）+ 鞭形照伤（旧码=门拒零伤必红）+
//   回旋镖形照伤（旧码=hurt 内部门拒零伤必红）;
//   §G 档位判别：per-proj 私表承载（实例 B 同拍照伤=旧码被残窗拒必红）+ cd=15 钉值
//   （私表记账直读）;
//   §H BJ436 既有面不回归：-2 缺省族（373）命中照开 10t 窗（勿反向修掉）;
//   §I 结构钉：CONTACT_CD_TABLE 登记 759: 15（金标串,防漂移）。
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';
import { Enemy } from '../src/entities/Enemy';
import { MinionProj } from '../src/entities/MinionProj';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MINION_TS = readFileSync(join(ROOT, 'src/entities/MinionProj.ts'), 'utf8');

function makeGame(): { hooks: GameHooks; player: Player } {
  const w = new World(200, 120, 7, 'bj511-window');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const list: Enemy[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => list,
    npcs: () => [],
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
    spawnFriendlyProj: () => undefined,
    applyLifeSteal: () => 0,
    entities: { projectiles: [], add: () => {}, nextId: 1 },
    tickCount: 0,
    noteNpcPlayerImmune: () => {},
  } as unknown as GameHooks;
  return { hooks, player };
}

/** 僵尸桩（vid 3;手动 id=私表键域隔离） */
function zombie(hooks: GameHooks, uid: number, px = 400, py = 600): Enemy {
  const z = Enemy.fromVanilla(3, px, py)!;
  z.id = uid;
  z.maxHp = 5000;
  z.hp = 5000;
  (hooks as unknown as { enemies: () => Enemy[] }).enemies().push(z);
  return z;
}

/** contact 为 private——测试面经类型手术直驱（BJ436 同式）;无 cdIn = 通用飞行尾
 *  真实实参形（雀杖 759 不在旗舰分派族,走通用飞行尾 contact(game,dmg0)）。 */
const contactDirect = (m: MinionProj, hooks: GameHooks, dmg = 30): boolean =>
  (m as unknown as { contact: (g: GameHooks, d: number, cdIn?: number, pad?: number) => boolean })
    .contact(hooks, dmg);

/** 鞭形命中（=WhipProj.ts:788 前置窗门 + :851 hurt pierce=-3 精确同参） */
const whipShaped = (z: Enemy, hooks: GameHooks, dmg = 12): number => {
  if (((z as unknown as { iframes?: number }).iframes ?? 0) > 0) return 0;   // :788 前置窗门
  const hp0 = z.hp;
  z.hurt(dmg, 1, 0, hooks, 0, false, -3, true);
  return hp0 - z.hp;
};

/** 回旋镖形命中（=hitEnemies hurtPierce 缺省 0 → Enemy.hurt :14560 内部门） */
const boomerangShaped = (z: Enemy, hooks: GameHooks, dmg = 15): number => {
  const hp0 = z.hp;
  z.hurt(dmg, 1, 0, hooks, 0, false, 0, true);
  return hp0 - z.hp;
};

describe('BJ511 §F 用户组合复现（雀杖 759 攻击窗内鞭/回旋镖伤害可达=原版钉）', () => {
  it('F1 雀杖命中=清窗档 iframes=0（旧码 -2 误档写 10 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（contact 面首掷 ×1.0）
    const { hooks } = makeGame();
    const z = zombie(hooks, 5101);
    const finch = new MinionProj(z.cx - 5, z.cy - 5, 759, 7, 4, false, 0, false, () => null);
    expect(contactDirect(finch, hooks)).toBe(true);      // 雀杖接触命中落地
    expect(5000 - z.hp).toBeGreaterThan(0);
    expect(5000 - z.hp).toBe(27);                        // ★BJ528 数值钉（dmg=30+0−def6/2;断供钳 1 必红——可达性→数值缺口补上）
    expect(z.iframes).toBe(0);                           // ★主判别:usesLocal 主支清窗（原版 :14175-14179）
  });

  it('F2 窗内鞭形照伤（旧码 WhipProj :788 前置门拒整跳=零伤必红）', () => {
    const { hooks } = makeGame();
    const z = zombie(hooks, 5102);
    const finch = new MinionProj(z.cx - 5, z.cy - 5, 759, 7, 4, false, 0, false, () => null);
    contactDirect(finch, hooks);
    expect(whipShaped(z, hooks)).toBeGreaterThan(0);     // ★荆鞭伤害可达（Snapthorn 4913/弹 914 面）
  });

  it('F3 窗内回旋镖形照伤（旧码 Enemy.hurt :14560 门拒=零伤必红）', () => {
    const { hooks } = makeGame();
    const z = zombie(hooks, 5103);
    const finch = new MinionProj(z.cx - 5, z.cy - 5, 759, 7, 4, false, 0, false, () => null);
    contactDirect(finch, hooks);
    expect(boomerangShaped(z, hooks)).toBeGreaterThan(0); // ★冰雪回旋镖伤害可达（670/弹 113 面）
  });
});

describe('BJ511 §G 档位判别（local 族 per-proj 私表 + cd=15 钉值）', () => {
  it('G1 实例 B（独立 per-proj 局部表）同拍照伤=局部免疫不共享（旧码被残窗拒必红）', () => {
    const { hooks } = makeGame();
    const z = zombie(hooks, 5111);
    const a = new MinionProj(z.cx - 5, z.cy - 5, 759, 7, 4, false, 0, false, () => null);
    const b = new MinionProj(z.cx - 6, z.cy - 6, 759, 7, 4, false, 0, false, () => null);
    expect(contactDirect(a, hooks)).toBe(true);
    // 原版 localNPCImmunity 按 projectile.whoAmI 分账——B 不吃 A 的私表,
    // 且 A 命中清窗不开窗 → B 同拍可达（旧码 -2 误档:iframes=10 残窗拒 → 必红）
    expect(contactDirect(b, hooks)).toBe(true);
    expect(5000 - z.hp).toBeGreaterThan(0);
    expect(z.iframes).toBe(0);
  });

  it('G2 cd=15 钉值（私表记账直读=原版 localNPCHitCooldown=15,SetDefaults :7843）', () => {
    const { hooks } = makeGame();
    const z = zombie(hooks, 5112);
    const finch = new MinionProj(z.cx - 5, z.cy - 5, 759, 7, 4, false, 0, false, () => null);
    contactDirect(finch, hooks);
    // MinionHitCd.map 私有——测试面经类型手术直读（记账值=受理写梯位 set(id, cd)）
    const ledger = (finch as unknown as { hitCd: { map: Map<number, number> } }).hitCd.map;
    expect(ledger.get(z.id)).toBe(15);                   // ★档位钉值（旧码 -2 族不入私表=undefined 必红）
  });

  it('G3 刃杖 864（Smolstar,普查第二发同病）：命中清窗 iframes=0 + cd=10 钉值 + 鞭形照伤', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    // 原版锚：1457 :8286-8299（=1458 同位）usesLocalNPCImmunity + localNPCHitCooldown=10
    //   + minion;写梯显式 864 支 :14131-14140 immune[owner]=0 清窗。repo 路由=通用召唤
    //   spawnMinion → 通用飞行尾 contact 无 cdIn——表缺曾落 -2 误档（同 759 病形）。
    const { hooks } = makeGame();
    const z = zombie(hooks, 5113);
    const blade = new MinionProj(z.cx - 5, z.cy - 5, 864, 6, 2, false, 0, false, () => null);
    expect(contactDirect(blade, hooks, 20)).toBe(true);
    expect(5000 - z.hp).toBe(20);                        // ★BJ528 数值钉（20+pen25 钳 def6/2=3−3;断供钳 1 必红）
    expect(z.iframes).toBe(0);                           // ★清窗档（旧码=10 必红）
    expect(whipShaped(z, hooks)).toBeGreaterThan(0);     // 窗内鞭形照伤
    const ledger = (blade as unknown as { hitCd: { map: Map<number, number> } }).hitCd.map;
    expect(ledger.get(z.id)).toBe(10);                   // ★cd=10 钉值（原版 :8299）
  });
});

describe('BJ511 §H BJ436 既有面不回归', () => {
  it('H1 -2 缺省族（373 本体）命中照开 10t 窗（原版本相,勿反向修掉）', () => {
    const { hooks } = makeGame();
    const z = zombie(hooks, 5121);
    const wasp = new MinionProj(z.cx - 12, z.cy - 13, 373, 20, 1, false, 0, false, () => null);
    expect(contactDirect(wasp, hooks)).toBe(true);
    expect(z.iframes).toBe(10);                          // 尾支 :14182 开窗=原版缺省族本相
    expect(whipShaped(z, hooks)).toBe(0);                // 窗内鞭形被拒（:12636 共门,原版同相）
  });
});

describe('BJ511 §I 结构钉（CONTACT_CD_TABLE 登记 759: 15 / 864: 10,防漂移）', () => {
  it('I1 金标串在位', () => {
    expect(MINION_TS).toContain('759: 15,');             // ★雀杖入表（SetDefaults :7843 cd=15）
    expect(MINION_TS).toContain('864: 10,');             // ★刃杖入表（Smolstar :8299 cd=10）
  });
});
