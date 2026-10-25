// ★BJ528（2026-10-06）BJ511 后续复报复验——「窗锁修复后武器伤害恢复,但召唤物伤害变成 1」
//  定谳链（复验四环,2026-10-06 盘上现役形亲测+反编译亲读）：
//   ①路由环：BJ511 只改 CONTACT_CD_TABLE 路由（759 缺省 -2 → local 15 / 864 → local 10），
//     contact() 的 dmg 传递链【与档位无关】——-2/local/idStatic 三档共用同一
//     resolveWhipTagHit + en.hurt 结算面（MinionProj.ts contact() :5931 起单链），
//     机制上不可能由 BJ511 造成 dmg 断供。★实测症状不可复现（本文件 §F/§V 钉值全绿）。
//   ②投影环：Game.ts 'summon' summonDmg=max(1,round(cwIn.damage×ps.dmg))（4281 雀杖
//     基伤 7）→ MinionProj.fixedUpdate dmg0=max(1,round(this.damage×summonDamageMult))
//     （:7928 live 刷新）→ contact(game,dmg0) 全额入参——逐环亲测无断供。
//   ③结算环：resolveWhipTagHit max(1,round(dmg)) → Enemy.hurt
//     dmg=trunc(max(1,dmg+pen−def×0.5))（原版 CalculateDamageNPCsTake/NPC.cs:82067 同式）
//     ——实测 759 dmg0=7 → 僵尸 vid3(def6) 每击 4、绿史莱姆 vid1(def2) 每击 6；
//     864 dmg0=6 → 僵尸每击 6（armorPenetration=25 池>def 钳 def/2=3:6+3−3=6）；
//     373 dmg0=20 → 17。全与原版公式吻合。
//   ④原版对照：759 SetDefaults（:7831-7843 minion=true/usesLocalNPCImmunity/
//     localNPCHitCooldown=15）接触伤=召唤武器伤害 live 投影（Projectile.cs:15368）；
//     864（:8286-8299 cd=10）同——本仓 §F/§V 钉值=该投影的防后终值。
//  病灶归因（登记不落刀,产品代码零改动）：「伤害变成 1」观感来源 =
//   a) 高防敌钳 1：max(1,7−def×0.5)——def≥13 敌（护甲僵尸 14/装甲骷髅 20 等）雀杖
//      每击恒 1=【原版本相】（原版同敌同值,BJ511 前后同值）;
//   b) 节拍变化：BJ511 后 759 命中节拍 10t（-2 全局窗自写）→ 15t（私表,原版 cd=15）
//      ——DPS 节奏降 1/3 可被感知为「伤害降」。
//  真债=判别面缺口：BJ511 F1-F3 只断言「伤害可达」（`>0`）——若 dmg 某环断供成 0
//  （钳 max(1,0)=1）测试照绿。本文件补上（可达性→数值钉值）。
//  判别力（旧码必红项）：
//   §F 真实链数值钉：fixedUpdate 驱动（非直调 contact）每击伤害=原版投影防后终值
//   （dmg 断供成 0 → 钳 1 ≠ 钉值必红）;
//   §V 投影环直传钉：contact(dmg0) 全额达敌（en.hurt 收 dmg0 非 0/负）;
//   §W BJ511 窗锁面不回归（iframes=0/鞭形照伤/回旋镖照伤/cd=15 私表钉值）;
//   §X BJ436 面不回归（-2 缺省族 373 照开 10t 窗+窗内鞭形被拒）。
import { describe, expect, it, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';
import { Enemy } from '../src/entities/Enemy';
import { MinionProj } from '../src/entities/MinionProj';

/** BJ511 同款夹具（世界/玩家/敌靶） */
function makeGame(): { hooks: GameHooks; player: Player } {
  const w = new World(200, 120, 7, 'bj528-dmg');
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

/** 敌怪桩（BJ511 同式;手动 id=私表键域隔离） */
function foe(hooks: GameHooks, vid: number, uid: number, px = 400, py = 600): Enemy {
  const e = Enemy.fromVanilla(vid, px, py)!;
  e.id = uid;
  e.maxHp = 5000;
  e.hp = 5000;
  (hooks as unknown as { enemies: () => Enemy[] }).enemies().push(e);
  return e;
}

/** contact 为 private——测试面经类型手术直驱（BJ436/BJ511 同式） */
const contactDirect = (m: MinionProj, hooks: GameHooks, dmg: number): boolean =>
  (m as unknown as { contact: (g: GameHooks, d: number, cdIn?: number, pad?: number) => boolean })
    .contact(hooks, dmg);

/** 鞭形命中（=WhipProj.ts:788 前置窗门 + :851 hurt pierce=-3 精确同参,BJ511 同款） */
const whipShaped = (z: Enemy, hooks: GameHooks, dmg = 12): number => {
  if (((z as unknown as { iframes?: number }).iframes ?? 0) > 0) return 0;
  const hp0 = z.hp;
  z.hurt(dmg, 1, 0, hooks, 0, false, -3, true);
  return hp0 - z.hp;
};

/** 回旋镖形命中（=hitEnemies hurtPierce 缺省 0 → Enemy.hurt :14560 内部门,BJ511 同款） */
const boomerangShaped = (z: Enemy, hooks: GameHooks, dmg = 15): number => {
  const hp0 = z.hp;
  z.hurt(dmg, 1, 0, hooks, 0, false, 0, true);
  return hp0 - z.hp;
};

describe('BJ528 §F 用户组合复现·数值面（真实链 fixedUpdate 驱动,dmg 断供=钳 1 必红）', () => {
  it('F1 雀杖 759 真实链每击伤害=原版投影防后终值 4（dmg0=7,僵尸 def6）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    const { hooks, player } = makeGame();
    const z = foe(hooks, 3, 5281);
    // 基伤 7 = itemCombat(4281).damage（雀杖,Game 'summon' 同值投影）;真实 owner
    const finch = new MinionProj(z.cx - 5, z.cy - 5, 759, 7, 4, false, 0, false, () => player);
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(finch);
    const hp0 = z.hp;
    for (let t = 0; t < 20 && z.hp === hp0; t++) finch.fixedUpdate(1, hooks);
    // 钉值：trunc(max(1, 7+0−6×0.5))=4——dmg 断供成 0 → 钳 1 ≠ 4 必红
    //（★BJ511 F1 旧断言 `>0` 对该病形不判别=缺口本面）
    expect(5000 - z.hp).toBe(4);
    expect(z.lastStrikeDealt).toBe(4);
    expect(z.iframes).toBe(0);   // BJ511 窗面同步不回归（local 档清窗）
  });

  it('F2 雀杖 dmg0 投影公式面：def2 绿史莱姆每击 6（7+0−2×0.5,跨防对账锁原版公式）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（contact 面首掷 ×1.0）
    const { hooks, player } = makeGame();
    const s = foe(hooks, 1, 5282);
    const finch = new MinionProj(s.cx - 5, s.cy - 5, 759, 7, 4, false, 0, false, () => player);
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(finch);
    const hp0 = s.hp;
    for (let t = 0; t < 20 && s.hp === hp0; t++) finch.fixedUpdate(1, hooks);
    expect(5000 - s.hp).toBe(6);
    expect(s.lastStrikeDealt).toBe(6);
  });

  it('F3 刃杖 864 真实链每击伤害=6（dmg0=6,armorPen 25 池钳 def/2=3: 6+3−3）+窗面', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    const { hooks, player } = makeGame();
    // ★BJ637（2026-10-11）几何迁改定谳：BJ634 忠实移植 AI_169_Smolstars（P.cs:46559-46700）
    //  后,旧敌位 (400,600) 不可再实现——①敌距玩家 1032.6px>800 双距超程（md 巡航脱离后
    //  恒>800,pd 恒 1032.6）;②敌盒 y 580..620 在玩家 viewRect（1920×1200 心=player.Center,
    //  Main.cs:758;:49903 全局扫 `(boss || rectangle.Intersects)` 门）外 → 原版同样不锁敌
    //  （本仓 findTargetInRangeDual 同门同值,探针 P2/P3 实证 canHitWithOwnBodyBox/canBeChasedBy
    //  全过,拒锁唯 viewRect）;③巡航首拍 40px/t（num4=10+GetLerpValue(200,600,dist)×30,
    //  dist≈985 满档）即脱离重叠盒（原版时序同:AI→HandleMovement→Damage 用位移后盒）→
    //  原版同场景同为 0 伤=F3 旧期望钉的是 BJ634 前「通用飞行路径 5px/t」非忠实相。
    //  迁敌位至 (960,1380)（玩家锚正下 30px,viewRect 内+pd=60<800;巡航位移 (0,10) 不脱盒
    //  →锁定+同拍接触）,钉值（6/iframes0/whip/hitCd=10）不变;判别锁见
    //  tests/bj637-bladestaff-realchain.test.ts（L1 锁敌/L2 viewRect 外不锁=原版本相钉/L3 全链追击）。
    const z = foe(hooks, 3, 5283, 960, 1380);
    // 基伤 6 = itemCombat(4758).damage（刃杖）;BJ511 同批第二发同查
    const blade = new MinionProj(z.cx - 5, z.cy - 5, 864, 6, 2, false, 0, false, () => player);
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(blade);
    const hp0 = z.hp;
    for (let t = 0; t < 20 && z.hp === hp0; t++) blade.fixedUpdate(1, hooks);
    expect(5000 - z.hp).toBe(6);   // 钉值（dmg 断供 → 1 必红）
    expect(z.iframes).toBe(0);     // BJ511 窗面同步不回归
    expect(whipShaped(z, hooks)).toBeGreaterThan(0);
    const ledger = (blade as unknown as { hitCd: { map: Map<number, number> } }).hitCd.map;
    expect(ledger.get(z.id)).toBe(10);   // cd=10 钉值（原版 :8299）
  });
});

