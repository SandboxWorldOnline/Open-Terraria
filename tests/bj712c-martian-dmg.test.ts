// ★BJ712-C（2026-10-25）：火星暴乱核报三件外部转报·逐件定谳守卫。
//   标杆 1457。转报未改代码（行号=其快照态），逐条亲读 1457 独立定谳。
//   件1 千兆电击塔 389 电矛 437（1457 NPC.cs:59636-59655）：confused→ai[2]=-60;
//      ai[2]<20 递增/受击 -30;ai[2]==20 → 437 平飞 direction*6 基伤 25 平值
//      （无 GetAttackDamage 重映射）,冷却 -10-rand(3)*10。终伤链 DamageVar→
//      banner(139)→缩放→×2 = 50/100/150（转报终值吻合;实体归属勘正=独立战士怪
//      NPC 389,非飞碟部件/骑手——转报「392? Scutlix Gunner 附着塔」系域混）。
//      弹 437 aiStyle1/extraUpdates2（P.cs:5074-5082）+Electrified 144 240-480t
//      （:12231-12234）+penetrate 递减（:14971-14974）均由既有数据链承载。
//   件2 五小怪弹幕旗减（转报四销案一真缺——快照早于 BJ710-C/G35 旗链刀）：
//      381→436/382→438/520→592 走 RANGED_TABLE→spawnHostileProj 内冻结
//      （BJ710-C,Enemy.ts:4011 族）;387→435 G35 D1 已接;唯 390 骑手 shootM
//      曾裸发 → 本刀补 bannerNpcId（390 鳞甲怪枪手有旗 143）。
//      转报 ID 勘正:激光枪手=382（383=军官近战）;火星走妖=520（382≠走妖）。
//   件3 飞碟死光 447 缺随机浮动（真缺）:Damage_EVP 链首 Main.DamageVar(damage,
//      -player[owner].luck)（P.cs:14904）先掷后进 banner/缩放/×2。本刀落 447 站
//      +其余 12 直调站逐站 census（961/962/965/1078/686/687/FallingBlock/537/
//      573/539/384/386/455 全数命中标准链或 Kill→Damage()→Damage_EVP——无销案）
//      统一 damageVar 入参包装,一批收完 BJ710-C D1 尾（BJ712-B 已修 681/683;
//      1091 落雷自管面不在 evpDirectDmg 域）。evpDirectDmg 门序不动。
//   变异恰红（M1-M3）：M1 摘 437 支/M2 摘 390 旗/M3 摘 447 DamageVar。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import { Enemy } from '../src/entities/Enemy';
import { martianFighterExtras, martianSaucerPartAI, MartianDeathray } from '../src/entities/bossAI_martian';
import { hitPlayer } from '../src/entities/projTargets';
import { readFileSync } from 'node:fs';

const W = 200, H = 140, FLOOR = 110;
const rd = (p: string) => readFileSync(new URL('../src/entities/' + p, import.meta.url), 'utf8');
const SRC_MARTIAN = rd('bossAI_martian.ts');
const SRC_ENEMY = rd('Enemy.ts');
const SRC_DEERCLOPS = rd('bossAI_deerclops.ts');
const SRC_METEOR = rd('MeteorChunk.ts');
const SRC_FALLING = rd('FallingBlock.ts');
const SRC_DD2 = rd('bossAI_dd2.ts');
const SRC_DUKE = rd('bossAI_duke_moonlord.ts');
const SRC_LUNAR = rd('bossAI_lunar_misc.ts');
const SRC_DART = rd('Dart.ts');

function makeWorld(difficulty = 0): World {
  const w = new World(W, H, 7, 'bj712c');
  w.difficulty = difficulty;
  const st = w.store;
  w.groundLevel = 40;
  for (let x = 0; x < W; x++) {
    st.setTile(x, FLOOR, 1);
    st.setTile(x, FLOOR + 1, 1);
  }
  return w;
}

type ProjCap = {
  damage: number; projId?: number; bannerNpcId?: number | null; hostile?: boolean;
  vx?: number; vy?: number; x?: number; y?: number; w?: number; h?: number;
  dead?: boolean; fixedUpdate?: (dt: number, g: GameHooks) => void;
};
type Fixture = {
  hooks: GameHooks; enemies: Enemy[]; projectiles: ProjCap[];
  damageCalls: number[]; player: Record<string, unknown>;
};

