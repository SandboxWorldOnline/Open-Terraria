// ★BJ704-G11（2026-10-21）件2 兔炮 1338 弹药面+活兔链——四判语+两刀：
//  ① 兔炮武器本体【已实装】（item 1337 vanilla.json createTile=209 + 导线 devices
//    case 209 band1 射 TrapShot 'bunny' 350 伤/480 冷却/上限 4 + 右键瞄准 Game.ts
//    sh===209）——手工火把点火（PlaceThing_CannonBall Player.cs:42112-42126 →
//    Player.ShootFromCannon :42347-42389,20t 冷却）未实装=登记 [g11-cannon-torch-fire]。
//  ② 1338 手持使用 = makeNPC==614 特支（ItemCheck_ReleaseCritter Player.cs:44400-
//    44405）在【玩家位】直放（Center.X/Bottom.Y,无鼠标格/射程/实心门,Style=placeStyle
//    0 → ReleaseNPC case 614 方向=player.direction,useTime 20 Item.cs:16574-75）
//    ——「活兔投掷支」（物品面投 281）在 vanilla 不存在=销案;仓旧走鼠标格通用支
//    =非 1:1 → Game.ts 小刀（玩家位特支）。281 弹体（TrapShot 'bunny'=导线兔炮活兔
//    态）撞块响应小刀：反弹 ×−0.5 / 缓速落定 ReleaseNPC(614)（:18942-18970）+
//    ai0==3 出膛 poof（:28695-28740）+ 前 2 拍隐身（:28688-26890 α255→0）。
//  ③ 281 尸态 ai0==-1：Projectile.cs 全卷 ai[0]=-1f 写位均在【他型】AI（DisplayDoll
//    127/596/631/659、AI_009 type34、AI_171 1039、AI_169 864）——281 无写位=死分支
//    销案不移植;:23545 = AI_DisplayDoll 的 281 模拟段（展示人偶弹幕模拟域,仓内
//    DisplayDoll.ts 渲染壳无弹幕模拟）=域外登记。
//  ④ ai1=owner+1 玩家可炸面（:14873-77 Damage_EVP）:活兔 friendly 不伤玩家（头门
//    !hostile 早退）=仓内 TrapShot friendly 同相零修;爆弹形态（ai0=-2 置 hostile）
//    已随 BJ704-R3 刀5 落（bunnyOwner 门）。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TrapShot } from '../src/entities/Dart';
import { World } from '../src/world/World';
import { TILE_BY_KEY } from '../src/data/tiles';
import { TILE } from '../src/core/constants';

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const gameSrc = () => read('src/core/Game.ts');
const dartSrc = () => read('src/entities/Dart.ts');

const STONE = TILE_BY_KEY['v_1_stone'] ?? 1;

/** 世界（实心地板 y=floorTy）+ 全录制 hooks（spawnNpcByVanilla/尘/音/粒） */
function bunnyWorld(floorTy = 100, solid = true) {
  const w = new World(80, 140, 42, 'open');
  w.groundLevel = 42;
  const st = w.store;
  if (solid) for (let x = 10; x <= 70; x++) st.setTileSilent(x, floorTy, STONE, 0, 0);
  const rec = {
    npcSpawns: [] as Array<{ id: number; x: number; y: number }>,
    dusts: [] as Array<{ type: number; scale: number }>,
    sfx: [] as string[], spawned: [] as unknown[],
  };
  const spawnedFake = { releasedFromItem: false, spawnedFromStatue: false, facing: 0 };
  const hooks = {
    world: w,
    player: { x: -500, y: -500, w: 20, h: 42, cx: -490, cy: -479, dead: true, luck: 0 } as never,
    spawnNpcByVanilla: (id: number, x: number, y: number) => {
      rec.npcSpawns.push({ id, x, y });
      return spawnedFake;
    },
    spawnDust: (_x: number, _y: number, _w: number, _h: number, type: number,
      _vx: number, _vy: number, _a: number, _c: unknown, scale: number) => {
      rec.dusts.push({ type, scale: scale ?? 1 });
      return { vx: 0, vy: 0, x: 0, y: 0, alpha: 0, scale: 1, noGravity: false, fadeIn: 0 };
    },
    playSfx: (n: string) => { rec.sfx.push(n); },
    playSfxFiles: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, onEnemyKilled: () => {},
    spawnDrop: () => null, damagePlayer: (): number => 0, spawnEnemy: () => {},
    notifyInventoryChanged: () => {}, showPickupLabel: () => {},
    enemies: () => [], critters: () => [], npcs: () => [],
    entities: { add: (e: unknown) => { rec.spawned.push(e); }, projectiles: [] as unknown[] },
  } as never;
  return { w, hooks, rec, spawnedFake };
}

