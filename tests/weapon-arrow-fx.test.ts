// 特殊箭特效批回归（2026-08-22，weapon-audit-2026-08-22 类别六"特殊箭特效 ❌"）：
//  ① 91 圣箭星雨（P.cs:72250-72287）——Arrow.killNow → Game.onProjectileDeath 分发链
//    端到端（Game 侧星雨分支本体在 held-draw-fixes.test.ts ⑤ 已锚，此处锚 Arrow 半边）
//  ② 41 狱炎箭（物品 265）64×64 爆炸盒（P.cs:73256-73293）——真 Arrow 撞块 → 真爆炸结算
//  ③ 469 蜂箭 Kill 放蜂（P.cs:73369-73390）+ 入水即 Kill（AI_001 :54969,★F8 校准）
//  ④ 225 叶绿箭撞块弹反 + 归巢（HandleMovement :17128-17150）
//  ⑤ 710 空中祸害空旷 ×1.5（Damage :12236-12239）+ 命中撒 5 裂片（BetsySharpnel :51075-51091）
//  ⑥ 撞块 Kill 音/尘分档（1/81 :70989-70996 / 2/82 :72542-72549 / 474 :72550-72557）
//  ⑦ 485 狱翼箭 (v×39+ai)/40 渐转 + 2 拍/帧扇翅（:54826-54843）
//  ⑧ 477 水晶镖旋转平滑（:54802-54812）
//  ⑨ 639 月总箭每跳 ×0.96 衰减（Damage :13221-13224）
import { describe, it, expect, vi, afterEach } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { Arrow } from '../src/entities/Arrow';
import { Game } from '../src/core/Game';
import type { GameHooks } from '../src/entities/types';

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

interface DustRec { type: number; vx: number; vy: number; scale: number; noGravity: boolean }

/** 记录型 GameHooks（Arrow.fixedUpdate 全路径消费面） */
function makeGame(w: World, enemies: unknown[] = [], hooks: Record<string, unknown> = {}): GameHooks {
  return {
    world: w,
    player: { dead: true, iframes: 0, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 10, h: 20 },
    enemies: () => enemies, critters: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    ...hooks,
  } as unknown as GameHooks;
}

/** 真 Game.prototype 壳（onProjectileDeath 只触 playSfxFiles/spawnDust/entities/player/
 *  damagePlayer——held-draw-fixes.test.ts ⑤ 同法）：Arrow 死亡链端到端驱动真星雨/爆炸 */
function deathShell(enemies: unknown[] = [], critters: unknown[] = []) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  const added: unknown[] = [];
  const sfx: string[] = [];
  const dusts: DustRec[] = [];
  const playerHits: number[] = [];
  g.entities = { add: (e: unknown) => { added.push(e); }, enemies, critters };
  g.player = { dead: true, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 10, h: 20 };
  g.playSfxFiles = (files: string[]) => { sfx.push(files.join(',')); };
  g.playSfxWav = () => {};
  g.spawnDust = (_x: number, _y: number, _w: number, _h: number, type: number,
    sx = 0, sy = 0, _alpha = 0, _c = null, scale = 1, noGravity = false) => {
    const d: DustRec = { type, vx: sx, vy: sy, scale, noGravity };
    dusts.push(d);
    return d;
  };
  g.damagePlayer = (n: number) => { playerHits.push(n); };
  return { g, added, sfx, dusts, playerHits };
}

const mkEnemy = (id: number, cx: number, cy: number, w = 16, h = 16) => ({
  id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, dead: false, iframes: 0,
  hits: [] as Array<[number, number]>,
  hurt(d: number, kx: number): boolean {
    (this as unknown as { hits: Array<[number, number]> }).hits.push([d, kx]);
    return true;
  },
});

/** 让弹飞到撞块消亡（竖直下砸地表行 190） */
function flyToTileDeath(a: Arrow, game: GameHooks, maxTicks = 400): void {
  for (let t = 0; t < maxTicks && !a.dead; t++) a.fixedUpdate(1, game);
  expect(a.dead).toBe(true);
}

