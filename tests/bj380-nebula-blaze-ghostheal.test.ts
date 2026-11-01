// ★BJ380（2026-09-28）星云烈焰（634/635）+ 月耀（645）幽灵治疗头 ghostHeal proc 补缺回归。
// 用户实报：星云烈焰不触发幽灵兜帽（Spectre Hood）吸血。
// 定谳（Terarria1457/Terraria/Projectile.cs）：原版吸血链在 Projectile.Damage() 通用
//   on-hit 段【无弹号白名单】——
//     :13712 flag10 = num41>0 ∧ targetNPC.lifeMax>5 ∧ friendly ∧ !hostile ∧ aiStyle≠59
//     :13875 if (targetNPC.canGhostHeal | flag9)     ——canGhostHeal=false 族 384/387/388/523
//     :13877 if (Main.player[owner].ghostHeal && !moonLeech) ghostHeal(num41, victimCenter)
//     :14263 numHits++ 在 proc 块【后】⇒ 首跳读 0 档率 0.20（BJ157-② 同相）
//   634/635/645 SetDefaults 均 magic（vanilla-projectiles.json magic 位）⇒ 原版本就吸血。
//   本仓 MagicProj（BJ157-①）/Arrow/MissileProc（BJ167）已接；NebulaBlazeBolt/LunarFlareStar
//   两类漏接（自绘 strike 环无 proc）——本文件锁两类落地 + 实参口径（BJ167-②③④ 同款）。
// 判别面 spy：hurt 萰 StrikeNPC——lastStrikeDealt = 防后实扣（num41 等位,Enemy.ts:13959
//   入口清零/:14195 实扣写点）；拒收（false）= 原版 immune 门整跳 → 无 proc 无 numHits++。
import { describe, it, expect, vi } from 'vitest';   // ★BJ741 R19-1：vi=Math.random 0.5 中性档（634/635/645 敌臂 DV 接入随刀）
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import { NebulaBlazeBolt, LunarFlareStar } from '../src/entities/LunarNebula';
import { projPveNumHits } from '../src/entities/SpectreSoulProj';

interface StealCall {
  kind: string; dmg: number; numHits: number; x: number; y: number; isMagic: boolean;
}

const DEFENSE = 22;   // 实扣 = 入伤 − 22（num41 防后口径）

function enemySpy(id: number, tx: number, ty: number, w = 24, h = 24,
  vanillaId: number | null = 15) {
  return {
    id, x: tx * TILE, y: ty * TILE, w, h, dead: false, vanillaId, maxHp: 100,
    lastStrikeDealt: 0, attempts: 0, iframes: 0,
    hurt(this: { lastStrikeDealt: number; attempts: number }, dmg: number): boolean {
      this.attempts++;
      this.lastStrikeDealt = Math.max(0, dmg - DEFENSE);
      return true;
    },
  };
}

function makeGame(log: StealCall[], list: unknown[]): GameHooks {
  return {
    world: new World(160, 200, 30, 'bj380'),
    player: null as unknown,
    enemies: () => list,
    entities: { nextId: 1, add: () => {} },
    playSfxFiles: () => {}, playSfx: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, critters: () => [], notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
      x: number, y: number, isMagic?: boolean) => {
      log.push({ kind, dmg, numHits, x, y, isMagic: !!isMagic });
      return 0;
    },
  } as unknown as GameHooks;
}

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'bj380-open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

