// ★BJ436（2026-10-02）召唤仆从命中写梯档位判别测试——「仆从攻击时其他武器无法造成伤害」
//  （用户实报「挺严重」,召唤核心机制）。
//  定谳锚（Terarria1457/Terraria/Projectile.cs 亲读）：
//   · 命中尾写梯 :14031-14186：usesIDStaticNPCImmunity（penetrate≠1,全随从 idStatic
//     族 penetrate=-1）→ immune[owner]=0【清窗】+ 私表;usesLocalNPCImmunity（cd≠-2）
//     → immune[owner]=0【清窗】+ 私表（:14175-14179）;只有 -2 缺省族（373/375/423/
//     613 本体,penetrate=-1 无局部旗）尾支 :14182 写 10=【开玩家全局窗】。
//   · :12636 免疫门 = 三族【共门】（flag3 只豁免单发非局部弹）且在 :14179 写位之前
//     ——窗拒拍私表保持 0,下拍重试（不消费私表）。
//   · 旧码病灶：MinionProj.contact() 全族 pierce=0 → local/idStatic 族每次命中都经
//     Enemy.hurt 通用档写 iframes=10（开窗）——仆从连续攻击=窗口近全覆盖（探针实测
//     82-97%）→ 玩家其他武器（近战/通用档弹）被 hurt 免疫门整段拒收。
//  判别力（旧码必红项）：
//   §A local 族命中 iframes=0（旧码=10 必红）+ 同拍近战形照伤（旧码=门拒零伤必红）;
//   §B idStatic 族命中 iframes=0 + GC1 桥写 0（近战循环门同拍清）;§C -2 缺省族命中
//   iframes=10（原版相,勿反向「修」掉）+ 窗内近战形被拒;§D :12636 窗拒拍【不消费】
//   local 私表（旧码先 ready() 白吃 cd 必红）;§E 818 扑击弹（usesLocal cd=-1）窗拒拍
//   hitSet 不记 + 命中清窗（结构断言,行为面 TigerPounce 直驱）。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';
import { Enemy } from '../src/entities/Enemy';
import { MinionProj, TigerPounce } from '../src/entities/MinionProj';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MINION_TS = readFileSync(join(ROOT, 'src/entities/MinionProj.ts'), 'utf8');

function makeGame(): {
  hooks: GameHooks; player: Player; immuneWrites: Array<[number, number]>;
} {
  const w = new World(200, 120, 7, 'bj436-window');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const immuneWrites: Array<[number, number]> = [];
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
    entities: { projectiles: [], add: () => {}, nextId: 1 },   // 818 countStormTigerGems 读口
    // ★BJ436 GC1 载体桥桩（noteNpcPlayerImmune/tickCount=npcImmuneByAttacker 承载面）
    tickCount: 0,
    noteNpcPlayerImmune: (npcId: number, ticks: number) => { immuneWrites.push([npcId, ticks]); },
  } as unknown as GameHooks;
  return { hooks, player, immuneWrites };
}

/** 僵尸桩（vid 3,def 6,近战形判别靶;手动 id=私表键域隔离） */
function zombie(hooks: GameHooks, uid: number, px = 400, py = 600): Enemy {
  const z = Enemy.fromVanilla(3, px, py)!;
  z.id = uid;
  z.maxHp = 5000;
  z.hp = 5000;
  (hooks as unknown as { enemies: () => Enemy[] }).enemies().push(z);
  return z;
}

const contactDirect = (m: MinionProj, hooks: GameHooks, dmg = 30, cd?: number): boolean =>
  // contact 为 private——测试面经类型手术直驱（Y2 同式）
  (m as unknown as { contact: (g: GameHooks, d: number, cdIn?: number, pad?: number) => boolean })
    .contact(hooks, dmg, cd);

/** 近战形直调（=Game.ts:34797 精确同参 pierce=0,fromPlayer=true） */
const meleeShaped = (z: Enemy, hooks: GameHooks, dmg = 10): number => {
  const hp0 = z.hp;
  z.hurt(dmg, 1, 0, hooks, 0, false, 0, true);
  return hp0 - z.hp;
};

describe('BJ436 §A local 族（乌鸦 317,显式 cd∈local 表）：命中清窗不开窗', () => {
  it('A1 命中后 enemy.iframes=0（旧码 pierce=0 写 10 必红）+ 同拍近战形照伤', () => {
    const { hooks } = makeGame();
    const z = zombie(hooks, 4001);
    const m = new MinionProj(z.cx - 14, z.cy - 14, 317, 30, 1.5, false, 0, false, () => null);
    expect(contactDirect(m, hooks, 30, 5)).toBe(true);   // cd=5（原版 localNPCHitCooldown=10 同族,cd 值只走私表）
    expect(5000 - z.hp).toBeGreaterThan(0);              // 仆从命中落地
    expect(z.iframes).toBe(0);                           // ★主判别:清窗档（旧码=10）
    expect(meleeShaped(z, hooks)).toBeGreaterThan(0);    // ★同拍近战形照伤（旧码=门拒零伤）
  });

  it('A2 GC1 桥写 0（近战循环门载体 npcImmuneByAttacker 同拍清窗）', () => {
    const { hooks, immuneWrites } = makeGame();
    const z = zombie(hooks, 4002);
    const m = new MinionProj(z.cx - 14, z.cy - 14, 317, 30, 1.5, false, 0, false, () => null);
    contactDirect(m, hooks, 30, 5);
    expect(immuneWrites).toContainEqual([z.id, 0]);      // ★usesLocal=清零档
  });
});

