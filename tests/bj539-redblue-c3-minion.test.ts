/**
 * BJ539（红蓝 R3 minion 批 findings 清偿刀 C3,2026-10-06）五件：
 *
 *  F1 海盗 393-395 贴地帧机整支死：:51805 读相=AI 相=贴地 0——BJ516④ 重力落
 *     walkChase 尾后拍尾带 +0.4 残留 → `this.vy===0` 直读恒假 → pirFrame=14 空中帧
 *     恒挂;改读 lastWalkPreGravVy 快照（BJ519① 先例,walkChase 补 capturePreGravVy）。
 *  F2 flinx 951 同病：:51767 rot 归零支死（AngleTowards 不跑）+ 空中帧 1 恒挂;
 *     同法（空中 rot 的 Math.min(4,vy) 同相取快照）。
 *  F3 跳尾 :52113 贴地门死（walkChase 四族 833/393/951/1036）：AI 相读=上拍
 *     post-AI 碰撞解算值=贴地 0 → 追高敌平地应跳;拍首直读带 0.4 残留 → 门死不跳。
 *     快照法推广至共享尾（独立形族 pal/mush/frog 步内「先重力后碰撞」无残留、
 *     从不调 walkChase → 快照恒 null,?? 直读回落=原相不动）。
 *  F4 ai177FindTarget 首敌豁免：:45929 `!(num<=num2)` 严格小于,num 初值=maxRange=400
 *     即域门——摘 `best===null||` 豁免（域外首敌不得入桶,恰 400 拒,399 纳）。
 *  F5 文档残留：ai177 头注 1036 残留/!gated 死支/快照字段注同步（源钉）。
 *
 * 真值锚：1457 Projectile.cs——:16880 Update 内 AI() 先行、:17585 tileCollide 积分
 * 碰撞后行（AI 相贴地 velocity.Y 恒 0）、:51766-51835 帧段、:52049-52056 重力、
 * :52109-52167 TryJumpingToTarget、:45918-45931 FindTargetWithinRange。
 * 实现落点：src/entities/MinionProj.ts（E1 跳尾 vyRead/E2 海盗帧机/E3 flinx 帧机/
 * E4 虎 capture/E5 F4 豁免/E6-E7 头注+死支/字段注）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { MinionProj, LocalImmunityTable } from '../src/entities/MinionProj';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MINION_TS = readFileSync(join(ROOT, 'src/entities/MinionProj.ts'), 'utf8');
const priv = (o: object): Record<string, any> => o as unknown as Record<string, any>;

const GROUND_TOP = 100 * 16;   // World(200,120) 地表行 100 顶

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number;
  hurt: (d: number) => boolean;
}
const mkEnemy = (id: number, cx: number, cy: number): MockEnemy => {
  const w = 16, h = 24;
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false,
    get cx() { return this.x + this.w / 2; },
    set cx(v: number) { this.x = v - this.w / 2; },
    get cy() { return this.y + this.h / 2; },
    set cy(v: number) { this.y = v - this.h / 2; },
    hp: 100000,
    hurt: () => true,
  };
  return e;
};

function makeHooks(enemies: MockEnemy[] = []) {
  const w = new World(200, 120, 7, 'bj539');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 79 * 16, new Inventory());
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    spawnDust: () => null,
  };
  (hooks as unknown as { entities: { projectiles: unknown[]; add: () => void } }).entities =
    { projectiles: [], add: () => {} };
  return { hooks, store: w.store, player, enemyList: enemies };
}

const minion = (player: Player, projId: number, cx: number, cy: number): MinionProj => {
  const m = new MinionProj(cx, cy, projId, 10, 2, false, 0, false, () => player);
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;
  return m;
};

/** 玩家平移落地表（h=42 盒）;返回玩家新 cx */
const playerAt = (h: ReturnType<typeof makeHooks>, cx: number): number => {
  priv(h.player).x = cx - 10;
  priv(h.player).y = GROUND_TOP - 42;
  return cx;
};

/** groundAnchorScan 机械复刻（:51213-51260 折算体,20 格下探+5% 步进视线截断）——
 *  静立判别面用：出生位=截断锚 → |Δx|=0 死区恒静立（截断使锚靠玩家侧,硬编码会漂） */
