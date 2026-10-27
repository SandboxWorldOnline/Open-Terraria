// ★BJ643（2026-10-11）：两型判别锁（BJ639 C 档批 3 锚）。
//  件1 1001 无头骑士南瓜弹（NPC 315 发射）：BJ639 定谳「本仓落 Dart 通用直线」——
//    原版 AI_194_HorsemanPumpkin（Projectile.cs:42031-42073）= 朝玩家 0.4/0.4
//    加速追踪（X 无死区钳 ±4、Y ±30 死区钳 ±5）+ rotation/spriteDirection 姿态
//    （:42055-42056）+ Opacity 渐显/淡出链（:42057-42064,getter/setter P.cs:542-548）
//    + 2/3 掷 d6 火尘（scale 0.6/fadeIn 1.1/noGravity/noLight,:42065-42072）+
//    timeLeft 360（SetDefaults :9519）/scale 1+Next(51)×0.01（:9518）。
//  件2 918 火鞭（Firecracker 4912 tag）proc 爆炸演出面：伤害面=WhipTag 96×96 单源
//    已接（★BJ449 两刀零改动）——缺=AI_178_FireExplosion（P.cs:46098-46148）出生
//    爆花：Item14 音 + 4×d31 + 30×2×d6 + 10×d6 + 10×d31 尘四组（位式
//    UnitY/UnitX×RotatedByRandom(π)×width/2）+ 2×gore 61-63（位覆写+速链
//    ×0.3+Next(-10,11)×0.05）;918 本体不可见（alpha=255 无绘制面）寿命 10t
//    （:46143-46147）——仓内伤害面折算即爆,观感等价。
//  ★夹具纪律（BJ514/BJ634/BJ639 判例防「夹具喂幻影」）：真 World + 真 Player +
//  真 Arrow fixedUpdate 驱动 + Math.random 钉死（掷率/位式全确定性）;玩家恒与弹
//  拉开距离防 hostile 接触杀干扰逐拍账。
//  ★变异证红（BJ606 习语）：M1 Y 死区摘除 / M2 X 钳 4→5 / M3 B1 烟速 ×3 摘 /
//    M4 gore 2→0（逐字节还原 + sha256 对拍,见套件尾变异块）。
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });   // ★残留普查波:变异自证三层守卫跨套件互斥下锁等待/内层 spawn 可超默认 5s——按仓内习语放宽（fx-codegen-parity 同款）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withMutation } from './mutation-guard';   // ★残留普查波:变异自证统一守卫（三层:文件互斥/panic 还原/残留自检）
import { Arrow } from '../src/entities/Arrow';
import { World } from '../src/world/World';
import { TileStore } from '../src/world/TileStore';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { projectileData } from '../src/data/vanillaProjectiles';
import { resolveWhipTagHit } from '../src/entities/WhipTag';
import { GorePiece } from '../src/entities/GorePiece';
import type { GameHooks } from '../src/entities/types';

const GAME = join(__dirname, '..');
const W = 400, H = 140, FLOOR = 120;
const px = (t: number): number => t * 16;

interface DustRec {
  x: number; y: number; w: number; h: number; type: number;
  vx: number; vy: number; scale: number; noGravity: boolean; alpha: number;
  fadeIn: number; noLight: boolean;
  color: { r: number; g: number; b: number; a: number } | null;
}
type DustSink = (x: number, y: number, dw: number, dh: number, type: number,
  sx?: number, sy?: number, alpha?: number, color?: DustRec['color'], scale?: number,
  noGravity?: boolean) => DustRec;

const mkDustSink = (dusts: DustRec[]): DustSink =>
  (x, y, dw, dh, type, sx = 0, sy = 0, alpha = 0, color = null, scale = 1, noGravity = false) => {
    const d: DustRec = { x, y, w: dw, h: dh, type, vx: sx + 0.3, vy: sy + 0.3, scale, noGravity, alpha, color, fadeIn: 0, noLight: false };
    dusts.push(d);
    return d;
  };