afterEach(() => { vi.restoreAllMocks(); });

// ============ ① 91 圣箭星雨（:72250-72287，Arrow→Game 分发链端到端） ============
describe('① 91 圣箭星雨（Kill :72250-72287）', () => {
  it('真 91 撞块消亡 → onProjectileDeath(91,dmg,kb) → 真星雨：92 落星伤/3、上空 600-899、速 22', () => {
    const sh = deathShell();
    const w = emptyWorld();
    const game = makeGame(w, [], {
      onProjectileDeath: (...a: unknown[]) => (sh.g.onProjectileDeath as (...aa: unknown[]) => void)(...a),
    });
    const a = new Arrow(100 * TILE, 186 * TILE, 3, 8, 30, 2, 91, {});
    flyToTileDeath(a, game);
    // Arrow 半边：消亡转发带 projId/伤害/击退（Game 侧 num663=dmg/3、kb 透传的输入）
    expect(sh.sfx).toEqual(['Item_10']);                       // SoundID.Item10（:72251）
    expect(sh.dusts.length).toBe(10);                          // 尘 58×10（:72252-72255）
    expect(sh.dusts.every((d) => d.type === 58)).toBe(true);
    expect(sh.added.length).toBe(1);                           // 落星 92（:72277）
    const star = sh.added[0] as Arrow;
    expect(star).toBeInstanceOf(Arrow);
    expect(star.projId).toBe(92);
    expect(star.damage).toBe(10);                              // (int)(30/3)（:72272-72276）
    expect(star.starFallLine).toBe(a.y);                       // ai[1] = 命中线（:72280）
    expect(star.starFallGen).toBe(1);                          // ai[0] = 1 直系（:72281）
    expect(star.y).toBeGreaterThanOrEqual(a.y - 899);          // 上空 Next(600,900)（:72263）
    expect(star.y).toBeLessThanOrEqual(a.y - 600);
    expect(Math.abs(star.x - a.x)).toBeLessThanOrEqual(400);   // ±Next(400)（:72262）
    expect(Math.hypot(star.vx, star.vy)).toBeCloseTo(22, 6);   // num661 = 22（:72267）
  });
});

// ============ ② 41 狱炎箭（物品 265）64×64 爆炸盒（:73256-73293） ============
describe('② 41 狱炎箭爆炸（Kill :73256-73293）', () => {
  it('真 41 撞块消亡 → Item14 + 尘 31×10/6×10 + 64×64 盒内敌结算、盒外不结算、不炸玩家', () => {
    const inside = mkEnemy(1, 41 * TILE + 8, 189 * TILE);          // 距爆心 < 32+半宽
    const outside = mkEnemy(2, 41 * TILE + 8 + 120, 189 * TILE);   // 120px 外出盒
    const sh = deathShell([inside, outside]);
    const game = makeGame(emptyWorld(), [], {
      onProjectileDeath: (...a: unknown[]) => (sh.g.onProjectileDeath as (...aa: unknown[]) => void)(...a),
    });
    const a = new Arrow(41 * TILE, 185 * TILE, 0, 6, 30, 8, 41, {});
    flyToTileDeath(a, game);
    expect(sh.sfx).toEqual(['Item_14']);                       // SoundID.Item14（:73258）
    expect(sh.dusts.filter((d) => d.type === 31).length).toBe(10);   // :73259-73262
    expect(sh.dusts.filter((d) => d.type === 6).length).toBe(10);    // 5 拍×(2.5+1.5)（:73263-73272）
    expect(inside.hits.length).toBe(1);
    expect(inside.hits[0][0]).toBe(30);                        // Damage() 重结算同伤
    expect(outside.hits.length).toBe(0);                       // 64×64 盒外（:73288-73289）
    expect(sh.playerHits.length).toBe(0);                      // friendly 弹不回炸玩家
  });
});

