// ★BJ720-A（2026-10-25）issue #19（SandboxWorldOnline/Open-Terraria）负 netID/体型
//  变体域七件清偿——判别锁（行为面）+结构锁（源文本锚）。
//  基准 Terarria1457 亲读：
//   · D12 SetDefaultsFromNetId 尾段（NPC.cs:8363-8372）：case -1..-10 硬置后
//     `if (flag) { ScaleStats(...); life = lifeMax; }`——flag=true 族三档照吃难度链
//     （ByDifficulty 乘区 + ForExpertHardmode 肉后兜底 :18448-18497 + 世花后
//     num2 80→100 + lifeMax<6 下限）。case 体 kbr 乘子（:7694 ×1.2 /:7722 ×1.4 /
//     :7733 ×0.95 /:7753 ×0.9）与 value 硬置（100/100/3/10000/10/20/10/8/10/500）。
//   · D12 分裂/携带链：母史莱姆 16→-5（:85716-85735）、飞尸 121→-2（:86418-86431）、
//     腐化史莱姆 81→-1（:86434-86452）、风气球 594 携带 -4/-7/-3（:48269-48272
//     NewNPC(1)+SetDefaults(-N)）——同走尾段重排 + netID 身份（BannerID/击杀计账）。
//   · D13 黄蜂毒刺 (int)(10f×scale)/(int)(30f×scale)（:51331-51335）——npc.scale
//     终态（负 netID 变体 -16..-21/-56..-65 ≠1）+ (int) 截断（非 round）。
//   · B03 BannerID()（:7672-7679）netID≥-10 直通——G35 D3b 已修，本文件带 belt。
//   · B01-④ 291 Kill→292（P.cs:75802-75807 GetProjectileSource_FromThis=
//     EntitySource_Parent(291 弹)→FindBannerToAssociateTo :11108-11113 派生弹继承
//     父弹旗）；B01-② 693 书弹（NPC.cs:21215 GetSpawnSource_ForProjectile 旗注入）。
//   · D07 飞蛾魔 477 三态（:38206 damage=defDamage / :38388 ×0.5 / :38536 ×1.3，
//     (int) 截断）——三档三态数值闭环（80/160/240 → 40/80/120 → 104/208/312）。
// 运行：cd game && npx vitest run tests/bj720a-issue19-variants.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VanillaSpawner, NET_ID_MAP } from '../src/world/spawn/VanillaSpawner';
import { World } from '../src/world/World';
import { RNG } from '../src/core/rng';
import { Enemy } from '../src/entities/Enemy';
import { bannerNpcKeyOf } from '../src/entities/projTargets';
import { bindScaleStatsWorld, GDL, type ScaleStatsWorld, truncCSf32Mul } from '../src/stats/ScaleStats';
import { mothronAI } from '../src/entities/bossAI_lunar_misc';
import { Dart } from '../src/entities/Dart';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const rd = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// ---- 难度上下文（CLASSIC_SCALE_WORLD 形制的字面夹具；afterEach 恒解绑防串档） ----
const ctx = (o: Partial<ScaleStatsWorld> = {}): ScaleStatsWorld => ({
  difficulty: GDL.CLASSIC, hardMode: false, getGoodWorld: false,
  tenthAnniversaryWorld: false, remixWorld: false, zenithWorld: false,
  downedPlantBoss: false, anyNpc: () => false, activePlayerCount: 1, ...o,
});
afterEach(() => bindScaleStatsWorld(null));

// spawnNPC 私有通道（bj337/bj344 同款 cast）
const spawner = new VanillaSpawner(new World(400, 400, 42, 'jungle'));
const spawnNPC = (netId: number) =>
  (spawner as unknown as {
    spawnNPC: (x: number, y: number, id: number, rng: RNG) => Enemy | null;
  }).spawnNPC(100, 100, netId, new RNG(42));

interface Spawned {
  vanillaId: number; vanillaNetId?: number; hp: number; maxHp: number;
  def: { damage: number; defense: number; knockbackResist?: number; value?: number };
}

