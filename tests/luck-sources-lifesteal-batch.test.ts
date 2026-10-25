// 补齐清单打包批回归（事件月亮/进度条 wave20 在渲染层，此处覆盖可单测项）：
//  1. GenState.seedFlags 灌入（parseSeed → vanillaTerrain；金标种子旗标恒空）
//  2. 风筝 buff 383（KiteBuff：移速/镐速/kiteLuck 三档）+ 恶臭 buff 120（luck −0.25）
//  3. 银河珍珠 5340 / 漂亮镜子 5577 物品注册（vi_ 前缀图标管线可达）
//  4. 火把僵尸 590/591 手持火把点光（Enemy.torchZombieLight）
//  5. 吸血链（Arrow 命中 → applyLifeSteal 分发：304=vampire / magic=ghost）
import { describe, it, expect, vi } from 'vitest';
import { parseSeed } from '../src/world/gen/SeedEasterEggs';
import { newGenState } from '../src/world/gen/vanilla/GenState';
import { BuffState, BuffType } from '../src/stats/Buffs';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { Enemy } from '../src/entities/Enemy';
import { Arrow } from '../src/entities/Arrow';
import { World } from '../src/world/World';
import type { GameHooks } from '../src/entities/types';

describe('GenState.seedFlags 灌入（SeedEasterEggs.parseSeed）', () => {
  it('醉酒/十周年种子旗标解析；金标种子旗标恒空', () => {
    // drunk 唯一触发=数字路 5162020（WorldSeedOption_Drunk.SpecialSeedNames 为空——
    // "drunk world" 文本自造别名已随 S0-2 退役）
    expect(parseSeed('05162020').flags.drunkWorld).toBe(true);
    expect(parseSeed('drunk world').flags.drunkWorld).toBeFalsy();
    expect(parseSeed('celebrationmk10').flags.tenthAnniversary).toBe(true);
    expect(parseSeed('9293480').flags).toEqual({});
    expect(newGenState(100, 100).seedFlags).toEqual({});
  });
});

describe('风筝 buff 383 / 恶臭 buff 120（★1457 基准 Player.cs:10001-10010 / luck 段 :29373/:29386-29389）', () => {
  it('KiteBuff：移速 +0.15、镐速 −0.1（★1457 :10003-10004；旧 1456 钉 +0.25/−0.15 已随基准切换反转）、kiteLuck 180s 一档钳 3', () => {
    const b = new BuffState();
    expect(b.kiteLuckLevel).toBe(0);
    b.apply(BuffType.KiteBuff, 179);
    expect(b.kiteLuckLevel).toBe(0);
    b.apply(BuffType.KiteBuff, 360);
    expect(b.kiteLuckLevel).toBe(2);
    b.apply(BuffType.KiteBuff, 10_000);
    expect(b.kiteLuckLevel).toBe(3);
    expect(b.pickSpeedMult).toBeCloseTo(0.9, 5);  // ★1457 :10004 pickSpeed -= 0.1f（旧 1456 −0.15 已反转）
    const noKite = new BuffState();
    expect(noKite.moveSpeedMult).toBe(1);
    b.remove(BuffType.KiteBuff);
    expect(b.moveSpeedMult).toBe(1);
    b.apply(BuffType.KiteBuff, 600);
    expect(b.moveSpeedMult).toBeCloseTo(1.15, 5);  // ★1457 :10003 moveSpeed += 0.15f（旧 1456 +0.25 已反转）
  });

  it('luck 聚合：风筝档 +0.1/3·档、恶臭 −0.25（RecalculateLuck :28675/:28687-28690）', () => {
    const p = new Player(0, 0, new Inventory());
    p.buffs.apply(BuffType.KiteBuff, 360);
    expect(p.luck).toBeCloseTo((2 * 0.1) / 3, 5);
    p.buffs.apply(BuffType.Stinky, 60);
    expect(p.luck).toBeCloseTo((2 * 0.1) / 3 - 0.25, 5);
  });
});

describe('幸运消耗品/投掷物注册（5340 银河珍珠 / 5577 漂亮镜子）', () => {
  it('vi_5340 / vi_5577 均在物品表（vi_ 前缀图标管线可达）', () => {
    expect(ITEM_BY_KEY['vi_5340_galaxy_pearl']).toBeDefined();
    expect(ITEM_BY_KEY['vi_5577_pretty_mirror']).toBeDefined();
  });
});

