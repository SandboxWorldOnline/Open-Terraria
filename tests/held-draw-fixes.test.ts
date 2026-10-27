// 手持绘制公式 + 叶绿弹追踪 + 弹药 Kill 三件 修复批回归（2026-08-22，item-audit
// ⚠️3 绘制公式 / 放置·涂料·弹药 ❌2/❌3/❌4/❌5）：
//  ① useStyle 9 饮药手位缺 ×Lerp(1.5,1.2,t)（Player.cs:50145-50152，98 件药水）
//  ② useStyle 5 法杖持位 3476 距离特档 6→14（Player.cs:50376-50379）
//  ③ useStyle 1 Item.claw 分支（:49931-49958，全集 {1827} Bladed Glove，Main.cs:6741）
//  ④ 叶绿弹 1179 → 弹 207 追踪（AI_001 :53906-54010：300px 锁敌 + 1000px 保持 +
//     v=(v×7+dir·speed)/8 转向；敌方同型不追踪）
//  ⑤ Kill 三件：91 圣箭坠星 / 89 水晶子弹碎裂 / 41 狱炎箭 64×64 重结算
//     （Projectile.cs :72260-72283 / :72289-72306 / :73256-73296）
import { describe, it, expect, vi } from 'vitest';
import { GorePiece } from '../src/entities/GorePiece';
import { Renderer } from '../src/render/Renderer';
import { ITEM_BY_KEY, ITEM_DEFS } from '../src/data/items';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Arrow } from '../src/entities/Arrow';
import { Game } from '../src/core/Game';
import type { GameHooks } from '../src/entities/types';

// ---- 手持绘制采样（空壳 Renderer + 记录型 ctx，同 held-proj-pointing.test.ts 法）----

interface Sample { offX: number; offY: number; rot: number }

/** 跑一次 drawUseItem，取 translate/rotate（= offX/offY/rot，dir=1 镜像空间） */
function sampleUseItem(facing: 1 | -1, swing: { t: number; dur: number; item: number; useStyle?: number; aim?: number }): Sample {
  const rots: number[] = [];
  const trans: Array<[number, number]> = [];
  const ctx = {
    save: () => {}, restore: () => {},
    translate: (a: number, b: number) => { trans.push([a, b]); },
    scale: () => {}, rotate: (a: number) => { rots.push(a); },
    drawImage: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
  } as unknown as CanvasRenderingContext2D;
  const r = Object.create(Renderer.prototype) as unknown as Record<string, unknown>;
  r.atlas = null;
  r.animTick = 0;
  r.itemIcon = () => null;
  r.ctx = ctx;
  const px = 100, py = 100;
  const p = { cx: px, cy: py, x: px - 8, y: py, w: 16, h: 28, facing, equipStats: {} };
  (Renderer.prototype as unknown as {
    drawUseItem(c: CanvasRenderingContext2D, pl: unknown, s: unknown, f: unknown): void;
  }).drawUseItem.call(r, ctx, p, swing, null);
  const [tx, ty] = trans[0] ?? [NaN, NaN];
  return { offX: tx - (px + facing * 0), offY: ty - py, rot: rots[0] ?? NaN };
}

/** useStyle 9 原版手位（Player.cs:50127-50157，dir=1 镜像空间展开） */
function expectUs9(pAnim: number, h = 28) {
  const t = Math.min(Math.max((1 - pAnim) / 0.7, 0), 1);
  const num11 = -(Math.PI * 2) / 5 * 0.5 + (1 - t) * ((Math.PI * 2) / 5) + Math.PI / 10;
  const hx = 10 * Math.cos(num11) - 4 - 3 * Math.sin(num11);
  const hy = 10 * Math.sin(num11) - 2 + 3 * Math.cos(num11);
  const stretch = 1.5 + (1.2 - 1.5) * t;                 // MathHelper.Lerp(1.5, 1.2, t)
  return { offX: hx * stretch + (8 + (2 - 8) * t), offY: h * 0.5 + hy * stretch, hx, hy, t, stretch };
}

