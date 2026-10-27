// 1456→1457 对齐批 2：NPC 侧行为修复回归（标杆 docs/diff-1456-1457-full-report.md
// "NPC.cs 行为差异清单" A-F 组 + 附录 B 代码对照;行号为 1457 Terraria/NPC.cs）。
//   A 组 新 debuff 家族 395/397/398/399/400 + 362 电鳗鞭标记（DOTTally 管线）
//   B 组 DOT 引擎（叠弹 min-1 层钳位 / 电鳗鞭平铺 50 DPS / 木史莱姆 +16 全火焰族）
//   C 组 AI_GlobalFiringDistanceCheck + Nailhead 固定伤 + 蜂族跳力修复
//   E 组 Midas Next(30,51)
//   F 组 695/696 受 NPC 伤固定 5
import { describe, it, expect, vi } from 'vitest';
import { Enemy, aiGlobalFiringDistanceCheck } from '../src/entities/Enemy';
import { applyProjStatus } from '../src/entities/projStatus';
import { nailheadHitScatter } from '../src/entities/fighterFamilies';
import { World } from '../src/world/World';
import { Inventory } from '../src/items/Inventory';
import { Player } from '../src/entities/Player';
import { TILE } from '../src/core/constants';
import { rollCoins } from '../src/drops/NpcDrops';
import type { GameHooks } from '../src/entities/types';

const W = 120, H = 80, FLOOR = 60;

function makeHooks(): { hooks: GameHooks; enemies: Enemy[]; em: { nextId: number; add: (e: unknown, b: string) => void } } {
  const w = new World(W, H, 11, 'diff-1457-batch2');
  const st = w.store;
  w.groundLevel = 30;
  for (let x = 0; x < W; x++) { st.setTile(x, FLOOR, 1); st.setTile(x, FLOOR + 1, 1); }
  w.clock.timeOfDay = 0.9;
  const enemies: Enemy[] = [];
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: string) => {
      (e as { id: number }).id = em.nextId++;
      if (bucket === 'enemies') enemies.push(e as Enemy);
    },
  };
  const player = new Player(W * TILE * 0.5, (FLOOR - 3) * TILE, new Inventory());
  const hooks = {
    world: w, player,
    enemies: () => enemies,
    critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    notifyInventoryChanged: () => {}, playSfx: () => {}, playSfxFiles: () => {},
    playSfxFile: () => {}, playSfxWav: () => {},
    showPickupLabel: () => {}, cutTile: () => {},
    dropContext: () => ({ zoneHallow: false, zoneCorrupt: false, zoneCrimson: false, zoneJungle: false, zoneSnow: false, zoneDesert: false, zoneDungeon: false, zoneBeach: false, bloodMoon: false, halloween: false, xmas: false, windy: false }),
    scene: { zoneHallow: false, zoneGraveyard: false },
    entities: em,
  } as unknown as GameHooks;
  return { hooks, enemies, em };
}

function makeEnemy(h: ReturnType<typeof makeHooks>, vanillaId: number, over: Partial<{ hp: number; defense: number }> = {}): Enemy {
  const e = Enemy.fromVanilla(vanillaId, 60 * TILE, (FLOOR - 3) * TILE)!;
  e.id = h.em.nextId++;
  e.def.defense = over.defense ?? 0;
  e.maxHp = e.hp = over.hp ?? 100000;
  e.iframes = 0;
  e.vx = 0; e.vy = 0;
  h.enemies.push(e);
  return e;
}

/** 1 秒 DoT 步进（字段直写,不经免疫表） */
function dotLoss(field: string, prep?: (e: Enemy) => void): number {
  const h = makeHooks();
  const e = makeEnemy(h, 3, { hp: 100000 });
  (e as unknown as Record<string, number>)[field] = 1;
  prep?.(e);
  e.fixedUpdate(1, h.hooks);
  return 100000 - e.hp;
}