function makeWorld(): World {
  const w = new World(W, H, 7, 'bj643');
  const st = w.store;
  for (let x = 0; x < W; x++) { st.setTile(x, FLOOR, 1); st.setTile(x, FLOOR + 1, 1); }
  w.groundLevel = 120;
  return w;
}

/** 件1 专用 hooks：真 Player（可移动）+ 尘记录（NewDust ±2 内在抖动以 +0.3 模拟——
 *  让速度链 ×N 可判别） */
function makeHooks1001(dusts: DustRec[] = []): { hooks: GameHooks; player: Player; dusts: DustRec[] } {
  const w = makeWorld();
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const hooks = {
    world: w, player,
    enemies: () => [], critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, spawnParticles: () => {},
    notifyInventoryChanged: () => {}, playSfx: () => {}, playSfxFiles: () => {},
    showPickupLabel: () => {}, cutTile: () => {},
    dropContext: () => ({ zoneHallow: false, zoneCorrupt: false, zoneCrimson: false, zoneJungle: false, zoneSnow: false, zoneDesert: false, zoneDungeon: false, zoneBeach: false, bloodMoon: false, halloween: false, xmas: false, windy: false }),
    scene: { zoneHallow: false, zoneGraveyard: false },
    entities: { nextId: 1, add: () => {} },
    dusts: dusts as never,
    spawnDust: mkDustSink(dusts) as never,
    addLightAt: () => {},
  } as unknown as GameHooks;
  return { hooks, player, dusts };
}

const mkPumpkin = (hooks: GameHooks, x: number, y: number, vx = 0, vy = 0, life = 360): Arrow =>
  new Arrow(x, y, vx, vy, 40, 0, 1001, { grav: 0, life, pierce: 1, hostile: true });   // = shoot() 1001 出膛档（life 360=SetDefaults :9519）

const drive = (a: Arrow, hooks: GameHooks, ticks: number): void => {
  const upd = (a as unknown as { fixedUpdate: (dt: number, g: GameHooks) => void }).fixedUpdate;
  for (let t = 0; t < ticks; t++) upd.call(a, 1 / 60, hooks);
};

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

// ===========================================================================
// §1 数据面（vanilla-projectiles.json 亲读 = SetDefaults :9513-9521 / :8691-8703）
// ===========================================================================
describe('§1 数据面：1001/918 SetDefaults 终值', () => {
  it('1001 = aiStyle 194/26×26/timeLeft 360/hostile/穿墙/ignoreWater', () => {
    const d = projectileData(1001);
    expect(d?.aiStyle).toBe(194);
    expect(d?.width).toBe(26);
    expect(d?.height).toBe(26);
    expect(d?.timeLeft).toBe(360);
    expect(d?.hostile).toBe(true);
    expect(d?.tileCollide).toBe(false);
    expect(d?.ignoreWater).toBe(true);
  });
  it('918 = aiStyle 178/96×96/penetrate −1/localNPCHitCooldown −1/friendly/穿墙', () => {
    const d = projectileData(918);
    expect(d?.aiStyle).toBe(178);
    expect(d?.width).toBe(96);
    expect(d?.height).toBe(96);
    expect(d?.penetrate).toBe(-1);
    expect(d?.localNPCHitCooldown).toBe(-1);
    expect(d?.friendly).toBe(true);
    expect(d?.tileCollide).toBe(false);
    expect(d?.usesLocalNPCImmunity).toBe(true);
  });
  it('出生面：α=255（:9520）/drawScale ∈ {1.00..1.50} 离散档（:9518,rand=0.5→1.25）', () => {
    Math.random = () => 0.5;
    const { hooks } = makeHooks1001();
    const a = mkPumpkin(hooks, 1000, 1000);
    expect((a as unknown as { alpha: number }).alpha).toBe(255);
    expect((a as unknown as { drawScale: number }).drawScale).toBe(1.25);
  });
});