describe('BJ380 星云烈焰 634/635 ghostHeal proc（Projectile.cs:13877-79）', () => {
  it('判别面（用户实报）：634 贴脸爆命中敌 → ghost proc,dmg=num41 防后实扣,首跳 numHits=0,出生点=受害者 Center', () => {
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：634/635 DV 接入——0.5 中性档（×1.00）
    const log: StealCall[] = [];
    const e = enemySpy(1, 81, 100);                       // Center (1308,1612),距弹心 8 < 20 → 搜敌即爆
    const game = makeGame(log, [e]);
    const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 0, 0, 130, 3, 634);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(bolt.dead).toBe(true);                         // 爆结算面未被门吞
    expect(e.lastStrikeDealt).toBe(130 - DEFENSE);
    expect(log.length).toBe(1);                           // ← 旧码 0 = 用户实报病灶
    expect(log[0].kind).toBe('ghost');
    expect(log[0].dmg).toBe(130 - DEFENSE);               // BJ167-③：num41 等位（非防前 130）
    expect(log[0].numHits).toBe(0);                       // BJ157-②：:14263 自增在 proc 后
    expect(log[0].x).toBe(81 * TILE + 12);                // BJ167-④：受害者 Center（:13879）
    expect(log[0].y).toBe(100 * TILE + 12);
    expect(log[0].isMagic).toBe(true);                    // 634 magic 数据面
    rnd741.mockRestore();
  });

  it('635 强发档同 proc（magic 数据面）', () => {
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：DV 中性档
    const log: StealCall[] = [];
    const e = enemySpy(1, 81, 100);
    const game = makeGame(log, [e]);
    const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 0, 0, 390, 3, 635);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(log.length).toBe(1);
    expect(log[0].dmg).toBe(390 - DEFENSE);
    expect(log[0].isMagic).toBe(true);
    rnd741.mockRestore();
  });

  it('Kill AoE 多敌 numHits 衰减：首敌 0 档、次敌 1 档（:14263 逐受理自增）;pveNumHits 终值 2（BJ157-④ PVP 读口）', () => {
    const log: StealCall[] = [];
    const near = enemySpy(1, 81, 100);
    const beside = enemySpy(2, 82, 100);                  // 盒缘内（爆盒 1275..1325 ∩ 1312..1336）
    const game = makeGame(log, [near, beside]);
    const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 0, 0, 130, 3, 634);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(bolt.dead).toBe(true);
    expect(log.map((c) => c.numHits)).toEqual([0, 1]);    // 率 0.20 → 0.15（Game.applyLifeSteal 内消费）
    expect(log.every((c) => c.kind === 'ghost')).toBe(true);
    expect(bolt.pveNumHits).toBe(2);
    expect(projPveNumHits(bolt)).toBe(2);                 // PVP 反馈读口单源
  });

  it('飞行盒接触命中（非贴脸爆）同 proc：追踪抵达 48×48 敌,接触 1 proc + burst skipId 不双发', () => {
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：DV 中性档
    const log: StealCall[] = [];
    const e = enemySpy(1, 84, 100, 48, 48);               // Center (1368,1624),盒 1344..1392
    const game = makeGame(log, [e]);
    const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 6, 0, 130, 3, 634);
    bolt.critChance = 0;
    for (let t = 0; t < 30 && !bolt.dead; t++) bolt.fixedUpdate(1, game);
    expect(bolt.dead).toBe(true);
    expect(e.attempts).toBe(1);                           // 接触命中一次
    expect(log.length).toBe(1);                           // 接触 proc；Kill 爆 skipId 不重复
    expect(log[0].numHits).toBe(0);
    expect(log[0].dmg).toBe(130 - DEFENSE);
    rnd741.mockRestore();
  });

  it('canGhostHeal=false 族 384：命中照常结算但零 proc（:13875 门）', () => {
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：DV 中性档
    const log: StealCall[] = [];
    const e = enemySpy(1, 81, 100, 24, 24, 384);
    const game = makeGame(log, [e]);
    const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 0, 0, 130, 3, 634);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(e.lastStrikeDealt).toBe(130 - DEFENSE);        // 结算面未被 victim 门吞
    expect(log.length).toBe(0);
    rnd741.mockRestore();
  });

  it('飞行盒 flag3：iframes 残窗照打照 proc 照计数 + 命中写支 immune=5（:12635-12637 豁免/:14080-14082）——★清偿刀 F 翻案（X2-D1 旧钉基于 pierce=0 假红窗,退役）', () => {
    // 定谳：634/635 SetDefaults（P.cs:6818-6839）无 penetrate/usesLocal 行 → :366
    //  缺省 1 → :10675 maxPenetrate=1 → :12635 flag3=真 → :12636 免疫门不拦。
    //  几何注：弹 40×40 出生即与敌盒重叠 → 本夹具实际走飞行盒支（非 Kill AoE）。
    const log: StealCall[] = [];
    const e = enemySpy(1, 81, 100);
    let attempts = 0;
    e.hurt = () => { attempts++; return false; };          // 血尽/未致命返假形态（无门位）
    e.iframes = 10;                                        // 残窗（他源 10t）
    const game = makeGame(log, [e]);
    const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 0, 0, 130, 3, 634);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(bolt.dead).toBe(true);                          // 命中 → penetrate 0 → Kill
    expect(attempts).toBe(1);                              // 飞行盒照打（不被残窗拦）
    expect(log.length).toBe(1);                            // 受理 → proc 照达
    expect(log[0].numHits).toBe(0);
    expect(bolt.pveNumHits).toBe(1);                       // :14263 受理后自增
    expect(e.iframes).toBe(5);                             // :14080-14082 专支覆写 5t（残窗 10 被覆写）
  });

  it('Kill AoE 门拒（maxPenetrate=-1 :73267 → flag3 假 → :12636 immune 门）:仅爆盒缘重叠的残窗敌不 proc 不计数', () => {
    // 敌 B 盒 1256..1280 ∩ 爆盒 1275..1325 ✓ ∩ 飞行盒 1280..1320 ✗（B 不被飞行盒
    // 命中 → 无 skipId,纯 AoE 面）——iframes 残窗下 AoE 门拒（原版 flag3 只豁免
    // maxPenetrate==1 的飞行盒;Kill 前 :73265-73267 置 -1 → 门照走）。
    const log: StealCall[] = [];
    const a = enemySpy(1, 81, 100);
    let attemptsA = 0;
    a.hurt = () => { attemptsA++; return false; };
    const b = enemySpy(2, 78.5 + 0, 100.6);                // x=1256,y=1609.6,盒 1256..1280×1609.6..1633.6
    b.iframes = 10;                                        // 残窗（他源）
    const game = makeGame(log, [a, b]);
    const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 0, 0, 130, 3, 634);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(bolt.dead).toBe(true);
    expect(attemptsA).toBe(1);                             // a 走飞行盒（flag3 照打）
    expect(log.length).toBe(1);                            // 只 a 的 proc（b 被门读拦）
    expect(log[0].numHits).toBe(0);
    expect(bolt.pveNumHits).toBe(1);                       // b 门拒不计数
    expect(b.iframes).toBe(10);                            // b 残窗原样（AoE 面无弹侧写支）
  });

  it('受理（普通未致命形态,hurt 返假无门位）照 proc 照计数（:14263 无死亡复查）——★X2-D1 判别面', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 81, 100);
    e.hurt = () => false;                                 // 血尽级联/普通未致命形态（无 iframes/dontTakeDamage 门位）
    const game = makeGame(log, [e]);
    const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 0, 0, 130, 3, 634);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(bolt.dead).toBe(true);
    expect(log.length).toBe(1);                           // 非门拒=受理 → proc 照达
    expect(log[0].kind).toBe('ghost');
    expect(log[0].numHits).toBe(0);
    expect(bolt.pveNumHits).toBe(1);                      // :14263 受理后自增
  });
});

