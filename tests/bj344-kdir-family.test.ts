// BJ344（2026-09-25）kdir 家族三面修复判别面（BJ340 台账 docs/kdir-family-ledger-bj340.md
// 落刀）。标杆 Terarria1457/Terraria/Projectile.cs 逐支亲读：
//   F1 回旋镖 aiStyle3（:984 调用点）：num40=弹 direction 字段（:13652）——出程自动向
//   sign(vx,0→1)（:17121-17131,排除表 :17389 含 ai0==1 回收态）/回收冻结/光刃回收态
//   AI 写位玩家相对存续（:40077-40086）。命中特例族（Damage_PVE_Inner :13056-13134,
//   先于 num40 读出）：301/383=玩家相对敌位（逐敌）+宽盒 num5 缩放（301×1.75/383×1.5
//   +dmg×0.6）;902 回收态字段翻转（:13124-13130,翻转在 num40 读出前→回调内翻转持久）。
//   F2 悠悠球/配重球 aiStyle99（:3450/:3486/:2870/:2924）：99 不在排除表 ⇒ 伤害时
//   direction=sign(vx,0→1)——AI 期玩家相对写（:68892-68902/:69111-69122）被同子步
//   自动向覆写（BJ340 §3 定谳独立复核：:17184 Damage 在 :17121 自向东之后 ✓）。
//   F3 链锤 aiStyle15（FlailProj）：伤害期覆写 :13667-13678 全族 num40=玩家相对敌位
//   （逐敌）+num5 相位缩放 ai0==0×0.35/ai0==6×0.5;1058「球侧专属」系 1456 锚误读,
//   摘分叉;1058 spriteDirection=离玩家向每拍覆写（:44876-44885,本仓出生冻结=缺口补齐）。
// 运行：cd game && npx vitest run tests/bj344-kdir-family.test.ts
import { describe, it, expect } from 'vitest';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import {
  hitEnemies, HitCooldown, Boomerang, YoyoProj, CounterweightProj, FlailProj,
} from '../src/entities/WeaponProj';
import { damageVarRoll } from '../src/stats/DamageVar';
import type { GameHooks } from '../src/entities/types';

const W = 200, H = 160;
const PX = 50 * 16, PY = 90 * 16;

function makeHooks() {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) {
    for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  }
  const player = new Player(PX, PY, new Inventory());
  const enemies: Array<Record<string, unknown>> = [];
  const hooks: GameHooks = {
    world: { store } as never,
    player: player as never,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: () => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  };
  return { hooks, player, enemies, store };
}

/** kb 探针敌：记录每次 hurt 的 kx（=kdir×knockback×kbScale）与 dmg */
function kbFoe(id: number, x: number, y: number, w = 24, h = 40) {
  const rec: Array<{ kx: number; dmg: number }> = [];
  const foe = {
    id, x, y, w, h, dead: false, vx: 0, vy: 0,
    hurt: (d: number, kx: number) => { rec.push({ kx, dmg: d }); return false; },
  };
  return { foe, rec };
}