describe('BJ528 §V 投影环直传钉（contact(dmg0) 全额达敌,en.hurt 收 dmg0 非 0/负）', () => {
  it('V1 雀杖 dmg0=7 直传：def6 每击 4 / def2 每击 6（-2 误档前后同值=dmg 面档位无关）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（contact 面首掷 ×1.0）
    const { hooks, player } = makeGame();
    const z = foe(hooks, 3, 5291);
    const finch = new MinionProj(z.cx - 5, z.cy - 5, 759, 7, 4, false, 0, false, () => player);
    contactDirect(finch, hooks, 7);
    expect(5000 - z.hp).toBe(4);
    const s = foe(hooks, 1, 5292);
    const finch2 = new MinionProj(s.cx - 5, s.cy - 5, 759, 7, 4, false, 0, false, () => player);
    contactDirect(finch2, hooks, 7);
    expect(5000 - s.hp).toBe(6);
  });

  it('V2 -2 缺省族（373 黄蜂 dmg0=20）dmg 面同链同值 17（=20+0−3,三档共用结算面实证）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（contact 面首掷 ×1.0）
    const { hooks, player } = makeGame();
    const z = foe(hooks, 3, 5293);
    const wasp = new MinionProj(z.cx - 12, z.cy - 13, 373, 20, 1, false, 0, false, () => player);
    contactDirect(wasp, hooks, 20);
    expect(5000 - z.hp).toBe(17);
    expect(z.iframes).toBe(10);   // -2 档开窗本相（BJ511 §H 面）
  });
});