// ===========================================================================
// A/B 组：1457 新 debuff 家族 + DOTTally 管线（NPC.cs:92746-92800）
// ===========================================================================
describe('A 组 1457 新 debuff（DOTTally 等价段）', () => {
  it('395 PotentAcid = 90 HP/s（AddPoison(180,60),:92751）', () => {
    expect(dotLoss('potentAcidT')).toBe(90);
  });
  it('397 ChlorophyteSpore = 90 HP/s（:92755）', () => {
    expect(dotLoss('chlorophyteSporeT')).toBe(90);
  });
  it('362 电鳗鞭 = 50 HP/s 平铺（Add(100,50),:92781——链式缩放删除）', () => {
    expect(dotLoss('eelWhipT')).toBe(50);
  });
  it('398 AcceleratePoisons：可加速族 ×2（毒 6→12 / onFire 4→8）', () => {
    expect(dotLoss('poisonT', (e) => { e.acceleratePoisonsT = 1; })).toBe(12);
    expect(dotLoss('onFireT', (e) => { e.acceleratePoisonsT = 1; })).toBe(8);
  });
  it('398 不加成裸 Add（电鳗鞭 50 恒定 / Oiled 25 恒定,:92840 只乘 SupportAcceleration 池）', () => {
    expect(dotLoss('eelWhipT', (e) => { e.acceleratePoisonsT = 1; })).toBe(50);
    expect(dotLoss('oiledT', (e) => { e.acceleratePoisonsT = 1; e.onFire3T = 1; }))
      .toBe(15 * 2 + 25);   // onFire3 可加速 ×2,oiled 裸 Add 不乘
  });
  it('木史莱姆火系 +16 lifeRegen=+8 HP/s 扩全火焰族（1457 AddFlamable :116-119;'
    + '1456 仅 onFrostBurn 块内）', () => {
    const slime = (e: Enemy) => { e.vanillaId = 1; e.ai1 = 9; };
    expect(dotLoss('onFireT', slime)).toBe(4 + 8);
    expect(dotLoss('frostburnT', slime)).toBe(8 + 8);
    expect(dotLoss('onFire3T', slime)).toBe(15 + 8);
    expect(dotLoss('cursedT', slime)).toBe(24 + 8);
    expect(dotLoss('shadowFlameT', slime)).toBe(15 + 8);
    // 非木史莱姆不加
    expect(dotLoss('onFire3T')).toBe(15);
  });
  it('熔岩史莱姆（ai1=364 族）对 20/70/395/397 运行时豁免静态免疫表（:61312-61316）', () => {
    const h = makeHooks();
    const lava = makeEnemy(h, 1, { hp: 100000 });
    lava.ai1 = 364;
    (lava as unknown as { slimeAI: (g: GameHooks, p: Player | null) => void }).slimeAI(h.hooks, null);
    expect(lava.debuffImmuneOverride?.get(20)).toBe(false);
    expect(lava.debuffImmuneOverride?.get(397)).toBe(false);
    expect(lava.debuffImmuneOverride?.get(395)).toBe(false);
    // 静态表 1:[20] 免疫中毒 → 覆写后可施加（proj 98 = 毒弹 → buff 20）
    const rec: Record<string, number> = lava as unknown as Record<string, number>;
    applyProjStatus(98, rec);
    expect(rec.poisonT).toBeGreaterThan(0);
    // 普通蓝史莱姆（无覆写）仍被静态表挡住（poisonT 保持缺省 0）
    const h2 = makeHooks();
    const plain = makeEnemy(h2, 1, { hp: 100000 });
    const rec2: Record<string, number> = plain as unknown as Record<string, number>;
    applyProjStatus(98, rec2);
    expect(rec2.poisonT).toBe(0);
  });
});

// ===========================================================================
// B 组：叠弹 DOT min-1 层钳位（AddStackedProjecitle :100-103）
// ===========================================================================
describe('B 组 叠弹 min-1 层钳位', () => {
  it('598 骨标：buff 在而层池空 → 按 1 层计 3 HP/s（1456 为 0）', () => {
    expect(dotLoss('javelinT')).toBe(3);
    expect(dotLoss('spikeT')).toBe(3);
    expect(dotLoss('butcherT')).toBe(4);
    expect(dotLoss('stardustT')).toBe(20);
  });
});