// ============ ③ 469 蜂箭（Kill :73369-73390 + 入水 :54969） ============
describe('③ 469 蜂箭放蜂/入水消亡', () => {
  it('Kill 放蜂：奇数拍 Next(3)==0 全中 → 6 只（伤/3、penetrate 2、ranged、蜂型 181）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const added: unknown[] = [];
    const game = makeGame(emptyWorld(), [], {
      entities: { nextId: 1, add: (e: unknown) => { added.push(e); } },
    });
    const a = new Arrow(100 * TILE, 186 * TILE, 4, 6, 30, 3, 469, {});
    flyToTileDeath(a, game);
    expect(added.length).toBe(6);                              // 6 拍循环全放（:73371-73374）
    for (const raw of added) {
      const bee = raw as Arrow;
      expect(bee).toBeInstanceOf(Arrow);
      expect(bee.projId).toBe(181);                            // beeType()（Player.cs:12006）
      expect(bee.pierce).toBe(2);                              // :73390
      expect(bee.pierceInit).toBe(2);
      expect(bee.frostEligible).toBe(true);                    // ranged = true（:73389）
      expect(bee.damage).toBe(10);                             // beeDamage(30/3)=10+Next(2)→+0
      expect(bee.knockback).toBe(0);                           // beeKB(0)（:12026）
    }
  });

  it('奇数拍 1/3 掷不中 → 只放偶数拍 3 只；出生点沿 −oldVelocity 逐拍退 8px', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const added: unknown[] = [];
    const game = makeGame(emptyWorld(), [], {
      entities: { nextId: 1, add: (e: unknown) => { added.push(e); } },
    });
    const a = new Arrow(100 * TILE, 186 * TILE, 0, 8, 30, 3, 469, {});
    flyToTileDeath(a, game);
    expect(added.length).toBe(3);                              // 奇数拍（1/3/5）全跳
    const ol = Math.hypot(a.vx, a.vy);
    for (let i = 0; i < 3; i++) {
      const iter = i * 2;                                      // 放出的拍号 0/2/4
      const bee = added[i] as Arrow;
      expect(bee.y - a.y).toBeCloseTo(-(a.vy / ol) * 8 * iter, 6);   // vector64 -= v65×i
    }
  });

  it('入水即 Kill（:54969 wet&&!honeyWet&&!shimmerWet）；蜂蜜豁免', () => {
    const w = emptyWorld();
    w.store.setLiquid(100, 189, 255, LIQUID_TYPE.WATER);
    const game = makeGame(w);
    const a = new Arrow(100 * TILE, 186 * TILE, 0, 4, 30, 3, 469, {});
    for (let t = 0; t < 60 && !a.dead; t++) a.fixedUpdate(1, game);
    expect(a.dead).toBe(true);                                 // 弹心入水行 189 → Kill
    const w2 = emptyWorld();
    w2.store.setLiquid(100, 189, 255, LIQUID_TYPE.HONEY);
    const game2 = makeGame(w2);
    const b = new Arrow(100 * TILE, 186 * TILE, 0, 4, 30, 3, 469, {});
    for (let t = 0; t < 6; t++) b.fixedUpdate(1, game2);
    expect(b.dead).toBe(false);                                // honeyWet 豁免（:54969）
  });
});