function makeHooks(world: World, playerAt: { x: number; y: number }): Fixture {
  const enemies: Enemy[] = [];
  const projectiles: ProjCap[] = [];
  const damageCalls: number[] = [];
  const buffApplies: Array<[number, number]> = [];
  const player = {
    x: playerAt.x, y: playerAt.y, w: 20, h: 42, dead: false, iframes: 0, luck: 0,
    cx: playerAt.x + 10, cy: playerAt.y + 21,
    buffs: { apply: (t: number, s: number) => { buffApplies.push([t, s]); } },
  };
  const em = {
    add: (e: ProjCap, bucket: string) => { if (bucket === 'projectiles') projectiles.push(e); },
  };
  const hooks = {
    world, player,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (dmg: number) => { damageCalls.push(dmg); return 1; },
    addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxWav: () => {}, playSfxFiles: () => {}, showPickupLabel: () => {},
    entities: em,
  } as unknown as GameHooks;
  return { hooks, enemies, projectiles, damageCalls, player };
}

function spawn(h: Fixture, id: number, tx: number, ty: number): Enemy {
  const e = Enemy.fromVanilla(id, tx * TILE, ty * TILE)!;
  e.id = h.enemies.length + 1;
  h.enemies.push(e);
  return e;
}

function tick(h: Fixture, n: number, only?: Enemy[]) {
  for (let i = 0; i < n; i++) {
    for (const e of only ?? h.enemies) {
      if (!e.dead) e.fixedUpdate(1 / 60, h.hooks);
    }
    for (const p of h.projectiles) {
      if (!p.dead) p.fixedUpdate?.(1 / 60, h.hooks);
    }
  }
}

