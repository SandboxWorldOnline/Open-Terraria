// ★SW-BJ93 债③/④/② wave2（2026-09-16）清偿守卫（RollingBoulder 世界写入面）。
//
// 三项与金标锚（1457;1458 同域逐字 byte-diff 全等 2026-09-16）：
//   债③ 1021 MoonBoulder 专属弹跳支   P.cs:19101-19128 ↔ :19102-19129——撞墙【不即碎】：
//                                      Y 高速(>4)落地弹 −0.9(:19109)+HitTiles+声;
//                                      Y 低速(0,4]置 localAI[1]=999(:19113 停稳标记);
//                                      X 撞墙 <=3 → 弹 −0.75++(:19118-22,四次内弹回),
//                                      >3 → Kill(:19123-26)。★本支零 RNG(亲读定谳)。
//   债④a 1053 落地 20 尘              家族①落地支 :19059-19071 ↔ :19060-19072——
//                                      10 迭代×2 尘 6（盒 pos.X,pos.Y+8,w,h−8、α100）:
//                                      ①scale2→v×8+noGravity ②scale1.25→v×2→X×1.5→Y−2;
//                                      位序=HitTiles 近似【前】。
//   债④b 1054 蛛网铺置                AI_025 :26394-26410 ↔ :26395-26411——扫盒
//                                      x∈[(int)(px+1)/16,(int)(px+w)/16]（y 同式,
//                                      31px 盒=3×3 格域）x 外 y 内;门=!active()∧
//                                      liquid==0∧Next(7)==0（短路）;PlaceTile(51,mute)
//                                      （tileSolid[51]=false → :59864 `!tileSolid` 臂
//                                      直过=EmptyTile 占用面不适用,亲读定谳）。
//   债② Kill 地形面                   :76478-76489 ↔ :76479-76490（netMode!=1 单机恒真）
//                                      ——1048→SpreadPoopPyramid（:71627-71645 半砖顶推
//                                      +Utils.FloodFillTile :2548-2592 BFS+DelegateMethods
//                                      .SpreadTile :474-599 金字塔 1/3/5/3+TryKillingReplaceable
//                                      Tile+PlaceTile(EmptyTile)+3×2 尘 322+邻坡拍平+草族
//                                      围杀）/ 1053→LavaBoulderExplosion（:71647-71661
//                                      半径 4 圆盘∧CanHit→PlaceLiquid(1,255) :4495-4546,
//                                      异液合并 水→56/蜜→230/微光→659【先清液 :4535-36
//                                      后 PlaceTile :4537→:59864 EmptyTile 臂(mergeTile
//                                      全 solid→化简;拒=止于液清零);EmptyTile 实体矩形
//                                      (int)position 截断 Collision.cs:1370/:1377】。
//                                      ★原版 Kill() 调用序亲读定谳：尘表→声→1053 专属
//                                      爆面→1054/1055/缺省尘→掉落→【地形面最后】。
//
// 变异证红（开发期逐组实测,每债至少两线）：
//   债③-M1 弹回系数 −0.75 改 −0.2（家族①）→ B3 红 / 债③-M2 limit 门 >3 改 >20
//   （1013 同款）→ B3 红 / 债③-M3 摘停稳标记 999 支 → B4 红 / 债③-M4 摘整支（回
//   通用②即碎）→ B3 红（首拍即 dead）。
//   债④a-M1 摘 1053 落地尘支 → L1 红 / 债④a-M2 scale 表 2/1.25 改 1.5 → L1 红。
//   债④b-M1 摘 liquid 门 → W2 红 / 债④b-M2 摘 hasTile 门 → W2 红 / 债④b-M3
//   遍历序改 y 外 x 内 → W3 红 / 债④b-M4 Next(7) 改 Next(1)（恒铺）→ W3 红。
//   债②-M1 摘 rbKillTerrainFace → P1/V1 红 / 债②-M2 金字塔形门 num2 公式改方形 →
//   P1 红 / 债②-M3 摘 EmptyTile 玩家门 → P2 红 / 债②-M4 摘 CanHit 门 → V2 红 /
//   债②-M5 半径 4 改 5 → V1 红 / 债②-M6 地形面挪到尘表前（错序）→ P3/V3 红。
//   债②-M7 摘合并臂 EmptyTile 门（G 刀收尾 :4537）→ V2b/V2c 红 / 债②-M8 摘
//   EmptyTile 实体 (int) 截断（Collision.cs:1370/:1377）→ V5 红 / 债②-M9 门错挂
//   主臂（:4511-4525 原版无门）→ V4/V5 红 / 债②-M10 门序倒置（先落块后清液）→ S4 红。
import { describe, it, expect, vi, beforeEach } from 'vitest';
// ★BJ743-A（R24 SEV-2）：require('node:fs') 旁路收口——改 ESM import 形经守卫。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RollingBoulder } from '../src/entities/RollingBoulder';
import { World } from '../src/world/World';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { GorePiece } from '../src/entities/GorePiece';
import type { GameHooks } from '../src/entities/types';

