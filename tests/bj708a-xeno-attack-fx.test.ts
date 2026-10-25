// BJ708-A — Xeno 法杖（2749）UFO 随从激光攻击特效链行为锁（2026-10-23 用户实报
// 「外星法杖的召唤物没有攻击特效」）。
//
// 定谳（先证据后刀）：2749 → shoot 423（UFOMinion, aiStyle 62, AI_062）→ 射击支
// 射出 433（UFOLaser, aiStyle 48）。仓内 423 射击支在位且伤害链通（用户实报能打：
// 433 以通用 Arrow 载体生成,MinionProj ai62Step MINION_SHOOT[423]={shot:433,
// speed:4,life:100}）——但 aiStyle 48 视觉三面整缺（BJ413「伤害已接、视觉弹缺」
// 姊妹形态）：①本体应恒隐（AI :28626-28629 alpha=255）②束段锚 localAI[1]/[2]
// （delay=0,:28616-28618）③Kill 铺束 d160 行进尘（Kill :71825-71870 →
// ParticleOrchestraType.UFOLaser 39 → Spawn_UFOLaser d160 LimeGreen/CornflowerBlue,
// ParticleOrchestrator.cs:1956-1963）。BJ345 普查注「433 无玩家发射源」漏了 423
// 射击支（2026-08-12 已在,git 000e7cca）。修 = Arrow 433 三件（PROJ_ALPHA0[433]=
// 255 / subStepAI 锚+InWorld(±5) / killNow 铺束 ufoLaserTrailFx+broadcast 39）
// + VanillaDust 160/162 update 分支（Dust.cs:1269-1302 青/橙光+自管 −0.1 衰减,
// 旧落 default 吃通用重力 +0.1 与 −0.01 慢衰 = 束尘悬垂 ~90t vs 原版 ~9t）
// + orchestraFx.spawnSingleLineDust scale 后置直写勘正（原版 :2071 是覆写非形参）。
// 433 ∈ ProjectileID.Sets.MinionShot（ProjectileID.cs:291）→ 恒留 Arrow 载体
// （BeamBoltProj 无 whipTagShot 面,迁 = 鞭加成回归）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Arrow } from '../src/entities/Arrow';
import { MinionProj } from '../src/entities/MinionProj';
import { VanillaDust } from '../src/fx/VanillaDust';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ParticleOrchestraType } from '../src/net/syncModules';
import type { GameHooks } from '../src/entities/types';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');
const projJson = JSON.parse(readFileSync(join(GAME, 'src/data/vanilla-projectiles.json'), 'utf8'));
const itemJson = JSON.parse(readFileSync(join(GAME, 'src/data/vanilla-itemcombat.json'), 'utf8'));
const vanilla = (f: string): string => readFileSync(join(VAN, 'Terraria', f), 'utf8');

const LIME = { r: 50, g: 205, b: 50, a: 255 };          // Color.LimeGreen
const CORN = { r: 100, g: 149, b: 237, a: 255 };        // Color.CornflowerBlue

// ==================== 夹具 ====================

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; maxHp: number; vanillaId: number;
  def: { hp: number; friendly: boolean };
  hurt: (d: number, ...rest: unknown[]) => boolean;
  hits: number[];
}
const mkEnemy = (id: number, cx: number, cy: number, w = 20, h = 40): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy,
    hp: 100000, maxHp: 100000, vanillaId: 48, def: { hp: 100000, friendly: false },
    hits: [], hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};

interface Rec {
  dusts: Array<{ type: number; x: number; y: number; vx: number; vy: number; scale: number;
    color?: { r: number; g: number; b: number; a: number } | null; noGravity: boolean }>;
  broadcast: Array<{ type: number; x: number; y: number; mx: number; my: number; info: number }>;
  added: unknown[];
}

/** 全空世界 + 真 VanillaDust 后端（spawn 语义/裁剪/密度门 1:1）+ 记录桩 */
function mkGame(enemies: MockEnemy[] = []) {
  const w = new World(200, 120, 7, 'bj708a');
  for (let x = 0; x < 200; x++) for (let y = 20; y <= 70; y++) w.store.setTileSilent(x, y, 0, 0, 0);
  const player = new Player(30 * 16, 20 * 16, new Inventory());
  const vd = new VanillaDust();
  vd.update(0, 0, 4000, 2400);                    // 预设宽视口（spawn 裁剪门用,尘零消耗）
  const rec: Rec = { dusts: [], broadcast: [], added: [] };
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
    spawnDust: ((x: number, y: number, ww: number, hh: number, type: number,
      sx = 0, sy = 0, alpha = 0, color = null, scale = 1, noGravity = false) => {
      const d = vd.spawn(x, y, ww, hh, type, sx, sy, alpha, color as never, scale);
      if (d && noGravity) d.noGravity = true;
      if (d) rec.dusts.push(d as never);
      return d;
    }) as never,
    broadcastParticleOrchestra: ((type: number, x: number, y: number, mx = 0, my = 0, info = 0) => {
      rec.broadcast.push({ type, x, y, mx, my, info });
    }) as never,
  } as GameHooks;
  (hooks as unknown as { entities: { projectiles: unknown[]; add: (e: unknown) => void } }).entities = {
    projectiles: rec.added,
    add: (e: unknown) => { rec.added.push(e); },
  };
  return { hooks, store: w.store, player, rec };
}