// ===========================================================================
// §2 1001 AI_194 追踪锁（:42043-42054）——真 Player fixedUpdate 逐拍
// ===========================================================================
describe('§2 1001 追踪（X 恒调 0.4 钳 ±4 / Y ±30 死区钳 ±5）', () => {
  it('X 加速：玩家正右 → vx 每拍 +0.4,至 4 钳住不越（:42054）', () => {
    Math.random = () => 0;                             // Next(3)==0 → 无尘干扰
    const { hooks, player } = makeHooks1001();
    player.x = px(60) + 500;                           // 玩家远右（500px,30 拍内不接触）
    const a = mkPumpkin(hooks, px(60), 90 * 16);
    drive(a, hooks, 1);
    expect(a.vx).toBeCloseTo(0.4, 12);
    drive(a, hooks, 8);                                // 累计 9 拍
    expect(a.vx).toBeCloseTo(3.6, 12);
    drive(a, hooks, 10);                               // 累计 19 拍（越 10 拍钳位）
    expect(a.vx).toBe(4);                              // 钳 ±4 恒值
  });
  it('Y 死区：|dy|=20 < 30 → vy 恒 0（X 仍调）；dy=30 恰入加速门/dy=29 不调（:42049-42053）', () => {
    Math.random = () => 0;
    const { hooks, player } = makeHooks1001();
    const a = mkPumpkin(hooks, px(60), 90 * 16);
    const aCy = (a as unknown as { cy: number }).cy;   // 弹心（=y+13,盒 26 中心语义 :42043 向量=心差）
    player.x = px(60) + 200;
    player.y = aCy + 20 - player.h / 2;                // 心差恰 +20（死区内）
    drive(a, hooks, 5);
    expect(a.vx).toBeCloseTo(2, 12);
    expect(a.vy).toBe(0);                              // 死区零调
    const { hooks: h2, player: p2 } = makeHooks1001();
    const b = mkPumpkin(h2, px(60), 90 * 16);
    p2.x = px(60) + 300; p2.y = (b as unknown as { cy: number }).cy + 30 - p2.h / 2;   // 心差恰 +30 → !(30<30)=true 入门
    drive(b, h2, 1);
    expect(b.vy).toBeCloseTo(0.4, 12);
    const { hooks: h3, player: p3 } = makeHooks1001();
    const c = mkPumpkin(h3, px(60), 90 * 16);
    p3.x = px(60) + 300; p3.y = (c as unknown as { cy: number }).cy + 29 - p3.h / 2;   // 心差 +29 → 死区
    drive(c, h3, 1);
    expect(c.vy).toBe(0);
  });
  it('Y 加速钳 ±5：玩家远下 → vy 爬至 5 恒值（:42052）', () => {
    Math.random = () => 0;
    const { hooks, player } = makeHooks1001();
    const a = mkPumpkin(hooks, px(60), 90 * 16);
    player.x = px(60);                                 // dx≈0（X 不调）
    player.y = (a as unknown as { cy: number }).cy + 600 - player.h / 2;   // 心差 +600 远下
    drive(a, hooks, 13);                               // 13×0.4=5.2 → 钳 5
    expect(a.vy).toBe(5);
  });
  it('目标失效（dead）：center 停本体 → 零向量恒零加速（:42038-42043 Sign(0)=0）', () => {
    Math.random = () => 0;
    const { hooks, player } = makeHooks1001();
    player.x = px(60) + 300; player.y = 90 * 16 + 300;
    player.dead = true;                                // !player.dead 门拒 → 向量零
    const a = mkPumpkin(hooks, px(60), 90 * 16);
    drive(a, hooks, 10);
    expect(a.vx).toBe(0);
    expect(a.vy).toBe(0);
  });
  it('发射位盘掷修正：Enemy.ts 315 出膛半径 = NextVector2Circular 盘掷（非 Edge 满径）+ life 360', () => {
    const src = readFileSync(join(GAME, 'src/entities/Enemy.ts'), 'utf8');
    expect(src).toContain('const rad = Math.random() * 40;');
    // ★BJ710-G35 D1（2026-10-25）：发射位合法增重（315 旗透传 opts）——life 360 语义
    //  不变,窗按 BJ710-C「arrow-fx-audit 576」判例随文本放宽（勿再缩回裸 `1001, 360);`）
    expect(src).toContain('1001, 360,   // life=360（:9519 timeLeft,shoot 缺省 300 系旧直飞档）');
    expect(src).toContain('{ bannerNpcId: bannerNpcKeyOf(this) });   // ★BJ710-G35 D1：315 无头骑士（banner 120）发射者旗冻结');
  });
});