// ================= 夹具（真 World 世界快照 + 弹域 game mock,BJ93/boulder-trap 同构） =================

const POO_ID = TILE_BY_KEY['v_666_poo'];
const WEB_ID = TILE_BY_KEY['v_51_cobweb'];
const SOLID_ID = TILE_BY_KEY['dirt'];

interface EventLog { events: string[] }

function makeWorld(): World {
  return new World(100, 100, 30, 'open');
}

function makeGame(w: World, opts?: {
  player?: Record<string, unknown>;
  enemies?: unknown[];
}) {
  const dusts: Array<{ x: number; y: number; w: number; h: number; type: number;
    vx: number; vy: number; alpha: number; scale: number; noGravity: boolean }> = [];
  const particles: Array<{ x: number; y: number; color: string; count: number }> = [];
  const sfx: Array<{ name: string }> = [];
  const events: string[] = [];                       // 掷序/写序时间线（债② P3/V3）
  const player = opts?.player ?? { dead: true, x: 99999, y: 99999, w: 20, h: 42,
    cx: 100009, cy: 100020, vx: 0, vy: 0, iframes: 0 };
  w.store.onTileChanged((x: number, y: number) => events.push(`tile@${x},${y}`));
  w.store.onLiquidChanged((x: number, y: number) => events.push(`liquid@${x},${y}`));
  const g = {
    world: w,
    player,
    candidatePlayers: () => [player],
    enemies: () => opts?.enemies ?? [],
    critters: () => [],
    npcs: () => [],
    projectiles: () => [],
    spawnParticles: (x: number, y: number, color: string, count: number) => {
      particles.push({ x, y, color, count });
      events.push(`particle:${count}`);
    },
    spawnDust: (x: number, y: number, dw: number, dh: number, type: number,
      vx = 0, vy = 0, alpha = 0, _color = null, scale = 1) => {
      const dust = { x, y, w: dw, h: dh, type, vx, vy, alpha, scale, fadeIn: 0,
        noGravity: false, color: null };
      dusts.push(dust);
      events.push(`d${type}@${dw}x${dh}`);
      return dust;
    },
    playSfx: (name: string) => { sfx.push({ name }); },
    playSfxWav: (name: string) => { sfx.push({ name }); },
    playSfxFile: (name: string) => { sfx.push({ name }); },
    cutTile: () => {},
    spawnDrop: () => null,
    damagePlayer: (dmg: number) => dmg,
    addLightAt: () => {},
    dusts, particles, sfx, events,
  };
  return g as unknown as GameHooks & {
    dusts: typeof dusts; particles: typeof particles; sfx: typeof sfx; events: string[];
  };
}

/** 直造弹型（1021 无 tile sheet 行;mkProj 同 BJ93 cast 约定） */
const mkProj = (projId: number): RollingBoulder => {
  const b = new RollingBoulder(104, 104, 138);
  (b as unknown as { projId: number }).projId = projId;
  return b;
};

const internals = (b: RollingBoulder) =>
  b as unknown as {
    rbKill: (g: GameHooks) => void;
    rb1021Bounce: (lx: number, ly: number, g: GameHooks) => void;
    localAI1: number; localAI0: number; localAI2: number;
  };

const sheetAt = (w: World, x: number, y: number): number =>
  TILE_DEFS[w.store.get(x, y)]?.vanilla?.sheet ?? -1;

beforeEach(() => { vi.restoreAllMocks(); });