describe('BJ380 月耀 645 爆炸相 ghostHeal proc', () => {
  it('爆炸相两敌：numHits 0→1 衰减;pveNumHits 终值 2', () => {
    const log: StealCall[] = [];
    const a = enemySpy(1, 81, 100);                       // 距星心 24 < 60 触发爆炸
    const b = enemySpy(2, 83, 100);                       // 爆盒 1215..1355 ∩ 1328..1352
    const game = makeGame(log, [a, b]);
    const star = new LunarFlareStar(80 * TILE, 100 * TILE, 0, 0, 100, 4.5, 200 * TILE);
    star.critChance = 0;
    star.fixedUpdate(1, game);                            // 首 update 搜敌 → 爆炸相首结算
    expect(log.map((c) => c.numHits)).toEqual([0, 1]);
    expect(log.every((c) => c.kind === 'ghost' && c.isMagic)).toBe(true);
    expect(star.pveNumHits).toBe(2);
    for (let t = 0; t < 21 && !star.dead; t++) star.fixedUpdate(1, game);
    expect(log.length).toBe(2);                           // hitSet 每敌一次,不重复 proc
  });

  it('canGhostHeal=false 族 387：零 proc', () => {
    const rnd741 = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ741 R19-1：645 DV 接入——0.5 中性档
    const log: StealCall[] = [];
    const a = enemySpy(1, 81, 100, 24, 24, 387);
    const game = makeGame(log, [a]);
    const star = new LunarFlareStar(80 * TILE, 100 * TILE, 0, 0, 100, 4.5, 200 * TILE);
    star.critChance = 0;
    star.fixedUpdate(1, game);
    expect(a.lastStrikeDealt).toBe(100 - DEFENSE);
    expect(log.length).toBe(0);
    rnd741.mockRestore();
  });
});
