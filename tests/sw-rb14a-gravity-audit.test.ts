// SW-RB14a 红蓝对抗审计批（FX31/34/40 反重力三波交叉复核）——findings 回归锁。
//  每组钉面：反编译锚 + 修复位 + 旧实现退化值（变异=回退对应刀 → 本组必红）。
//  F1 merman 撞顶 jump 清零（DryCollision :23731/:23767 无门站 + :28463 gated 站）
//  F2 微光化接触伤豁免（GetHurtTile 唯一消费位 :27818-27824 !shimmering 门）
//  F3 粪块地板恶臭 buff（FloorVisuals :23921-23923 AddBuff(120,180),坡面门前）
//  F5 湿档 gravity 字段每拍无条件写（:24559/:24590-24628/:24884 复位链头执行）
//  （F4=985 光束 terra.ai0 ×gravDir :49444——出生位在 Game 挥击管线内,无轻量夹具,
//    以锚+代码评审钉面,不设Behavior测试）
import { describe, it, expect } from 'vitest';
import { Player } from '../src/entities/Player';
import { World } from '../src/world/World';
import { TILE, PLAYER_JUMP_TICKS } from '../src/core/constants';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { Inventory } from '../src/items/Inventory';
import { BuffType } from '../src/stats/Buffs';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_BY_KEY } from '../src/data/items';
import { GRAVITY } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const STONE_ID = TILE_BY_KEY['stone'] ?? 1;
const SPIKE_ID = TILE_BY_KEY['v_48_spike'] ?? -1;
const POO_SHEET = 666;

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

const tileBySheet = (sheet: number): number => {
  for (let i = 1; i < TILE_DEFS.length; i++) {
    if (TILE_DEFS[i]?.vanilla?.sheet === sheet) return i;
  }
  return -1;
};

function makeGame(w: World): { game: GameHooks; dmg: number[] } {
  const dmg: number[] = [];
  const game = {
    world: w, player: null as unknown, enemies: () => [], critters: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (d: number): number => { dmg.push(d); return d; }, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    achievements: { notifyProgressionEvent: () => {}, handleSpecialEvent: () => {} },
  } as unknown as GameHooks;
  return { game, dmg };
}