// ================= 债③：1021 专属弹跳支（P.cs:19101-19128） =================
describe('SW-BJ93 债③ 1021 弹跳支（四次内弹回 −0.75/limit Kill/停稳标记 999）', () => {
  it('B1 Y 高速落地（lastVY>4）弹回 −0.9 + HitTiles 近似 + dig 声（:19105-19110）;localAI1 不动', () => {
    const w = makeWorld();
    const game = makeGame(w);
    const b = mkProj(1021);
    b.vx = 0; b.vy = 0;
    internals(b).rb1021Bounce(0, 8, game);
    expect(b.vy).toBeCloseTo(-7.2, 6);                 // −8×0.9（变异 M1:系数回 −0.2 → −1.6 红）
    expect(internals(b).localAI1).toBe(0);             // Y 弹不计数
    expect(game.particles.length).toBe(1);             // HitTiles 近似（:19107）
    expect(game.sfx.some((s) => s.name === 'dig')).toBe(true);   // PlaySound(0)（:19108）
    expect(b.dead).toBe(false);
  });

  it('B2 Y 低速下落（0<lastVY≤4）→ localAI[1]=999 停稳标记（:19111-19114）,速度不覆写、零尘', () => {
    const w = makeWorld();
    const game = makeGame(w);
    const b = mkProj(1021);
    b.vx = 0; b.vy = 0;
    internals(b).rb1021Bounce(0, 3, game);
    expect(internals(b).localAI1).toBe(999);           // 变异 M3:摘支 → 0 → B4 连锁红
    expect(b.vy).toBe(0);                              // 无弹回
    expect(game.particles.length).toBe(0);             // 低速支无 HitTiles
    expect(b.dead).toBe(false);
  });

  it('B3 X 撞墙四次内弹回 −0.75++（:19118-19122）,第 5 次撞墙 >3 → Kill（:19123-19126;尘 323×30 族面）', () => {
    const w = makeWorld();
    const game = makeGame(w);
    const b = mkProj(1021);
    b.vy = 0;
    for (let i = 1; i <= 4; i++) {
      internals(b).rb1021Bounce(7, 0, game);
      expect(internals(b).localAI1).toBe(i);           // 0..3 四次内弹回（变异 M2:>3 改 >20 → 第 5 次不碎红）
      expect(b.vx).toBeCloseTo(-5.25, 6);              // 7×−0.75（变异 M1 同线）
      expect(b.dead).toBe(false);                      // 变异 M4:摘支回通用② → 首拍即碎红
    }
    internals(b).rb1021Bounce(7, 0, game);             // 第 5 次:localAI1=4 >3 → Kill
    expect(b.dead).toBe(true);
    expect(game.dusts.filter((d) => d.type === 323).length).toBe(30);   // 尘表 1021→323（:76367）
  });

  it('B4 停稳标记（999）后首次 X 撞墙即 Kill 且不再弹回（:19118 else 臂）', () => {
    const w = makeWorld();
    const game = makeGame(w);
    const b = mkProj(1021);
    b.vx = 0; b.vy = 0;
    internals(b).rb1021Bounce(0, 3, game);             // 停稳标记
    internals(b).rb1021Bounce(7, 0, game);             // 撞墙 → 999 > 3 → Kill
    expect(b.dead).toBe(true);
    expect(b.vx).toBe(0);                              // 不弹回（else 臂无速度覆写）
  });
});