// ============================================================================
// D12：负 netID 史莱姆 -1..-10 尾段 flag=true 重排（三档数值闭环）
// ============================================================================
describe('BJ720-A D12：spawnNPC(-1..-10) 三档（尾段 ScaleStats 重排）', () => {
  // [netId, life, dmg, def, value, kb]——case 体逐值（NPC.cs:7688-7783）
  const CASES: Array<[number, number, number, number, number, number]> = [
    [-1, 90, 45, 10, 100, 1.2], [-2, 90, 45, 20, 100, 1.2],
    [-3, 14, 6, 0, 3, 1.2], [-4, 150, 5, 5, 10000, 1.4],
    [-5, 30, 13, 4, 10, 0.95], [-6, 45, 15, 4, 20, 1],
    [-7, 40, 12, 6, 10, 0.9], [-8, 35, 12, 4, 8, 1],
    [-9, 45, 15, 7, 10, 1], [-10, 60, 18, 6, 500, 1],
  ];

  it('经典档：hp/dmg/def=case 原值 + kbr ×case 乘子 + value 硬置（变异恰红：旧档三档同值/漏 kbr/value）', () => {
    bindScaleStatsWorld(ctx());
    for (const [id, life, dmg, def, val, kb] of CASES) {
      const e = spawnNPC(id)!;
      expect(e.maxHp, `netID ${id} life`).toBe(life);
      expect(e.def.damage, `netID ${id} dmg`).toBe(dmg);
      expect(e.def.defense, `netID ${id} def`).toBe(def);
      expect(e.def.value, `netID ${id} value`).toBe(val);
      expect(e.def.knockbackResist!, `netID ${id} kbr`).toBeCloseTo(kb, 6);
    }
  });

  it('专家档（非肉后）：×2 生命/伤害 + ×2.5 钱 + kbr 双乘难度（旧档停经典值=恰红）', () => {
    bindScaleStatsWorld(ctx({ difficulty: GDL.EXPERT }));
    const e3 = spawnNPC(-3)!;
    expect(e3.maxHp).toBe(28);                       // trunc(14×2)
    expect(e3.def.damage).toBe(12);                  // trunc(6×2)
    expect(e3.def.value).toBe(7);                    // trunc(3×2.5)
    // kbr 三段链（原版同构）：基底 SetDefaults 尾 ×0.9 → case ×1.2 → 尾段再 ×0.9
    expect(e3.def.knockbackResist!).toBeCloseTo(0.972, 6);
    const e1 = spawnNPC(-1)!;
    expect(e1.maxHp).toBe(180);
    expect(e1.def.damage).toBe(90);
    expect(e1.def.value).toBe(250);                  // trunc(100×2.5)
    expect(e1.def.knockbackResist!).toBeCloseTo(0.972, 6);
    const e10 = spawnNPC(-10)!;
    expect(e10.maxHp).toBe(120);
    expect(e10.def.damage).toBe(36);
    expect(e10.def.value).toBe(1250);
  });

  it('专家+肉后：ForExpertHardmode 兜底（num=dmg+def+life/4 拉到 80；世花后 100）', () => {
    // -3：num=6+0+3=9 <80 → num3=floor(80/9)=8 → FEH dmg trunc(48×0.9)=43、life
    // trunc(112×1.1)=123、value trunc(24×0.8)=19 → ByDifficulty ×2/×2.5
    bindScaleStatsWorld(ctx({ difficulty: GDL.EXPERT, hardMode: true }));
    const e3 = spawnNPC(-3)!;
    expect(e3.maxHp).toBe(246);
    expect(e3.def.damage).toBe(86);
    expect(e3.def.value).toBe(47);
    // 世花后（downedPlantBoss）：num2=100 → num3=floor(100/9)=11
    bindScaleStatsWorld(ctx({ difficulty: GDL.EXPERT, hardMode: true, downedPlantBoss: true }));
    const e3p = spawnNPC(-3)!;
    expect(e3p.maxHp).toBe(338);                     // trunc(trunc(14×11)×1.1)=169 → ×2
    expect(e3p.def.damage).toBe(118);                // FEH trunc(66×0.9)=59 → ByDifficulty ×2
    expect(e3p.def.value).toBe(65);                  // trunc(33×0.8)=26 → ×2.5
    // -1：num=45+10+22=77 <80 → num3=1 → FEH dmg trunc(45×0.9)=40、life trunc(90×1.1)=99
    bindScaleStatsWorld(ctx({ difficulty: GDL.EXPERT, hardMode: true }));
    const e1 = spawnNPC(-1)!;
    expect(e1.maxHp).toBe(198);
    expect(e1.def.damage).toBe(80);
    expect(e1.def.defense).toBe(10);                 // ×1 后 ×2 难度乘区不触及防
  });

  it('NET_ID_MAP value/kb 钉值（case 体 :7695-7782 逐行）', () => {
    const pins: Record<number, [number | undefined, number | undefined]> = {
      [-1]: [100, 1.2], [-2]: [100, 1.2], [-3]: [3, 1.2], [-4]: [10000, 1.4],
      [-5]: [10, 0.95], [-6]: [20, undefined], [-7]: [10, 0.9], [-8]: [8, undefined],
      [-9]: [10, undefined], [-10]: [500, undefined],
    };
    for (const k of Object.keys(pins).map(Number)) {
      expect(NET_ID_MAP[k]!.value, `netID ${k} value`).toBe(pins[k][0]);
      expect(NET_ID_MAP[k]!.kb, `netID ${k} kb`).toBe(pins[k][1]);
    }
  });
});