// ===========================================================================
// §3 1001 Opacity 链（:42057-42064 + P.cs:542-548 int 截断 setter）
//    alpha_n = trunc(alpha_{n-1} − 8.5) → 246,237,…,3,0;末 6t −0.1/t 反向 +25.5
// ===========================================================================
describe('§3 1001 渐显/淡出（Opacity getter/setter 对）', () => {
  it('渐显：246→237→…→3（t28）→0（t29）——30t 全显档（:42063 += 1/30）', () => {
    Math.random = () => 0;
    const { hooks, player } = makeHooks1001();
    player.x = px(60) + 500;                           // 右 500px:追踪右漂不接触（30 拍 ≈150px）
    const a = mkPumpkin(hooks, px(60), 90 * 16);
    const al = () => (a as unknown as { alpha: number }).alpha;
    drive(a, hooks, 1);
    expect(al()).toBe(246);                            // trunc((1−1/30)×255)=trunc(246.5)
    drive(a, hooks, 1);
    expect(al()).toBe(237);                            // trunc(246−8.5)
    drive(a, hooks, 26);                               // 累计 28 拍
    expect(al()).toBe(3);                              // 246−9×27
    drive(a, hooks, 1);                                // 29 拍
    expect(al()).toBe(0);                              // 3−8.5<0 → 钳 0
    drive(a, hooks, 1);
    expect(al()).toBe(0);                              // 恒 0（o 钳 1）
  });
  it('淡出：life=8 载体 → 前 3 拍渐显（246/237/228）,life<6 反向 253→255（:42057-42059）', () => {
    Math.random = () => 0;
    const { hooks, player } = makeHooks1001();
    player.x = px(60) + 500;
    const a = mkPumpkin(hooks, px(60), 90 * 16, 0, 0, 8);
    const al = () => (a as unknown as { alpha: number }).alpha;
    drive(a, hooks, 3);                                // life 8/7/6 三拍渐显
    expect(al()).toBe(228);
    drive(a, hooks, 1);                                // life=5 首拍淡出
    expect(al()).toBe(253);                            // 228+25.5
    drive(a, hooks, 1);                                // life=4
    expect(al()).toBe(255);                            // 钳顶
  });
  it('满寿命收口：360 拍杀 + 末 5 拍淡出终值 α=125（25/50/75/100/125 步进 25.5 截断）', () => {
    Math.random = () => 0;
    const { hooks, player } = makeHooks1001();
    player.x = 1200; player.y = 90 * 16;               // 玩家 2000px 左:vx=−4 钉死（clamp −4−0.4=−4）
    const a = mkPumpkin(hooks, 3200, 90 * 16, -4);     // 恒速 −4 左飞 1440px,终距 560 不接触
    const upd = (a as unknown as { fixedUpdate: (dt: number, g: GameHooks) => void }).fixedUpdate;
    let ticks = 0;
    while (!(a as unknown as { dead: boolean }).dead && ticks < 400) { upd.call(a, 1 / 60, hooks); ticks++; }
    expect(ticks).toBe(360);                           // timeLeft=360 终杀
    expect((a as unknown as { alpha: number }).alpha).toBe(125);   // 末 5 拍淡出 25/50/75/100/125
  });
});

