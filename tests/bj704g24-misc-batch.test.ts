// ★BJ704-G24 登记债清偿·杂项批六件守卫（先定谳再动刀,1457 亲读）：
//   件1 a-batch1 陈旧夹具（MV3 单键沿）——修在 tests/a-batch1.test.ts 本体
//        （27/27 绿+装备/护甲/跑步批 370/370）,此处只留结构锁防回退。
//   件3 [g22-fw-conch-mirror]：海螺落点 fireWalk 镜像补 buff305 熔岩鲨腿
//        （Game.ts requestMagicConchTeleportPosition——TeleportHelpers.cs:256
//        TileIsDangerous→Collision.cs:3233 `TouchDamageHot && !player.fireWalk`,
//        fireWalk 第源=UpdateBuffs :9994-9998 buffType 305）。
//   件5 [g20-buff305-lavavision]：维持登记（Player.ts/Renderer.ts 双热争用）,
//        VanillaLiquidRenderer.ts 两处强化注记——结构锁。
//   件6 [fetchAsset-no-backoff-consumers]：维持登记（三证判语,sw.js 注记）——结构锁。
//   件2/件4 的行为守卫在 tests/bj704g24-launcher-fw-blast.test.ts 与
//   tests/orchestra-types-l5.test.ts（锁随结构走）。
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/core/Game';
import { Camera } from '../src/render/Camera';
import { World } from '../src/world/World';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { TileStore, LIQUID_TYPE } from '../src/world/TileStore';
import { TILE } from '../src/core/constants';

const GAME_TS = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const LIQ_TS = readFileSync(new URL('../src/render/VanillaLiquidRenderer.ts', import.meta.url), 'utf8');
const SW_JS = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const A_BATCH1_TS = readFileSync(new URL('./a-batch1.test.ts', import.meta.url), 'utf8');

function paintRect(st: TileStore, x0: number, x1: number, y0: number, y1: number, type: number): void {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) st.setTileSilent(x, y, type);
}
function paintWater(st: TileStore, x0: number, x1: number, y0: number, y1: number, amount = 200): void {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) st.setLiquid(x, y, amount, LIQUID_TYPE.WATER);
}

/** 左洋水体 + 狱石岸（TouchDamageHot sheet 58——fireWalk=false 时 CanTileHurt=true 判危）。
 *  ★岸顶与水面同行（113）:爬行体在 (px,112) 站位评估 (px,113) 危险臂——岸顶高出
 *  水面一行时落位经爬行尾 break 步进（vanilla 同构不查步进列,TeleportHelpers.cs
 *  :158-162 `point.X += crawlOffsetX` 后直 break）,危险臂不可达=无判别力。 */
function hellstoneShoreWorld(): World {
  const w = new World(300, 240, 7, 'g24-hs');
  w.groundLevel = 128;
  const st = w.store;
  const hs = TILE_BY_KEY['ore_hellstone']!;
  expect(TILE_DEFS[hs]?.vanilla?.sheet).toBe(58);
  paintWater(st, 30, 60, 113, 143);
  paintRect(st, 61, 70, 113, 196, hs);
  return w;
}

type ConchFn = (rightOcean: boolean, inwardRetry?: boolean) => { x: number; y: number } | null;
/** bj281 同款 Game.prototype 桩 + 可配置骑乘态（件3 载体） */
function stubGame(world: World, riding: { buff: number } | null) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
    player: Record<string, unknown>;
    world: World;
    requestMagicConchTeleportPosition: ConchFn;
  };
  g.world = world;
  g.player = {
    x: 0, y: 0, vx: 1, vy: 1, w: 20, h: 42, cx: 10, cy: 21,
    iframes: 0, fallStartY: 1234, team: 0,
    inv: { removeHeld: () => {} },
    removeAllGrapplingHooks: () => {},
    updateUnbreakableWallScan: () => {},
    equipStats: { fireWalk: false },
    buffs: null,
    ridingMount: riding !== null,                        // 件3：buff305 熔岩鲨骑乘腿
    mount: riding,                                       //  :9994-9998 fireWalk=true 源
  };
  g.sfx = { play: () => {} };
  g.spawnParticles = () => {};
  g.camera = new Camera(800, 600);
  g.golfState = { tryGetCameraTrackingPosition: () => null };
  g.cb = {};
  g.net = null;
  g.spectatingSlot = -1;
  g.lastStripReq = '';
  return g as unknown as {
    player: { x: number; y: number; vy: number };
    world: World;
    requestMagicConchTeleportPosition: ConchFn;
  };
}