/** MinionProj ai62Step 出弹同构（:5824-5826）：Center 落盒 8×8、grav 0、life 100 */
const mk433 = (cx: number, cy: number, vx = 4, vy = 0): Arrow =>
  new Arrow(cx - 4, cy - 4, vx, vy, 36, 2, 433, { grav: 0, life: 100 });

const d160 = (rec: Rec) => rec.dusts.filter((d) => d.type === 160);
const isBeamColor = (c: Rec['dusts'][number]['color']) =>
  !!c && ((c.r === LIME.r && c.g === LIME.g && c.b === LIME.b && c.a === LIME.a)
    || (c.r === CORN.r && c.g === CORN.g && c.b === CORN.b && c.a === CORN.a));

// ============================================================
// ① 原版锚（读错反编译即红）
// ============================================================
describe('① 原版锚：2749 → 423 → 433 → Kill 铺束全链', () => {
  it('Item.cs 2749 SetDefaults：shoot=423/buffType=140（:26266-26281）', () => {
    const src = vanilla('Item.cs');
    const i = src.indexOf('case 2749:');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf('case 2750:', i));
    expect(block).toContain('shoot = 423;');
    expect(block).toContain('buffType = 140;');
  });

  it('AI_062 射击支：423 档 num47=4/num48=433 + ≤400 门（:67071-67110）', () => {
    const src = vanilla('Projectile.cs');
    const i = src.indexOf('private void AI_062()');
    const block = src.slice(i, src.indexOf('private void AI_075()', i));
    const j = block.indexOf('num48 = 433');
    expect(j).toBeGreaterThan(-1);
    const fire = block.slice(block.lastIndexOf('else if', j), block.indexOf('}', block.indexOf('NewProjectile', j)) + 1);
    expect(fire).toContain('num47 = 4f;');
    expect(fire).toContain('400f');
    expect(fire).toContain('NewProjectile');
  });

  it('aiStyle48 AI 支 433：alpha=255（:28626-28629）;delay 表 433 走缺省 0（:54934-54948）', () => {
    const src = vanilla('Projectile.cs').replace(/\r\n/g, '\n');
    expect(src).toContain('else if (type == 433)\n\t\t\t{\n\t\t\t\talpha = 255;');
    const d = src.slice(src.indexOf('private int AI_048_GetStartPositionSettingDelay()'),
      src.indexOf('private void AI_001()'));
    expect(d).not.toContain('case 433');                       // 缺省 0 档
  });

  it('Kill aiStyle48 组 case 433 → UFOLaser 编播（:71849-71851）', () => {
    const src = vanilla('Projectile.cs');
    const i = src.indexOf('public void Kill()');
    const block = src.slice(i, i + 40000);
    const j = block.indexOf('case 433:');
    expect(j).toBeGreaterThan(-1);
    expect(block.slice(j, j + 200)).toContain('ParticleOrchestraType.UFOLaser');
  });

  it('Spawn_UFOLaser：d160 双层 + LimeGreen/CornflowerBlue 逐尘掷（ParticleOrchestrator.cs:1956-1963）', () => {
    const src = readFileSync(join(VAN, 'Terraria.GameContent.Drawing', 'ParticleOrchestrator.cs'), 'utf8');
    const i = src.indexOf('private static void Spawn_UFOLaser');
    const block = src.slice(i, src.indexOf('private static void Spawn_MagnetSphereBolt', i));
    expect(block).toContain('160');
    expect(block).toContain('Color.LimeGreen');
    expect(block).toContain('Color.CornflowerBlue');
    expect(block).toContain('velocity * 0.25f');
  });

  it('433 ∈ ProjectileID.Sets.MinionShot（ProjectileID.cs:291——鞭 tag 面,禁迁 BeamBoltProj）', () => {
    const src = readFileSync(join(VAN, 'Terraria.ID', 'ProjectileID.cs'), 'utf8');
    const i = src.indexOf('public static bool[] MinionShot');
    expect(src.slice(i, src.indexOf(';', i) + 1)).toContain('433');
  });

  it('尘 160/162 update 分支（Dust.cs:1269-1302）：青/橙光 + 自管 −0.1/漂移 + 1/50 子尘', () => {
    const src = vanilla('Dust.cs');
    const i = src.indexOf('else if (dust.type == 160 || dust.type == 162)');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf('else if (dust.type == 168)', i));
    expect(block).toContain('num70 * 0.1f, num70, num70');
    expect(block).toContain('num70, num70 * 0.7f, num70 * 0.1f');
    expect(block).toContain('dust.scale -= 0.1f');
    expect(block).toContain('Main.rand.Next(50) == 0');
  });
});