// ===========================================================================
// §4 1001 尘锁（:42065-42072）：2/3 掷、d6 火、继承弹速、四件套后置
// ===========================================================================
describe('§4 1001 尘（2/3 掷 d6 fire）', () => {
  it('rand=0 → Next(3)==0 → 零尘；rand=0.5 → 每拍一粒（2/3 掷面）', () => {
    Math.random = () => 0;
    const { hooks, player, dusts } = makeHooks1001();
    player.x = px(60) + 100; player.y = 90 * 16;
    const a = mkPumpkin(hooks, px(60), 90 * 16);
    drive(a, hooks, 5);
    expect(dusts.length).toBe(0);
    Math.random = () => 0.5;
    drive(a, hooks, 3);
    expect(dusts.length).toBe(3);
  });
  it('尘四件套：d6/scale 0.6/fadeIn 1.1/noGravity/noLight + 初速=当拍弹速（±2 抖动模拟 0.3）+ 26×26 盒（:42067-42071）', () => {
    Math.random = () => 0.5;
    const { hooks, player, dusts } = makeHooks1001();
    player.x = px(60) + 300; player.y = 90 * 16;
    const a = mkPumpkin(hooks, px(60), 90 * 16, 2, -3);
    // 逐拍快照（AI 序=加速→尘：尘速=本拍加速后的弹速;尘位=本拍位移前左上角）
    const preX: number[] = [], preY: number[] = [], postVx: number[] = [], postVy: number[] = [];
    for (let t = 0; t < 2; t++) {
      preX.push((a as unknown as { x: number }).x);
      preY.push((a as unknown as { y: number }).y);
      drive(a, hooks, 1);
      postVx.push(a.vx); postVy.push(a.vy);
    }
    expect(dusts.length).toBe(2);
    for (let i = 0; i < 2; i++) {
      const d = dusts[i];
      expect(d.type).toBe(6);
      expect(d.scale).toBe(0.6);
      expect(d.fadeIn).toBe(1.1);
      expect(d.noGravity).toBe(true);
      expect(d.noLight).toBe(true);
      expect(d.alpha).toBe(0);
      expect(d.w).toBe(26);                            // NewDustDirect(position, width, height,…) 盒
      expect(d.h).toBe(26);
      expect(d.vx).toBeCloseTo(postVx[i] + 0.3, 12);   // 速度实参=当拍 velocity.X/Y（dy=0 死区 → vy 恒）
      expect(d.vy).toBeCloseTo(postVy[i] + 0.3, 12);
      expect(d.x).toBeCloseTo(preX[i], 6);             // 弹盒左上角=AI 时相
      expect(d.y).toBeCloseTo(preY[i], 6);
    }
  });
});

// ===========================================================================
// §5 918 出生爆花演出面（AI_178 :46098-46148）——firecracker proc 链驱动
//    （rand=0.25：三角掷恒 0、r=0.25、量化位 96×25/100=24、gore 61、Next(-10,11)=−5）
// ===========================================================================
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; hits: number[];
  hurt: (d: number, kx?: number, ky?: number, g?: GameHooks) => boolean;
}
const mkEnemy = (id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy, hp: 100000, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};

function makeHooks918(enemies: MockEnemy[], dusts: DustRec[], sfx: string[][],
  particles: number[]): { hooks: GameHooks; player: Player } {
  const store = new TileStore(200, 120);
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) store.setTile(x, y, 1);
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const hooks = {
    world: { store } as never,
    player,
    enemies: () => enemies, critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => { particles[0] = (particles[0] ?? 0) + 1; },
    notifyInventoryChanged: () => {}, playSfx: () => {},
    playSfxFiles: (files: string[]) => { sfx.push(files); },
    showPickupLabel: () => {}, cutTile: () => {},
    entities: { add: () => {} },
    dusts: dusts as never,
    spawnDust: mkDustSink(dusts) as never,
  } as unknown as GameHooks;
  return { hooks, player };
}