// ============================================================
// 载体契约：dirOverride 逐敌回调 + kbScale 乘区（hitEnemies 本体）
// ============================================================
describe('BJ344 载体契约: dirOverride 回调档/kbScale（:384 kdir/:423 hurt）', () => {
  const self = { x: PX, y: PY, w: 20, h: 20, vx: 1, damage: 10, knockback: 2, projId: 6 };

  it('①dirOverride=number 静态档零漂移（404 既有面回归钉）', () => {
    const { hooks, enemies } = makeHooks();
    const { foe, rec } = kbFoe(1, PX, PY);
    enemies.push(foe as never);
    hitEnemies(self, hooks, new HitCooldown(), 10, -1, 0, undefined, undefined, false,
      undefined, 0, 1, 1);
    expect(rec[0].kx).toBe(2);            // dirOverride=+1 强占（敌相对弹位=0→dirX=-1 档不达）
  });

  it('②dirOverride=回调逐敌求值：同拍左右两侧敌各有各的向（301/383/aiStyle15 语义）', () => {
    const { hooks, enemies } = makeHooks();
    const pl = hooks.player as unknown as { cx: number; cy: number };
    const left = kbFoe(1, PX - 12, PY);    // 敌心 PX 在玩家心（PX+10）左,盒与弹盒重叠
    const right = kbFoe(2, PX + 8, PY);    // 敌心 PX+20 在玩家心右
    enemies.push(left.foe as never, right.foe as never);
    hitEnemies(self, hooks, new HitCooldown(), 10, 0, 0, undefined, undefined, false,
      undefined, 0,
      (e: unknown) => {
        const t = e as { cx?: number; x: number; w: number };
        return pl.cx < (t.cx ?? t.x + t.w / 2) ? 1 : -1;
      }, 1);
    expect(left.rec[0].kx).toBe(-2);      // 玩家<敌? 否 → −1（推离玩家）
    expect(right.rec[0].kx).toBe(2);      // 玩家<敌 → +1
  });

  it('③kbScale 乘区：knockback×kbScale（:423 kdir×knockback×kbScale）', () => {
    const { hooks, enemies } = makeHooks();
    const a = kbFoe(1, PX, PY);
    enemies.push(a.foe as never);
    hitEnemies(self, hooks, new HitCooldown(), 10, 1, 0, undefined, undefined, false,
      undefined, 0, 1, 0.35);
    expect(a.rec[0].kx).toBeCloseTo(0.7); // 2×0.35
  });
});