// ============================================================
// ② 数据面 + 仓内结构锁
// ============================================================
describe('② 数据面金标 + 发射/消费结构锁', () => {
  it('projJson 433（SetDefaults :5039-5048）：aiStyle48/8×8/friendly/EU100/life100/ignoreWater', () => {
    expect(projJson['433']).toMatchObject({
      aiStyle: 48, width: 8, height: 8, friendly: true, extraUpdates: 100, timeLeft: 100, ignoreWater: true,
    });
    expect(projJson['433'].penetrate).toBeUndefined();         // 缺省 1（单发）
  });

  it('itemJson 2749：shoot=423/summon/伤 36（I.cs:26266-26281）', () => {
    expect(itemJson['2749']).toMatchObject({ shoot: 423, summon: true, damage: 36, noMelee: true });
  });

  it('结构锁：MinionProj 423 出弹表（摘 shot:433 恰红）', () => {
    const src = readFileSync(join(GAME, 'src/entities/MinionProj.ts'), 'utf8');
    expect(src).toContain('423: { shot: 433, speed: 4, life: 100 }');
  });

  it('结构锁：Arrow 433 三件（α 表键/subStepAI 锚/killNow 铺束——摘任一恰红）', () => {
    const src = readFileSync(join(GAME, 'src/entities/Arrow.ts'), 'utf8');
    expect(src).toMatch(/^\s*433: 255,/m);                      // PROJ_ALPHA0
    expect(src).toContain('if (this.sbL0 - 1 === 0) { this.sbAx = this.cx; this.sbAy = this.cy; }');
    expect(src).toContain('ufoLaserTrailFx(game, this.sbAx, this.sbAy, this.cx, this.cy, info708)');
    expect(src).toContain('ParticleOrchestraType.UFOLaser, this.cx, this.cy');
  });

  it('结构锁：VanillaDust case 160/162（摘 update 分支恰红）+ 枚举 39', () => {
    const src = readFileSync(join(GAME, 'src/fx/VanillaDust.ts'), 'utf8');
    expect(src).toMatch(/case 160: case 162: \{/);
    expect(src).toContain('c708.noGravity = true; c708.scale = d.scale * 1.5;');
    expect(ParticleOrchestraType.UFOLaser).toBe(39);           // syncModules 枚举面
  });

  it('结构锁：spawnSingleLineDust scale 后置直写（原版 :2071 覆写语义）', () => {
    const src = readFileSync(join(GAME, 'src/fx/orchestraFx.ts'), 'utf8');
    const i = src.indexOf('export function spawnSingleLineDust');
    expect(src.slice(i, src.indexOf('}', src.indexOf('if (d)', i)) + 1))
      .toContain('d.scale = sc');
  });
});

// ============================================================
// ③ Arrow 433 行为面（单驱夹具）
// ============================================================
describe('③ 433 行为：恒隐本体 + 三死路铺束', () => {
  it('本体恒隐：alpha=255（PROJ_ALPHA0[433],AI :28626-28629——缺键 α≡0 全亮恰红）', () => {
    const { hooks } = mkGame();
    const b = mk433(1600, 800);
    expect(b.alpha).toBe(255);                                  // ctor 注入即终值
    b.fixedUpdate(1 / 60, hooks);
    expect(b.alpha).toBe(255);                                  // 恒隐不漂移
  });

  it('寿命尽铺束：锚=出生心、d160 双层/步、双色、广播 39（旧无 killNow 块恰红）', () => {
    const { hooks, rec } = mkGame();
    const b = mk433(1600, 800, 4, 0);                           // 心 (1604,804) 向 +x 4px/子步
    for (let t = 0; t < 3 && !b.dead; t++) b.fixedUpdate(1 / 60, hooks);
    expect(b.dead).toBe(true);                                  // life 100 逐子步耗尽（单拍 101 子步）
    const dusts = d160(rec);
    expect(dusts.length).toBeGreaterThanOrEqual(180);           // ~404px/4px 步 ×2 层
    expect(rec.dusts.every((d) => d.type === 160)).toBe(true);  // 唯一尘型
    // 锚点=出生心 1600（首子步 AI 先于位移记录）;束沿 +x 展开 ≤ 404px（101 子步 ×4px）。
    // 首步第二层回拖 −v×0.25=−1px → min=锚−1（Spawn_UFOLaser 双层 :1958-1961）
    const xs = dusts.map((d) => d.x);
    expect(Math.min(...xs)).toBeCloseTo(1599, 5);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1600 + 404 + 1);
    expect(Math.max(...xs)).toBeGreaterThan(1600 + 300);        // 束达对端（非原地团）
    expect(dusts.every((d) => Math.abs(d.y - 800) <= 0.51)).toBe(true);   // 精确位（无 +4 抖）
    // 双色逐尘掷（LimeGreen/CornflowerBlue 混布,204 采样双色必现）
    expect(dusts.every((d) => isBeamColor(d.color))).toBe(true);
    const limeN = dusts.filter((d) => d.color?.g === 205).length;
    expect(limeN).toBeGreaterThan(10);
    expect(dusts.length - limeN).toBeGreaterThan(10);
    // 尺寸带（scale 直写勘正后 = 原版 rand(70..110)×0.013 精确带）+ 尘速 ×0.2（±2→±0.4）
    expect(dusts.every((d) => d.scale >= 0.909 && d.scale <= 1.431)).toBe(true);
    expect(dusts.every((d) => Math.abs(d.vx) <= 0.4 && Math.abs(d.vy) <= 0.4)).toBe(true);
    // 广播（联机上行镜像）：type 39、锚=出生心、UniqueInfo=|v|×1000=4000
    expect(rec.broadcast).toHaveLength(1);
    const bc = rec.broadcast[0]!;
    expect(bc.type).toBe(ParticleOrchestraType.UFOLaser);
    expect(bc.info).toBe(4000);
    expect(bc.mx).toBeCloseTo(1600, 5);
    expect(bc.my).toBeCloseTo(800, 5);
  });

  it('撞块铺束：墙体前消亡,束段=锚→撞点（HandleMovement 消亡同达 killNow）', () => {
    const { hooks, store, rec } = mkGame();
    for (let y = 40; y <= 60; y++) {                            // 竖墙 @tile x=110（px 1760）
      store.type[store.idx(110, y)] = 1;
      store.flags[store.idx(110, y)] = 1;
    }
    const b = mk433(1600, 800, 4, 0);                           // 1600 → 墙 1760 ≈ 160px
    for (let t = 0; t < 3 && !b.dead; t++) b.fixedUpdate(1 / 60, hooks);
    expect(b.dead).toBe(true);
    const xs = d160(rec).map((d) => d.x);
    expect(xs.length).toBeGreaterThanOrEqual(60);               // ~160px/4 ×2 层
    expect(Math.max(...xs)).toBeLessThan(1764);                 // 束不穿墙
    expect(Math.min(...xs)).toBeCloseTo(1599, 5);               // 锚−1（首步回拖层）
  });

  it('命中铺束：敌接伤害（伤害链不动）+ 束至命中点（pierce 1 单发）', () => {
    const e = mkEnemy(1, 1700, 800);                            // 盒 (1690..1710, 780..820)
    const { hooks, rec } = mkGame([e]);
    const b = mk433(1600, 800, 4, 0);
    for (let t = 0; t < 3 && !b.dead; t++) b.fixedUpdate(1 / 60, hooks);
    expect(b.dead).toBe(true);
    expect(e.hits.length).toBeGreaterThanOrEqual(1);            // 用户实报「能打」面保持
    expect(e.hits[0]).toBeGreaterThanOrEqual(1);
    expect(d160(rec).length).toBeGreaterThanOrEqual(40);        // ~90px 束
    expect(rec.dusts.every((d) => d.type === 160)).toBe(true);
  });
});

