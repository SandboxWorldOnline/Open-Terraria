// ★BJ167 登记债 2/3/4（spectre 域三小件——Arrow/MissileProc ghost 治疗支对齐）回归
//（2026-09-19）。标杆 Terarria1457/Terraria/Projectile.cs：
//   ② canGhostHeal 门：:13875 `if (targetNPC.canGhostHeal | flag9)` 对 ghostHeal
//     (:13877-79) 与 ghostHurt(:13881-83) 【同块】设门——false 族 384/387/388/523
//     （NPC.cs:13921/:13961/:13978/:15839 写点,字段缺省 true :6270）。旧码
//     Arrow/MissileProc ghost 支命中该族仍治疗（Game.applyLifeSteal 无 victim 门）。
//   ③ dmg 口径：原版传 num41（:13712 `int num41 = targetNPC.StrikeNPC(...)` 返回值 =
//     防后实扣,:13879/:13883 实参）——旧码传 Math.round(dmg)（防前伤）,治疗量按
//     防御/旗乘差值虚高。仓内 num41 等位 = Enemy.lastStrikeDealt（入口清零
//     Enemy.ts:13883 + 实扣写点 :14111 + 假人 488 分支 :14078）。
//   ④ 出生点：原版传受害者 Center（:13879 `new Vector2(targetNPC.Center.X,.Y)`——
//     治疗弹 298 从受害者位置起飞）——旧码传弹体左上 this.x,y,起飞原点差几像素。
// 单源习语 = MagicProj BJ157-①（spectreVictimEligible + lastStrikeDealt + 受害者
// Center）;numHits 实参沿 BJ157-②（Arrow=pveNumHits,MissileProc=pierceInit−pierce）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// ★BJ730 改判史：本套件期望值（60−22=38 / 80−22=58 等）写于 BJ716-A R18-F2 DV
//  首掷接入（2026-10-25,:12970 ±15% 31 档）【之前】——Arrow/MissileProj 伤害面
//  现每次命中 DV 掷,未钉掷时期望值在 31 档内随机漂移（42=64−22/30=52−22 等红
//  皆掷面漂移非回归;ghost 支传参 lastStrikeDealt/Center 已复核 vanilla 等位）。
//  按 BJ716-A「DV 接入测试位移配方」钉 Math.random=0.5（tier 0 → ×1.0 中性档,
//  crit 0.5≥0.04 恒不中）,期望值回归确定。
beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0.5); });
afterEach(() => { vi.restoreAllMocks(); });
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Arrow } from '../src/entities/Arrow';
import { MagicMissileProj } from '../src/entities/MissileProj';
import type { GameHooks } from '../src/entities/types';

interface StealCall {
  kind: string; dmg: number; numHits: number; x: number; y: number; isMagic: boolean;
}

const DEFENSE = 22;   // spy 敌防御模拟：实扣 = 入伤 − 22（num41=StrikeNPC 防后返回值等位）

/** 敌怪 spy：hurt 萰 StrikeNPC——lastStrikeDealt = 防后实扣（:num41 等位）+ iframes=10 */
function enemySpy(id: number, x: number, y: number, w = 16, h = 16,
  vanillaId: number | null = 15) {
  return {
    id, x, y, w, h, dead: false, vanillaId, maxHp: 100,
    lastStrikeDealt: 0, iframes: 0,
    hurt(this: { lastStrikeDealt: number; iframes: number }, dmg: number): boolean {
      this.lastStrikeDealt = Math.max(0, dmg - DEFENSE);
      this.iframes = 10;
      return true;
    },
  };
}

function makeGame(log: StealCall[], enemies: unknown[], world?: World): GameHooks {
  return {
    world: world ?? new World(64, 32, 42, 'bj167'),
    player: new Player(30 * 16, 10 * 16, new Inventory()),
    enemies: () => enemies, critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {}, spawnParticles: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    playSfxFiles: () => {}, onEnemyKilled: () => {},
    entities: { add: () => {}, nextId: 1 },
    applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
      x: number, y: number, isMagic?: boolean) => {
      log.push({ kind, dmg, numHits, x, y, isMagic: !!isMagic });
      return 0;
    },
  } as unknown as GameHooks;
}