// ============================================================================
// D12：分裂幼体（母史莱姆 16→-5 / 飞尸 121→-2 / 腐化史莱姆 81→-1）
// ============================================================================
function splitHooks(): { hooks: GameHooks; enemies: Enemy[] } {
  const w = new World(120, 120, 7, 'bj720a-split');
  const enemies: Enemy[] = [];
  let nextId = 1;
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: string) => {
      const ent = e as { id: number };
      ent.id = nextId++;
      if (bucket === 'enemies') enemies.push(e as Enemy);
    },
  };
  const px = 60 * TILE, py = 100 * TILE;
  const player = {   // hurt 死亡分支读 luck/hp/mana（心星条件结算）+ addDPS/lastCreatureHit
    x: px, y: py, w: 20, h: 42, cx: px + 10, cy: py + 21, vx: 0, vy: 0,
    hp: 400, maxHp: 400, mana: 100, maxMana: 100, luck: 0, dead: false,
    stealth: 0, itemAnimTicks: 0, useTime: 0, iframes: 0,
    lastCreatureHit: -1, buffs: new Map(),
    addDPS: () => {},
    aabbOverlaps: () => false,
  };
  const hooks = {
    world: w,
    player,
    enemies: () => enemies,
    npcs: () => [], critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, spawnParticles: () => {}, spawnDust: () => null,
    notifyInventoryChanged: () => {}, playSfx: () => {}, playSfxFiles: () => {},
    playSfxWav: () => {}, showPickupLabel: () => {}, entities: em,
  } as unknown as GameHooks;
  void nextId;
  return { hooks, enemies };
}