const scanAnchor = (h: ReturnType<typeof makeHooks>, ax0: number, ay0: number) => {
  const st = h.store; const p = h.player;
  let ay = ay0;
  for (let k = 0; k < 20; k++) {
    if (st.isSolid(Math.floor(ax0 / 16), Math.floor(ay / 16))) break;
    ay += 16;
  }
  const dx = ax0 - p.cx, dy = ay - p.cy;
  let fx = p.cx, fy = p.cy;
  for (let t = 0.05; t <= 1.001; t += 0.05) {
    if (st.isSolid(Math.floor((p.cx + dx * t) / 16), Math.floor((p.cy + dy * t) / 16))) break;
    fx = p.cx + dx * t; fy = p.cy + dy * t;
  }
  return { x: fx, y: fy };
};

// ============================================================
// ① F1 海盗 393 贴地帧机（:51802-51835 flag 支）
// ============================================================
describe('① F1 海盗 393-395 贴地帧机（:51805 AI 相读=贴地 0）', () => {
  it('静立贴地：锚位出生恒 pirFrame=0（病灶形=14 空中帧恒挂 → 红）', () => {
    const h = makeHooks([]);
    const pcx = playerAt(h, 66 * 16);
    // 跟随锚 = p.cx−(15+p.w/2)×facing（slot=0）,取截断后锚位出生 → |Δx|=0 死区静立
    const anchor = scanAnchor(h, pcx - 25, priv(h.player).cy);
    const m = minion(h.player, 393, anchor.x, GROUND_TOP - 15);
    for (let t = 0; t < 12; t++) m.fixedUpdate(1, h.hooks);
    expect(m.y + m.h, '贴地（盒底=地表顶）').toBe(GROUND_TOP);
    expect(priv(m).vx, '死区静立（判别前提）').toBe(0);
    expect(priv(m).pirFrame, '贴地帧 0（变异 E2 回直读 → 14 → 红）').toBe(0);
  });

  it('行走贴地：帧域 0-3 翻页（走行帧机活,病灶形恒 14 → 红）', () => {
    const h = makeHooks([]);
    const pcx = playerAt(h, 66 * 16);
    const m = minion(h.player, 393, pcx - 245, GROUND_TOP - 15);   // 距锚 220px → 步行
    const seen = new Set<number>();
    for (let t = 0; t < 20; t++) {
      m.fixedUpdate(1, h.hooks);
      seen.add(priv(m).pirFrame as number);
    }
    for (const f of seen) {
      expect(f, `帧 ${f} ∈ 走行域 0-3（14=空中帧漏入 → 红）`).toBeLessThan(4);
    }
    expect(seen.size, '走行翻页发生（非单帧冻结）').toBeGreaterThan(1);
  });
});