describe('BJ528 §W BJ511 窗锁面不回归（759 local 档全链）', () => {
  it('W1 雀杖命中清窗 iframes=0 + 窗内鞭形照伤 + cd=15 私表钉值', () => {
    const { hooks, player } = makeGame();
    const z = foe(hooks, 3, 5301);
    const finch = new MinionProj(z.cx - 5, z.cy - 5, 759, 7, 4, false, 0, false, () => player);
    expect(contactDirect(finch, hooks, 7)).toBe(true);
    expect(z.iframes).toBe(0);
    expect(whipShaped(z, hooks)).toBeGreaterThan(0);
    expect(boomerangShaped(z, hooks)).toBeGreaterThan(0);
    const ledger = (finch as unknown as { hitCd: { map: Map<number, number> } }).hitCd.map;
    expect(ledger.get(z.id)).toBe(15);   // 原版 localNPCHitCooldown=15（:7843-7844）
  });
});

describe('BJ528 §X BJ436 面不回归', () => {
  it('X1 -2 缺省族（373）窗内鞭形被拒（原版共门本相,勿反向修掉）', () => {
    const { hooks, player } = makeGame();
    const z = foe(hooks, 3, 5311);
    const wasp = new MinionProj(z.cx - 12, z.cy - 13, 373, 20, 1, false, 0, false, () => player);
    contactDirect(wasp, hooks, 20);
    expect(z.iframes).toBe(10);
    expect(whipShaped(z, hooks)).toBe(0);
  });
});