describe('BJ720-A D12：死亡分裂站（尾段重排消费链）', () => {
  const kill = (id: number): Enemy[] => {
    const { hooks, enemies } = splitHooks();
    const e = Enemy.fromVanilla(id, 60 * TILE, 100 * TILE)!;
    e.id = 999;
    enemies.push(e);
    e.hurt(99999, 0, 0, hooks, 0, false, 0, true);
    return enemies.filter((n) => n !== e && !n.dead);
  };

  it('母史莱姆 16 死 → -5 幼体：专家档 60/26（旧 raw 30/13=恰红）+ kbr×0.95×0.9', () => {
    bindScaleStatsWorld(ctx({ difficulty: GDL.EXPERT }));
    const kids = kill(16).filter((n) => n.vanillaNetId === -5);
    expect(kids.length).toBeGreaterThanOrEqual(2);   // Next(2)+2 = 2-3
    for (const k of kids) {
      expect(k.maxHp).toBe(60);                      // trunc(30×2)
      expect(k.def.damage).toBe(26);                 // trunc(13×2)
      expect(k.def.defense).toBe(4);
      expect(k.def.value).toBe(25);                  // trunc(10×2.5)
      expect(k.def.knockbackResist!).toBeCloseTo(0.7695, 6);  // 0.9（基底尾）×0.95（case）×0.9（尾段）
      expect(bannerNpcKeyOf(k)).toBe(-5);            // 击杀计账排除面（excludedFromDeathTally）
    }
  });

  it('飞尸 121 死 → -2：专家档 180/90 + value 250 + kbr 1.08（旧 kbr 直写 1.2=恰红）', () => {
    bindScaleStatsWorld(ctx({ difficulty: GDL.EXPERT }));
    const kids = kill(121).filter((n) => n.vanillaNetId === -2);
    expect(kids.length).toBe(1);
    const s = kids[0];
    expect(s.vanillaId).toBe(81);
    expect(s.maxHp).toBe(180);
    expect(s.def.damage).toBe(90);
    expect(s.def.defense).toBe(20);
    expect(s.def.value).toBe(250);
    expect(s.def.knockbackResist!).toBeCloseTo(0.972, 6);  // 0.9×1.2×0.9（三段链）
  });

  it('腐化史莱姆 81 死 → -1×2-3：专家档 180/90（旧 raw 90=恰红）', () => {
    bindScaleStatsWorld(ctx({ difficulty: GDL.EXPERT }));
    const kids = kill(81).filter((n) => n.vanillaNetId === -1);
    expect(kids.length).toBeGreaterThanOrEqual(2);
    for (const c of kids) {
      expect(c.maxHp).toBe(180);
      expect(c.def.damage).toBe(90);
      expect(c.def.defense).toBe(10);
      expect(c.def.value).toBe(250);
      expect(c.def.knockbackResist!).toBeCloseTo(0.972, 6);  // 0.9×1.2×0.9（三段链）
    }
  });
});

// ============================================================================
// D12+#7：风气球 594 携带变体（真实 windyBalloonAI 首帧挂载）
// ============================================================================
describe('BJ720-A D12+#7：风气球 594 携带变体（身份+尾段重排）', () => {
  const balloonSlave = (rand: number): Enemy | null => {
    const { hooks, enemies } = splitHooks();
    const b = Enemy.fromVanilla(594, 60 * TILE, 40 * TILE)!;
    b.id = 1;
    enemies.push(b);
    const orig = Math.random;
    Math.random = () => rand;   // ai2 装饰掷与变体掷同源（0/0.05/0.2 三档命中三分支）
    try {
      (b as unknown as { windyBalloonAI(g: GameHooks, p: Player2 | null): void })
        .windyBalloonAI(hooks, null);
    } finally { Math.random = orig; }
    return enemies.find((n) => n !== b && n.vanillaId === 1) ?? null;
  };
  type Player2 = { cx: number; cy: number; dead: boolean };

  it.each([
    [0.0, -4, 150, 5, 5, 10000, 1.4],   // r<1/180 金史莱姆
    [0.05, -7, 40, 12, 6, 10, 0.9],     // 1/180≤r<1/10 母史莱姆
    [0.2, -3, 14, 6, 0, 3, 1.2],        // 1/10≤r<1/3 绿史莱姆
  ] as Array<[number, number, number, number, number, number, number]>)(
    '经典档 rand=%s → netID %s：%s/%s/%s + value %s + kbr×%s',
    (rand, netId, life, dmg, def, val, kb) => {
      bindScaleStatsWorld(ctx());
      const slave = balloonSlave(rand);
      expect(slave, 'slave 未挂载').not.toBeNull();
      expect(slave!.vanillaNetId, '#7 身份缺口（BannerID/击杀计账域）').toBe(netId);
      expect(slave!.maxHp).toBe(life);
      expect(slave!.def.damage).toBe(dmg);
      expect(slave!.def.defense).toBe(def);
      expect(slave!.def.value).toBe(val);
      expect(slave!.def.knockbackResist!).toBeCloseTo(kb, 6);
      expect(bannerNpcKeyOf(slave!)).toBe(netId);
    });

  it('专家档：携带变体同吃难度链（-3 → 28/12；旧恒 14/6=恰红）', () => {
    bindScaleStatsWorld(ctx({ difficulty: GDL.EXPERT }));
    const slave = balloonSlave(0.2);
    expect(slave!.vanillaNetId).toBe(-3);
    expect(slave!.maxHp).toBe(28);
    expect(slave!.def.damage).toBe(12);
    expect(slave!.def.value).toBe(7);
  });

  it('r≥1/3：普通蓝史莱姆（无变体覆盖,身份 netId=1）', () => {
    bindScaleStatsWorld(ctx());
    const slave = balloonSlave(0.9);
    expect(slave).not.toBeNull();
    expect(slave!.vanillaNetId ?? 0).toBe(0);   // fromVanilla 直出无变体
    expect(bannerNpcKeyOf(slave!)).toBe(1);
  });
});