describe('§5 918 爆花（AI_178 localAI==0 支 1:1）', () => {
  const HX = 3000, HY = 2500;
  function runBurst(): {
    dusts: DustRec[]; gores: { type: number; x: number; y: number; vx: number; vy: number }[];
    sfx: string[][]; particles: number[]; src: MockEnemy; near: MockEnemy;
  } {
    const dusts: DustRec[] = [];
    const sfx: string[][] = [];
    const particles: number[] = [0];
    const src = mkEnemy(1, HX, HY);
    const near = mkEnemy(2, HX + 30, HY + 10);          // 96×96 盒内（|30|<48+8）
    const far = mkEnemy(3, HX + 300, HY);               // 盒外
    const { hooks, player } = makeHooks918([src, near, far], dusts, sfx, particles);
    const gores: { type: number; x: number; y: number; vx: number; vy: number }[] = [];
    const spy = vi.spyOn(GorePiece, 'newGore').mockImplementation(
      (type: number, x: number, y: number) => {
        const g = { type, x, y, vx: 1, vy: 2, scale: 1 };
        gores.push(g);
        return g as unknown as GorePiece;
      });
    player.tagEffectStack.tryApplyTagToNPC(4912, src.id);
    player.tagEffectStack.tryEnableProcOnNPC(4912, src.id);
    Math.random = () => 0.25;
    resolveWhipTagHit(src, 20, hooks, () => {}, 1, HX, HY, player);
    spy.mockRestore();
    return { dusts, gores, sfx, particles, src, near };
  }

  it('计数面：4×d31 + 30×(d6α200+d6α100) + 10×d6α0 + 10×d31α0 = 84 尘 + Item14 音（:46102-46133）', () => {
    const { dusts, sfx } = runBurst();
    expect(dusts.filter((d) => d.type === 31 && d.alpha === 100 && d.scale === 1.5).length).toBe(4);
    expect(dusts.filter((d) => d.type === 6 && d.alpha === 200).length).toBe(30);
    expect(dusts.filter((d) => d.type === 6 && d.alpha === 100).length).toBe(30);
    expect(dusts.filter((d) => d.type === 6 && d.alpha === 0).length).toBe(10);
    expect(dusts.filter((d) => d.type === 31 && d.alpha === 0).length).toBe(10);
    expect(dusts.length).toBe(84);
    expect(sfx.length).toBe(1);
    expect(sfx[0]).toEqual(['Item_14']);               // :46102 SoundID.Item14
  });
  it('noGravity 面：B1/B2/C/D 全 noGr,A 组重力置位（:46112/:46117/:46124/:46131）', () => {
    const { dusts } = runBurst();
    expect(dusts.filter((d) => d.type === 31 && d.alpha === 100).every((d) => !d.noGravity)).toBe(true);
    expect(dusts.filter((d) => d.type === 6).every((d) => d.noGravity)).toBe(true);
    expect(dusts.filter((d) => d.type === 31 && d.alpha === 0).every((d) => d.noGravity)).toBe(true);
  });
  it('速度链：B1 ×3=0.9 / B2 ×2=0.6+fadeIn2.5 / C·D ×3（:46113/:46116-46118/:46125/:46132）', () => {
    const { dusts } = runBurst();
    const B1 = dusts.filter((d) => d.type === 6 && d.alpha === 200);
    const B2 = dusts.filter((d) => d.type === 6 && d.alpha === 100);
    const C = dusts.filter((d) => d.type === 6 && d.alpha === 0);
    const D = dusts.filter((d) => d.type === 31 && d.alpha === 0);
    expect(B1.every((d) => Math.abs(d.vx - 0.9) < 1e-9 && Math.abs(d.vy - 0.9) < 1e-9)).toBe(true);
    expect(B2.every((d) => Math.abs(d.vx - 0.6) < 1e-9 && Math.abs(d.vy - 0.6) < 1e-9 && d.fadeIn === 2.5)).toBe(true);
    expect(C.every((d) => Math.abs(d.vx - 0.9) < 1e-9 && Math.abs(d.vy - 0.9) < 1e-9)).toBe(true);
    expect(D.every((d) => Math.abs(d.vx - 0.9) < 1e-9 && Math.abs(d.vy - 0.9) < 1e-9)).toBe(true);
  });
  it('位式：A/B = (hx, hy+12)（UnitY·r=0.25·48）;C/D = (hx+12, hy)（UnitX 再旋 0）（:46106/:46123）', () => {
    const { dusts } = runBurst();
    for (const d of dusts.filter((d) => d.type === 31 && d.alpha === 100)) {
      expect(d.x).toBeCloseTo(HX, 6); expect(d.y).toBeCloseTo(HY + 12, 6);
    }
    for (const d of dusts.filter((d) => d.type === 6 && d.alpha === 100)) {
      expect(d.x).toBeCloseTo(HX, 6); expect(d.y).toBeCloseTo(HY + 12, 6);
    }
    for (const d of [...dusts.filter((d) => d.type === 6 && d.alpha === 0),
      ...dusts.filter((d) => d.type === 31 && d.alpha === 0)]) {
      expect(d.x).toBeCloseTo(HX + 12, 6); expect(d.y).toBeCloseTo(HY, 6);
    }
    // NewDust 盒 = 弹盒 96×96 @ (hx−48, hy−48)（:46105 盒实参;位即刻覆写）
    expect(dusts[0].w).toBe(96);
    expect(dusts[0].h).toBe(96);
  });
  it('gore 2×：数量/型 61（Next(61,64)）/位覆写 (hx,hy+12)/速链 1×0.3−0.25=0.05、2×0.3−0.25=0.35（:46134-46141）', () => {
    const { gores } = runBurst();
    expect(gores.length).toBe(2);
    for (const g of gores) {
      expect(g.type).toBe(61);                          // 61+floor(0.25×3)
      expect(g.x).toBeCloseTo(HX, 6);                   // :46137 覆写位（式同 A）
      expect(g.y).toBeCloseTo(HY + 12, 6);
      expect(g.vx).toBeCloseTo(0.05, 12);               // NewGore 传入 v=1 → ×0.3 → +=−5×0.05
      expect(g.vy).toBeCloseTo(0.35, 12);               // v=2 → 0.6 → 0.35
    }
  });
  it('伤害面零改动回归（★BJ449 同相）：源敌永免/盒内旁邻 55/盒外不波及/粒子占位退役', () => {
    const { src, near, particles } = runBurst();
    expect(src.hits).toEqual([]);                       // :23 源敌 -1 永免
    expect(near.hits).toEqual([55]);                    // trunc(20×2.75)
    expect(particles[0]).toBe(0);                       // 旧 '#FF7A28' 占位退役——演出全走 AI_178 真值面
  });
});