// ================= 债④a：1053 落地 20 尘（家族①落地支 :19059-19071） =================
describe('SW-BJ93 债④a 1053 落地 20 尘（10×scale2 + 10×scale1.25,盒 y+8/h−8）', () => {
  const FLOOR_ROW = 80;

  function floorWorld(): World {
    const w = makeWorld();
    for (let x = 0; x < 100; x++) w.store.setTileSilent(x, FLOOR_ROW, SOLID_ID, 0, 0);
    return w;
  }

  it('L1 1053 硬落拍 20 尘（:19061-19071）+ 弹回 −lastVY×0.2（:19074）;位序在 HitTiles 近似前', () => {
    const w = floorWorld();
    const game = makeGame(w);
    const b = mkProj(1053);
    b.x = 800; b.y = 80 * 16 - 31 - 4;                 // 贴地 4px 上方
    b.vx = 0; b.vy = 8;
    b.fixedUpdate(1 / 60, game);                       // 首拍重力 8.3 → 落地
    expect(b.vy).toBeCloseTo(-8.3 * 0.2, 6);           // :19074 弹回（lastVY=8.3）
    const big = game.dusts.filter((d) => d.scale === 2);
    const small = game.dusts.filter((d) => d.scale === 1.25);
    expect(big.length).toBe(10);                       // 变异 M1:摘支 → 0 红
    expect(small.length).toBe(10);                     // 变异 M2:scale 表改 → 0/对折红
    for (const d of [...big, ...small]) {
      expect(d.type).toBe(6);                          // :19063/:19066 尘 6
      expect(d.alpha).toBe(100);
      expect(d.w).toBe(31); expect(d.h).toBe(23);      // 盒 (pos.X, pos.Y+8, w, h−8)
      expect(d.h).toBe(b.h - 8);
    }
    expect(big[0]!.noGravity).toBe(true);              // :19065
  });

  it('L2 非 1053 家族型（99）落地拍零落地尘（支门 type==1053 :19059）', () => {
    const w = floorWorld();
    const game = makeGame(w);
    const b = mkProj(99);
    b.x = 800; b.y = 80 * 16 - 31 - 4;
    b.vx = 0; b.vy = 8;
    b.fixedUpdate(1 / 60, game);
    expect(game.dusts.filter((d) => d.scale === 2 || d.scale === 1.25).length).toBe(0);
  });
});

// ================= 债④b：1054 蛛网铺置（AI_025 :26394-26410） =================
describe('SW-BJ93 债④b 1054 蛛网铺置（3×3 窗/空干格 Next(7)/x 外 y 内序）', () => {
  it('W1 空干窗 9 格全铺（Next(7) 恒中 mock）;快照=v_51_cobweb（:26402 PlaceTile(51,mute)）', () => {
    const w = makeWorld();                             // 先建后 spy（World 构造自掷 1 发）
    vi.spyOn(Math, 'random').mockReturnValue(0);       // Next(7)==0 恒真
    const game = makeGame(w);
    const b = mkProj(1054);
    b.x = 104; b.y = 104;                              // 窗 (6..8, 6..8)
    b.fixedUpdate(1 / 60, game);
    let placed = 0;
    for (let x = 6; x <= 8; x++) {
      for (let y = 6; y <= 8; y++) {
        expect(w.store.get(x, y)).toBe(WEB_ID);
        placed++;
      }
    }
    expect(placed).toBe(9);
  });

  it('W2 占用格/液格短路跳过（:26400 门序 !active()∧liquid==0【先】于掷）且不消耗掷', () => {
    const w = makeWorld();                             // World 构造自掷 1 发,先建后 spy
    w.store.setTileSilent(6, 6, SOLID_ID, 0, 0);       // 占用格
    w.store.setLiquid(6, 7, 255, 1);                   // 液格（repo 编码 1=水）
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    const game = makeGame(w);
    const b = mkProj(1054);
    b.x = 104; b.y = 104;
    b.fixedUpdate(1 / 60, game);
    expect(w.store.get(6, 6)).toBe(SOLID_ID);          // 占用格不被铺（变异 M2:摘 hasTile 门 → 红）
    expect(w.store.liquid[w.store.idx(6, 7)]).toBe(255);   // 液格不被铺（变异 M1:摘 liquid 门 → 红）
    expect(w.store.get(6, 7)).toBe(0);
    let webCount = 0;
    for (let x = 6; x <= 8; x++) for (let y = 6; y <= 8; y++) {
      if (w.store.get(x, y) === WEB_ID) webCount++;
    }
    expect(webCount).toBe(7);                          // 余 7 空干格全铺
    expect(rnd.mock.calls.length).toBe(7);             // 短路:被跳格零掷（x 外 y 内 7 掷）
  });

  it('W3 遍历序=x 外 y 内（:26396/:26398 循环嵌套序;序列 mock 第 2 掷收 → 必落 (6,7)）', () => {
    const w = makeWorld();                             // 先建后 spy（World 构造自掷 1 发）
    let call = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => (call++ === 1 ? 0 : 0.99));
    const game = makeGame(w);
    const b = mkProj(1054);
    b.x = 104; b.y = 104;
    b.fixedUpdate(1 / 60, game);
    // x 外 y 内:第 1 掷=(6,6) 拒、第 2 掷=(6,7) 收——y 外 x 内则第 2 掷=(7,6)=变异 M3 红
    expect(w.store.get(6, 7)).toBe(WEB_ID);
    expect(w.store.get(7, 6)).toBe(0);
    let webCount = 0;
    for (let x = 6; x <= 8; x++) for (let y = 6; y <= 8; y++) {
      if (w.store.get(x, y) === WEB_ID) webCount++;
    }
    expect(webCount).toBe(1);                          // 变异 M4:Next(7) 改 Next(1) → 每掷必中 ≠1 红
  });
});

