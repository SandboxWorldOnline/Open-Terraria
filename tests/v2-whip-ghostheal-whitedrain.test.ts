// ★清偿刀 V2（2026-10-01）判别测试——WhipProj.tryHit 环 ghostHeal 白耗面（U2 领地外残留）。
//  定谳锚（Terarria1457/Terraria/Projectile.cs 亲读）：
//   · :13712 flag10 = num41>0 ∧ targetNPC.lifeMax>5 ∧ friendly ∧ !hostile ∧ aiStyle≠59
//     ——【无伤害类别门】;正常局 :12843 初值臂（`flag10 |= friendly && aiStyle!=59`）
//     仅 DebugOptions.LetProjectilesAimAtTargetDummies 假人支可达,鞭面全由 :13712 承载。
//   · :13869 `if (flag10)` → :13875 `targetNPC.canGhostHeal | flag9`（flag9=假人调试位
//     :12837-12842,正常局恒 false）→ :13877-79 ghostHeal 调用点在 Damage() 通用 on-hit 段。
//   · 鞭数据面（SetDefaults 逐型亲读）：18 型（841/847/848/849/912/913/914/915/952/
//     1028/1029/1030/1031/1032/1033/1034/1035/1104）全走 DefaultToWhip（:8144-8146/
//     :8157-8169/:8668-8680/:8987-8989/:9738-9768/:10293-10295）无 magic 行 → 非 magic =
//     ghostHeal 白耗单面（:12090 `lifeSteal -= num2` 先于 :12091-93 `if (!magic) return`
//     ⇒ 幽灵兜帽在身白扣治疗预算不出治疗球=原版本相）;ghostHurt 不接=非 magic 死码
//     （:12022 `if (!magic || damage <= 0) return` 早退零观察面,S2/R1-B 定谳保形）。
//   · 门位（:12634-12637）：鞭 maxPenetrate=-1 ∧ usesLocalNPCImmunity=true ⇒ flag3=false
//     ⇒ immune[owner] 门【生效】——门拒（他弹残窗）=原文 return:不 proc 不计数。
//   · :14263 numHits++ 受理拍自增在 proc 块后 ⇒ proc 读自增前值（首跳 0 档率 0.20）。
//  本仓承接 = T 单源快照判据 + U2 ghostHealProc 单源（isMagic 经 projectileData 直传）。
import { describe, it, expect, vi } from 'vitest';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { WhipProj } from '../src/entities/WhipProj';
import { SpectreSoulProj } from '../src/entities/SpectreSoulProj';
import { projectileData as projData } from '../src/data/vanillaProjectiles';
import type { GameHooks } from '../src/entities/types';

const TILE_W = 200, TILE_H = 120;
const DEFENSE = 22;
const WHIP_IDS = [841, 847, 848, 849, 912, 913, 914, 915, 952,
  1028, 1029, 1030, 1031, 1032, 1033, 1034, 1035, 1104];

interface StealCall {
  kind: string; dmg: number; numHits: number; x: number; y: number; isMagic: boolean;
}

/** 敌怪 spy：镜像 Enemy.hurt 三早退的受理形态（入口清零/免疫窗拒/防后实扣+iframes 10t） */
function enemySpy(id: number, cx: number, cy: number, w = 24, h = 24,
  vanillaId: number | null = 15) {
  const e = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, vanillaId, maxHp: 100,
    lastStrikeDealt: 0, iframes: 0, dontTakeDamage: false, attempts: 0,
    hurt(this: { lastStrikeDealt: number; iframes: number; attempts: number;
      dontTakeDamage: boolean },
      dmg: number): boolean {
      this.lastStrikeDealt = 0;                        // 入口清零（Enemy.ts:14229）
      if (this.iframes > 0 || this.dontTakeDamage) return false;
      this.attempts++;
      this.lastStrikeDealt = Math.max(0, dmg - DEFENSE);
      this.iframes = 10;
      return true;
    },
  };
  return e;
}

function makeHooks(enemies: unknown[]) {
  const store = new TileStore(TILE_W, TILE_H);
  for (let x = 0; x < TILE_W; x++) for (let y = 100; y < TILE_H; y++) store.setTile(x, y, 1);
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const log: StealCall[] = [];
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: { store } as never,
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
    entities: { add: (e: unknown) => { added.push(e); }, nextId: 1 },
    // ★V2 吸血链录放口（生产实现 Game.applyLifeSteal :43431——白耗面=预算扣/不出球,
    //  判别测试只录 proc 实参:isMagic 直传位/numHits 读数/出生点）
    applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
      x: number, y: number, isMagic?: boolean) => {
      log.push({ kind, dmg, numHits, x, y, isMagic: !!isMagic });
      return 0;
    },
  } as unknown as GameHooks;
  return { hooks, player, log, added };
}

/** 鞭命中驱动（F2 landOneHit 同式）：9 tick 后把敌挪到 ai0=20 快照曲线中段控制点,
 *  再 tick 一拍取一次命中 */