// ---- F1 定谳（撤销误修）：merman 门 = 原版净语义 1:1 ----
//  原版 DryCollision 两处无门站（:23731/:23767）是【干路径专属】——WetCollision
//  （:23157-23172）无 `Collision.up→jump=0` 站;而 merman ⊆ wet（:22965 只在水中
//  置位;本仓 :3895 `equipStats.merman && inWater && !inLava` 同域推导）⇒ 干态
//  merman 恒 false（门不可达=无门站净语义自动成立）、湿态人鱼原版本就不清。
//  误修假设（干态人鱼 bonk 循环）物理不可达 —— 撤销,以三态测试锁净语义。
describe('SW-RB14a F1 定谳：merman 门四面净语义（:23731/:23767 干专属 + :28463 gated）', () => {
  /** 竖井：顶 62/63 行石（底面 y=1024）、地板 68 行（顶 y=1088）。
   *  水注入 64-67 行（竖井内部,玩家浸没）。 */
  function bonkPlayer(opts: { mermanShell?: boolean; water?: boolean; gd?: 1 | -1; vy0?: number }): { p: Player; game: GameHooks } {
    const w = new World(480, 120, 30, 'open');
    for (let x = 0; x < w.w; x++) {
      w.store.setTileSilent(x, 62, STONE_ID, 0, 0);
      w.store.setTileSilent(x, 63, STONE_ID, 0, 0);
      w.store.setTileSilent(x, 68, STONE_ID, 0, 0);
    }
    const gd = opts.gd ?? 1;
    // gd=1：头距顶 4px（湿链当拍可走满 −5.01 → 触顶）;gd=-1：盒底（头）距地板 4px
    // 湿态位移 ×liqFactor 0.5（WetCollision）→ 行程减半,起点再贴近 1px 保撞顶
    // ★BJ730 改判史：湿支起点旧 1027（头距顶 3px）——夹具 vy0=−5.21 系 BJ717-A 前
    //  旧湿跳轨迹口径（旧序无 sustain 钉,当拍末速恰触顶）。BJ717-A F1（2026-10-25,
    //  R13 P0 清偿）钉序翻正后当拍净 vy=钉(−6.01)+湿重力(0.2)=−5.81,×湿位移 0.5
    //  =−2.905px < 3px 恰差 0.095px 不触顶（探针实证 1024.095,vy0 被钉覆写=调 vy0
    //  无效）。起点重校 1026（距顶 2px<2.905px 必触顶）——语义目标不变（:28463
    //  !merman 撞顶清 jumpHold+vy=+0.01,探针实证 y=1024/vy=0.01/jh=0 三件套全通;
    //  R1-2 merman 组随之从「不触顶的空转绿」变为真触顶不清华=更强判别）。
    const py = gd === 1 ? (opts.water ? 1026 : 1028) : 1042;
    const p = new Player(60 * TILE, py, new Inventory());
    if (opts.mermanShell) p.inv.armor[4] = { id: iid(861), stack: 1 };   // 月亮贝壳 → fx.merman
    if (opts.water) {
      for (let x = 0; x < w.w; x++) for (let y = 64; y <= 67; y++) w.store.setLiquid(x, y, 255, 1);
    }
    p.gravDir = gd;
    p.inputJump = true;
    // 湿链当拍只加液体重力不钉跳速（仓湿跳结构,债外域）;水档 lMaxFall=5.01 钳带内
    // 选 vy0 使当拍末速恰触顶（普通水 0.2/人鱼 0.3 重力,干臂钉 -5.01）
    p.vy = opts.vy0 ?? (gd === 1 ? -8 : 8);
    p.jumpHold = PLAYER_JUMP_TICKS;
    return { p, game: makeGame(w).game };
  }

  it('R1-1 干态非人鱼：撞顶拍 jumpHold 清零（DryCollision 无门站,merman 恒 false=门不可达）', () => {
    const { p, game } = bonkPlayer({});
    p.fixedUpdate(1 / 60, game);
    expect(p.merman).toBe(false);
    expect(p.jumpHold).toBe(0);          // 变异=merman 门误扩到恒真 → 本组仍绿（干态门等价无门）
    expect(p.vy).toBe(0.01);             // :28463 vy=+0.01
  });

  it('R1-2 湿态人鱼：水下撞顶 jumpHold 不清（WetCollision 无无门站,:28463 merman 门原文）', () => {
    const { p, game } = bonkPlayer({ mermanShell: true, water: true });
    p.fixedUpdate(1 / 60, game);
    expect(p.merman).toBe(true);         // 贝壳+水 → 变身态成立（:3895 推导）
    expect(p.jumpHold).toBeGreaterThan(0);   // 变异=去 merman 门 → 清零本组红
  });

  it('R1-3 湿态非人鱼：水下撞顶 jumpHold 清零（:28463 !merman 站,WetCollision 的 TileCollision 亦置 Collision.up）', () => {
    const { p, game } = bonkPlayer({ water: true, vy0: -5.21 });
    p.fixedUpdate(1 / 60, game);
    expect(p.merman).toBe(false);
    expect(p.jumpHold).toBe(0);          // 变异=整个 gd=1 臂 → 本组红
  });

  it('R1-4 湿态人鱼倒挂：head-bump（hitDown）不清（:28471 merman 门原文,回归锁）', () => {
    const { p, game } = bonkPlayer({ mermanShell: true, water: true, gd: -1 });
    p.fixedUpdate(1 / 60, game);
    expect(p.jumpHold).toBeGreaterThan(0);
  });
});