describe('件3 [g22-fw-conch-mirror]：海螺落点 fireWalk 并集补 buff305 熔岩鲨腿', () => {
  beforeEach(() => { Game.CONCH_RIGHT_OCEAN_COMPENSATION = true; });

  it('①骑熔岩鲨（mount.buff=305）→ 狱石岸不作危 → 落岸（修前=恒 null）', () => {
    const w = hellstoneShoreWorld();
    const g = stubGame(w, { buff: 305 });
    const dest = g.requestMagicConchTeleportPosition(false);
    expect(dest, 'buff305 腿在=狱石不判危=承位').not.toBeNull();
    expect(dest!.x).toBe(61 * TILE + 8 - 10);
    expect(dest!.y).toBe(112 * TILE + 16 - 42);
    // 承位面确为狱石（TouchDamageHot 58）
    const st = w.store;
    expect(TILE_DEFS[st.type[st.idx(61, 113)]]?.vanilla?.sheet).toBe(58);
  });

  it('②未骑 → 狱石判危 → 爬行穿岸游出带外失败（判别对照,fireWalk=false）', () => {
    const w = hellstoneShoreWorld();
    const g = stubGame(w, null);
    expect(g.requestMagicConchTeleportPosition(false), '无 fireWalk=狱石 TouchDamageHot 判危').toBeNull();
  });

  it('③并集既有腿不回归：黑曜石皮（obsidianSkin）同落狱石岸（:9576 并档）', () => {
    const w = hellstoneShoreWorld();
    const g = stubGame(w, null);
    (g.player as unknown as Record<string, unknown>).buffs = { obsidianSkin: true };
    const dest = g.requestMagicConchTeleportPosition(false);
    expect(dest, '黑曜石皮腿照常').not.toBeNull();
    expect(dest!.x).toBe(61 * TILE + 8 - 10);
  });

  it('④非 305 坐骑 buff 不误开（并集腿窄域判别）', () => {
    const w = hellstoneShoreWorld();
    const g = stubGame(w, { buff: 130 });   // 骑兔子(非 305)
    expect(g.requestMagicConchTeleportPosition(false), 'buff≠305 无 fireWalk').toBeNull();
  });
});

describe('结构锁（防静默回退/防再登记误判）', () => {
  it('件3：Game.ts fireWalk 并集三腿在位（equipStats/obsidianSkin/mount305）', () => {
    expect(GAME_TS).toContain('|| (p.ridingMount && p.mount.buff === 305);   // buff305（mount 49）');
    expect(GAME_TS).toContain('[g22-fw-conch-mirror] 清偿');
  });
  it('件1：a-batch1 夹具 MV3 单键沿注入在位（回退 inputX 单注=复红 5）', () => {
    expect(A_BATCH1_TS).toContain('p.inputX = 1; p.inputLeft = false; p.inputRight = true;');
    expect(A_BATCH1_TS).toContain('BJ704-G24 夹具对齐 MV3 输入模型');
  });
  it('件5：lavaVision 清偿（★BJ705-G26 件3 随迁:登记→清偿,任务书销账）', () => {
    // ★BJ705-G26（2026-10-22）:[g20-buff305-lavavision] 已清偿——Player.lavaOpacity
    //   字段+湿段斜坡落地,渲染三消费面穿参（本文件 :26 头注/:2945 注/:alpha 块）。
    //   判别锁=tests/bj705g26-lavavision.test.ts;此锁迁移为清偿形态防回潮。
    expect(LIQ_TS).toContain('[g20-buff305-lavavision] 清偿');
    expect(LIQ_TS).toContain(':12140-12153');           // 斜坡锚（Player 侧落地注）
    expect(LIQ_TS).toContain('TileDrawing.cs:4116/:4125');
    expect(LIQ_TS).toContain('LiquidRenderer.cs:659');
    // Player.cs:1517 字段锚随清偿迁至 Player.ts（本测 LIQ_TS 无该行——判别锁
    // tests/bj705g26-lavavision.test.ts §D1 承载）
  });
  it('件6：fetchAsset 无退避消费方维持登记·三证判语在位', () => {
    expect(SW_JS).toContain('fetchAsset-no-backoff-consumers');
    expect(SW_JS).toContain('维持登记三证');
    expect(SW_JS).toContain('warm 路径已有单文件 ×3 重试');
  });
});