// ================= 债②：1048 便便金字塔（:71627-71645+:2548-2592+DelegateMethods :474-599） =================
describe('SW-BJ93 债② 1048 SpreadPoopPyramid（金字塔 1/3/5/3/EmptyTile/掷序锁）', () => {
  // 弹 (104,104) → 心 tile (7,7):行 (7,6)=1、(6..8,7)=3、(5..9,8)=5、(6..8,9)=3
  const PYRAMID: Array<[number, number]> = [
    [7, 6],
    [6, 7], [7, 7], [8, 7],
    [5, 8], [6, 8], [7, 8], [8, 8], [9, 8],
    [6, 9], [7, 9], [8, 9],
  ];

  it('P1 空场 rbKill → 12 格金字塔快照（sheet 666）;形外格零 poo', () => {
    const w = makeWorld();
    const game = makeGame(w);
    internals(mkProj(1048)).rbKill(game);
    for (const [x, y] of PYRAMID) {
      expect(w.store.get(x, y)).toBe(POO_ID);          // 变异 M2:形门改方形 → (5,7)/(10,8) 有 poo 红
    }
    for (const [x, y] of [[7, 5], [5, 7], [10, 8], [5, 9], [7, 10]] as const) {
      expect(w.store.get(x, y)).toBe(0);
    }
    expect(game.dusts.filter((d) => d.type === 322 && d.w === 16).length).toBe(12 * 6);   // 逐格 3×2 尘 322
    expect(sheetAt(w, 7, 7)).toBe(666);
  });

  it('P2 EmptyTile 玩家占用格拒铺（Collision.cs:1361-1383）,余 11 格 BFS 绕行照铺', () => {
    const w = makeWorld();
    const game = makeGame(w, { player: { dead: false, x: 88, y: 128, w: 1, h: 1, cx: 88, cy: 128 } });
    internals(mkProj(1048)).rbKill(game);
    expect(w.store.get(5, 8)).toBe(0);                 // 玩家罩格（变异 M3:摘玩家门 → 有 poo 红）
    let poo = 0;
    for (const [x, y] of PYRAMID) if (w.store.get(x, y) === POO_ID) poo++;
    expect(poo).toBe(11);
  });

  it('P2b EmptyTile NPC 占用格拒铺（Main.npc 全桶=enemies+npcs+critters 并集）', () => {
    const w = makeWorld();
    const game = makeGame(w, { enemies: [{ dead: false, x: 88, y: 128, w: 1, h: 1 }] });
    internals(mkProj(1048)).rbKill(game);
    expect(w.store.get(5, 8)).toBe(0);
  });

  it('P3 掷序锁（原版 Kill() 调用序）:家族死亡尘 30×31 盒【先】于铺置面（16 盒尘/tile 写位）', () => {
    const w = makeWorld();
    const game = makeGame(w);
    internals(mkProj(1048)).rbKill(game);
    const ev = game.events;
    const firstTileIdx = ev.findIndex((e) => e.startsWith('tile@'));
    const deathDustIdx = ev.map((e, i) => (e === 'd322@31x31' ? i : -1)).filter((i) => i >= 0);
    expect(deathDustIdx.length).toBe(30);              // 尘表 1048→322 缺省支 ×30（:76459-76466）
    expect(Math.max(...deathDustIdx)).toBeLessThan(firstTileIdx);   // 变异 M6:地形面前挪 → 红
    expect(ev.slice(0, 30).every((e) => e.startsWith('d'))).toBe(true);
  });
});