// ============================================================================
// D13：黄蜂大小变体毒刺（npc.scale 终态 + (int) 截断）
// ============================================================================
describe('BJ720-A D13：黄蜂毒刺基伤（变体体型+截断）', () => {
  // issue 表 16 变体逐值：[netId, base, scale, 期望]
  const VARIANTS: Array<[number, number, number, number]> = [
    [-16, 42, 0.85, 8], [-17, 42, 1.2, 12],
    [-18, 176, 0.8, 24], [-19, 176, 0.9, 27], [-20, 176, 1.1, 33], [-21, 176, 1.2, 36],
    [-56, 231, 0.85, 8], [-57, 231, 1.25, 12],
    [-58, 232, 0.8, 8], [-59, 232, 1.15, 11],
    [-60, 233, 0.92, 9], [-61, 233, 1.1, 11],
    [-62, 234, 0.78, 7], [-63, 234, 1.16, 11],
    [-64, 235, 0.87, 8], [-65, 235, 1.21, 12],
  ];

  it('结构锁：swarmerAI scale=npc.scale 终态（表×vanillaScale）+ 毒刺 truncCSf32Mul', () => {
    const src = rd('src/entities/Enemy.ts');
    expect(src).toContain(
      'const scale = (this.vanilla?.scale ?? 1) * (this.vanillaScale ?? 1);');
    expect(src).toContain('truncCSf32Mul(vid === 176 ? 30 : 10, scale), 55)');
    // 变异恰红位：旧实现裸表 scale + Math.round
    expect(src).not.toContain('Math.round((vid === 176 ? 30 : 10) * scale)');
  });

  it('行为锁：变体 npc.scale 终态 = box.scale（spawnNPC 注入 vanillaScale）+ 基伤公式逐值', () => {
    bindScaleStatsWorld(ctx());
    for (const [netId, base, , exp] of VARIANTS) {
      const e = spawnNPC(netId)!;
      expect(e.vanillaId, `netID ${netId} base`).toBe(base);
      // npc.scale 终态 = v.scale × vanillaScale（渲染口径逆读 = D13 的 scale 消费面）
      const npcScale = (e.vanilla?.scale ?? 1) * (e.vanillaScale ?? 1);
      expect(truncCSf32Mul(base === 176 ? 30 : 10, npcScale),
        `netID ${netId} 毒刺基伤`).toBe(exp);
    }
  });

  it('截断判别：truncCSf32Mul(10,0.85)=8 / (10,0.78)=7 / (30,0.9)=27（round 会给 9/8/27）', () => {
    expect(truncCSf32Mul(10, 0.85)).toBe(8);      // 8.5 → 8（round 9=红）
    expect(truncCSf32Mul(10, 0.78)).toBe(7);      // 7.8 → 7（round 8=红）
    expect(truncCSf32Mul(30, 0.9)).toBe(27);
    expect(truncCSf32Mul(10, 1.21)).toBe(12);     // 12.1 → 12
  });

  it('行为锁：真实 swarmerAI 毒刺出膛（-16 小黄蜂 → 弹 55 基伤 8 / -21 巨苔藓黄蜂 → 36）', () => {
    bindScaleStatsWorld(ctx());
    const fireStinger = (netId: number): number | null => {
      const w = new World(160, 140, 7, 'bj720a-hornet');
      for (let x = 0; x < 160; x++) { w.store.setTile(x, 120, 1); w.store.setTile(x, 121, 1); }
      const projs: Array<{ projId?: number; damage: number; hostile?: boolean }> = [];
      const player = {
        x: 60 * TILE + 300, y: 100 * TILE, w: 20, h: 42,
        cx: 60 * TILE + 310, cy: 100 * TILE + 21, vx: 0, vy: 0,
        hp: 400, maxHp: 400, dead: false, stealth: 0,
        // 毒刺蓄力只在玩家 item 动画窗累计（:51168-51175 stealth==0 &&
        // itemAnimation==0 → ai[1]=0 待机清零——原版机制:挥空物品时蜂才蓄力）
        itemAnimTicks: 1, useTime: 1,
        aabbOverlaps: () => false,
      };
      const hooks = {
        world: w, player,
        enemies: () => [], npcs: () => [], critters: () => [],
        spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
        cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
        spawnParticles: () => {}, spawnDust: () => null, notifyInventoryChanged: () => {},
        playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
        showPickupLabel: () => {},
        entities: { add: (e: unknown) => projs.push(e as never) },
      } as unknown as GameHooks;
      const e = spawnNPC(netId)!;
      e.x = 60 * TILE; e.y = 100 * TILE;
      e.vx = 2; e.vy = 0;
      e.ai1 = 129.5;   // 一拍蓄力（+0.5..3.4）越 130 → 发射窗
      const orig = Math.random;
      Math.random = () => 0.5;   // 散布 +0.5 不翻向（玩家在 +300px）
      try {
        (e as unknown as { swarmerAI(g: GameHooks, p: unknown): void }).swarmerAI(hooks, player);
      } finally { Math.random = orig; }
      const stinger = projs.find((d) => d.projId === 55 && d.hostile);
      return stinger ? stinger.damage : null;
    };
    expect(fireStinger(-16), '-16 Little Stinger 基伤').toBe(8);    // (int)(10×0.85)
    expect(fireStinger(-17), '-17 Big Stinger 基伤').toBe(12);      // (int)(10×1.2)
    expect(fireStinger(-21), '-21 Giant Moss Hornet 基伤').toBe(36); // (int)(30×1.2)
    expect(fireStinger(-18), '-18 Tiny Moss Hornet 基伤').toBe(24);  // (int)(30×0.8)
  });
});