describe('BJ436 §B idStatic 族（史莱姆 266,表解析）：命中清窗不开窗', () => {
  it('B1 contactResolve(266)=idStatic 12 → 命中后 iframes=0 + 同拍近战形照伤', () => {
    const { hooks } = makeGame();
    const z = zombie(hooks, 4011);
    const m = new MinionProj(z.cx - 8, z.cy - 8, 266, 8, 1, false, 0, false, () => null);
    expect(contactDirect(m, hooks)).toBe(true);          // 无 cdIn → 表解析 idStatic
    expect(z.iframes).toBe(0);                           // ★主判别（旧码=10）
    expect(meleeShaped(z, hooks)).toBeGreaterThan(0);
  });
});

describe('BJ436 §C -2 缺省族（373 本体）：命中开 10t 窗=原版本相（勿反向修掉）', () => {
  it('C1 命中后 iframes=10（尾支 :14182）+ 窗内近战形被拒（:12636 共门）', () => {
    const { hooks } = makeGame();
    const z = zombie(hooks, 4021);
    const m = new MinionProj(z.cx - 12, z.cy - 13, 373, 20, 1, false, 0, false, () => null);
    expect(contactDirect(m, hooks)).toBe(true);          // contactResolve(373)=CONTACT_PLAYER_WINDOW
    expect(5000 - z.hp).toBeGreaterThan(0);
    expect(z.iframes).toBe(10);                          // ★原版相:缺省族开窗（Projectile.cs:14182）
    expect(meleeShaped(z, hooks)).toBe(0);               // 窗内近战形被拒（原版同相）
  });
});

describe('BJ436 §D :12636 窗拒拍不消费 local 私表（:12636 在 :14179 写位前）', () => {
  it('D1 窗开启中 contact 拒收;窗关后下拍重试即命中（私表未被窗内空转白吃）', () => {
    const { hooks } = makeGame();
    const z = zombie(hooks, 4031);
    z.iframes = 10;                                      // 预置开窗（玩家武器刚命中）
    const m = new MinionProj(z.cx - 14, z.cy - 14, 317, 30, 1.5, false, 0, false, () => null);
    expect(contactDirect(m, hooks, 30, 5)).toBe(false);  // :12636 窗门拒收
    expect(z.hp).toBe(5000);
    z.iframes = 0;                                       // 窗关（10t 后）
    expect(contactDirect(m, hooks, 30, 5)).toBe(true);   // ★下拍重试即命中=私表未消费（旧码先 ready() 白吃 cd=5 → 此处必红）
    expect(5000 - z.hp).toBeGreaterThan(0);
    expect(z.iframes).toBe(0);                           // 命中仍清窗
  });
});

describe('BJ436 §E 818 扑击弹（usesLocal cd=-1）：窗拒拍 hitSet 不记 + 命中清窗', () => {
  it('E1 行为面：TigerPounce 直驱——窗开启中扑击零伤且 hitSet 未记;窗关后命中落地且 iframes=0', () => {
    const { hooks, player } = makeGame();
    const z = zombie(hooks, 4041);
    const t = new TigerPounce(z.cx, z.cy, 0, 0, 40, () => player, 0, 60);
    z.iframes = 10;                                      // 预置开窗
    t.fixedUpdate(1 / 60, hooks);
    expect(z.hp).toBe(5000);                             // 窗门拒收零伤
    expect(((t as unknown as { hitSet: Set<number> }).hitSet.has(z.id))).toBe(false); // ★hitSet 未记（旧码先 add 必红）
    z.iframes = 0;
    t.fixedUpdate(1 / 60, hooks);
    expect(5000 - z.hp).toBeGreaterThan(0);              // 窗关重试命中
    expect(z.iframes).toBe(0);                           // ★清窗档（旧码 pierce=0 写 10 必红）
  });

  it('E2 结构断言：818 敌怪环窗门先于 hitSet 记账 + 写梯 -3 + GC1 桥在位', () => {
    // （防回归:窗门/hitSet 记账次序与写梯档位是本刀核心,结构钉值）
    const anchor = MINION_TS.indexOf('沙漠虎扑击弹 818');
    const enemyArm = MINION_TS.slice(anchor, anchor + 12000);
    const gateIdx = enemyArm.indexOf('if (MinionProj.enemyImmune(en)) continue;');
    const addIdx = enemyArm.indexOf('this.hitSet.add(en.id);');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(gateIdx);             // ★窗门先于记账
    // ★BJ452 N2（2026-10-03）：crit 参 false→res.crit（tag 掷率色位,Enemy.hurt 纯染色）
    //   ——写梯 -3 档不变,金标串随刀更新（旧串 'en.hurt(res.dmg, 0, 0, game, 0, false, -3, true)'）
    // ★BJ455③（2026-10-03）：banner 乘区包入 applyBannerDamageDealt（Damage_PVE :13387-91
    //   对 818 标准管线照跑,他臂同式）;★BJ453 并链 critPounce 源保持
    // ★BJ716-A（R18-F2）锁随刀走:818 臂补 DamageVar 首掷（dmgVPounce）——窗门/hitSet/-3 写梯语义不变
    expect(enemyArm).toContain("en.hurt(applyBannerDamageDealt(game, en, critPounce && !res.crit ? dmgVPounce * 2 : dmgVPounce), 0, 0, game, 0, critPounce, -3, true)");
    expect(enemyArm).toContain('noteVanillaProjImmune(game, 818, en.id, { penetrate: -1, localFace: true })');
  });
});