const POTION = ITEM_BY_KEY['vi_188_healing_potion'];
const PRISM = ITEM_BY_KEY['vi_3476_NebulaArcanum'];      // 3476（audit 文案 Last Prism，id 为准）
const STAFF_CTRL = ITEM_BY_KEY['vi_739_AmethystStaff'];  // 同集普通法杖（Item.staff 739）
const CLAW = ITEM_BY_KEY['vi_1827_BladedGlove'];
const MELEE_CTRL = ITEM_BY_KEY['vi_188_healing_potion']; // 非 claw 件（走普通三段档）

describe('① useStyle 9 饮药手位 ×Lerp(1.5,1.2,t)（Player.cs:50145-50152）', () => {
  it('中段（pAnim=0.5）：手位向量整体 ×1.2857 + 前移 Lerp(8,2,t)', () => {
    const s = sampleUseItem(1, { t: 15, dur: 30, item: POTION, useStyle: 9 });
    const e = expectUs9(0.5);
    expect(s.offX).toBeCloseTo(e.offX, 6);
    expect(s.offY).toBeCloseTo(e.offY, 6);
    // 旧实现（漏乘）：offX = hx + Lerp(8,2,t) —— 必须不等（贴身 3-5px 根因）
    expect(s.offX).not.toBeCloseTo(e.hx + (8 - 6 * e.t), 3);
    expect(s.offY).not.toBeCloseTo(14 + e.hy, 3);
  });

  it('起手（pAnim=1，t=0）×1.5 / 收杯（pAnim=0，t=1）×1.2——随饮用进度收回', () => {
    const start = sampleUseItem(1, { t: 30, dur: 30, item: POTION, useStyle: 9 });
    const end = sampleUseItem(1, { t: 0, dur: 30, item: POTION, useStyle: 9 });
    const eStart = expectUs9(1);
    const eEnd = expectUs9(0);
    expect(eStart.stretch).toBeCloseTo(1.5, 9);
    expect(eEnd.stretch).toBeCloseTo(1.2, 9);
    expect(start.offX).toBeCloseTo(eStart.offX, 6);
    expect(end.offX).toBeCloseTo(eEnd.offX, 6);
    expect(start.offY).toBeCloseTo(eStart.offY, 6);
    expect(end.offY).toBeCloseTo(eEnd.offY, 6);
    // 朝向镜像：dir=-1 时 offX 取反（itemLocation.X += direction×Lerp(8,2,t) 同域）
    const left = sampleUseItem(-1, { t: 15, dur: 30, item: POTION, useStyle: 9 });
    expect(left.offX).toBeCloseTo(-expectUs9(0.5).offX, 6);
  });
});

describe('② useStyle 5 法杖持位 3476 距离特档（Player.cs:50376-50379）', () => {
  it('3476 持位前伸 14px+帧宽半 12（PlayerDrawLayers.cs:3341 vector6）（其余法杖恒 6）', () => {
    // ★X2 重锚（2026-10-01）:BJ348b-2（beabdece,2026-09-25）case 3476 专支——
    //  位置 = staff 14px 前伸 + (帧宽/2×dir, 0)=+12（PlayerDrawLayers.cs:3341
    //  vector6）、origin=帧中心（:3343）、rot=aim 无 0.785 斜持（:3347）
    const prism = sampleUseItem(1, { t: 5, dur: 30, item: PRISM, useStyle: 5, aim: 0 });
    expect(prism.offX).toBeCloseTo(14 + 12, 9);
    expect(prism.offY).toBeCloseTo(14 + 0, 9);            // p.h*0.5 + sin(0)×14 = 14+0
    const ctrl = sampleUseItem(1, { t: 5, dur: 30, item: STAFF_CTRL, useStyle: 5, aim: 0 });
    expect(ctrl.offX).toBeCloseTo(6, 9);
    expect(ctrl.offY).toBeCloseTo(14, 9);
  });

  it('3476 斜指（aim=π/4）：偏移向量 = 瞄准向 ×14 + 帧宽半 12', () => {
    const s = sampleUseItem(1, { t: 5, dur: 30, item: PRISM, useStyle: 5, aim: Math.PI / 4 });
    expect(s.offX).toBeCloseTo(Math.cos(Math.PI / 4) * 14 + 12, 9);
    expect(s.offY).toBeCloseTo(14 + Math.sin(Math.PI / 4) * 14, 9);
  });
});