// ===========================================================================
// §6 演出面接线源锚（PROJ_ROT_RIGHT/PROJ_ALPHA0/爆花方法在位）
// ===========================================================================
describe('§6 接线源锚', () => {
  const arrowSrc = readFileSync(join(GAME, 'src/entities/Arrow.ts'), 'utf8');
  const whipSrc = readFileSync(join(GAME, 'src/entities/WhipTag.ts'), 'utf8');
  it('1001 入 PROJ_ROT_RIGHT 速度角族（AI_194 :42055-42056 rotation/spriteDirection 面）', () => {
    // ★BJ730 改判史：旧锁闭口 `…, 1001])` 全表文本——BJ703-B D2（408/435/682）+
    //  BJ704-G2（459）合法扩员后闭口文本必然破窗（发射位增重破窗第三例同族）;
    //  按判例改锁前缀开窗（成员序首八员含 1001）,扩员免碎、缩员/移位仍红。
    expect(arrowSrc).toContain('new Set([16, 34, 190, 837, 1023, 485, 1026, 1001');
  });
  it('PROJ_ALPHA0[1001]=255（SetDefaults :9520）+ AI_194 支在 subStepAI', () => {
    expect(arrowSrc).toContain('1001: 255,');
    expect(arrowSrc).toContain('if (this.projId === 1001) {');
    expect(arrowSrc).toContain('if (Math.abs(dy194) >= 30) {');
  });
  it('918 爆花在 WhipTag firecracker proc 位 + 旧占位粒子行退役', () => {
    expect(whipSrc).toContain('this.firecracker918Burst(g, ctx.hx, ctx.hy);');
    expect(whipSrc).not.toContain("spawnParticles?.(ctx.hx, ctx.hy, '#FF7A28'");
  });
});