// ============================================================================
// B03 belt：BannerID() netID≥-10 直通（G35 D3b 主修,本带锁变体域）
// ============================================================================
describe('BJ720-A B03 belt：变体史莱姆旗键域（NPC.cs:7672-7679）', () => {
  it('spawnNPC 变体 → bannerNpcKeyOf = netID 本身（-3 绿/-1 腐化/-4 粉）', () => {
    bindScaleStatsWorld(ctx());
    for (const [netId, base] of [[-3, 1], [-1, 81], [-4, 1], [-10, 1]] as const) {
      const e = spawnNPC(netId)!;
      expect(e.vanillaId).toBe(base);
      expect(bannerNpcKeyOf(e), `netID ${netId} 旗键`).toBe(netId);
    }
    // -12 getGood 僵尸回落 type=6（≥-10 上界外的回落面,G35 D3b）
    const z = spawnNPC(-12)!;
    expect(z.vanillaId).toBe(6);
    expect(bannerNpcKeyOf(z)).toBe(6);
  });
});

// ============================================================================
// B01-④/②：派生弹旗继承（291→292）与 693 书弹发射者旗
// ============================================================================
describe('BJ720-A B01：派生弹/书弹发射者旗', () => {
  it('291 Kill → 292 爆区继承父弹旗（P.cs:75802-75807 + :11108-11113）', () => {
    const w = new World(120, 120, 7, 'bj720a-292');
    const projs: unknown[] = [];
    const hooks = {
      world: w, player: null, enemies: () => [], npcs: () => [], critters: () => [],
      spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
      cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
      spawnParticles: () => {}, spawnDust: () => null, notifyInventoryChanged: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
      showPickupLabel: () => {},
      entities: { add: (e: unknown) => projs.push(e) },
    } as unknown as GameHooks;
    const d = new Dart(60 * TILE, 60 * TILE, 1, 0, 40, 291);
    d.bannerNpcId = 105;   // 285/286 Diabolist 旗键（发射站冻结面）
    (d as unknown as { inferno291Kill(g: GameHooks): void }).inferno291Kill(hooks);
    const blast = projs[0] as { bannerNpcId: number | null };
    expect(blast, '292 未生成').toBeDefined();
    expect(blast.bannerNpcId, '派生弹继承父弹旗').toBe(105);   // 旧缺=null 恰红
  });

  it('结构锁：693 书弹站 + Dart 双生成口旗透传 + BookProj/InfernoHostileBlast 字段', () => {
    const enemy = rd('src/entities/Enemy.ts');
    expect(enemy).toContain('book.bannerNpcId = bannerNpcKeyOf(this)');
    const dart = rd('src/entities/Dart.ts');
    expect(dart.match(/blast\.bannerNpcId = this\.bannerNpcId/g)?.length)
      .toBeGreaterThanOrEqual(2);   // 本地 Kill 口 + destroy 镜像口
    expect(rd('src/entities/BookProj.ts')).toContain('bannerNpcId: number | null = null');
    expect(rd('src/entities/InfernoHostileBlast.ts')).toContain('bannerNpcId: number | null = null');
  });
});