// ============================================================
// F1：回旋镖 aiStyle3（Boomerang :984）
// ============================================================
describe('BJ344 F1: 回旋镖 direction 字段/特例族（:13652+:13056-13134）', () => {
  it('①出程弹在敌「身后」命中：kdir=sign(vx)（旧载体=敌相对弹位=反向红）', () => {
    const { hooks, enemies } = makeHooks();
    // 弹向右飞（vx=+3）,敌盒与弹盒重叠且敌心在弹心左侧（旧 kdir=−1）
    const b = new Boomerang(PX + 40, PY, 3, 0, 10, 2, 6, 1);
    const { foe, rec } = kbFoe(7, PX + 28, PY - 10);
    enemies.push(foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect(rec.length).toBeGreaterThanOrEqual(1);
    expect(rec[0].kx).toBe(2);            // ★+knockback（sign(vx)=+1）;旧载体给 −2
  });

  it('②回收态冻结向：ai0=1 时 kdir=出程末向（不随敌位翻转）', () => {
    const { hooks, enemies } = makeHooks();
    const b = new Boomerang(PX + 40, PY, -3, 0, 10, 2, 6, 1);
    (b as unknown as { ai0: number }).ai0 = 1;   // 直接置回收态（出程末向=出生向 +1）
    const { foe, rec } = kbFoe(7, PX + 52, PY - 10);  // 敌心在弹心右侧（旧载体=+1）
    enemies.push(foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect(rec.length).toBeGreaterThanOrEqual(1);
    expect(rec[0].kx).toBe(2);            // ★冻结出程向 +1（弹向左回飞但 dir 冻结;敌相对弹位恰同值=对照弱,①承担主判别）
  });

  it('③301 命中：kdir=玩家相对敌位（逐敌）+宽盒拍 kb×1.75', () => {
    const { hooks, enemies } = makeHooks();
    // 弹在玩家右侧（心 PX+79）向右飞,敌在弹身位（心 PX+60,仍在玩家右侧）：
    // 旧载体=敌相对弹位 −1×2=−2 且无缩放;新=玩家相对敌位 +1×2×1.75=+3.5（双向判别）
    const b = new Boomerang(PX + 60, PY, 3, 0, 10, 2, 301, 1);
    (b as unknown as { boomBox: number }).boomBox = 200;   // 宽盒拍
    const { foe, rec } = kbFoe(7, PX + 40, PY - 10, 40, 40);
    enemies.push(foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect(rec.length).toBeGreaterThanOrEqual(1);
    expect(rec[0].kx).toBeCloseTo(3.5);   // +1×2×1.75（玩家心 PX+10 < 敌心 PX+60 → +1）
  });

  it('③b 301 方向强判别：弹向右飞但敌在玩家左侧（宽盒走廊补判）→ kdir=−1（旧载体 sign(vx)=+1 红）', () => {
    const { hooks, enemies } = makeHooks();
    const b = new Boomerang(PX + 60, PY, 3, 0, 10, 2, 301, 1);
    (b as unknown as { boomBox: number }).boomBox = 200;
    // 敌在玩家左侧（心 PX−20）,靠 boomExt 冲击盒走廊（[PX−21,PX+179]）补判命中
    const { foe, rec } = kbFoe(8, PX - 40, PY - 10, 40, 40);
    enemies.push(foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect(rec.length).toBeGreaterThanOrEqual(1);
    expect(rec[0].kx).toBeCloseTo(-3.5);  // −1×2×1.75;旧载体=敌相对弹位 −2/变异体 sign(vx)=+3.5
  });

  it('④383 宽盒拍：kb×1.5 + dmg×0.6', () => {
    const { hooks, enemies } = makeHooks();
    const b = new Boomerang(PX + 60, PY, 3, 0, 10, 2, 383, 1);
    (b as unknown as { boomBox: number }).boomBox = 300;
    const { foe, rec } = kbFoe(7, PX + 40, PY - 10, 40, 40);  // 敌心=玩家右侧 → +1
    enemies.push(foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect(rec.length).toBeGreaterThanOrEqual(1);
    expect(rec[0].kx).toBeCloseTo(3);     // +1×2×1.5
    // ★BJ735 改判史（随 BJ723-B W01,2026-10-26）：hitEnemies 主环 DV 首掷
    // （Projectile.cs:12970）→ dmg=trunc(DV(10)×0.6) 档域（旧钉 6=10×0.6 平值遗迹,
    // 全量棘轮真随机 flaky——非中值档必红）;kb 链无 DV,kx 锁不动。
    const dv383 = new Set<number>();
    for (let i = 0; i < 31; i++) dv383.add(Math.trunc(damageVarRoll(10, 0, () => i / 31) * 0.6));
    expect(dv383.has(rec[0].dmg)).toBe(true);
  });

  it('⑤902 回收态命中：翻转在 num40 读出前（首中即翻转值,逐命中震荡持久）', () => {
    const { hooks, enemies } = makeHooks();
    const b = new Boomerang(PX + 40, PY, -3, 0, 10, 2, 902, 1);
    (b as unknown as { ai0: number }).ai0 = 1;   // 回收态,dir=+1（出程末向）
    const e1 = kbFoe(7, PX + 28, PY - 10);       // 两敌同拍重叠
    const e2 = kbFoe(8, PX + 30, PY + 12);
    enemies.push(e1.foe as never, e2.foe as never);
    b.fixedUpdate(1 / 60, hooks);
    expect(e1.rec.length + e2.rec.length).toBe(2);   // 902 penetrate=-1,同拍双敌各一次（后 2 子步吃 10t 冷却）
    const kxs = [...e1.rec, ...e2.rec].map((r) => r.kx).sort((a, b2) => a - b2);
    expect(kxs).toEqual([-2, 2]);         // 逐敌翻转震荡：−dir → +dir（旧载体恒 =dir 单值）
    expect((b as unknown as { dir: number }).dir).toBe(1);   // 字段持久（两次翻转回位）
  });
});

// ============================================================
// F2：悠悠球/配重球 aiStyle99（:3450/:3486/:2870/:2924）
// ============================================================
describe('BJ344 F2: aiStyle99 伤害时 direction=sign(vx,0→1)（:17121-17131 同子步覆写）', () => {
  it('①悠悠球活跃态：弹在敌「身后」（敌相对弹位=−1）但 vx>0 → kdir=+1', () => {
    const { hooks, enemies } = makeHooks();
    const y = new YoyoProj(PX + 30, PY, 10, 2, 3274, 300, () => true,
      () => ({ x: PX + 200, y: PY }), 0);
    (y as unknown as { vx: number }).vx = 2;   // 强置速度（AI 逼近段会改,构造后直置）
    const { foe, rec } = kbFoe(7, PX + 12, PY - 10);   // 敌心在弹心左侧
    enemies.push(foe as never);
    y.fixedUpdate(1 / 60, hooks);
    expect(rec.length).toBeGreaterThanOrEqual(1);
    expect(rec[0].kx).toBe(2);            // ★sign(vx)=+1;旧载体=敌相对弹位 −2
  });

  it('②配重球回收态（ai0=-1 直积分后）：vx<0 → kdir=−1（敌在右侧旧载体=+1 红）', () => {
    const { hooks, enemies } = makeHooks();
    // 距玩家 ≥40（回收 <40 Kill 门）——PX+80 距玩家心（PX+10）=70
    const cw = new CounterweightProj(PX + 80, PY, 10, 2, 556, -1, {
      owner: () => hooks.player as never,
      channel: () => false,
      yoyoInPlay: () => true,
    } as never);
    (cw as unknown as { vx: number }).vx = -2;
    // 敌盒罩住两子步 lerp 后弹落位（盒 10×10,末位 cx≈PX+67.2）且敌心（PX+75）在弹心右侧
    const { foe, rec } = kbFoe(7, PX + 60, PY - 10, 30, 40);
    enemies.push(foe as never);
    cw.fixedUpdate(1 / 60, hooks);
    expect(rec.length).toBeGreaterThanOrEqual(1);
    expect(rec[0].kx).toBe(-2);           // ★sign(vx)=−1（lerp 后 vx 仍负）
  });
});

// ============================================================
// F3：链锤 aiStyle15（FlailProj :4725 区）
// ============================================================
describe('BJ344 F3: aiStyle15 伤害期覆写（:13667-13678 玩家相对敌位+num5 相位缩放）', () => {
  it('①蓄旋态（st=0,vx=0）：kdir=玩家相对敌位（旧 sign(vx) 档=−1 红）+ kb×0.35', () => {
    const { hooks, enemies } = makeHooks();
    const f = new FlailProj(PX, PY, 10, 2, 25, () => true, () => ({ x: PX + 200, y: PY }));
    const { foe, rec } = kbFoe(7, PX - 10, PY - 30, 80, 80);   // 敌心 PX+30 在玩家右侧
    enemies.push(foe as never);
    f.fixedUpdate(1 / 60, hooks);
    expect((f as unknown as { st: number }).st).toBe(0);
    expect(rec.length).toBeGreaterThanOrEqual(1);
    expect(rec[0].kx).toBeCloseTo(0.7);   // +1×2×0.35（旧：vx=0 → −1×2）
  });

  it('②悬荡态（st=6 直置）：kb×0.5,kdir 仍玩家相对敌位（旧 vx==0→−1 且无缩放=红）', () => {
    const { hooks, enemies } = makeHooks();
    const f = new FlailProj(PX, PY, 10, 2, 25, () => true, () => ({ x: PX, y: PY + 200 }));
    (f as unknown as { st: number }).st = 6;   // 直置悬荡态（私有态机跨两 tick 驱动过脆）
    const { foe, rec } = kbFoe(7, PX + 2, PY - 10, 60, 60);   // 敌心 PX+32 在玩家心右
    enemies.push(foe as never);
    f.fixedUpdate(1 / 60, hooks);
    expect((f as unknown as { st: number }).st).toBe(6);
    expect(rec.length).toBeGreaterThanOrEqual(1);
    expect(rec[0].kx).toBeCloseTo(1);     // +1×2×0.5（旧：−1×2×1=−2）
  });

  it('③1058 同受全族覆写（旧分叉摘除）+ spriteDirection 离玩家向每拍更新', () => {
    const { hooks, enemies } = makeHooks();
    const tgt = { x: PX + 200, y: PY };
    const f = new FlailProj(PX, PY, 10, 2, 1058, () => true, () => tgt);
    const { foe, rec } = kbFoe(7, PX - 10, PY - 30, 80, 80);
    enemies.push(foe as never);
    f.fixedUpdate(1 / 60, hooks);          // tick1: 球绕右侧 → spriteDir=+1（同出生）
    expect(rec[0].kx).toBeCloseTo(0.7);    // 蓄旋 ×0.35（与 25 同表,无 1058 特例）
    tgt.x = PX - 200;
    f.fixedUpdate(1 / 60, hooks);          // tick2: 球绕左侧 → spriteDir 翻 −1（旧=出生冻结 +1）
    expect((f as unknown as { spriteDir: number }).spriteDir).toBe(-1);
  });
});
