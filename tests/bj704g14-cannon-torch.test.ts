// ★BJ704-G14（2026-10-21）件1 [g11-cannon-torch-fire] 兔炮火把手工点火清偿 +
//   件1 附带（devices band2 彩带勘误 / 178 载体 / Damage damage<=0 头门 / G11 落定
//   碰撞门附带回归修复）判别锁。
//  原版链（1457 亲读）：
//   · PlaceThing_CannonBall（Player.cs:42115-42127）：ItemID.Sets.Torches ∧ Simple
//     射程（TB=tileBoost+blockRange）→ 目标 active∧type 209∧frameX/72<3（band
//     0 大炮/1 兔兔炮/2 彩带炮;3/4 传送门炮不入）→ ShootFromCannon。
//   · Player.ShootFromCannon（:42347-42391）：cannonCooldown≤0 → 兔炮容量门
//     （num==2&&!BunnyCannonCanFire）→ cursorItemIconEnabled（ToolCursorIcon 既有）
//     → 发射门 ItemTimeIsZero∧itemAnimation>0∧controlUseItem → 锚点回算（列/行
//     取模）→ cannonCooldown=20 → damage 300/350/0 → WorldGen.ShootFromCannon。
//   · WorldGen.ShootFromCannon（:51033-51148）：速度 14/初向表（仰角带 0-8）/
//     出膛 (ax+2)*16,(ay+2)*16;ammo1=162 炮弹/ammo2=281 兔/ammo3=178 彩带。
//   · 附带①devices.ts band2 旧落 'portalbolt'=整型错配（Wiring.cs 走同一条
//     WorldGen.ShootFromCannon,ammo3=178）→ 同刀对齐 'confetti'。
//   · 附带②178 载体（SetDefaults :2643-2651）：10×10 aiStyle1 直线/α255/
//     timeLeft 2;friendly·hostile 双 false → Damage_PVE :12576 / Damage_EVP
//     :14847 双 damage<=0 头门=敌我两判定整段不进;Kill :76062-76085=85×彩带尘
//     （Game.onProjectileDeath 178 支既有）。
//   · 附带③G11 落定支碰撞门（域回归 cannon-projectiles 定谳）：原版 281 块在
//     `if (flag)`（:18015——TileCollision 实际发生）门内=碰撞拍专属;旧无门=
//     空中缓速兔（竖直上抛过顶点/静止出生）误落定。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Game } from '../src/core/Game';
import { TrapShot } from '../src/entities/Dart';
import { Wiring } from '../src/world/Wiring';
import { World } from '../src/world/World';
import { deviceTable, type DeviceCtx } from '../src/world/wiring/devices';
import { TILE_BY_KEY } from '../src/data/tiles';

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const gameSrc = () => read('src/core/Game.ts');
const dartSrc = () => read('src/entities/Dart.ts');
const devicesSrc = () => read('src/world/wiring/devices.ts');

const CANNON_T = TILE_BY_KEY['v_209_cannon']!;

/** 放置一座 4×3 大炮：frameX = style*72 + col*18，frameY = angle*54 + row*18 */
function placeCannon(st: import('../src/world/Wiring').Wiring['st'] | World['store'],
  ox: number, oy: number, style: number, angle: number) {
  for (let cx = 0; cx < 4; cx++) {
    for (let cy = 0; cy < 3; cy++) {
      st.setTileSilent(ox + cx, oy + cy, CANNON_T, style * 72 + cx * 18, angle * 54 + cy * 18);
    }
  }
}

/** Game 原型桩（Object.create 惯例）——只注入 tryTorchFireCannon 消费面字段 */
function stubGame(w: World) {
  const spawned: TrapShot[] = [];
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  g.world = w;
  g.wiring = new Wiring(w.store);
  g.player = { useTime: 0 };
  g.swing = { t: 5 };
  g.cannonTorchCooldown = 0;
  g.entities = {
    add: (e: TrapShot) => { spawned.push(e); },
    projectiles: [] as unknown[],
    critters: [] as unknown[],
  };
  const fire = (tx: number, ty: number) =>
    (Game.prototype as unknown as { tryTorchFireCannon: (tx: number, ty: number, vid: number) => boolean })
      .tryTorchFireCannon.call(g, tx, ty, 8);
  return { g, spawned, fire };
}