// ============================================================
// ④ 全链 e2e：Xeno 法杖 2749 → UFO 423 射出 433（whipTag 面）→ 铺束
// ============================================================
describe('④ e2e：423 UFO 射出带鞭 tag 的 433 → 死亡铺束', () => {
  it('400px 内可视敌 → 首拍射出 Arrow 433（whipTagShot=true）→ 消亡铺束', () => {
    const e = mkEnemy(1, 30 * 16 + 200, 20 * 16);               // 玩家东侧 200px（<400 门,LOS 通）
    const { hooks, rec, player } = mkGame([e]);
    const m = new MinionProj(player.cx, player.cy, 423, 36, 1, false, 0, false, () => player);
    m.id = 1;
    m.x = player.cx - m.w / 2; m.y = player.cy - m.h / 2;
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(m);
    let shot: Arrow | null = null;
    for (let t = 0; t < 10 && !shot; t++) {
      m.fixedUpdate(1, hooks);
      shot = rec.added.find((a): a is Arrow => a instanceof Arrow && (a as Arrow).projId === 433) ?? null;
    }
    expect(shot).not.toBeNull();                                // 出弹（旧无攻击特效实报面）
    expect(shot!.whipTagShot).toBe(true);                       // MinionShot 鞭 tag（ProjectileID.cs:291）
    expect(shot!.alpha).toBe(255);                              // 本体恒隐
    for (let t = 0; t < 3 && !shot!.dead; t++) shot!.fixedUpdate(1 / 60, hooks);
    expect(shot!.dead).toBe(true);
    expect(d160(rec).length).toBeGreaterThanOrEqual(20);        // 命中/寿命尽 → 束尘落地
    expect(rec.dusts.every((d) => d.type === 160)).toBe(true);
  });
});

