// ★BJ751-A（issue#38 §三 移动/攻击 AI 域 7 项）行为锁：
//   ⑰ 南瓜跳跳 304 跳跃计时器 int 整除（1457 NPC.cs:62200-62204，num53 :62202）
//   ⑱ Fighter 悬崖大跳 directionY<0（:60729）+ SolidTileAllowBottomSlope 脚下判据
//   ⑲ 台阶攀升接受半砖 + num197 ±8（:60461-60535 整谓词）
//   ⑳ 蜘蛛族（163/164/236/239/530）台阶高度 +8（:60522-60525）
//   ㉑ 血腥僵尸 489 专家 3f 档 + scaleBoost 复乘（:58934-58951）
//   ㉒ 城镇 NPC 攻击冷却 numX/2 int 整除（:55084/:55356/:55554/:55682 四态退出）
//   ㉓ 恶魔眼白天离场用顶边（IsDiscouraged :53301-53303，调用点 :52856 传 position）
// 驱动方式沿用 ground-ai-parity-fixes.test.ts 夹具（原型直调 + 少量全链）。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { TownNPC } from '../src/entities/TownNPC';
import { fighterMoveStep } from '../src/entities/fighterFamilies';
import { TILE } from '../src/core/constants';
import { TILE_BY_KEY } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';

const W = 140, H = 90, FLOOR = 60;

function makeWorld(): World {
  const w = new World(W, H, 11, 'bj751a-ai-domain');
  const st = w.store;
  w.groundLevel = 24;
  for (let x = 0; x < W; x++) {
    st.setTile(x, FLOOR, 1);
    st.setTile(x, FLOOR + 1, 1);
  }
  w.clock.timeOfDay = 0.9;   // 夜间（白天驱散门不干扰）
  return w;
}

function makeHooks(w: World, playerAt: { x: number; y: number } | null) {
  const enemies: Enemy[] = [];
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: 'enemies' | 'projectiles') => {
      const ent = e as { id: number };
      ent.id = em.nextId++;
      if (bucket === 'enemies') enemies.push(e as Enemy);
    },
  };
  const px = (playerAt?.x ?? 70) * TILE, py = (playerAt?.y ?? FLOOR - 3) * TILE;
  const player = new Player(px, py, new Inventory());
  const hooks = {
    world: w, player: playerAt ? player : null,
    enemies: () => enemies,
    critters: () => [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    cutTile: () => {},
    scene: { zoneGraveyard: false },
    entities: em,
  } as unknown as GameHooks;
  return { hooks, enemies, player, em };
}

function spawn(h: ReturnType<typeof makeHooks>, id: number, tx: number, ty: number): Enemy {
  const e = Enemy.fromVanilla(id, tx * TILE, ty * TILE)!;
  e.id = h.em.nextId++;
  h.enemies.push(e);
  return e;
}

const drive = (e: Enemy, fn: string) =>
  (e as unknown as Record<string, (g: GameHooks, p: unknown) => void>)[fn];

function settle(h: ReturnType<typeof makeHooks>, e: Enemy, n = 200): void {
  for (let i = 0; i < n; i++) {
    e.fixedUpdate(1 / 60, h.hooks);
    if (i >= 5 && e.vy === 0 && e.onGround) break;
  }
}

// ===========================================================================
// ⑰ 南瓜跳跳 304：ai[0] += (1 - life/lifeMax) * 10 的 int/int 整除
// ===========================================================================
describe('⑰ 南瓜跳跳 304 跳跃计时器整除（NPC.cs:62200-62204）', () => {
  it('满血：life==lifeMax → 整除 1 → +0（净 +2：flag3 恒激愤 +1、基础 +1）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 120, y: FLOOR - 3 });
    const e = spawn(h, 304, 40, FLOOR - 2);
    settle(h, e);
    e.ai0 = -1400;                     // 阶段空档（无起跳重置，纯计数读数）
    drive(e, 'slimeAI').call(e, h.hooks, h.player);
    expect(e.ai0).toBe(-1398);         // +1(flag3)+1(基础)+0(满血)
  });

  it('受损 1 点：life<lifeMax → 整除 0 → +10（净 +12）——无浮点渐变', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 120, y: FLOOR - 3 });
    const e = spawn(h, 304, 40, FLOOR - 2);
    settle(h, e);
    e.hp = e.maxHp - 1;                // 任何受损 → int life < lifeMax
    e.ai0 = -1400;
    drive(e, 'slimeAI').call(e, h.hooks, h.player);
    expect(e.ai0).toBe(-1388);         // +1+1+10
  });

  it('分数血量（maxHp−0.5）同判 +10：C# int life 语义（浮点残血=已受伤）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 120, y: FLOOR - 3 });
    const e = spawn(h, 304, 40, FLOOR - 2);
    settle(h, e);
    e.hp = e.maxHp - 0.5;              // 旧浮点式此处得 (1−0.99…)×10≈0（90% 档 +1）
    e.ai0 = -1400;
    drive(e, 'slimeAI').call(e, h.hooks, h.player);
    expect(e.ai0).toBe(-1388);
  });
});