function freshWorld() {
  const w = new World(60, 60, 7, 'open');
  return w;
}

// ================================================================ §0 源锚/结构锁
describe('§0 源锚（分派位 / 发射门 / 冷却 / devices band2 / 178 载体）', () => {
  it('[A] Game.ts updateUse 分派位：PlaceThing 序（油漆三件套后）+ TORCH_ITEMS 门 + 射程', () => {
    const s = gameSrc();
    expect(s).toContain('this.tryUsePaintTool(tx, ty, heldDef);');
    const iPaint = s.indexOf('this.tryUsePaintTool(tx, ty, heldDef);');
    const iCannon = s.indexOf('this.tryTorchFireCannon(tx, ty, heldDef.vid ?? -1);');
    expect(iCannon).toBeGreaterThan(iPaint);   // 分派序：PaintScraper → CannonBall（:39899-39900）
    expect(s).toContain('TORCH_ITEMS.has(heldDef.vid ?? -1)');
    expect(s).toMatch(/inTileRange\(tx, ty, tileBoostOfVid\(heldDef\.vid \?\? -1\)\)/);
  });
  it('[B] 发射门四件套：冷却 20 / band<3 / 兔炮容量 / useTime+swing 双门', () => {
    const s = gameSrc();
    expect(s).toContain('if (this.cannonTorchCooldown > 0) return false;');
    expect(s).toContain('if (band >= 3) return false;');
    expect(s).toContain("if (ammo === 2 && this.countTrapProjectiles('bunny', 0, 0, Infinity) >= 4) return false;");
    expect(s).toContain('if (this.player.useTime !== 0) return false;');
    expect(s).toContain('if (!this.swing || this.swing.t <= 0) return false;');
    expect(s).toContain('this.cannonTorchCooldown = 20;');
    expect(s).toMatch(/const damage = ammo === 1 \? 300 : ammo === 2 \? 350 : 0;/);
  });
  it('[C] 冷却递减位（ItemCheck :43922-43925 方法体级——G21 迁 updateUse 头,旧「swing 在途门」系伪锚）+ wiring ctx 复用抽方法', () => {
    const s = gameSrc();
    expect(s).toContain('if (this.cannonTorchCooldown > 0) this.cannonTorchCooldown--;');
    expect(s).toContain('countTrapProjectiles(kind, px, py, radius)');
  });
  it('[D] devices.ts band2 彩带勘误（Wiring.cs 同走 ShootFromCannon ammo3=178）', () => {
    expect(devicesSrc()).toContain("num36 === 2 ? 'confetti' : 'portalbolt'");
  });
  it('[E] Dart.ts 178 载体：style 表项 + 死亡 FX 路由 + damage<=0 双头门 + 落定碰撞门', () => {
    const s = dartSrc();
    expect(s).toContain("confetti: { w: 10, h: 10, color: '#F0F0F0', grav: 0, proj: 'vanilla/Projectile_178.png'");
    expect(s).toContain('onProjectileDeath?.(178, this.x, this.y, this.w, this.h, this.vx, this.vy, this.damage)');
    expect(s).toMatch(/if \(this\.damage > 0\s*\n\s*&& projOverlap/);          // Damage_EVP :14847
    expect(s).toContain('if (this.damage <= 0) return;');                       // Damage_PVE :12576
    expect(s).toContain('if ((hitX2 || hitY2) && Math.abs(this.vx) + Math.abs(this.vy) < 2) {');  // :18015 if(flag) 门
  });
});

// ================================================================ §1 手工点火行为面
describe('§1 tryTorchFireCannon（Player.ShootFromCannon 1:1）', () => {
  it('[A] band0 大炮：cannonball 300 / 出膛 (ax+2)*16 / 角度带 0 → (14,0) / 冷却 20', () => {
    const w = freshWorld();
    placeCannon(w.store, 10, 20, 0, 0);
    const { g, spawned, fire } = stubGame(w);
    expect(fire(11, 21)).toBe(true);          // 命中待发列（块内列 1）
    expect(spawned).toHaveLength(1);
    const s = spawned[0]!;
    expect(s.kind).toBe('cannonball');
    expect(s.damage).toBe(300);               // :42383
    expect(s.x).toBe((10 + 2) * 16);          // :51112 出膛位
    expect(s.y).toBe((20 + 2) * 16);
    expect(s.vx).toBeCloseTo(14, 6);          // :51035 num=14f 归一
    expect(s.vy).toBeCloseTo(0, 6);
    expect((g as unknown as { cannonTorchCooldown: number }).cannonTorchCooldown).toBe(20);   // :42379
  });
  it('[B] 冷却窗内二连发拒绝（cannonCooldown>0 :42349-42352）', () => {
    const w = freshWorld();
    placeCannon(w.store, 10, 20, 0, 0);
    const { g, spawned, fire } = stubGame(w);
    expect(fire(11, 21)).toBe(true);
    expect(fire(11, 21)).toBe(false);         // 20t 窗内
    expect(spawned).toHaveLength(1);
    (g as unknown as { cannonTorchCooldown: number }).cannonTorchCooldown = 0;
    expect(fire(11, 21)).toBe(true);          // 窗清后再发
    expect(spawned).toHaveLength(2);
  });
  it('[C] band1 兔兔炮：bunny 350 + BunnyCannonCanFire ≥4 拒发（:42357/:51125）', () => {
    const w = freshWorld();
    placeCannon(w.store, 10, 20, 1, 0);
    const { g, spawned, fire } = stubGame(w);
    expect(fire(11, 21)).toBe(true);
    expect(spawned[0]!.kind).toBe('bunny');
    expect(spawned[0]!.damage).toBe(350);     // :42387
    // 场上 4 只（弹 281+NPC614 合计）→ 拒发（WorldGen.cs:51150-51191 ≥4）
    const g2 = (g as unknown as { entities: { projectiles: unknown[] } });
    for (let i = 0; i < 4; i++) g2.entities.projectiles.push(new TrapShot(0, 0, 1, 0, 350, 'bunny'));
    expect(fire(11, 21)).toBe(false);
  });
  it('[D] band2 彩带炮：confetti damage 0（ammo3 → type 178,:51043-51046）', () => {
    const w = freshWorld();
    placeCannon(w.store, 10, 20, 2, 0);
    const { spawned, fire } = stubGame(w);
    expect(fire(11, 21)).toBe(true);
    expect(spawned[0]!.kind).toBe('confetti');
    expect(spawned[0]!.damage).toBe(0);       // :42380-42388 else 0
  });
  it('[E] band3 传送门炮：band<3 门拒（:42122——右键链专属,本支不入）', () => {
    const w = freshWorld();
    placeCannon(w.store, 10, 20, 3, 0);
    const { spawned, fire } = stubGame(w);
    expect(fire(11, 21)).toBe(false);
    expect(spawned).toHaveLength(0);
  });
  it('[F] 发射门：useTime≠0 / swing 缺位 / swing 归零 → 不发（:42362 三合门）', () => {
    const w = freshWorld();
    placeCannon(w.store, 10, 20, 0, 0);
    const { g, spawned, fire } = stubGame(w);
    (g as unknown as { player: { useTime: number } }).player.useTime = 5;
    expect(fire(11, 21)).toBe(false);
    (g as unknown as { player: { useTime: number } }).player.useTime = 0;
    (g as unknown as { swing: unknown }).swing = null;
    expect(fire(11, 21)).toBe(false);
    (g as unknown as { swing: { t: number } }).swing = { t: 0 };
    expect(fire(11, 21)).toBe(false);
    (g as unknown as { swing: { t: number } }).swing = { t: 1 };
    expect(fire(11, 21)).toBe(true);          // 使用在途（itemAnimation>0 同拍）
    expect(spawned).toHaveLength(1);
  });
  it('[G] 仰角带 4 → (0,−14)（:51087-51091 angle 表）+ 任意块内格锚点回算同出膛位', () => {
    const w = freshWorld();
    placeCannon(w.store, 10, 20, 0, 4);
    const { spawned, fire } = stubGame(w);
    expect(fire(13, 22)).toBe(true);          // 块内列 3 行 2 → 锚点回算同炮
    expect(spawned[0]!.vx).toBeCloseTo(0, 6);
    expect(spawned[0]!.vy).toBeCloseTo(-14, 6);
    expect(spawned[0]!.x).toBe((10 + 2) * 16);
    expect(spawned[0]!.y).toBe((20 + 2) * 16);
  });
  it('[H] 非 209 格 / 空格 → 不发（:42122 active∧type 门）', () => {
    const w = freshWorld();
    const { spawned, fire } = stubGame(w);
    expect(fire(11, 21)).toBe(false);         // 空世界无炮
    expect(spawned).toHaveLength(0);
  });
});

// ================================================================ §2 devices band2 + 178 载体行为
describe('§2 devices 导线 band2 与 178 载体', () => {
  const makeCtx = () => {
    const shots: Array<{ px: number; py: number; vx: number; vy: number; damage: number; kind: string; form: number }> = [];
    const ctx: DeviceCtx = {
      dropItem: () => {}, spawnNpc: () => true, mechSpawnOk: () => true, itemSpawnOk: () => true,
      shootProjectile: (px, py, vx, vy, damage, kind, form = 0) => shots.push({ px, py, vx, vy, damage, kind, form }),
      countProjectiles: () => 0,
      doorOpen: () => true, doorClose: () => true, teleportPair: () => {},
      relocateTownNpc: () => true, explode: () => {}, toast: () => {}, sfx: () => {},
      extractinatorPull: () => null, dropItemStack: () => {},
      worldSurface: 100,
    };
    return { ctx, shots };
  };
  it('[A] 导线 band2：confetti / damage 0 / 速度 14（Wiring.cs:1237-1346 → ShootFromCannon）', () => {
    const w = new World(60, 60, 7, 'open');
    const wiring = new Wiring(w.store);
    const { ctx, shots } = makeCtx();
    placeCannon(wiring.st, 10, 20, 2, 0);
    expect(deviceTable(wiring, ctx, 209, 11, 21)).toBe(true);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.kind).toBe('confetti');
    expect(shots[0]!.damage).toBe(0);
    expect(shots[0]!.vx).toBeCloseTo(14, 6);
  });
  it('[B] 178 载体：2 拍寿终 → onProjectileDeath(178)（:76062 彩带尘分发）', () => {
    const calls: number[] = [];
    const world = new World(40, 40, 7, 'open');
    const hits: number[] = [];
    const game = {
      world,
      player: { x: -500, y: -500, w: 20, h: 20, dead: true, cx: -490, damage: (d: number) => hits.push(d) },
      enemies: () => [{ x: 0, y: 0, w: 20, h: 20, dead: false, hurt: (d: number) => { hits.push(d); return true; } }],
      critters: () => [], npcs: () => [],
      onProjectileDeath: (id: number) => { calls.push(id); },
      spawnDust: () => null, spawnParticles: () => {}, playSfx: () => {}, playSfxFiles: () => {},
      spawnDrop: () => null, addDamageNumber: () => {}, onEnemyKilled: () => {},
      notifyInventoryChanged: () => {}, showPickupLabel: () => {},
    } as never;
    const p = new TrapShot(0, 0, 5, 0, 0, 'confetti');
    expect(p.life).toBe(2);                       // SetDefaults timeLeft=2（:2648）
    p.fixedUpdate(1, game);
    expect(p.dead).toBe(false);
    expect(calls).toHaveLength(0);
    p.fixedUpdate(1, game);
    expect(p.dead).toBe(true);                    // 2 拍寿终（:17307-17311）
    expect(calls).toEqual([178]);                 // Kill 分发 178（Game 85×彩带尘支）
    expect(hits).toHaveLength(0);                 // damage=0：敌/玩家两判定整段不进（:12576/:14847）
  });
  it('[C] damage<=0 头门不吞割草（friendly 0 伤弹 cutTiles 先行 :12516-12523）', () => {
    // 烟花盒 415-418（friendly damage 0）——割草面保持（结构锁的守卫锚）
    const s = dartSrc();
    const iCut = s.indexOf('if (!this.hostile) cutTilesBox(game, this.x, this.y, this.w, this.h);');
    const iZero = s.indexOf('if (this.damage <= 0) return;');
    expect(iCut).toBeGreaterThan(-1);
    expect(iZero).toBeGreaterThan(iCut);          // return 在割草之后
  });
});