// ================================================================ §0 源锚/结构锁
describe('§0 源锚（1338 特支 / 撞块响应 / 兔炮上限计数）', () => {
  it('[A] Game.ts 1338 玩家位特支（:44400-44405）+ useTime 20', () => {
    const s = gameSrc();
    expect(s).toContain('if (relItemId === 1338) {');
    expect(s).toMatch(/spawnNpcByVanilla\(614, p614\.cx, p614\.y \+ p614\.h, undefined, true\)/);
    expect(s).toContain('p614.useTime = 20;');
  });
  it('[B] Dart.ts 281 撞块响应（反弹/落定）+ poof + 隐身窗 + 中心格爆整支跳过', () => {
    const s = dartSrc();
    expect(s).toContain('const style614 = (this.vx > 0 ? 1 : 2) + 2;');
    expect(s).toContain('this.bunnyLanded = true;');
    expect(s).toContain('if (hitX2) this.vx = -lvx2 * 0.5;');
    expect(s).toContain("if (this.kind === 'bunny' && this.age === 3) {");
    expect(s).toContain("if (this.kind === 'bunny' && this.age < 3) return;");
    expect(s).toContain("if (this.kind !== 'bunny' && game.world.store.isSolid(tx, ty))");
  });
  it('[C] 兔炮上限计数含 NPC614（BunnyCannonCanFire :51150-51192）', () => {
    const s = gameSrc();
    expect(s).toMatch(/if \(kind === 'bunny'\) \{[\s\S]{0,260}vanillaId === 614/);
  });
  it('[D] 281 ai0==-1 死分支/DisplayDoll 模拟段不移植（判语入档）', () => {
    // 无对应仓内面——判语锚：dartSrc 不含 ai0==-1 尸态支（rotation=0/vx×0.95/vy+=0.2）
    expect(dartSrc()).not.toContain('this.vx * 0.95;                    // ai0==-1');
    expect(read('src/render/DisplayDoll.ts')).not.toContain('281');
  });
});

// ================================================================ §1 撞块响应（:18942-18970）
describe('§1 281 活兔撞块：反弹 ×−0.5 / 缓速落定 ReleaseNPC(614)', () => {
  it('[A] 斜落快弹（vx=10,vy=10）撞地板 → 不爆不灭、vy=−last×0.5、位置贴外', () => {
    const { hooks, rec } = bunnyWorld(100);
    const b = new TrapShot(40 * TILE, 100 * TILE - 29, 10, 10, 350, 'bunny');
    const y0 = b.y;
    b.fixedUpdate(1 / 60, hooks);
    expect(b.dead).toBe(false);                          // 旧仓=撞块即 blastKill → 必红
    expect(rec.npcSpawns).toHaveLength(0);
    expect(b.vy).toBeCloseTo(-5, 6);                     // −lastVy×0.5
    expect(b.vx).toBe(10);                               // X 未撞不动
    expect(b.y).toBeLessThan(y0 + 10 + 0.01);            // 位移被取消（未嵌墙）
    // 唯一 'explosion'=age1 出膛 Item14（launchSfx,soundDelay==0 :28659-28663）
    expect(rec.sfx.filter((n) => n === 'explosion')).toHaveLength(1);
  });
  it('[B] 缓速落定（vx=0,vy=1.5）→ ReleaseNPC(614, Center.X, Bottom.Y−4, Style 左）+ 雕像旗', () => {
    const { hooks, rec, spawnedFake } = bunnyWorld(100);
    const b = new TrapShot(40 * TILE, 100 * TILE - 29, 0, 1.5, 350, 'bunny');
    b.fixedUpdate(1 / 60, hooks);
    expect(rec.npcSpawns).toHaveLength(1);
    const sp = rec.npcSpawns[0];
    expect(sp.id).toBe(614);
    expect(sp.x).toBe(Math.trunc(b.cx));                 // (int)Center.X
    expect(sp.y).toBe(Math.trunc(b.y + b.h) - 4);        // (int)Bottom.Y − 4
    // Style=(vx>0?1:2)+2 —— vy 撞后清 0、vx=0 → 4 → 方向强制左 + 雕像旗（:80957-77）
    expect(spawnedFake.spawnedFromStatue).toBe(true);
    expect(spawnedFake.releasedFromItem).toBe(true);
    expect(spawnedFake.facing).toBe(-1);
    expect((b as unknown as { bunnyLanded: boolean }).bunnyLanded).toBe(true);
    // 落定拍存活（接触结算照跑）,次拍头静默灭（AI_049 ai0=-3 → Kill 零 FX）
    expect(b.dead).toBe(false);
    expect(rec.sfx.filter((n) => n === 'explosion')).toHaveLength(1);   // 仅出膛音
    b.fixedUpdate(1 / 60, hooks);
    expect(b.dead).toBe(true);
    expect(rec.sfx.filter((n) => n === 'explosion')).toHaveLength(1);   // 静默灭非爆
  });
  it('[C] Style 分派：地板斜落（X 未撞,vx=1.5>0）→ 3 右;横撞墙（X 撞清 0）→ 4 左', () => {
    // 竖墙 x=50：弹从左飞向墙
    const w = new World(80, 140, 42, 'open');
    w.groundLevel = 42;
    for (let y = 90; y <= 110; y++) w.store.setTileSilent(50, y, STONE, 0, 0);
    const rec = { npcSpawns: [] as Array<{ id: number; x: number; y: number }>, sfx: [] as string[] };
    const fake = { releasedFromItem: false, spawnedFromStatue: false, facing: 0 };
    const hooks = {
      world: w,
      player: { dead: true, cx: -999, cy: -999 } as never,
      spawnNpcByVanilla: (id: number, x: number, y: number) => { rec.npcSpawns.push({ id, x, y }); return fake; },
      spawnDust: () => null, playSfx: (n: string) => { rec.sfx.push(n); }, playSfxFiles: () => {},
      spawnParticles: () => {}, addDamageNumber: () => {}, onEnemyKilled: () => {},
      spawnDrop: () => null, damagePlayer: (): number => 0, spawnEnemy: () => {},
      notifyInventoryChanged: () => {}, showPickupLabel: () => {},
      enemies: () => [], critters: () => [], npcs: () => [],
      entities: { add: () => {}, projectiles: [] as unknown[] },
    } as never;
    // ① 地板斜落（vx=1.5,vy=1.5）：Y 撞清 0、X 未撞 vx 保留 → (1.5>0)→Style 3→右
    const { hooks: hFloor, rec: rFloor, spawnedFake: fFloor } = bunnyWorld(100);
    const bf = new TrapShot(40 * TILE, 100 * TILE - 29, 1.5, 1.5, 350, 'bunny');
    bf.fixedUpdate(1 / 60, hFloor);
    expect(rFloor.npcSpawns).toHaveLength(1);
    expect(fFloor.facing).toBe(1);                       // Style 3 → 方向右
    expect(fFloor.spawnedFromStatue).toBe(true);
    // ② 横撞墙（vx=1.5,vy=0）：X 撞清 0 → (0>0 假)→Style 4→左（原版碰后速度读法）
    const b = new TrapShot(50 * TILE - 29, 100 * TILE, 1.5, 0, 350, 'bunny');
    b.fixedUpdate(1 / 60, hooks);
    expect(rec.npcSpawns).toHaveLength(1);
    expect(fake.facing).toBe(-1);                        // Style 4 → 方向左
    expect(fake.spawnedFromStatue).toBe(true);
  });
  it('[D] timeLeft 耗尽仍爆（Kill case 281 :77327-77384 保留面）', () => {
    const { hooks, rec } = bunnyWorld(100, false);       // 无地板=空中纯寿命
    const b = new TrapShot(40 * TILE, 100 * TILE, 0, 0, 350, 'bunny');
    (b as unknown as { life: number }).life = 1;
    b.fixedUpdate(1 / 60, hooks);
    expect(b.dead).toBe(true);
    expect(rec.sfx).toContain('explosion');              // blastKill（Item14 近似）
  });
});

// ================================================================ §2 出膛 poof + 隐身窗
describe('§2 ai0==3 poof（:28695-28740）+ 前 2 拍隐身（:28688-28690）', () => {
  it('[A] 第 3 拍恰 20 尘（10×d31 s1.5 + 10×d6（s2×5+s1×5））', () => {
    const { hooks, rec } = bunnyWorld(100, false);
    const b = new TrapShot(40 * TILE, 100 * TILE, 8, 0, 350, 'bunny');
    b.fixedUpdate(1 / 60, hooks);                        // age 1
    b.fixedUpdate(1 / 60, hooks);                        // age 2
    expect(rec.dusts).toHaveLength(0);
    b.fixedUpdate(1 / 60, hooks);                        // age 3 → poof
    const d31 = rec.dusts.filter((d) => d.type === 31);
    const d6 = rec.dusts.filter((d) => d.type === 6);
    expect(d31).toHaveLength(10);
    expect(d31.every((d) => d.scale === 1.5)).toBe(true);
    expect(d6).toHaveLength(10);
    expect(d6.filter((d) => d.scale === 2)).toHaveLength(5);   // noGravity 掷
    expect(d6.filter((d) => d.scale === 1)).toHaveLength(5);
  });
  it('[B] draw 前 2 拍跳画、第 3 拍起可见（α255→0）', () => {
    const { hooks } = bunnyWorld(100, false);
    const draws: number[] = [];
    const ctx = {
      save() {}, restore() {},
      translate() {}, rotate() {},
      set imageSmoothingEnabled(_: boolean) {},
      set globalAlpha(_: number) {},
      set fillStyle(_: string) {},
      fillRect() {},
      drawImage: () => { draws.push(1); },
    } as unknown as CanvasRenderingContext2D;
    const r = {
      ctx,
      atlas: { ensureVImage: () => ({ width: 28, height: 28 }), vimages: new Map() },
    } as never;
    const b = new TrapShot(40 * TILE, 100 * TILE, 8, 0, 350, 'bunny');
    b.draw(r, {} as never);
    expect(draws).toHaveLength(0);                       // age 0（出生拍）全隐
    b.fixedUpdate(1 / 60, hooks);
    b.draw(r, {} as never);
    expect(draws).toHaveLength(0);                       // age 1 隐
    b.fixedUpdate(1 / 60, hooks);
    b.draw(r, {} as never);
    expect(draws).toHaveLength(0);                       // age 2 隐
    b.fixedUpdate(1 / 60, hooks);
    b.draw(r, {} as never);
    expect(draws).toHaveLength(1);                       // age 3 起可见
  });
});