// ===========================================================================
// ⑱ Fighter 悬崖大跳（NPC.cs:60729）
// ===========================================================================
describe('⑱ Fighter 悬崖大跳（NPC.cs:60729 directionY<0 + AllowBottomSlope）', () => {
  /** 僵尸 3 站地板（41 列）向右走，42/43 列地板挖空（悬崖）。玩家同层（脚底等高
   *  → aiStyle3 专档 directionY=-1；旧码要求玩家脚高于僵尸【顶】才跳） */
  function cliffWorld(playerAt: { x: number; y: number }) {
    const w = makeWorld();
    const st = w.store;
    st.setTile(42, FLOOR, 0); st.setTile(42, FLOOR + 1, 0);
    st.setTile(43, FLOOR, 0); st.setTile(43, FLOOR + 1, 0);
    const h = makeHooks(w, playerAt);
    const e = spawn(h, 3, 41, FLOOR - 2);
    settle(h, e);
    e.x = 41 * TILE;                   // settle 期间行走漂移复位
    e.y = FLOOR * TILE - e.h;          // 脚底恰在地板顶
    e.vx = 1; e.vy = 0; e.facing = 1;
    return { w, h, e };
  }

  it('玩家与僵尸同层（脚底等高）：dirY=-1 → 大跳 vy=−8、vx×1.5', () => {
    const { h, e } = cliffWorld({ x: 55, y: FLOOR - 3 });
    drive(e, 'fighterAI').call(e, h.hooks, h.player);
    expect(e.vy).toBe(-8);             // :60731
    expect(e.vx).toBeCloseTo(1.5, 6);  // :60732（vx=1 恰在限速 1 上，无加速）
  });

  it('负控（脚下判据）：悬崖处置【平台】→ AllowBottomSlope=地 → 不跳', () => {
    const { w, h, e } = cliffWorld({ x: 55, y: FLOOR - 3 });
    w.store.setTile(42, FLOOR, TILE_BY_KEY['platform']);
    drive(e, 'fighterAI').call(e, h.hooks, h.player);
    expect(e.vy).toBe(0);              // 平台算地（旧 isSolid 判非地 → 会误跳）
  });

  it('负控（脚下判据）：悬崖处置【半砖】→ AllowBottomSlope≠地 → 照跳', () => {
    const { w, h, e } = cliffWorld({ x: 55, y: FLOOR - 3 });
    w.store.setTile(42, FLOOR, 1);
    w.store.setHalfBrick(42, FLOOR, true);
    drive(e, 'fighterAI').call(e, h.hooks, h.player);
    expect(e.vy).toBe(-8);             // 半砖不算地（旧 isSolid 判地 → 不跳，两相颠倒）
  });

  it('玩家死亡（dirY 保留旧值）：曾锁定上方 → 照跳（不挂 player 门）', () => {
    const { h, e } = cliffWorld({ x: 55, y: FLOOR - 3 });
    (h.hooks as unknown as { player: Player }).player = { ...h.player, dead: true } as unknown as Player;
    e.dirY = -1;                       // 上一拍锁定的方向（TargetClosest 死亡不改向）
    drive(e, 'fighterAI').call(e, h.hooks, h.hooks.player);
    expect(e.vy).toBe(-8);
  });
});