// ================= 债②：1053 熔岩巨石爆炸（P.cs:71647-71661 + WorldGen.cs:4495-4546） =================
describe('SW-BJ93 债② 1053 LavaBoulderExplosion（半径 4 圆盘∧CanHit→PlaceLiquid(1,255)）', () => {
  it('V1 空场 rbKill → 圆盘 dist<4 全 255/岩浆;dist==4 与角格严格干（:71655 `< 4f`）', () => {
    const w = makeWorld();
    const game = makeGame(w);
    internals(mkProj(1053)).rbKill(game);
    const cx = 7, cy = 7;                              // 心 tile（弹 (104,104)）
    expect(w.store.liquid[w.store.idx(cx, cy)]).toBe(255);
    expect(w.store.liquidType[w.store.idx(cx, cy)]).toBe(2);   // repo LAVA
    expect(w.store.liquid[w.store.idx(cx + 3, cy)]).toBe(255); // dist 3 <4
    expect(w.store.liquid[w.store.idx(cx + 2, cy + 3)]).toBe(255);   // √13≈3.61 <4
    expect(w.store.liquid[w.store.idx(cx + 4, cy)]).toBe(0);   // dist 4 非 <（变异 M5:半径 5 → 红）
    expect(w.store.liquid[w.store.idx(cx + 3, cy + 3)]).toBe(0);   // √18≈4.24 干
    expect(w.store.liquid[w.store.idx(cx - 4, cy - 4)]).toBe(0);
  });

  it('V2 CanHit 门：实心环围心 → 仅心格注液（Collision.CanHit :71655）', () => {
    const w = makeWorld();
    for (let x = 6; x <= 8; x++) {
      for (let y = 6; y <= 8; y++) {
        if (x === 7 && y === 7) continue;
        w.store.setTileSilent(x, y, SOLID_ID, 0, 0);   // 3×3 实心环（心格空=弹所在）
      }
    }
    const game = makeGame(w);
    internals(mkProj(1053)).rbKill(game);
    expect(w.store.liquid[w.store.idx(7, 7)]).toBe(255);   // 自格恒可达（同格 true）
    let wet = 0;
    for (let x = 3; x <= 11; x++) {
      for (let y = 3; y <= 11; y++) {
        if (w.store.liquid[w.store.idx(x, y)] > 0) wet++;
      }
    }
    expect(wet).toBe(1);                               // 变异 M4:摘 CanHit 门 → 圆盘全湿红
  });

  it('V3 掷序锁：1053 死亡爆面（尘 31×25+尘 6×80+gore×4）【先】于注液写位（:76391-76446 → :76478）', () => {
    const w = makeWorld();
    const game = makeGame(w);
    const goreSpy = vi.spyOn(GorePiece, 'newGore').mockImplementation(() => {
      game.events.push('gore');
      return null;
    });
    internals(mkProj(1053)).rbKill(game);
    expect(goreSpy).toHaveBeenCalledTimes(4);
    const ev = game.events;
    const firstLiquidIdx = ev.findIndex((e) => e.startsWith('liquid@'));
    expect(firstLiquidIdx).toBeGreaterThan(-1);
    expect(ev.slice(0, firstLiquidIdx).filter((e) => e === 'd31@64x64').length).toBe(25);
    expect(ev.slice(0, firstLiquidIdx).filter((e) => e === 'd6@64x64').length).toBe(80);
    expect(ev.slice(0, firstLiquidIdx).filter((e) => e === 'gore').length).toBe(4);
    expect(ev.slice(firstLiquidIdx).every((e) => e.startsWith('liquid@'))).toBe(true);
  });

  it('V3b 异液合并：水格注岩浆 → 黑曜石 56（GetLiquidMergeTypes case1;蜜→230/微光→659 同域）', () => {
    const w = makeWorld();
    w.store.setLiquid(7, 6, 255, 1);                   // repo 1=水（vanilla b=0）
    const game = makeGame(w);
    internals(mkProj(1053)).rbKill(game);
    expect(w.store.get(7, 6)).toBe(TILE_BY_KEY['obsidian']);   // :4532 case 1 → mergeTile 56
    expect(w.store.liquid[w.store.idx(7, 6)]).toBe(0);         // :4535 液清零
    expect(w.store.liquid[w.store.idx(7, 7)]).toBe(255);       // 余盘照注
  });

  // ★G 刀收尾（2026-09-16）：合并臂 PlaceTile 门（WorldGen.cs:4533-4544+:59864 亲读定谳
  //  ——原版序=【先】清液 :4535-4536【后】PlaceTile :4537;mergeTile 56/230/659 全
  //  solid(Main.cs:8079/:10362/:9767)∧非 moss∧非覆写特支 → :59864 化简为 EmptyTile
  //  臂;拒铺=止于液清零、块不落）+ EmptyTile 实体矩形 (int) 截断（:1370/:1377）。
  it('V2b EmptyTile 罩格拒铺：玩家/NPC 罩格 → 水格止于液清零、不落 56（:4537 门;原版序）', () => {
    const w = makeWorld();
    w.store.setLiquid(7, 6, 255, 1);                   // repo 1=水
    const game = makeGame(w, { player: { dead: false, x: 113, y: 97, w: 1, h: 1, cx: 113, cy: 97 } });
    internals(mkProj(1053)).rbKill(game);
    expect(w.store.get(7, 6)).toBe(0);                 // 不落黑曜石（变异 M7:摘门 → 56 红）
    expect(w.store.liquid[w.store.idx(7, 6)]).toBe(0); // 止于液清零=原版序 :4535-36【先】于 :4537
    expect(w.store.liquid[w.store.idx(7, 7)]).toBe(255);   // 主臂无门照注
    const w2 = makeWorld();                            // NPC 罩格支（Main.npc 全桶=enemies 并集）
    w2.store.setLiquid(7, 6, 255, 1);
    const game2 = makeGame(w2, { enemies: [{ dead: false, x: 113, y: 97, w: 1, h: 1 }] });
    internals(mkProj(1053)).rbKill(game2);
    expect(w2.store.get(7, 6)).toBe(0);
    expect(w2.store.liquid[w2.store.idx(7, 6)]).toBe(0);
  });

  it('V2c 格上 active 非实心件（蛛网 51,tileSolid=false）→ 件保留+不落 56+液清零', () => {
    const w = makeWorld();
    w.store.setTileSilent(7, 6, WEB_ID, 0, 0);         // :4507 实心门放行（tileSolid[51]=false）
    w.store.setLiquid(7, 6, 255, 1);
    const game = makeGame(w);
    internals(mkProj(1053)).rbKill(game);
    expect(w.store.get(7, 6)).toBe(WEB_ID);            // 件保留（EmptyTile active() 拒 Collision.cs:1364;变异 M7 红）
    expect(w.store.liquid[w.store.idx(7, 6)]).toBe(0); // 液清零
  });

  it('V4 主臂无 EmptyTile 门：玩家罩格空格仍注满 255（PlaceLiquid :4511-4525 原版无门;门错挂主臂→红）', () => {
    const w = makeWorld();
    const game = makeGame(w, { player: { dead: false, x: 113, y: 81, w: 1, h: 1, cx: 113, cy: 81 } });
    internals(mkProj(1053)).rbKill(game);
    expect(w.store.liquid[w.store.idx(7, 5)]).toBe(255);   // 玩家罩格 (7,5) 照注（变异 M9 → 0 红）
    expect(w.store.liquid[w.store.idx(7, 7)]).toBe(255);
  });

  it('V5 EmptyTile 实体矩形 (int) 截断（Collision.cs:1370）：浮点罩 0.5px、截断后脱罩 → 照落 56', () => {
    const w = makeWorld();
    w.store.setLiquid(7, 6, 255, 1);                   // 水格 (7,6)=[112,128)×[96,112)
    const game = makeGame(w, { player: { dead: false, x: 96.5, y: 96.5, w: 16, h: 16, cx: 96.5, cy: 96.5 } });
    internals(mkProj(1053)).rbKill(game);
    // 浮点 rect [96.5,112.5]² 右/下缘罩 (7,6)/(6,7)/(7,7) 0.5px → 拒;(int) 截断 [96,112]²
    // 右缘恰 112 非闭开 < → 脱罩 → EmptyTile 真 → 落 56。变异 M8:摘 Math.trunc → 红。
    expect(w.store.get(7, 6)).toBe(TILE_BY_KEY['obsidian']);
    expect(w.store.liquid[w.store.idx(7, 6)]).toBe(0);
    expect(w.store.liquid[w.store.idx(6, 6)]).toBe(255);   // 真罩格 (6,6)（截断前后都罩）主臂照注（变异 M9 同红）
  });
});