// ---------------------------------------------------------------------------
// ② Arrow canGhostHeal 门（:13875 victim 门——false 族不治疗,命中照常结算）
// ---------------------------------------------------------------------------
describe('BJ167-② Arrow ghost 治疗支 canGhostHeal 门（Projectile.cs:13875）', () => {
  it('canGhostHeal=false 族 384：命中照常结算但零治疗 proc（旧码仍治疗=变异红）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 480, 256, 16, 16, 384);
    const game = makeGame(log, [e]);
    const a = new Arrow(450, 264, 6, 0, 60, 0, 15, { grav: 0, life: 300, pierce: 1 });
    for (let i = 0; i < 40 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(e.lastStrikeDealt).toBe(60 - DEFENSE);   // 命中结算面未被 victim 门吞
    expect(log.length).toBe(0);                     // :13875 canGhostHeal|flag9 门
  });

  it('普通敌 15：照常治疗（门不误伤常规 proc）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 480, 256);
    const game = makeGame(log, [e]);
    const a = new Arrow(450, 264, 6, 0, 60, 0, 15, { grav: 0, life: 300, pierce: 1 });
    for (let i = 0; i < 40 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].numHits).toBe(0);                 // BJ157-② numHits 实参不回归
  });
});

// ---------------------------------------------------------------------------
// ③④ Arrow dmg 口径（num41 防后实扣）+ 出生点（受害者 Center）
// ---------------------------------------------------------------------------
describe('BJ167-③④ Arrow ghost 治疗实参（num41=lastStrikeDealt / 受害者 Center）', () => {
  it('dmg = 防后实扣（旧 Math.round(dmg) 防前伤 = 变异红）;出生点 = 受害者 Center', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 480, 256);                // Center = (488, 264)
    const game = makeGame(log, [e]);
    const a = new Arrow(450, 264, 6, 0, 60, 0, 15, { grav: 0, life: 300, pierce: 1 });
    for (let i = 0; i < 40 && !a.dead; i++) a.fixedUpdate(1 / 60, game);
    expect(log.length).toBe(1);
    expect(log[0].dmg).toBe(60 - DEFENSE);          // ← 旧码 60（防前伤,虚高）
    expect(log[0].x).toBe(488);                     // ← 旧码 = 弹体左上 x（<488）
    expect(log[0].y).toBe(264);                     // :13879 Vector2(targetNPC.Center)
    expect(log[0].isMagic).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ②③④ MissileProc（MagicMissileProj 16/34/79 hitStep ghost 支）同三件
// ---------------------------------------------------------------------------
describe('BJ167-②③④ MissileProc ghost 支（:13875 门 / num41 / 受害者 Center）', () => {
  function missileAt(offX: number, offY: number, e: { x: number; y: number },
    world: World): MagicMissileProj {
    const proj = new MagicMissileProj(e.x + offX, e.y + offY, 0, 0, {
      projId: 34, damage: 80, knockback: 2, useTime: 20,
      channelCb: () => false, aimCb: () => ({ x: e.x + offX, y: e.y + offY }),
      payMana: () => true,
    });
    proj.critChance = 0;                            // 掷面定常（缺省 0.04）
    return proj;
  }

  it('canGhostHeal=false 族 523：命中照常结算但零治疗 proc', () => {
    const world = new World(64, 64, 7, 'bj167-m');
    const log: StealCall[] = [];
    const e = enemySpy(55, world.w * 8 - 120, world.h * 8 - 120, 240, 240, 523);
    const game = makeGame(log, [e], world);
    missileAt(120, 120, e, world).fixedUpdate(1 / 60, game);
    expect(e.lastStrikeDealt).toBe(80 - DEFENSE);
    expect(log.length).toBe(0);                     // :13875 victim 门（旧码仍治疗）
  });

  it('普通敌：dmg = 防后实扣、出生点 = 受害者 Center（旧码 = 弹体左上 = 变异红）', () => {
    const world = new World(64, 64, 7, 'bj167-m');
    const log: StealCall[] = [];
    const e = enemySpy(55, world.w * 8 - 120, world.h * 8 - 120, 240, 240);
    const game = makeGame(log, [e], world);
    // 出膛点刻意偏心（盒内 60,60）——旧码传弹体左上即 (e.x+60,e.y+60)≠Center
    missileAt(60, 60, e, world).fixedUpdate(1 / 60, game);
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].dmg).toBe(80 - DEFENSE);          // ← 旧码 80（防前伤,虚高）
    expect(log[0].x).toBe(e.x + 120);               // Center.X（旧码 e.x+60）
    expect(log[0].y).toBe(e.y + 120);               // Center.Y（旧码 e.y+60）
    expect(log[0].numHits).toBe(0);                 // pierceInit−pierce 首跳 0（BJ157-②）
  });
});