// ===========================================================================
// ⑲⑳ 台阶自动步升（NPC.cs:60461-60535）
// ===========================================================================
describe('⑲ 台阶攀升半砖 + ±8（NPC.cs:60461-60535）', () => {
  /** 僵尸 3 站地板向右走；前探列 42（px+vx 后 (w/2+1) 前移） */
  function stepWorld(vid: number) {
    const w = makeWorld();
    const h = makeHooks(w, { x: 55, y: FLOOR - 3 });
    const e = spawn(h, vid, 41, FLOOR - 2);
    settle(h, e);
    e.x = 41 * TILE;
    e.y = FLOOR * TILE - e.h;
    e.vx = 1; e.vy = 0; e.facing = 1;
    return { w, h, e };
  }

  it('半砖台阶（42, FLOOR−1）：A 面 + num197+8 → 攀升恰 8px', () => {
    const { w, h, e } = stepWorld(3);
    w.store.setTile(42, FLOOR - 1, 1);
    w.store.setHalfBrick(42, FLOOR - 1, true);
    const y0 = e.y;
    drive(e, 'fighterAI').call(e, h.hooks, h.player);
    expect(e.y).toBe(y0 - 8);          // 旧码 !half 拒绝半砖 → y 不变卡死
  });

  it('整砖台阶（42, FLOOR−1）：A 面 → 攀升恰 16px（回归护栏）', () => {
    const { w, h, e } = stepWorld(3);
    w.store.setTile(42, FLOOR - 1, 1);
    const y0 = e.y;
    drive(e, 'fighterAI').call(e, h.hooks, h.player);
    expect(e.y).toBe(y0 - 16);
  });
});

describe('⑳ 蜘蛛族台阶 +8（NPC.cs:60522-60525 num199=24.1）', () => {
  /** 半砖悬于 (axCol, FLOOR−2)（B 面：tile[ax, fr−1].halfBrick，num197−8）：
   *  站整地板（脚 960）→ 落点 936 → 高差 24 —— 蜘蛛 24.1 窗内、僵尸 16.1 窗外。
   *  探针列随体宽（僵尸 3 w=18 → ax=42；蜘蛛 163/236 w=50 → ax=44） */
  function spiderWorld(vid: number, axCol: number) {
    const w = makeWorld();
    const h = makeHooks(w, { x: 55, y: FLOOR - 3 });
    const e = spawn(h, vid, 41, FLOOR - 2);
    settle(h, e);
    e.x = 41 * TILE;
    e.y = FLOOR * TILE - e.h;
    e.vx = 1; e.vy = 0; e.facing = 1;
    w.store.setTile(axCol, FLOOR - 2, 1);
    w.store.setHalfBrick(axCol, FLOOR - 2, true);
    return { w, h, e };
  }

  it('血蛛 163：B 面 24px 高差 ≤ 24.1 → 攀升', () => {
    const { h, e } = spiderWorld(163, 44);
    const y0 = e.y;
    drive(e, 'fighterAI').call(e, h.hooks, h.player);
    expect(e.y).toBe(y0 - 24);         // 恒 16.1 档不攀升
  });

  it('僵尸 3 对照：同几何（B 面 24px > 16.1）→ 不攀升', () => {
    const { h, e } = spiderWorld(3, 42);
    const y0 = e.y;
    drive(e, 'fighterAI').call(e, h.hooks, h.player);
    expect(e.y).toBe(y0);
  });

  it('墙蛛 236 同 163 档（蜘蛛表 163/164/236/239/530）', () => {
    const { h, e } = spiderWorld(236, 44);
    const y0 = e.y;
    drive(e, 'fighterAI').call(e, h.hooks, h.player);
    expect(e.y).toBe(y0 - 24);
  });
});