afterEach(() => { vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------
describe('件1：千兆电击塔 389 电矛 437（NPC.cs:59636-59655）', () => {
  it('分发+出弹：AI_003 战士核驱动 60t 出 2 发 437（冷却 rand 锁 0 → -10 档,30t 间隔）', () => {
    const w = makeWorld(0);
    const h = makeHooks(w, { x: 12 * TILE, y: 100 * TILE });
    const gz = spawn(h, 389, 6, 100);
    vi.spyOn(Math, 'random').mockReturnValue(0);   // rnd(3)=0 → 冷却 -10 → 30t 间隔
    tick(h, 60, [gz]);
    const spears = h.projectiles.filter((p) => p.projId === 437);
    expect(spears.length).toBe(2);                 // ★M1：摘 389 支 → 红
  });

  it('出膛四元组：基伤 25 平值 / direction*6 平飞 / 旗键冻结 389 / hostile', () => {
    const w = makeWorld(0);
    const h = makeHooks(w, { x: 12 * TILE, y: 100 * TILE });
    const gz = spawn(h, 389, 6, 100);
    gz.facing = 1;
    gz.ai2 = 19;                                   // 下一拍 20 → 出弹
    vi.spyOn(Math, 'random').mockReturnValue(0);
    martianFighterExtras(gz, h.hooks, h.player as never);
    const spear = h.projectiles.find((p) => p.projId === 437)!;
    expect(spear.damage).toBe(25);                 // 基伤 25 平值（无重映射,:59655）
    expect(spear.vx).toBe(6);                      // direction*6（facing=1）
    expect(spear.vy).toBe(0);
    expect(spear.bannerNpcId).toBe(389);           // 发射者旗键（389 有旗 139）
    expect(spear.hostile).toBe(true);
  });

  it('三档终伤 50/100/150（hitPlayer 链 DamageVar(0.5 掷=+0 档)→缩放→×2）', () => {
    for (const [diff, expected] of [[0, 50], [1, 100], [2, 150]] as const) {
      const w = makeWorld(diff);
      const h = makeHooks(w, { x: 12 * TILE, y: 100 * TILE });
      const gz = spawn(h, 389, 6, 100);
      gz.facing = 1;
      gz.ai2 = 19;
      vi.spyOn(Math, 'random').mockReturnValue(0.5);  // tier 0 → ×1.0 档
      martianFighterExtras(gz, h.hooks, h.player as never);
      const spear = h.projectiles.find((p) => p.projId === 437)!;
      // collide 谓词代打（弹在敌位未及玩家;原版 Damage_EVP 以 Colliding 为受理门,本测试直取链体）
      hitPlayer(spear as never, h.hooks, spear.damage, false, false, () => true);   // Arrow.hitPlayer 同链
      expect(h.damageCalls[h.damageCalls.length-1]).toBe(expected);   // 转报终值 50/100/150 逐位闭环
    }
  });

  it('门序：confused=-60 不出弹 / 受击 -30 / 冷却三档 -10/-20/-30（:59653）', () => {
    const w = makeWorld(0);
    const h = makeHooks(w, { x: 12 * TILE, y: 100 * TILE });
    const gz = spawn(h, 389, 6, 100);
    gz.confusedT = 999;
    for (let i = 0; i < 40; i++) martianFighterExtras(gz, h.hooks, h.player as never);
    expect(gz.ai2).toBe(-60);
    expect(h.projectiles.filter((p) => p.projId === 437).length).toBe(0);
    gz.confusedT = 0;
    gz.ai2 = 10;
    gz.justHitT = 2;
    martianFighterExtras(gz, h.hooks, h.player as never);
    expect(gz.ai2).toBe(-30);
    for (const [mock, cd] of [[0, -10], [0.4, -20], [0.8, -30]] as const) {
      const g2 = spawn(h, 389, 8, 100);
      g2.facing = 1; g2.ai2 = 19;
      vi.spyOn(Math, 'random').mockReturnValue(mock);
      martianFighterExtras(g2, h.hooks, h.player as never);
      expect(g2.ai2).toBe(cd);
    }
  });
});

// ---------------------------------------------------------------------------
describe('件2：五小怪弹幕旗减（四销案 + 390 真缺补旗）', () => {
  it('骑手 390 出膛带旗（438 基伤 30 平值 + bannerNpcId 类型键 390）', () => {
    const w = makeWorld(0);
    const h = makeHooks(w, { x: 14 * TILE, y: 100 * TILE });
    const mount = spawn(h, 391, 10, 100);
    const rider = spawn(h, 390, 10, 100);
    rider.bInit = true;                            // 跳过首帧生成坐骑
    rider.master = mount;
    mount.facing = 1;
    rider.ai1 = 59;                                // 下一拍 60 → 出弹
    vi.spyOn(Math, 'random').mockReturnValue(0);
    martianSaucerPartAI(rider, h.hooks, h.player as never);
    const shot = h.projectiles.find((p) => p.projId === 438)!;
    expect(shot.damage).toBe(30);                  // num1139 平值（NPC.cs:36011）
    expect(shot.bannerNpcId).toBe(390);            // ★M2：摘旗 → 红（390 有旗 143）
  });

  it('销案锁：381/382/520 走 RANGED_TABLE→spawnHostileProj 冻结（转报快照早于 BJ710-C）', () => {
    // 三表项字面（Enemy.ts RANGED_TABLE;projDmgScale=GetAttackDamage_ForProjectiles 对）
    expect(SRC_ENEMY).toContain('projDmgScale: [24, 19.2]');   // 381→436（NPC.cs:60023-60035+60146-60149）
    expect(SRC_ENEMY).toContain('projDmgScale: [30, 24]');     // 382→438
    expect(SRC_ENEMY).toContain('proj: 436');
    expect(SRC_ENEMY).toContain('proj: 438');
    expect(SRC_ENEMY).toContain('proj: 592');                  // 520→592（35 平值,381-392 重映射带外）
    // spawnHostileProj 无条件冻结发射者旗（BJ710-C 单源,摘除=四怪旗面全塌 →红）
    expect(SRC_ENEMY).toContain('dart.bannerNpcId = bannerNpcKeyOf(this)');
    // 387→435 / 250→264 G35 D1 已接（销案带锚）
    expect(SRC_MARTIAN).toContain('getAttackDamageForProjectiles(35, 28, e.difficulty), 435,');
    expect(SRC_MARTIAN).toContain('20, 264, 300, 1, { bannerNpcId: bannerNpcKeyOf(e) }');
  });

  it('旗表实证：五怪 NPC→banner 键全在（381→136/382→142/387→144/389→139/390→143/520→241）', async () => {
    const { default: banners } = await import('../src/data/vanilla-banners.json');
    const nb = (banners as { npcToBanner: Record<string, number> }).npcToBanner;
    expect(nb['381']).toBe(136);
    expect(nb['382']).toBe(142);
    expect(nb['387']).toBe(144);
    expect(nb['389']).toBe(139);
    expect(nb['390']).toBe(143);
    expect(nb['520']).toBe(241);
    expect(nb['392']).toBeUndefined();   // 飞碟族无旗（死光 bannerNpcId 恒 null 零行为）
  });
});

// ---------------------------------------------------------------------------
describe('件3：死光 447 DamageVar 首掷 + 13 直调站 census 收尾', () => {
  it('447 死光随机浮动三掷形 136/160/184（基伤 80,经典档 ×1×2;DamageVar ±15% 离散档）', () => {
    for (const [mock, expected] of [[0, 136], [0.5, 160], [0.999, 184]] as const) {
      const w = makeWorld(0);
      const h = makeHooks(w, { x: 10 * TILE, y: 103 * TILE });
      const src = spawn(h, 395, 10, 100);
      src.ai0 = 2;                                 // 专家死光弹幕态（:36740+ ai[0]==2）
      src.ai3 = 70;                                // ai[3]%120=70 ≥60 窗内（num1197/1198）
      vi.spyOn(Math, 'random').mockReturnValue(mock);
      const ray = new MartianDeathray(src, 80);    // :371 站（num1195=80 平值）
      for (let i = 0; i < 6; i++) ray.fixedUpdate(1 / 60, h.hooks);   // age 6 → %6==0 命中拍
      expect(h.damageCalls[h.damageCalls.length-1]).toBe(expected); // ★M3：摘 damageVar → 恒 160 → 红
    }
  });

  it('13 站 damageVar 入参包装字面锁（含 BJ712-B 已修 681/683 在位复核）', () => {
    const cnt = (s: string, sub: string) => s.split(sub).length - 1;
    expect(cnt(SRC_MARTIAN, 'evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId)')).toBe(1);   // 447
    expect(cnt(SRC_DEERCLOPS, 'evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId)')).toBe(1); // 965（非冷,旧形保持）★BJ716-A 改判史:曾 3——961/962 增 resistCold 尾参
    expect(cnt(SRC_DEERCLOPS, 'evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId, false, 961)')).toBe(1);  // ★BJ716-A（R15-P2-3）:冷弹 resistCold 门
    expect(cnt(SRC_DEERCLOPS, 'evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId, false, 962)')).toBe(1);  // ★BJ716-A（R15-P2-3）:冷弹 resistCold 门
    expect(cnt(SRC_METEOR, 'evpDirectDmg(game, damageVar(dmg, -p.luck), null, true)')).toBe(1);               // 1078（trap 档保留）
    expect(cnt(SRC_FALLING, 'evpDirectDmg(game, damageVar(this.dmg, -p.luck), null)')).toBe(1);               // 沙坠/巨石族
    expect(cnt(SRC_DD2, 'evpDirectDmg(game, damageVar(this.damage, -(game.player.luck ?? 0)), this.bannerNpcId)')).toBe(1); // 686
    expect(cnt(SRC_DD2, 'evpDirectDmg(game, damageVar(this.dmg, -(game.player.luck ?? 0)), this.bannerNpcId)')).toBe(1);   // 687
    expect(cnt(SRC_DD2, 'damageVar(this.damage, -pl.luck)')).toBe(1);   // 681（BJ712-B 在位）
    expect(cnt(SRC_DD2, 'damageVar(this.dmg, -pl.luck)')).toBe(1);      // 683（BJ712-B 在位）
    expect(cnt(SRC_DUKE, 'evpDirectDmg(game, damageVar(base, -p.luck), this.bannerNpcId)')).toBe(1);          // 384/386 龙卷
    expect(cnt(SRC_DUKE, 'evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId)')).toBe(1);      // 455 月总死光
    expect(cnt(SRC_LUNAR, 'evpDirectDmg(game, damageVar(this.dmg, -p.luck), this.bannerNpcId)')).toBe(1);     // 539 爆盒
    expect(cnt(SRC_DART, 'evpDirectDmg(game, damageVar(this.damage, -p.luck), this.bannerNpcId)')).toBe(2);   // 537/573
    // evpDirectDmg 单源门序（★BJ716-A 改判史:banner→resistCold→缩放→×2——R15-P2-3
    // 补冷门 Projectile.cs:14909-14912,projVid 缺省=旧行为逐位不变;DamageVar 由站侧入参,勿内嵌）
    expect(rd('projTargets.ts')).toContain('let mid = applyBannerDamageReceivedOnProj(game, dmg, bannerNpcId);');
    expect(rd('projTargets.ts')).toContain('mid = Math.trunc(mid * 0.7);');
    expect(rd('projTargets.ts')).toContain('let out = hostileProjectileDamage(mid, mainDifficulty(game.world)) * 2;');
  });

  it('结构锁：Enemy.ts AI_003 分发含 389;437 支字面（防静默回退）', () => {
    expect(SRC_ENEMY).toContain('this.vanillaId === 386 || this.vanillaId === 389) martianFighterExtras');
    expect(SRC_MARTIAN).toContain('if (id === 389) {');
    expect(SRC_MARTIAN).toContain('e.ai2 = -10 + rnd(3) * -10;');
    expect(SRC_MARTIAN).toContain('shootM(game, e.cx, e.cy + 8, e.facing * 6, 0, 25, 437, 300, 1,');
  });
});