// ============================================================
// ② F2 flinx 951 贴地 rot 归零支 + 帧机（:51766-51790 flag5 地面段）
// ============================================================
describe('② F2 flinx 951 贴地 rot 归零支活（:51767 AngleTowards）', () => {
  it('静立贴地：锚位出生 flinFrame=0 且 rot→0（病灶形=空中帧 1+rot 恒 −0.04 → 红）', () => {
    const h = makeHooks([]);
    const pcx = playerAt(h, 66 * 16);
    // 锚 = p.cx−(45+p.w/2)×facing−30slot（slot=0）,取截断后锚位出生 → 死区静立
    const anchor = scanAnchor(h, pcx - 55, priv(h.player).cy);
    const m = minion(h.player, 951, anchor.x, GROUND_TOP - 13);
    priv(m).rot = 0.6;                                   // 预置倾斜 → AngleTowards 判别面
    for (let t = 0; t < 12; t++) m.fixedUpdate(1, h.hooks);
    expect(m.y + m.h).toBe(GROUND_TOP);
    expect(priv(m).vx, '死区静立（判别前提）').toBe(0);
    expect(priv(m).flinFrame, '贴地帧 0（病灶形=1 → 红）').toBe(0);
    expect(Math.abs(m.rot), 'rot 归零支跑通 0.6→0（病灶形=−0.04 覆写 → 红）').toBeLessThan(1e-9);
  });

  it('行走贴地：帧域 2-11（:51769-51784 走行支,病灶形恒 1 → 红）', () => {
    const h = makeHooks([]);
    const pcx = playerAt(h, 66 * 16);
    const m = minion(h.player, 951, pcx - 275, GROUND_TOP - 13);   // 距锚 220px → 步行
    const seen = new Set<number>();
    for (let t = 0; t < 20; t++) {
      m.fixedUpdate(1, h.hooks);
      seen.add(priv(m).flinFrame as number);
    }
    for (const f of seen) {
      expect(f, `帧 ${f} ∈ 2-11（1=空中帧漏入 → 红）`).toBeGreaterThanOrEqual(2);
      expect(f).toBeLessThanOrEqual(11);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

// ============================================================
// ③ F3 跳尾 :52113 贴地门——walkChase 四族追高敌平地跳
//    （先 5 拍无敌 settling 建快照（贴地=0）,再入敌拍判别：快照相=0 → 跃起;
//      病灶形拍首直读 0.4 → 门死 → vy 恒 0.4）
// ============================================================
describe('③ F3 跳尾 :52113 贴地门活（walkChase 四族追高敌平地跳）', () => {
  // 虎 833 玩家置 450px（★BJ704-G1 夹具重产:旧 900px 系「特攻池 |Δx|≤800 恒空」的
  // 拍隔离法,但 BJ703-D2 归位门（>500 ∨ |dy|>300 → ai0=1 飞行,:51171-51199）后
  // 900px 令虎起飞离地 → settling 恒红。450<500 保步行;特攻劫拍改由敌拍前显式
  // 钉 pounceCd=1000 摘门（bj703a §2 同式）;视野域 960 内保索敌）
  // 雾网 1036 需 whipBuffs[365]（:50027-50041 生命绑定,缺省即 Kill——bj516 先例 stub）
  const CASES: Array<{ label: string; id: number; playerDx: number; whipBuff?: boolean }> = [
    { label: '虎 833', id: 833, playerDx: 450 },
    { label: '海盗 393', id: 393, playerDx: 150 },
    { label: 'flinx 951', id: 951, playerDx: 150 },
    { label: '雾网蜘蛛 1036', id: 1036, playerDx: 150, whipBuff: true },
  ];
  for (const c of CASES) {
    it(`${c.label}：贴地+敌心高 50px → 拍尾跃起 vy<0（变异 E1/E4 回直读/漏 capture → 红）`, () => {
      const h = makeHooks([]);
      if (c.whipBuff) h.player.whipBuffs[365] = 60;
      const m0 = minion(h.player, c.id, 66 * 16, 0);   // 占位取真盒高
      const pcx = playerAt(h, 66 * 16 + c.playerDx);
      const m = minion(h.player, c.id, 66 * 16, GROUND_TOP - m0.h / 2);
      for (let t = 0; t < 5; t++) m.fixedUpdate(1, h.hooks);   // settling：贴地稳态建快照 0
      expect(m.y + m.h, 'settling 后贴地').toBe(GROUND_TOP);
      expect(priv(m).lastWalkPreGravVy, '快照=碰撞后重力前=贴地 0（capturePreGravVy 载体）').toBe(0);
      if (c.id === 833) priv(m).pounceCd = 1000;       // 摘特攻门（旧 900px 拍隔离法退役,见上注）
      h.enemyList.push(mkEnemy(1, m.cx, m.cy - 50));   // 敌心高 50px（<80 避虎 flag3 墙意图;Δx=0 避 flag21 梯）
      m.fixedUpdate(1, h.hooks);
      expect(m.vy, '拍尾跃起（−√(50×0.8) 经 walkChase 重力 ≈ −5.9;病灶形=+0.4 → 红）').toBeLessThan(-1);
    });
  }
});

// ============================================================
// ④ F3 独立形族不回归：pal 1093 / frog 758 / mush 1022（?? 直读回落=原相）
// ============================================================
describe('④ F3 独立形族（pal/mush/frog）跳尾不回归', () => {
  const CASES: Array<{ label: string; id: number }> = [
    { label: '捣蛋猫 1093', id: 1093 },
    { label: '吸血蛙 758', id: 758 },
    { label: '蘑菇小伙伴 1022', id: 1022 },
  ];
  for (const c of CASES) {
    it(`${c.label}：贴地+敌心高 60px → 共享尾照常跃起（独立形族拍尾 vy=0 无病不动）`, () => {
      const h = makeHooks([]);
      const m0 = minion(h.player, c.id, 66 * 16, 0);
      playerAt(h, 66 * 16 + 150);
      const m = minion(h.player, c.id, 66 * 16, GROUND_TOP - m0.h / 2);
      for (let t = 0; t < 5; t++) m.fixedUpdate(1, h.hooks);
      expect(m.y + m.h).toBe(GROUND_TOP);
      expect(priv(m).lastWalkPreGravVy, '独立形族从不调 walkChase → 快照恒 null（回落前提）').toBeNull();
      h.enemyList.push(mkEnemy(1, m.cx, m.cy - 60));
      m.fixedUpdate(1, h.hooks);
      expect(m.vy, '共享尾照常跃起（若回落被破坏 → null≠0 门死 → 红）').toBeLessThan(-1);
    });
  }
});

// ============================================================
// ⑤ F4 ai177FindTarget 首敌豁免边界（:45918-45931 FindTargetWithinRange）
// ============================================================
describe('⑤ F4 ai177FindTarget 域门边界（:45929 严格小于,无首敌豁免）', () => {
  const mk177 = (h: ReturnType<typeof makeHooks>, cx: number, cy: number) => {
    const m = minion(h.player, 917, cx, cy);
    priv(m).ai177Immunity = new LocalImmunityTable();
    return m;
  };

  it('仅域外敌 d=450 → null（病形：best===null 豁免直纳 → 红）', () => {
    const h = makeHooks([mkEnemy(1, 60 * 16 + 450, 60 * 16)]);
    const m = mk177(h, 60 * 16, 60 * 16);
    expect(priv(m).ai177FindTarget(h.hooks)).toBeNull();
  });

  it('恰 d=400 → null（num<=num2 拒;病形：豁免直纳 → 红）', () => {
    const h = makeHooks([mkEnemy(1, 60 * 16 + 400, 60 * 16)]);
    const m = mk177(h, 60 * 16, 60 * 16);
    expect(priv(m).ai177FindTarget(h.hooks)).toBeNull();
  });

  it('d=399 → 锁定该敌（域内首敌照纳）', () => {
    const h = makeHooks([mkEnemy(3, 60 * 16 + 399, 60 * 16)]);
    const m = mk177(h, 60 * 16, 60 * 16);
    const r = priv(m).ai177FindTarget(h.hooks);
    expect(r && r.id).toBe(3);
    expect(priv(m).ai177Lock, ':46016-46017 锁写位').toBe(3);
  });

  it('域外首敌不遮域内近敌：450+200 → 取 200（序等价回归钉）', () => {
    const h = makeHooks([mkEnemy(1, 60 * 16 + 450, 60 * 16),
      mkEnemy(2, 60 * 16 + 200, 60 * 16)]);
    const m = mk177(h, 60 * 16, 60 * 16);
    const r = priv(m).ai177FindTarget(h.hooks);
    expect(r && r.id).toBe(2);
  });
});

// ============================================================
// ⑥ F5 文档残留清理（源钉）+ 快照载体四族补齐钉
// ============================================================
describe('⑥ F5 文档残留 + 快照载体源钉', () => {
  it('ai177FindTarget：!gated 死支摘除、头注 1036 残留同步（变异回填 → 红）', () => {
    const fn = MINION_TS.slice(
      MINION_TS.indexOf('private ai177FindTarget('),
      MINION_TS.indexOf('private webStep('));
    expect(fn).not.toContain('!gated ||');
    expect(fn).toContain('if (this.ai177Lock < 0)');
    expect(fn).toContain('BJ-C3/F5');
    expect(fn).toContain('BJ-C3/F4');
    expect(fn).not.toContain('best === null || d < bestD');
  });

  it('跳尾快照回落+四族 capturePreGravVy 补齐（源钉,独立形族回落路径守卫）', () => {
    const tail = MINION_TS.slice(
      MINION_TS.indexOf('private ai67TryJumpingToTargetTail('),
      MINION_TS.indexOf('private ai067WalkChase('));
    expect(tail).toContain('const vyRead = this.lastWalkPreGravVy ?? this.vy;');
    expect(tail).toContain('let flag = vyRead === 0;');
    // 四族捕获补齐（web 1036 既有 BJ516①,虎/海盗/flinx 随本刀）
    expect(MINION_TS).toContain('{ wet, capturePreGravVy: true }');
    expect(MINION_TS).toContain('{ wet, wallIntent: -80, capturePreGravVy: true }');
    expect(MINION_TS).toContain('{ wet, wallIntent: jumpAtTarget, capturePreGravVy: true }');
    // 帧机读相两钉（海盗直读形/flinx 相位局部量）
    expect(MINION_TS).toContain('if ((this.lastWalkPreGravVy ?? this.vy) === 0) {');
    expect(MINION_TS).toContain('const vyPhase = this.lastWalkPreGravVy ?? this.vy;');
  });
});