// ============================================================
// ③ 变异自证（恰红+逐字节还原+sha256 对拍,BJ606 习语）
//    SW_BJ643_MUT=1 时本组跳过（变异运行读环境位跳过自证组,防递归）
// ============================================================
describe.skipIf(process.env.SW_BJ643_MUT)('③ 变异自证（恰红+逐字节还原+sha256 对拍）', () => {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');

  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj643-pumpkin-burst.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_BJ643_MUT: '1' },
    });
  // ★残留普查波 2026-10-12:BJ606 习语统一改造→tests/mutation-guard.ts 三层守卫
  //  （跨套件按文件互斥=bj642/bj643 同变异 Arrow.ts 联跑互染根除/panic-safe 还原/
  //  残留自检+自愈）;本文件只留 spawnVitest+恰红双门断言。
  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      const out = r.stdout + r.stderr;
      // 恰红双门：退出码非零 ∨ 输出面含红账（联跑池并发下 exit code 可能被
      // 缓存命中洗白——以测试账面为准,BJ606 习语的同构加固）
      const red = r.status !== 0 || /Tests\s+\d+ failed/.test(out) || out.includes(' failed');
      expect(red, `变异须证红: ${replacement}`).toBe(true);
      expect(out).toContain(filter);
      expect(out).not.toContain('没有找到测试');
    }, { label: `BJ643 ${filter}` });
  };

  const ARROW = join(process.cwd(), 'src', 'entities', 'Arrow.ts');
  const WHIP = join(process.cwd(), 'src', 'entities', 'WhipTag.ts');

  it('M1 AI_194 Y 死区摘除（回退无死区旧面）→ §2 Y 死区 红', () => {
    mutate(ARROW,
      'if (Math.abs(dy194) >= 30) {',
      'if (true) {',
      'Y 死区');
  });
  it('M2 AI_194 X 钳 ±4→±5（num3 误并 num4 档）→ §2 X 加速 红', () => {
    mutate(ARROW,
      'this.vx = Math.min(4, Math.max(-4, this.vx + Math.sign(dx194) * 0.4));',
      'this.vx = Math.min(5, Math.max(-5, this.vx + Math.sign(dx194) * 0.4));',
      'X 加速');
  });
  it('M3 AI_178 B1 尘速 ×3 摘（爆花速度链回退）→ §5 速度链 红', () => {
    mutate(WHIP,
      'if (b1) { b1.noGravity = true; b1.vx *= 3; b1.vy *= 3; }',
      'if (b1) { b1.noGravity = true; }',
      '速度链');
  });
  it('M4 AI_178 gore 2→0（爆花 gore 整缺回退）→ §5 gore 红', () => {
    mutate(WHIP,
      'for (let m = 0; m < 2; m++) {',
      'for (let m = 0; m < 0; m++) {',
      'gore 2×');
  });
});