// ============ ④ 225 叶绿箭弹反+归巢（HandleMovement :17128-17150） ============
describe('④ 225 叶绿箭撞块弹反', () => {
  /** 走廊：x=99 / x=110 两道竖墙（行 184-189），弹在其中水平往复 */
  function corridorWorld(): World {
    const w = new World(160, 200, 30, 'open');
    for (let y = 184; y <= 189; y++) {
      w.store.setTileSilent(99, y, 1, 0, 0);
      w.store.setTileSilent(110, y, 1, 0, 0);
    }
    return w;
  }

  it('首撞伤 ×0.66、全速反 lastVelocity 不消亡；第 4 撞 Kill（:17131-17139）', () => {
    const game = makeGame(corridorWorld());
    const a = new Arrow(101 * TILE, 186 * TILE + 8, 5, 0, 16, 2, 225, { grav: 0 });
    // 撞右墙（x=110 行 186）：ai[1]=1 → 伤 ×0.66、vx 反向
    for (let t = 0; t < 60 && a.vx > 0; t++) a.fixedUpdate(1, game);
    expect(a.dead).toBe(false);
    expect(a.vx).toBeLessThan(0);                              // :17140 全速反（无 ×0.5 衰减）
    expect(a.damage).toBe(Math.trunc(16 * 0.66));              // 10（:17133 (int) 截断）
    // 往复撞满 4 次 → Kill（:17135-17139）
    for (let t = 0; t < 400 && !a.dead; t++) a.fixedUpdate(1, game);
    expect(a.dead).toBe(true);
  });

  it('弹反后 FindTargetWithLineOfSight 归巢：保速转向视距内最近敌（:17142-17150）', () => {
    const enemy = mkEnemy(7, 102 * TILE, 186 * TILE + 8);
    const game = makeGame(corridorWorld(), [enemy]);
    const a = new Arrow(108 * TILE, 186 * TILE + 8, 5, 0, 16, 2, 225, { grav: 0 });
    for (let t = 0; t < 60 && a.vx > 0; t++) a.fixedUpdate(1, game);
    expect(a.dead).toBe(false);
    const sp = Math.hypot(a.vx, a.vy);
    expect(sp).toBeCloseTo(5, 6);                              // velocity.Length() 保速（:17148）
    // 瞄向目标中心上方 h×Lerp(0.1,0.5,GetLerpValue(0,300,t))（:17147）——方向指向敌心偏上
    const dist = Math.hypot(enemy.cx - (a.x + a.w / 2), enemy.cy - (a.y + a.h / 2));
    const off = enemy.h * (0.1 + 0.4 * Math.min(1, Math.max(0, dist / 300)));
    const aim = Math.atan2(enemy.cy - off - (a.y + a.h / 2), enemy.cx - (a.x + a.w / 2));
    expect(Math.atan2(a.vy, a.vx)).toBeCloseTo(aim, 6);
  });
});

// ============ ⑤ 710 空中祸害（Damage :12236-12239 + BetsySharpnel :51075-51091） ============
describe('⑤ 710 空中祸害空旷加伤/裂片', () => {
  it('空旷（下方 12 格无实心）命中伤 ×1.5；近地不加成', () => {
    const mr710 = Math.random; Math.random = () => 0.5;         // ★BJ716-A:DV 中性档（主环首掷 ×1.0）
    // 空旷档：行 40 高空，下方 12 格全空
    {
      const enemy = mkEnemy(1, 100 * TILE, 40 * TILE);
      const game = makeGame(emptyWorld(), [enemy]);
      const a = new Arrow(100 * TILE - 4, 40 * TILE - 2, 6, 0, 20, 4, 710, {});
      a.critChance = -1;   // 钳非暴击（缺省回落 4% 基础暴击 = 批序换 RNG 流即偶发 ×2 假失败）
      a.fixedUpdate(1, game);
      expect(enemy.hits.length).toBe(1);
      expect(enemy.hits[0][0]).toBe(30);                       // (int)(20×1.5)（:12238）
    }
    // 近地档：行 188（地表 190 在 12 格内）→ 原伤
    {
      const enemy = mkEnemy(1, 100 * TILE, 188 * TILE);
      const game = makeGame(emptyWorld(), [enemy]);
      const a = new Arrow(100 * TILE - 4, 188 * TILE - 2, 6, 0, 20, 4, 710, {});
      a.critChance = -1;   // 同上钳非暴击
      a.fixedUpdate(1, game);
      expect(enemy.hits.length).toBe(1);
      expect(enemy.hits[0][0]).toBe(20);
    }
    Math.random = mr710;
  });

  it('命中撒 5 枚 710 裂片（速 6、(0,6).RotatedBy(π/4−i·π/6) 扇），裂片不再链', () => {
    const enemy = mkEnemy(1, 100 * TILE, 40 * TILE);
    const added: unknown[] = [];
    const game = makeGame(emptyWorld(), [enemy], {
      entities: { nextId: 1, add: (e: unknown) => { added.push(e); } },
    });
    const a = new Arrow(100 * TILE - 4, 40 * TILE - 2, 6, 0, 20, 4, 710, {});
    a.fixedUpdate(1, game);
    expect(a.dead).toBe(true);                                 // penetrate 1 命中即耗
    expect(added.length).toBe(5);                              // num2 = 5（:51082）
    for (let i = 0; i < 5; i++) {
      const s = added[i] as Arrow;
      expect(s.projId).toBe(710);
      expect(s.abShard).toBe(true);                            // ai[1] = -1（:51086 尾参）
      expect(s.damage).toBe(20);                               // 裂片用 damage 字段（未 ×1.5）
      expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(6, 9);        // spinningpoint (0,6)
      const ang = Math.PI / 4 - (Math.PI / 6) * i;             // num + num3×i（:51081-51083）
      expect(s.vx).toBeCloseTo(-6 * Math.sin(ang), 9);
      expect(s.vy).toBeCloseTo(6 * Math.cos(ang), 9);
    }
    // 裂片命中不再撒裂片（:51077 ai[1] != -1 门）
    const enemy2 = mkEnemy(2, 100 * TILE, 60 * TILE);
    const added2: unknown[] = [];
    const game2 = makeGame(emptyWorld(), [enemy2], {
      entities: { nextId: 1, add: (e: unknown) => { added2.push(e); } },
    });
    const shard = new Arrow(100 * TILE - 4, 60 * TILE - 2, 6, 0, 20, 4, 710, {});
    shard.abShard = true;
    shard.fixedUpdate(1, game2);
    expect(enemy2.hits.length).toBe(1);
    expect(added2.length).toBe(0);
  });
});