describe('火把僵尸 590/591 手持火把点光（NPC.cs:57309-57366）', () => {
  function gameStub(): GameHooks {
    return {
      world: new World(80, 40, 7, '测试'),
      player: new Player(0, 0, new Inventory()),
      enemies: () => [], critters: () => [], spawnDrop: () => null,
      damagePlayer: (): number => 0, addDamageNumber: () => {}, cutTile: () => {},
      spawnParticles: () => {}, playSfxFiles: () => {},
    } as unknown as GameHooks;
  }
  it('590：朝左取 (cx−22, y+6) 格；空气无液体 → (1, 0.95, 0.8)', () => {
    const e = Enemy.fromVanilla(590, 40 * 16, 20 * 16);
    expect(e).not.toBeNull();
    if (!e) return;
    e.facing = -1;
    (e as unknown as { torchZombieLight: (g: GameHooks) => void }).torchZombieLight(gameStub());
    expect(e.lightRGB).toEqual([1, 0.95, 0.8]);
    expect(e.lightRGBAt).toEqual({ x: Math.floor((e.cx - 22) / 16) * 16, y: Math.floor((e.y + 6) / 16) * 16 });
  });
  it('591：专家持械变体非水即亮，偏移 (cx−36, y+24)', () => {
    const e = Enemy.fromVanilla(591, 40 * 16, 20 * 16);
    expect(e).not.toBeNull();
    if (!e) return;
    e.facing = -1;
    (e as unknown as { torchZombieLight: (g: GameHooks) => void }).torchZombieLight(gameStub());
    expect(e.lightRGB).toEqual([1, 0.95, 0.8]);
    expect(e.lightRGBAt).toEqual({ x: e.cx - 36, y: e.y + 24 });
  });
});

describe('吸血链分发（Projectile.cs:12877-12892）', () => {
  interface Log { calls: Array<[string, number, number, number, number, boolean]>; }
  function makeGame(log: Log, enemy: unknown): GameHooks {
    return {
      world: new World(64, 32, 42, '测试'),
      player: new Player(0, 0, new Inventory()),
      enemies: () => [enemy], critters: () => [], spawnDrop: () => null,
      damagePlayer: (): number => 0, addDamageNumber: () => {}, cutTile: () => {},
      spawnParticles: () => {}, playSfxFiles: () => {},
      applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
        x: number, y: number, isMagic?: boolean) => {
        log.calls.push([kind, dmg, numHits, x, y, !!isMagic]); return 0;
      },
    } as unknown as GameHooks;
  }
  function targetEnemy(x: number): { x: number; y: number; w: number; h: number; id: number; dead: boolean; hurt: () => boolean } {
    return { x, y: 16 * 16, w: 16, h: 16, id: 1, dead: false, hurt: () => true };
  }

  it('吸血鬼飞刀 304 命中 → vampire（系数 0.075 侧）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（主环首掷 ×1.0,吸血基数不漂）
    const log: Log = { calls: [] };
    const game = makeGame(log, targetEnemy(30 * 16));
    const a = new Arrow(30 * 16 - 30, 16 * 16 + 8, 6, 0, 100, 0, 304, { grav: 0, life: 300, pierce: 1 });
    for (let i = 0; i < 8 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(log.calls.length).toBe(1);
    expect(log.calls[0][0]).toBe('vampire');
    expect(log.calls[0][1]).toBe(100);
  });

  it('魔法弹命中 → ghost（isMagic=true）;非魔法弹 → ghost 白耗面（isMagic=false）', () => {
    const log: Log = { calls: [] };
    const game = makeGame(log, targetEnemy(30 * 16));
    // 恶魔镰刀 15（vanilla-projectiles magic=true）
    const a = new Arrow(30 * 16 - 30, 16 * 16 + 8, 6, 0, 60, 0, 15, { grav: 0, life: 300, pierce: 1 });
    for (let i = 0; i < 8 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(log.calls.length).toBe(1);
    expect(log.calls[0][0]).toBe('ghost');
    expect(log.calls[0][5]).toBe(true);     // isMagic 直传（治疗面）
    const log2: Log = { calls: [] };
    const game2 = makeGame(log2, targetEnemy(30 * 16));
    // 木箭 1（数据面非 magic）→ ghostHeal 白耗面照走：:12090 `lifeSteal -= num2`
    //   先于 :12091-93 `if (!magic) return`，调用点 :13877-79 无类别门 ⇒ 非 magic
    //   PVE 命中在幽灵兜帽在身时白扣治疗预算不出治疗球=原版本相（★清偿刀 S2-债1
    //   定谳 + U2 判别面复核；旧断言「非魔法不分发」=摘门前的陈旧 oracle 已改判）。
    //   真扣不回复由 Game.applyLifeSteal :43432-33 承载（本 mock 直记调用面）。
    const b = new Arrow(30 * 16 - 30, 16 * 16 + 8, 6, 0, 60, 0, 1, { grav: 0, life: 300, pierce: 1 });
    for (let i = 0; i < 8 && !b.dead; i++) b.fixedUpdate(1 / 60, game2);
    expect(log2.calls.length).toBe(1);
    expect(log2.calls[0][0]).toBe('ghost');
    expect(log2.calls[0][5]).toBe(false);   // isMagic=false 忠实直传
  });
});