// ============================================================================
// D07：飞蛾魔 477 三态三档数值闭环（issue 表：40/80/120 与 104/208/312）
// ============================================================================
describe('BJ720-A D07：Mothron 477 三态（普通/近战×0.5/冲刺×1.3）', () => {
  const mothron = (difficulty: number): { base: number; melee: number; dash: number } => {
    bindScaleStatsWorld(ctx({ difficulty }));
    const w = new World(120, 120, 7, 'bj720a-mothron');
    const player = {
      x: 60 * TILE + 200, y: 60 * TILE, w: 20, h: 42,
      cx: 60 * TILE + 210, cy: 60 * TILE + 21, dead: false,
    };
    const hooks = {
      world: w, player,
      enemies: () => [], npcs: () => [], critters: () => [],
      spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
      cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
      spawnParticles: () => {}, spawnDust: () => null, notifyInventoryChanged: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
      showPickupLabel: () => {}, entities: { add: () => {} },
    } as unknown as GameHooks;
    (w as unknown as { clock: { eclipse: boolean } }).clock = { eclipse: true };
    const e = Enemy.fromVanilla(477, 60 * TILE, 60 * TILE)!;
    e.ai0 = 2;
    mothronAI(e, hooks, player as never);
    const melee = e.def.damage;
    e.ai0 = 3.2;
    e.ai1 = 1;   // 冲刺向（非零防除零）
    mothronAI(e, hooks, player as never);
    const dash = e.def.damage;
    e.ai0 = 0;   // 悬顶态（damage=defDamage 基线）
    e.ai1 = 0;
    mothronAI(e, hooks, player as never);
    return { base: e.def.damage, melee, dash };
  };

  it.each([
    [GDL.CLASSIC, 80, 40, 104],
    [GDL.EXPERT, 160, 80, 208],
    [GDL.MASTER, 240, 120, 312],
  ] as Array<[number, number, number, number]>)(
    '难度 %s：普通 %s / 近战 %s / 冲刺 %s（issue D07 表逐值）',
    (difficulty, base, melee, dash) => {
      const m = mothron(difficulty);
      expect(m.base, '普通态=defDamage').toBe(base);
      expect(m.melee, '近战态 ×0.5').toBe(melee);
      expect(m.dash, '冲刺态 ×1.3').toBe(dash);
    });
});