// ============================================================
// ⑤ 尘 160/162 update 分支（VanillaDust 1:1,旧落 default 恰红）
// ============================================================
describe('⑤ d160/162 update：青/橙光 + 自管衰减漂移（Dust.cs:1269-1302）', () => {
  it('d160 缺省档：cyan 光 (0.1,1,1)×min(1,1.3×scale) + scale −0.11/t（旧 −0.01 慢衰恰红）', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 160)!;
    d.scale = 1; d.vx = 0; d.vy = 0;                            // 排除 spawn 抖动,钉初值
    vd.update(0, 0, 1000, 1000);
    expect(d.scale).toBeCloseTo(1 - 0.1 - 0.01, 10);            // 本支 −0.1 + 公共老化 −0.01
    expect(Math.abs(d.vy)).toBeLessThanOrEqual(0.2);            // 漂移 ±0.2,无重力 +0.1（旧恰红）
    expect(Math.abs(d.vx)).toBeLessThanOrEqual(0.2);
    const l = vd.lights.find((x) => x.x === d.x && x.y === d.y);
    expect(l).toBeDefined();                                    // 旧 default 无光恰红
    expect(l!.r).toBeCloseTo(0.1, 6);
    expect(l!.g).toBeCloseTo(1, 6);
    expect(l!.b).toBeCloseTo(1, 6);
  });

  it('d160 noGravity 档：×0.8 阻尼 + ±0.8 漂移 + 净 −0.15/t（含链 B 兜底 −0.04）', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 160)!;
    d.noGravity = true;                                         // spawn 第 12 参是 opts 非 noGravity（Game.spawnDust 包装位）
    d.scale = 1; d.vx = 1; d.vy = 1;
    vd.update(0, 0, 1000, 1000);
    expect(d.scale).toBeCloseTo(1 - 0.1 - 0.01 - 0.04, 10);     // + 链 B 兜底 noGravity −0.04
    expect(d.vx).toBeLessThanOrEqual(0.8 * 1 + 0.8 + 1e-9);     // ×0.8 + ±0.8 漂移
    expect(d.vx).toBeGreaterThanOrEqual(0.8 * 1 - 0.8 - 1e-9);
  });

  it('d162：橙光 (1,0.7,0.1)（HeatRay 束尘,同分支异色档）', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 162)!;
    d.scale = 1;
    vd.update(0, 0, 1000, 1000);
    const l = vd.lights.find((x) => x.x === d.x && x.y === d.y);
    expect(l).toBeDefined();
    expect(l!.r).toBeCloseTo(1, 6);
    expect(l!.g).toBeCloseTo(0.7, 6);
    expect(l!.b).toBeCloseTo(0.1, 6);
  });

  it('d160 光带 scale 门：scale 0.5 → num70=0.65（min(1,1.3×scale) 非恒 1）', () => {
    const vd = new VanillaDust();
    vd.update(0, 0, 1000, 1000);
    const d = vd.spawn(500, 500, 1, 1, 160)!;
    d.scale = 0.5;
    vd.update(0, 0, 1000, 1000);
    const l = vd.lights.find((x) => x.x === d.x && x.y === d.y);
    expect(l!.g).toBeCloseTo(Math.min(1, 0.5 * 1.3), 6);
  });
});