describe('③ useStyle 1 Item.claw 分支（:49931-49958，{1827} Bladed Glove）', () => {
  it('三段持位 = 固定握点 10/8/6 + Y 26/24/20（末段在身后）', () => {
    const s0 = sampleUseItem(1, { t: 6, dur: 30, item: CLAW, useStyle: 1 });   // pAnim=0.2 <0.333
    expect(s0.offX).toBeCloseTo(14 * 0.5 - 10, 9);
    expect(s0.offY).toBe(26);
    const s1 = sampleUseItem(1, { t: 15, dur: 30, item: CLAW, useStyle: 1 });  // pAnim=0.5 <0.666
    expect(s1.offX).toBeCloseTo(14 * 0.5 - 8, 9);
    expect(s1.offY).toBe(24);
    const s2 = sampleUseItem(1, { t: 24, dur: 30, item: CLAW, useStyle: 1 });  // pAnim=0.8 ≥0.666
    expect(s2.offX).toBeCloseTo(-(14 * 0.5 - 6), 9);
    expect(s2.offY).toBe(20);
    // 挥砍角与普通档同式（:49957）
    expect(s0.rot).toBeCloseTo((0.2 - 0.5) * -3.5 - 0.3, 9);
  });

  it('非 claw 件走普通三段档（同 pAnim 下 Y 不同：26 vs 24）', () => {
    const ctrl = sampleUseItem(1, { t: 6, dur: 30, item: MELEE_CTRL, useStyle: 1 });
    expect(ctrl.offY).toBe(24);            // swingTier(0) yT=24（claw 档为 26）
    expect(ctrl.offX).toBeCloseTo(14 * 0.5 - 10, 9);
  });
});

// ---- 弹幕侧：叶绿弹 207 追踪 + 92 坠星 ----