// ---- F2：微光化接触伤豁免 ----
describe('SW-RB14a F2：shimmering 免接触伤（:27818-27824 !shimmering 门）', () => {
  function spikePlayer(shimmering: boolean): { p: Player; game: GameHooks; dmg: number[] } {
    const w = new World(480, 120, 30, 'open');
    for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, 70, SPIKE_ID, 0, 0);
    const p = new Player(60 * TILE, 70 * TILE - 42, new Inventory());
    if (shimmering) p.buffs.apply(BuffType.Shimmered, 3);   // buff 353：帧首 buff 段置 shimmering
    return { p, ...makeGame(w) };
  }

  it('R2-1 对照组：普通态踩地刺吃接触伤（hurtTiles 主扫,变异=误加门 → 本组红）', () => {
    const { p, game, dmg } = spikePlayer(false);
    p.fixedUpdate(1 / 60, game);
    expect(dmg.length).toBeGreaterThan(0);        // 地刺 48 → TOUCH_IMMEDIATE 60
  });

  it('R2-2 微光化：同摆位零接触伤（变异=摘 !shimmering 门 → 本组红）', () => {
    const { p, game, dmg } = spikePlayer(true);
    p.fixedUpdate(1 / 60, game);
    expect(dmg.length).toBe(0);                   // 旧退化值：照吃地刺伤害
  });

  it('R2-3 微光化 + 兜底清单联动： touchedTiles 路线同样豁免（FX40-g 联动面）', () => {
    const { p, game, dmg } = spikePlayer(true);
    p.touchedTiles.push({ x: 60, y: 70 });        // 兜底清单注入地刺格
    p.fixedUpdate(1 / 60, game);
    expect(dmg.length).toBe(0);
  });
});

// ---- F3：粪块地板恶臭 buff ----
describe('SW-RB14a F3：粪块地板 Stinky（FloorVisuals :23921-23923 AddBuff(120,180)）', () => {
  function floorPlayer(sheet: number | null): { p: Player; game: GameHooks } {
    const w = new World(480, 120, 30, 'open');
    const id = sheet === null ? STONE_ID : tileBySheet(sheet);
    for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, 70, id, 0, 0);
    const p = new Player(60 * TILE, 70 * TILE - 42, new Inventory());
    return { p, game: makeGame(w).game };
  }

  it('R3-1 粪块地板 → Stinky 3s（变异=删 AddBuff 行 → 本组红）', () => {
    const { p, game } = floorPlayer(POO_SHEET);
    p.fixedUpdate(1 / 60, game);
    expect(p.buffs.has(BuffType.Stinky)).toBe(true);   // 旧退化值：false（踩粪不臭）
  });

  it('R3-2 对照组：石地板不挂恶臭', () => {
    const { p, game } = floorPlayer(null);
    p.fixedUpdate(1 / 60, game);
    expect(p.buffs.has(BuffType.Stinky)).toBe(false);
  });
});

// ---- F5：湿档 gravity 字段每拍无条件写 ----
describe('SW-RB14a F5：湿态扇翅 gField 新鲜度（:24559/:24590-24628 复位链头执行）', () => {
  function wetFlyer(): { p: Player; game: GameHooks } {
    const w = new World(480, 120, 30, 'open');
    for (let x = 0; x < w.w; x++) {
      for (let y = 64; y <= 70; y++) w.store.setLiquid(x, y, 255, 1);
    }
    const p = new Player(60 * TILE, 66 * TILE, new Inventory());
    p.inv.armor[3] = { id: iid(492), stack: 1 };   // 天使翼 → eq.wing
    p.wingTime = 100;
    p.inputJump = true;
    p.jumpEdgePrev = true;                          // 静化跳沿（不入起跳腿,保 flying）
    p.vy = 1;
    return { p, game: makeGame(w).game };
  }

  it('R5-1 湿态扇翅拍 gField=液体档 0.2（变异=写位退回 !flying 支内 → undefined 本组红）', () => {
    const { p, game } = wetFlyer();
    p.fixedUpdate(1 / 60, game);
    expect(p.gField).toBeCloseTo(GRAVITY * 0.5, 9);   // 旧退化值：undefined（陈值/缺省回退）
  });
});