function landOneHit(w: WhipProj, hooks: GameHooks, ...enemies: { x: number; y: number }[]): void {
  for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
  const p = w.pointsAt(20, true)[10];
  for (const e of enemies) { e.x = p.x - 12; e.y = p.y - 12; }   // 24 盒对控制点同心
  w.fixedUpdate(1, hooks);
}

const mkWhip = (player: Player, dmg: number): WhipProj =>
  new WhipProj(player.cx, player.cy, 0, 841 /*皮革鞭*/, 4672, dmg, 4, 30, 4, () => player);

describe('V2-§A：鞭命中环 ghostHeal 白耗面（841 非 magic 数据面）', () => {
  it('首跳 proc：isMagic=false（白耗面）/numHits=0/dmg=防后实扣/出生点=受害者 Center', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ723-C S03 位移修复:鞭 DV 中性档（num41=防后实扣平值复稳）
    const e = enemySpy(1, 400, 600);
    const { hooks, player, log } = makeHooks([e]);
    landOneHit(mkWhip(player, 60), hooks, e);
    expect(e.attempts).toBe(1);
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].isMagic).toBe(false);       // ← 旧档整缺=零 proc（变异红）
    expect(log[0].dmg).toBe(60 - DEFENSE);    // num41 等位（Enemy.lastStrikeDealt）
    expect(log[0].numHits).toBe(0);           // :14263 自增在 proc 后
    expect(log[0].x).toBe(e.x + e.w / 2);     // 受害者 Center（:13879 new Vector2(Center.X,.Y);
    expect(log[0].y).toBe(e.y + e.h / 2);     //   landOneHit 已把敌挪到控制点 → 实时盒心对照）
  });

  it('门拒（他弹残窗 iframes>0）零 proc 零计数（:12634-12637 门生效,flag3=false）', () => {
    const e = enemySpy(2, 400, 600);
    e.iframes = 10;
    const { hooks, player, log } = makeHooks([e]);
    const w = mkWhip(player, 60);
    landOneHit(w, hooks, e);
    expect(e.attempts).toBe(0);               // Enemy.hurt 免疫窗早退（镜像）
    expect(log.length).toBe(0);               // ← 门拒不 proc（★S3b:本站前置免疫窗门 :12635-12639 1:1 上位,V2 快照判据退役）
    expect(w.pveNumHits).toBe(0);             // 门拒不计数（:14263 门拒拍不达）
  });
});

describe('V2-§B：pveNumHits 计数源（:14263 受理拍自增,多敌叠跳）', () => {
  it('双敌同拍：二跳 proc 读自增前值 numHits=1;鞭面 pveNumHits=2（localNPCHitCooldown=-1 每敌一次）', () => {
    const a = enemySpy(3, 400, 600);
    const b = enemySpy(4, 460, 620);
    const { hooks, player, log } = makeHooks([a, b]);
    const w = mkWhip(player, 60);
    landOneHit(w, hooks, a, b);
    expect(a.attempts).toBe(1);
    expect(b.attempts).toBe(1);
    expect(log.length).toBe(2);
    expect(log[0].numHits).toBe(0);
    expect(log[1].numHits).toBe(1);           // ← 旧档无计数源=恒 0（变异红）
    expect(w.pveNumHits).toBe(2);
    expect(log[1].isMagic).toBe(false);
  });
});

describe('V2-§C：ghostHurt 死码面（:12022 非 magic 早退,S2/R1-B 定谳保形）', () => {
  it('幽灵面具玩家（ghostHurt=true）鞭命中：白耗臂照达但零浮魂 356 出弹（单面判别位）', () => {
    const e = enemySpy(5, 400, 600);
    const { hooks, player, log, added } = makeHooks([e]);
    // 幽灵面具档：equipStats 冻结记忆化（Player.get equipStats Object.freeze）→
    //  Proxy 仅覆写 equipStats,其余面（buffs/banner 域）走真玩家
    (hooks as unknown as { player: unknown }).player = new Proxy(player, {
      get(t, k) {
        if (k === 'equipStats') return { setBonus: { ghostHurt: true } };
        return Reflect.get(t, k);
      },
    });
    landOneHit(mkWhip(player, 60), hooks, e);
    expect(e.attempts).toBe(1);
    expect(log.length).toBe(1);
    expect(log[0].isMagic).toBe(false);       // ghostHeal 白耗面在
    // ← ghostHurt 不接：entities 无 SpectreSoulProj(356)（若误接 magic 臂=变异红）
    expect(added.some((x) => x instanceof SpectreSoulProj)).toBe(false);
  });
});

describe('V2-§D：鞭族数据面哨（vanilla-projectiles.json 回归锁——白耗单面判据前提）', () => {
  it('18 型全 aiStyle=165/无 magic/无 hostile/friendly（SetDefaults DefaultToWhip 面）', () => {
    for (const id of WHIP_IDS) {
      const d = projData(id);
      expect(d, `projData(${id}) 缺行`).toBeTruthy();
      expect(d?.aiStyle, `projData(${id}).aiStyle`).toBe(165);
      expect(d?.magic, `projData(${id}).magic`).toBeFalsy();
      expect(d?.hostile, `projData(${id}).hostile`).toBeFalsy();
      expect(d?.friendly, `projData(${id}).friendly`).toBe(true);
    }
  });
});