// ================= 结构锁（源文本锚,防静默回退） =================
describe('SW-BJ93 wave2 结构锁（判据表达式与调用序钉死）', () => {
  // ★BJ743-A：require 形退役——顶部 ESM import 经守卫（R24 SEV-2 旁路收口）。
  const rb = () => readFileSync(join(__dirname, '../src/entities/RollingBoulder.ts'), 'utf8');

  it('S1 1021 专支接线于碰撞链（先于 1013=原版链序）且弹回式逐式在场', () => {
    const src = rb();
    const b21 = src.indexOf('} else if (this.projId === 1021) {');
    const b13 = src.indexOf('} else if (this.projId === 1013) {');
    expect(b21).toBeGreaterThan(-1);
    expect(b13).toBeGreaterThan(b21);                  // 原版链序 1021→1013（:19101 → :19129）
    expect(src.slice(b21, b13)).toContain('this.rb1021Bounce(lastVX, lastVY, game)');
    const m = src.slice(src.indexOf('private rb1021Bounce'));
    expect(m).toContain('this.localAI1 = 999');        // :19113 停稳标记
    expect(m).toContain('lastVX * -0.75');             // :19120
    expect(m).toContain('-lastVY * 0.9');              // :19109
    expect(m).toContain('this.localAI1 <= 3');         // :19118 limit
  });

  it('S2 Kill 地形面在家族面尾（掉落臂后=原版 :76470-77 → :76478-89 调用序）且两型接线', () => {
    const src = rb();
    const fam = src.slice(src.indexOf('private rbKillFamilyFace'), src.indexOf('private rbCenterTileX'));   // ★BJ102：旧 rbSelfHurtPlayers 终点标记随面退役
    const dropIdx = fam.indexOf("VANILLA_ITEM_KEY_BY_ID[29]");
    const terrainIdx = fam.indexOf('this.rbKillTerrainFace(game)');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(terrainIdx).toBeGreaterThan(dropIdx);       // 变异 M6 结构面
    expect(fam).toContain('this.rbSpreadPoopPyramid(game)');
    expect(fam).toContain('this.rbLavaBoulderExplosion(game)');
  });

  it('S3 地形面写位原语：EmptyTile 玩家+NPC 门/形门 num2 式/CanHit/PlaceLiquid 满补', () => {
    const src = rb();
    expect(src).toContain('private rbEmptyTile1457');
    expect(src).toContain('num * (1 - Math.abs(y - (ay + num / 2)) / num)');   // 金字塔形门 :480-482
    expect(src).toContain('canHit(st, this.x, this.y, this.w, this.h, i * 16, j * 16, 16, 16)');
    expect(src).toContain('st.setLiquid(x, y, 255, LIQUID_TYPE.LAVA)');        // :4513-4518 满补
    expect(src).toContain('if (resid === 0) return false');    // vanilla 残型 0=土实心对拍
  });

  it('S4 合并臂门序+实体矩形截断钉死（G 刀收尾 :4537 EmptyTile 门/Collision.cs:1370/:1377 trunc）', () => {
    const src = rb();
    const m = src.slice(src.indexOf('private rbPlaceLiquidLava'));
    const clearIdx = m.indexOf('st.setLiquid(x, y, 0, LIQUID_TYPE.NONE)');        // :4535-36【先】
    const gateIdx = m.indexOf('if (!this.rbEmptyTile1457(x, y, game)) return;');  // :4537 门【后】
    const putIdx = m.indexOf('st.setTile(x, y, mergeId)');
    expect(clearIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(clearIdx);         // 原版序=先清液后 PlaceTile（变异 M10 倒置 → 红）
    expect(putIdx).toBeGreaterThan(gateIdx);           // 门在写位前（变异 M7:摘门 → -1 红）
    const e = src.slice(src.indexOf('private rbEmptyTile1457'));
    expect(e).toContain('Math.trunc(pp.x), Math.trunc(pp.y)');   // :1370 (int)position（变异 M8 → 红）
    expect(e).toContain('Math.trunc(e.x), Math.trunc(e.y)');     // :1377 (int)position（变异 M8 → 红）
  });
});