function makeGame(w: World, enemies: unknown[] = [], hooks: Record<string, unknown> = {}): GameHooks {
  return {
    world: w,
    // player 需非空（hostile 弹 hitPlayer 走 p.dead 早退门）
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

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

describe('④ 叶绿弹 207 追踪（AI_001 :53906-54010）', () => {
  const mkEnemy = (id: number, tx: number, ty: number) => ({
    id, x: tx * TILE - 8, y: ty * TILE - 8, w: 16, h: 16, dead: false,
  });

  it('300px 视距锁敌并当帧起转向：v=(v×7+dir·speed)/8（:53963-53966 锁后同拍进保持段）', () => {
    // 弹(100,50) → 敌(108,58)：曼哈顿 < 300，视线空旷
    const enemy = mkEnemy(7, 108, 58);
    const game = makeGame(emptyWorld(), [enemy]);
    const a = new Arrow(100 * TILE, 50 * TILE, 5, 0, 9, 4.5, 207, { extraUpdates: 0 });
    // 转向一步 = (v×(8−1) + dir×|v₀|)/8（dir = 弹心→敌心单位向量，speed = localAI[0]）
    const dirTo = (): [number, number] => {
      const dx = 108 * TILE - (a.x + a.w / 2), dy = 58 * TILE - (a.y + a.h / 2);
      const dl = Math.hypot(dx, dy);
      return [dx / dl, dy / dl];
    };
    let [ux, uy] = dirTo();                       // 本帧 AI 用当前（未位移）弹心
    a.fixedUpdate(1, game);                       // 锁敌帧（锁后同拍进保持段 → 已转向）
    expect(a.chloAi1).toBe(7);
    expect(a.chloSpeed).toBeCloseTo(5, 9);        // localAI[0] 初速基准
    expect(a.vx).toBeCloseTo((5 * 7 + ux * 5) / 8, 9);
    expect(a.vy).toBeCloseTo((0 * 7 + uy * 5) / 8, 9);
    expect(a.vy).toBeGreaterThan(0);              // 朝右下方目标偏转
    const v1x = a.vx, v1y = a.vy;
    [ux, uy] = dirTo();                           // 第二帧 dir 随位移更新
    a.fixedUpdate(1, game);
    expect(a.vx).toBeCloseTo((v1x * 7 + ux * 5) / 8, 9);
    expect(a.vy).toBeCloseTo((v1y * 7 + uy * 5) / 8, 9);
  });

  it('目标失效（死亡）→ 清锁重锁；敌方同型（hostile）恒不追踪', () => {
    const enemy = mkEnemy(3, 105, 52);
    const game = makeGame(emptyWorld(), [enemy]);
    const a = new Arrow(100 * TILE, 50 * TILE, 5, 0, 9, 4.5, 207, { extraUpdates: 0 });
    a.fixedUpdate(1, game);
    expect(a.chloAi1).toBe(3);
    enemy.dead = true;                            // :53984-53986 失效清锁
    a.fixedUpdate(1, game);
    expect(a.chloAi1).toBe(0);
    // 敌方同型弹（!friendly → :53992-53994 flag5=false）：锁敌照记但恒不转向
    const game2 = makeGame(emptyWorld(), [mkEnemy(3, 105, 52)]);
    const h = new Arrow(100 * TILE, 50 * TILE, 5, 0, 9, 4.5, 207,
      { extraUpdates: 0, hostile: true });
    h.fixedUpdate(1, game2);
    h.fixedUpdate(1, game2);
    expect(h.vx).toBe(5);
    expect(h.vy).toBe(0);                          // 直飞（转向被 !friendly 门拦）
  });

  it('alpha 255 起 −25/t 渐显（GetAlpha :76682 (255−alpha) 通道）', () => {
    const game = makeGame(emptyWorld(), []);
    const a = new Arrow(100 * TILE, 50 * TILE, 5, 0, 9, 4.5, 207, { extraUpdates: 0 });
    expect(a.alpha).toBe(255);                    // SetDefaults :2687
    a.fixedUpdate(1, game);
    expect(a.alpha).toBe(230);
    for (let t = 0; t < 10; t++) a.fixedUpdate(1, game);
    expect(a.alpha).toBe(0);                      // 255−25×11 < 0 → 钳 0（:53940-53943）
  });
});

describe('④b 92 坠星弹体（aiStyle 5 :22152-22156 + :22222-22245）', () => {
  it('无重力直飞；弹顶越过 ai[1] 命中线才恢复撞块（线上穿墙）', () => {
    const w = emptyWorld();
    const game = makeGame(w, [], {
      onProjectileDeath: (...a: unknown[]) => { deaths.push(a[0]); },
    });
    const deaths: unknown[] = [];
    // 命中线 y=60T，星在线上方（y=40T）直落
    const star = new Arrow(100 * TILE, 40 * TILE, 0, 22, 10, 2, 92,
      { starFall: { lineY: 60 * TILE, gen: 1 } });
    expect(star.noTileCollide).toBe(true);        // SetDefaults tileCollide=false（:1487）
    for (let t = 0; t < 5; t++) star.fixedUpdate(1, game);
    expect(star.vy).toBe(22);                     // aiStyle5 无重力恒速
    expect(star.noTileCollide).toBe(true);        // 仍在命中线上方 → 穿墙
    star.y = 61 * TILE;                           // 越线（:22152 position.Y > ai[1]）
    star.fixedUpdate(1, game);
    expect(star.noTileCollide).toBe(false);
    // 越线后撞实心块 → Kill（消亡钩子收到 92）
    star.x = 100 * TILE;
    star.y = 190 * TILE - 22;                     // 步进 22 后弹心恰入地表行 190（实心）
    star.fixedUpdate(1, game);
    expect(star.dead).toBe(true);
    expect(deaths.includes(92)).toBe(true);
  });

  it('alpha 0↔200 闪烁档（localAI[0] ±1 翻向）+ Item_9 星啸节拍', () => {
    const sfx: string[] = [];
    const game = makeGame(emptyWorld(), [], {
      playSfxFiles: (files: string[]) => { sfx.push(files.join(',')); },
    });
    const star = new Arrow(100 * TILE, 40 * TILE, 0, 22, 10, 2, 92,
      { starFall: { lineY: 60 * TILE, gen: 0 } });
    for (let t = 0; t < 8; t++) star.fixedUpdate(1, game);
    expect(star.alpha).toBe(200);                 // 0→200 钳顶（:22229-22231）
    for (let t = 0; t < 8; t++) star.fixedUpdate(1, game);
    expect(star.alpha).toBe(0);                   // 200→0 钳底（:22232-22235）
    expect(sfx.filter((s) => s === 'Item_9').length).toBeGreaterThan(0);  // :22166-22172
  });
});

describe('⑤ Kill 三件（Projectile.cs Kill 段）', () => {
  interface Shell {
    g: Record<string, unknown>;
    added: unknown[];
    sfx: string[];
    dusts: Array<{ type: number; vx: number; vy: number; scale: number; noGravity: boolean }>;
    playerHits: number[];
  }
  function killShell(enemies: unknown[] = [], critters: unknown[] = []): Shell {
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    const added: unknown[] = [];
    const sfx: string[] = [];
    const dusts: Shell['dusts'] = [];
    const playerHits: number[] = [];
    g.entities = {
      add: (e: unknown) => { added.push(e); },
      enemies, critters,
    };
    g.player = { dead: false, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 10, h: 20 };
    g.playSfxFiles = (files: string[]) => { sfx.push(files.join(',')); };
    g.sfx = { play: (name: string) => { sfx.push(name); } };
    g.playSfxWav = () => {};
    g.spawnDust = (_x: number, _y: number, _w: number, _h: number, type: number,
      sx = 0, sy = 0, _alpha = 0, _c = null, scale = 1, noGravity = false) => {
      const d = { type, vx: sx, vy: sy, scale, noGravity };
      dusts.push(d);
      return d;
    };
    g.damagePlayer = (n: number): number => { playerHits.push(n); return 0; };
    return { g, added, sfx, dusts, playerHits };
  }
  const mkEnemy = (cx: number, cy: number) => ({
    cx, cy, x: cx - 8, y: cy - 8, w: 16, h: 16, dead: false,
    hurt(d: number, kx: number, _ky: number, _g: unknown, _pen = 0, _crit = false,
      _pierce = 0, _fp = false): boolean {
      (this as unknown as { hits: Array<[number, number]> }).hits.push([d, kx]);
      return true;
    },
    hits: [] as Array<[number, number]>,
  });

  it('91 圣箭：Item10 + 尘 58×10 + gore {16,17} + 命中点上空生成 92 坠星（伤/3、ai1=命中线、速 22）', () => {
    const sh = killShell();
    const goreTypes: number[] = [];
    const spy = vi.spyOn(GorePiece, 'newGore')
      .mockImplementation((type: number) => { goreTypes.push(type); return null; });
    try {
      (sh.g as unknown as { onProjectileDeath: (...a: unknown[]) => void })
        .onProjectileDeath(91, 1000, 2000, 10, 10, 3, 4, 30, { kb: 2, ai0: 0 });
    } finally {
      spy.mockRestore();
    }
    expect(goreTypes.length).toBe(3);
    expect(goreTypes.every((t) => t === 16 || t === 17)).toBe(true);   // Next(16,18) 右开（:72257）
    expect(sh.sfx).toEqual(['Item_10']);
    expect(sh.dusts.length).toBe(10);
    expect(sh.dusts.every((d) => d.type === 58)).toBe(true);
    expect(sh.dusts[0].vx).toBeCloseTo(0.3, 9);    // velocity×0.1
    expect(sh.added.length).toBe(1);
    const star = sh.added[0] as Arrow;
    expect(star).toBeInstanceOf(Arrow);
    expect(star.projId).toBe(92);
    expect(star.damage).toBe(10);                  // (int)(30/3)
    expect(star.starFallLine).toBe(2000);          // ai[1] = position.Y
    expect(star.y).toBeLessThanOrEqual(2000 - 600);   // 上空 600-899px（Next(600,900)）
    expect(star.y).toBeGreaterThanOrEqual(2000 - 899);
    expect(Math.hypot(star.vx, star.vy)).toBeCloseTo(22, 6);   // num661 = 22
  });

  it('92 坠星链：ai0>0 再链一代（伤不变、gen 归 0），ai0=0 终止', () => {
    const sh = killShell();
    const call = sh.g as unknown as { onProjectileDeath: (...a: unknown[]) => void };
    call.onProjectileDeath(92, 1000, 2000, 24, 24, -5, 8, 10, { kb: 1, ai0: 1 });
    expect(sh.added.length).toBe(1);
    const grand = sh.added[0] as Arrow;
    expect(grand.projId).toBe(92);
    expect(grand.damage).toBe(10);                 // 92 支不除 3（:72278-72281）
    expect(grand.starFallGen).toBe(0);             // ai[0] 不置 1 → 孙代终止
    const sh2 = killShell();
    (sh2.g as unknown as { onProjectileDeath: (...a: unknown[]) => void })
      .onProjectileDeath(92, 1000, 2000, 24, 24, -5, 8, 10, { kb: 1, ai0: 0 });
    expect(sh2.added.length).toBe(0);              // ai[0]=0 不再链（:72271 门）
  });

  it('89 水晶子弹：尘 68×5 + 2 枚 90 碎块（伤×0.5、出生偏移=速度向量）', () => {
    const sh = killShell();
    (sh.g as unknown as { onProjectileDeath: (...a: unknown[]) => void })
      .onProjectileDeath(89, 1000, 2000, 4, 4, 8, -6, 20, { kb: 0 });
    expect(sh.sfx).toEqual(['dig']);               // legacy PlaySound(0) = case 0 SoundDig（LegacySoundPlayer.cs:443，非 Item_1）
    expect(sh.dusts.length).toBe(5);
    expect(sh.dusts.every((d) => d.type === 68 && d.noGravity)).toBe(true);
    expect(sh.dusts[0].scale).toBeCloseTo(0.9, 9); // scale×0.9（NewDust scale 1 → 0.9）
    expect(sh.added.length).toBe(2);
    for (const raw of sh.added) {
      const s = raw as Arrow;
      expect(s.projId).toBe(90);
      expect(s.damage).toBe(10);                   // (int)(damage×0.5)
      // 出生点 = position + (nvx,nvy)、速度 = (nvx,nvy)（:72298-72303 同向量）
      expect(s.x - 1000).toBeCloseTo(s.vx, 6);
      expect(s.y - 2000).toBeCloseTo(s.vy, 6);
    }
  });

  it('41 狱炎箭：Item14 + 尘 31×10/6×10 + 64×64 盒内敌重结算 30 伤、盒外不结算', () => {
    const inside = mkEnemy(1005, 2005);
    const outside = mkEnemy(1005 + 120, 2005);
    const sh = killShell([inside, outside]);
    // ★BJ731 改判史（2026-10-27）：41 爆箱伤走 :12970 DV 掷（BJ723-B 落地面）
    //   ——0.5 恒等档钉 30（未 mock 必漂 25-34）。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      (sh.g as unknown as { onProjectileDeath: (...a: unknown[]) => void })
        .onProjectileDeath(41, 1000, 2000, 10, 10, 3, 0, 30, { kb: 2, hostile: false, arpen: 5 });
    } finally { rvi731.mockRestore(); }
    expect(sh.sfx).toEqual(['Item_14']);
    expect(sh.dusts.length).toBe(20);              // 31×10 + 6×(2.5+1.5)×5
    expect(sh.dusts.filter((d) => d.type === 31).length).toBe(10);
    expect(sh.dusts.filter((d) => d.type === 6).length).toBe(10);
    expect(inside.hits.length).toBe(1);
    expect(inside.hits[0][0]).toBe(30);            // Damage() 重结算同伤
    expect(inside.hits[0][1]).toBeCloseTo(0, 6);   // 击退向 = 爆心−敌心（同心 → 0）
    expect(outside.hits.length).toBe(0);           // 120px 外出 64×64 盒
    expect(sh.playerHits.length).toBe(0);          // friendly 弹不回炸玩家
  });
});