// ===========================================================================
// C 组：Nailhead 固定伤 + 全局开火视野门 + 蜂族跳力
// ===========================================================================
describe('C 组 AI 数值/条件', () => {
  it('Nailhead 463 钉弹固定伤 GetAttackDamage_ForProjectiles(15,25)（:57792）——'
    + '经典 15 / 专家 25,不再随本体 damage×0.15', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // 1/3 掷中 + 弹数/方向确定
    const h = makeHooks();
    const e = makeEnemy(h, 463, { hp: 100000 });
    const fired: Array<{ dmg: number; proj: number }> = [];
    (e as unknown as { spawnHostileProj: (g: unknown, x: number, y: number, vx: number, vy: number, dmg: number, proj: number) => void }).spawnHostileProj =
      (_g: unknown, _x: number, _y: number, _vx: number, _vy: number, dmg: number, proj: number) => {
        fired.push({ dmg, proj });
      };
    e.difficulty = 1;   // GDL.CLASSIC
    e.justHitT = 2; e.lai3 = 0;
    nailheadHitScatter(e, h.hooks, null);
    expect(fired.length).toBeGreaterThan(0);
    for (const f of fired) {
      expect(f.proj).toBe(498);
      expect(f.dmg).toBe(15);
    }
    const h2 = makeHooks();
    const e2 = makeEnemy(h2, 463, { hp: 100000 });
    const fired2: number[] = [];
    (e2 as unknown as { spawnHostileProj: (g: unknown, x: number, y: number, vx: number, vy: number, dmg: number) => void }).spawnHostileProj =
      (_g: unknown, _x: number, _y: number, _vx: number, _vy: number, dmg: number) => { fired2.push(dmg); };
    e2.difficulty = 2;  // GDL.EXPERT
    e2.justHitT = 2; e2.lai3 = 0;
    nailheadHitScatter(e2, h2.hooks, null);
    expect(fired2.length).toBeGreaterThan(0);
    for (const d of fired2) expect(d).toBe(25);
    vi.restoreAllMocks();
  });
  it('AI_GlobalFiringDistanceCheck（:56405）：MaxWorldViewSize(1920×1200)−50 视野矩形,'
    + '半轴 910×550(Inflate(-50) 每侧内缩,非尺寸-50),Rectangle.Contains 左闭右开（参数序 = 射手,目标）', () => {
    expect(aiGlobalFiringDistanceCheck(909, 549, 0, 0)).toBe(true);   // 内缘
    expect(aiGlobalFiringDistanceCheck(-910, -550, 0, 0)).toBe(true); // 左/上缘闭
    expect(aiGlobalFiringDistanceCheck(910, 0, 0, 0)).toBe(false);    // 右缘开
    expect(aiGlobalFiringDistanceCheck(0, 550, 0, 0)).toBe(false);    // 下缘开
    expect(aiGlobalFiringDistanceCheck(935, 0, 0, 0)).toBe(false);    // 旧错值更拒
    expect(aiGlobalFiringDistanceCheck(0, 575, 0, 0)).toBe(false);
    expect(aiGlobalFiringDistanceCheck(936, 0, 0, 0)).toBe(false);
    expect(aiGlobalFiringDistanceCheck(0, 576, 0, 0)).toBe(false);
  });
  it('蜂族 42/231-235 速度乘区 1f−scale → 2f−scale（:50884-50885,scale=1 时 1456=0）', () => {
    const h = makeHooks();
    const hornet = makeEnemy(h, 42, { hp: 100000 });
    hornet.fixedUpdate(1 / 60, h.hooks);
    // ★BJ731 改判史（2026-10-27）：BJ703-C D6（2026-10-21）落地原版 |vx|<0.005
    //   清零（NPC.cs:91588-91591,AI 后无条件）——首拍 vx=osc(−0.023)+accel(+0.021)
    //   =−0.002 被 :91588 清零,旧「单拍 |vx|>0」断言在【已修复】代码上恰红;
    //   而 1456 档 ×(1−scale)=0（accel=0）留下纯 osc −0.023 不入清零带=旧断言
    //   反而绿——单拍 |vx| 无判别力,判别面改 vy：
    //   1457 档首拍 vy=osc(+0.023)+accel(+0.021)=0.044;1456 档 accel=0 且
    //   sy=maxSpd×0=0 → vy=0.023。0.03 阈值双面判别。
    expect(hornet.vy).toBeGreaterThan(0.03);
    for (let t = 0; t < 119; t++) hornet.fixedUpdate(1 / 60, h.hooks);
    expect(Math.abs(hornet.vx)).toBeGreaterThan(0.1);   // t101 起 osc 翻 +,vx 持续起步（模拟 t130≈0.86）
  });
});

// ===========================================================================
// E/F 组：Midas 30-50% + 695/696 固定接触伤
// ===========================================================================
describe('E/F 组 掉落与接触伤', () => {
  it('Midas 加成 Next(30,51)（:80450,1456 为 Next(10,51)）——首个 int 掷 = (30,50)', () => {
    const calls: Array<[number, number]> = [];
    const rng = {
      next: () => 0,
      int: (a: number, b: number) => { calls.push([a, b]); return b; },
    };
    rollCoins(100, { rng } as never, false, true);
    expect(calls[0]).toEqual([30, 50]);
  });
  it('695/696 受其他 NPC 接触伤固定 5（BeHurtByOtherNPC :93594-93596）', () => {
    for (const vid of [695, 696]) {
      const h = makeHooks();
      const victim = makeEnemy(h, vid, { hp: 100000, defense: 0 });
      const foe = makeEnemy(h, 3, { hp: 100000 });
      foe.def.damage = 40;
      // 盒重叠（BeHurtByOtherNPC 接触门）
      foe.x = victim.x; foe.y = victim.y;
      (victim as unknown as { npcVsNpcContactUpdate: (g: GameHooks) => void })
        .npcVsNpcContactUpdate(h.hooks);
      expect(100000 - victim.hp).toBe(5);
    }
  });
});