// ===========================================================================
// ㉑ 血腥僵尸 489 专家速度（NPC.cs:58934-58951）
// ===========================================================================
describe('㉑ 血腥僵尸 489 限速（NPC.cs:58934-58951）', () => {
  /** 远距玩家（>600px → num109 钳 1.5）；vx 置 max−0.05 → 加速后恰钳 max */
  function bloodZombie(difficulty: number, scale: number) {
    const w = makeWorld();
    w.difficulty = difficulty;
    const h = makeHooks(w, { x: 120, y: FLOOR - 3 });
    const e = spawn(h, 489, 40, FLOOR - 2);
    e.vanillaScale = scale;
    e.vy = 0;
    return { h, e };
  }

  it('经典档：max = (2.5−1.5)×0.8 = 0.8', () => {
    const { h, e } = bloodZombie(0, 1);
    e.vx = 0.75;
    fighterMoveStep(e, h.hooks, 1, h.player);
    expect(e.vx).toBeCloseTo(0.8, 6);
  });

  it('专家档：max = (3−1.5)×0.8 = 1.2（旧码恒 2.5 档 → 0.8）', () => {
    const { h, e } = bloodZombie(1, 1);
    e.vx = 1.15;
    fighterMoveStep(e, h.hooks, 1, h.player);
    expect(e.vx).toBeCloseTo(1.2, 6);
  });

  it('专家 + scale 0.5：scaleBoost 复乘 → max = 1.2×1.5 = 1.8（旧覆写丢 boost）', () => {
    const { h, e } = bloodZombie(1, 0.5);
    e.vx = 1.75;
    fighterMoveStep(e, h.hooks, 1, h.player);
    expect(e.vx).toBeCloseTo(1.8, 6);
  });

  it('经典 + scale 0.5：max = 0.8×1.5 = 1.2', () => {
    const { h, e } = bloodZombie(0, 0.5);
    e.vx = 1.15;
    fighterMoveStep(e, h.hooks, 1, h.player);
    expect(e.vx).toBeCloseTo(1.2, 6);
  });
});

// ===========================================================================
// ㉒ 城镇 NPC 攻击冷却 int 整除（NPC.cs:55084/:55356/:55554/:55682）
// ===========================================================================
describe('㉒ 城镇 NPC 攻击冷却 numX/2 整除（exitAttackCommon 四态共用）', () => {
  type Exposed = { atkCd: number; turnLock: number; walkT: number };
  function exited(cdBase: number, cdRand: number) {
    const npc = new TownNPC('guide', 100 * 16, 99 * 16, new Inventory());
    npc.rng = () => 0;                 // Next(maxValue) 恒 0 → 纯整除读数
    (npc as unknown as Record<string, (a: number, b: number) => void>)
      .exitAttackCommon(cdBase, cdRand);
    return npc as unknown as Exposed;
  }

  it('奇数 cdBase=15（护士 18 档）：15/2 int 整除 = 7（非 7.5）', () => {
    const npc = exited(15, 10);
    expect(npc.atkCd).toBe(7);         // localAI[1]（:55084）
    expect(npc.turnLock).toBe(7);      // localAI[3] 同值同掷
    expect(npc.walkT).toBe(15);        // ai[1] = num46+Next（无整除）
  });

  it('偶数 cdBase=30：30/2 = 15 不变（回归护栏）', () => {
    const npc = exited(30, 60);
    expect(npc.atkCd).toBe(15);
    expect(npc.turnLock).toBe(15);
    expect(npc.walkT).toBe(30);
  });
});

// ===========================================================================
// ㉓ 恶魔眼白天离场顶边判定（NPC.cs:53301-53303）
// ===========================================================================
describe('㉓ 恶魔眼白天离场顶边（IsDiscouraged :53303）', () => {
  /** 白天 + 地表线 groundLevel=FLOOR−10；眼悬空于线附近，玩家在下方地板 */
  function eyeWorld(eyeTopY: number) {
    const w = makeWorld();
    w.clock.timeOfDay = 0.3;           // 白天
    w.groundLevel = FLOOR - 10;        // 地表线（tile 坐标）
    const h = makeHooks(w, { x: 55, y: FLOOR - 3 });
    const e = spawn(h, 2, 40, FLOOR - 12);
    e.y = eyeTopY;
    e.vx = 1; e.vy = 0;
    return { w, h, e };
  }
  const LINE = (FLOOR - 10) * TILE;

  it('顶边过线（y ≤ 线）而中心未过（cy > 线）：驱散 → dirY=−1', () => {
    const { h, e } = eyeWorld(LINE - 2);   // 顶边在线上方 2px；中心 = 顶边+h/2 > 线
    expect(e.cy).toBeGreaterThan(LINE);    // 前置：中心确实未过线（旧码不驱散）
    drive(e, 'floatEyeAI').call(e, h.hooks, h.player);
    expect(e.dirY).toBe(-1);               // 驱散分支（旧码 cy 判定 → 走 targeting +1）
  });

  it('顶边未过线（y > 线）：不驱散 → dirY=+1（玩家在下方）', () => {
    const { h, e } = eyeWorld(LINE + 20);  // 顶边/中心均在线下
    drive(e, 'floatEyeAI').call(e, h.hooks, h.player);
    expect(e.dirY).toBe(1);                // TargetClosest：玩家在下 → +1
  });
});