// ============ ⑥ 撞块 Kill 音/尘分档（:70989-70996 / :72542-72549 / :72550-72557） ============
describe('⑥ Kill 音/尘分档', () => {
  function killFxCase(projId: number) {
    const sfx: string[] = [];
    const dusts: DustRec[] = [];
    const game = makeGame(emptyWorld(), [], {
      playSfx: (n: string) => { sfx.push(n); },
      spawnDust: (_x: number, _y: number, _w: number, _h: number, type: number,
        sx = 0, sy = 0, _alpha = 0, _c = null, scale = 1, noGravity = false) => {
        dusts.push({ type, vx: sx, vy: sy, scale, noGravity });
        return null;
      },
    });
    const a = new Arrow(100 * TILE, 186 * TILE, 2, 6, 10, 1, projId, {});
    // ★R2 #7 重锚:2026-09-02 尾尘批后飞行期每 tick 撒尾尘(2/82→d6 与 Kill 尘同型
    //  混流)——本用例锁【Kill 档】,直调 killNow 单口,不经飞行
    (a as unknown as { killNow: (g: unknown) => void }).killNow(game);
    return { sfx, dusts };
  }

  it('1/81 木箭：Dig 音 + 尘 7×10（:70989-70996）', () => {
    for (const pid of [1, 81]) {
      const { sfx, dusts } = killFxCase(pid);
      expect(sfx).toEqual(['dig']);                            // legacy PlaySound(0)=SoundID.Dig
      expect(dusts.length).toBe(10);
      expect(dusts.every((d) => d.type === 7)).toBe(true);
    }
  });

  it('2/82 燃烧箭：Dig 音 + 火尘 6×10（:72542-72549）', () => {
    for (const pid of [2, 82]) {
      const { sfx, dusts } = killFxCase(pid);
      expect(sfx).toEqual(['dig']);
      expect(dusts.length).toBe(10);
      expect(dusts.every((d) => d.type === 6)).toBe(true);
    }
  });

  it('474 骨箭：Dig 音 + 骨尘 26×20（:72550-72557）', () => {
    const { sfx, dusts } = killFxCase(474);
    expect(sfx).toEqual(['dig']);
    expect(dusts.length).toBe(20);
    expect(dusts.every((d) => d.type === 26)).toBe(true);
  });
});