// ============================================================================
// X04 销案 belt：537/573 直击环 DV+旗面（716A F2/BJ710-C 已修——带锁防回退）
// ============================================================================
describe('BJ720-A X04 belt：观星怪 537/预言怪 573 直击环（销案复核）', () => {
  it('结构锁：两站均走 evpDirectDmg(damageVar, bannerNpcId) 单源', () => {
    const dart = rd('src/entities/Dart.ts');
    expect(dart.match(/evpDirectDmg\(game, damageVar\(this\.damage, -p\.luck\), this\.bannerNpcId\)/g)?.length)
      .toBeGreaterThanOrEqual(2);   // 537 束 :3223 + 573 蓄能弹 :3291（+其余直调站）
  });
});

// ============================================================================
// B01-①②③ census 锁：issue 点名的发射站全数在旗冻结面（spawnHostileProj/shootDart
// 两通道恒冻 bannerNpcId——BJ710-C；此处锁「站点存在」防静默退役）
// ============================================================================
describe('BJ720-A B01 census：issue 链路清单全数在冻结面', () => {
  it('远程战士表 25 NPC（111/214-216/110/206/290-293/449-452/481/498-506/468）全在 RANGED_TABLE', () => {
    const RANGED = (Enemy as unknown as {
      RANGED_TABLE: Record<number, unknown>; RANGED_FIGHTERS: Set<number>;
    });
    const ids = [111, 214, 215, 216, 110, 206, 290, 291, 292, 293,
      449, 450, 451, 452, 481, 498, 499, 500, 501, 502, 503, 504, 505, 506, 468];
    for (const id of ids) {
      expect(RANGED.RANGED_TABLE[id], `远程战士 ${id} 缺表行=发射站退役`).toBeDefined();
      expect(RANGED.RANGED_FIGHTERS.has(id), `远程战士 ${id} 缺集合行`).toBe(true);
    }
  });

  it('结构锁：shootDart/spawnHostileProj 双通道恒冻发射者旗（全清单消费总闸）', () => {
    const src = rd('src/entities/Enemy.ts');
    expect(src).toContain('dart.bannerNpcId = bannerNpcKeyOf(this);');
    // 直赋值站 10（双通道 shootDart/spawnHostileProj + G35 D1 直构 Dart 站）+
    // 对象字面量站 3（{ bannerNpcId: bannerNpcKeyOf(this) } 形）——计数下限锁
    expect(src.match(/bannerNpcId = bannerNpcKeyOf\(this\);/g)?.length)
      .toBeGreaterThanOrEqual(10);
    expect(src.match(/bannerNpcId: bannerNpcKeyOf\(this\)/g)?.length)
      .toBeGreaterThanOrEqual(3);
  });

  it('结构锁：③补齐三名（243/251/69）+②链路代表站的发射代码在位', () => {
    const src = rd('src/entities/Enemy.ts');
    expect(src).toContain('this.vanillaId === 243');   // 冰雪巨人霜冻光束
    expect(src).toContain('this.vanillaId === 251');   // 独眼怪死光
    expect(src).toContain('this.vanillaId === 109');   // 小丑炸弹链（109）
    expect(src).toContain('antlionAI');                // 蚁狮沙球（69）
    // ④弹生弹/激怒面：蜘蛛双站（AI_003+AI_040 版）与 216 激怒档均在
    expect(src.match(/this\.vanillaId === 163 \|\| this\.vanillaId === 238/g)?.length)
      .toBeGreaterThanOrEqual(2);
    expect(src).toContain('vidR === 216 && this.lai2 >= 20');   // 激怒炮弹 240 档
  });
});

// ============================================================================
// D12 附带：hp 与 maxHp 同步写（life=lifeMax 尾段语义）
// ============================================================================
describe('BJ720-A D12 附带：e.hp === e.maxHp（:8371 life=lifeMax）', () => {
  it('专家档变体 hp/maxHp 同值（曾只写 maxHp 漏 hp）', () => {
    bindScaleStatsWorld(ctx({ difficulty: GDL.EXPERT }));
    const e = spawnNPC(-5)!;
    expect(e.hp).toBe(60);
    expect(e.hp).toBe(e.maxHp);
  });
});