// ============ ⑦ 485 狱翼箭（:54826-54850） ============
describe('⑦ 485 狱翼箭渐转/扇翅', () => {
  it('v=(v×39+ai)/40 渐转向游移向量（保速），2 拍/帧推 5 帧扇翅（:54834-54843）', () => {
    const game = makeGame(emptyWorld());
    const a = new Arrow(50 * TILE, 50 * TILE, 10, 0, 22, 5, 485, {});
    const sp0 = Math.hypot(a.vx, a.vy);
    const ang0 = Math.atan2(a.vy, a.vx);
    expect(a.hwFrame).toBe(0);
    a.fixedUpdate(1, game);
    a.fixedUpdate(1, game);
    expect(a.hwFrame).toBe(1);                                 // frameCounter≥2 推帧
    a.fixedUpdate(1, game);
    a.fixedUpdate(1, game);
    expect(a.hwFrame).toBe(2);
    for (let t = 0; t < 196; t++) a.fixedUpdate(1, game);
    // 速度模长守恒（转向不清速——ai 与初速同模长，:54829 渐近不动点 |v|=|ai|）
    expect(Math.hypot(a.vx, a.vy)).toBeCloseTo(sp0, 1);
    // 方向渐转向 ai（±RotatedByRandom(π/8)）——总偏角有界（<π/8+π/16+余量）且已偏离初向
    const turn = Math.abs(Math.atan2(a.vy, a.vx) - ang0);
    expect(turn).toBeGreaterThan(0.001);
    expect(turn).toBeLessThan(Math.PI / 8 + Math.PI / 16 + 0.01);
  });
});

// ============ ⑧ 477 水晶镖旋转平滑（:54802-54812） ============
describe('⑧ 477 水晶镖旋转', () => {
  it('前 5 拍对齐速度角+π/2，之后 (rot×2+aim)/3 渐近平滑', () => {
    const game = makeGame(emptyWorld());
    // extraUpdates 0：单步/tick，age 即拍号（原版 localAI[1] 每 AI 步 +1）
    const a = new Arrow(50 * TILE, 50 * TILE, 6, -2, 14, 3, 477, { extraUpdates: 0 });
    const aim = () => Math.atan2(a.vy, a.vx) + Math.PI / 2;
    for (let t = 0; t < 5; t++) a.fixedUpdate(1, game);
    expect(a.dartRot).not.toBeNull();
    expect(a.dartRot).toBeCloseTo(aim(), 9);                   // localAI[1]<5 对齐档（age 1..5）
    // 变向后平滑：rot 逐拍向新 aim 收敛（每拍剩余差 ×1/3）
    a.vy = 6;                                                  // 速度角突变
    const prev = a.dartRot as number;
    a.fixedUpdate(1, game);                                    // age 6 → 平滑档
    const now = a.dartRot as number;
    const want = (prev * 2 + aim()) / 3;                       // :54811
    expect(now).toBeCloseTo(want, 9);
    expect(Math.abs(now - aim())).toBeLessThan(Math.abs(prev - aim()));   // 收敛
  });
});

// ============ ⑨ 639 月总箭每跳 ×0.96（Damage :13221-13224） ============
describe('⑨ 639 月总箭 on-hit 衰减', () => {
  it('首跳全额、次跳 ×0.96（(int) 截断）', () => {
    const mr = Math.random;
    Math.random = () => 0.5;                                   // 钉非暴击(命中链 4% 掷);★BJ716-A:DV 中性档(×1.0)
    const e1 = mkEnemy(1, 100 * TILE, 50 * TILE);
    const e2 = mkEnemy(2, 100 * TILE + 8, 50 * TILE);
    const game = makeGame(emptyWorld(), [e1, e2]);
    const a = new Arrow(100 * TILE - 4, 50 * TILE - 2, 6, 0, 100, 3, 639, {});
    a.fixedUpdate(1, game);
    expect(e1.hits.length).toBe(1);
    expect(e1.hits[0][0]).toBe(100);                           // 本跳全额（字段结算后改写）
    expect(e2.hits.length).toBe(1);
    expect(e2.hits[0][0]).toBe(96);                            // (int)(100×0.96)（:13223）
    expect(a.damage).toBe(Math.trunc(96 * 0.96));              // 每跳各衰减一次 → 92
    Math.random = mr;
  });
});
