// 台账清偿批回归（2026-08-31，approx-registry M 级武器面 A①②③/B⑤ + C 档）：
//   A① Daybreak 953 爆炸 AoE（AI_117 扩盒 Damage 数值面）
//   A② Spear 三类伴生弹生成门（343/228/1107-1109,缩回相+单发闩）
//   A③ Chain Guillotines 481 出程撞块截停（tileCollide 出程真值）
//   A④ 光刃再掷召回门（recallGate）
//   B⑤ 彩虹棒 X 钳符号/Y 缓降特例（P.cs:19798-19821）
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => vi.restoreAllMocks());   // ★BJ716-A 判例:防 mock 泄漏（0.5 钉死尘面掷）
import { TileStore } from '../src/world/TileStore';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import {
  DaybreakFlare, DaybreakExplosionProj, daybreakExplosionSide,
  SpearProj, Boomerang, GlowstickProj, PHASEBLADE_PROJ,
  AnchoredProj, FlaironSpike, YoyoShotProj, FlailProj,
} from '../src/entities/WeaponProj';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const W = 200, H = 260;
// ★H=260（非 120）:Collision.CanHit 钳制上界 maxTilesY−40——矮世界里 row≥80 全被
// 钳进天空带导致视线门恒真（TileStore 网格行 ≥ 世界高−40 在 LOS 域外）。本文件
// 342 CanHit 门断言依赖真实扫描域,须保证墙/地面行 < H−40。

interface DustRec { type: number; x: number; y: number; vx: number; vy: number; scale: number; noGravity: boolean; fadeIn: number; alpha: number }

function mkHooks(opts: { wallColumn?: number; wallRows?: [number, number] } = {}) {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  if (opts.wallColumn !== undefined) {
    const [r0, r1] = opts.wallRows ?? [80, 99];
    for (let y = r0; y <= r1; y++) store.setTile(opts.wallColumn, y, 1);
  }
  const player = new Player(50 * TILE, 90 * TILE, new Inventory());
  const enemies: Array<Record<string, unknown>> = [];
  const projectiles: unknown[] = [];
  const dusts: DustRec[] = [];
  const sfxFiles: string[] = [];
  const sfxNames: string[] = [];
  const sfxWav: Array<[string, number | undefined]> = [];
  const hooks = {   // mock 简化面统一 unknown→GameHooks 收口（tests/weapons-entities 惯例）
    world: { store },
    player,
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
    playSfx: (n: string) => sfxNames.push(n),
    playSfxFiles: (f: string[]) => sfxFiles.push(...f),
    playSfxWav: (f: string, _v?: number, _x?: number, _y?: number, pitch?: number) =>
      sfxWav.push([f, pitch]),
    playSfxFile: (f: string) => sfxNames.push(`wav:${f}`),
    showPickupLabel: () => {},
    spawnFriendlyProj: (e: unknown) => projectiles.push(e),
    spawnDust: (x: number, y: number, _w: number, _h: number, type: number,
      sx = 0, sy = 0, alpha = 0) => {
      // 最小 VDust 面：位置=盒内均匀/速度含 ±2 抖动（fx/VanillaDust.spawn 同源抖动语义）
      const d = {
        type, x: x + Math.random() * 5, y: y + Math.random() * 5,
        vx: sx + (Math.random() * 41 - 20) * 0.1, vy: sy + (Math.random() * 41 - 20) * 0.1,
        scale: 1, noGravity: false, fadeIn: 0, alpha,
        noLight: false, noLightEmittance: false, color: null, rotation: 0,
        fx: 0, fy: 0, followPlayer: false, followOnce: false, dyeVid: -1,
      };
      dusts.push(d as unknown as DustRec);
      return d;
    },
  } as unknown as GameHooks;
  return { hooks, player, store, enemies, projectiles, dusts, sfxFiles, sfxNames, sfxWav };
}

type EnemyRec = Record<string, unknown> & {
  id: number; x: number; y: number; w: number; h: number; dead?: boolean;
  hits: Array<{ d: number; kx: number }>;
};

function addEnemy(enemies: EnemyRec[], id: number, ex: number, ey: number, w = 60, h = 40): EnemyRec {
  const e = {
    id, x: ex, y: ey, w, h, dead: false, hp: 999, maxHp: 999, iframes: 0,
    hits: [] as Array<{ d: number; kx: number }>,
    hurt(this: { x: number; w: number }, d: number, kx: number) {
      // 入参面与 hitEnemies 调用序对齐（其余可选参省略）
      (this as unknown as EnemyRec).hits.push({ d, kx });
      return true;
    },
  };
  // cx/cy = Entity/Enemy 暴露的中心 getter（DaybreakFlare 附着相直读 t.cx——
  // 缺省 mock 无此面会让附着坐标 NaN,与实体域语义不符）
  Object.defineProperty(e, 'cx', { get: () => e.x + e.w / 2, enumerable: true });
  Object.defineProperty(e, 'cy', { get: () => e.y + e.h / 2, enumerable: true });
  enemies.push(e as unknown as EnemyRec);
  return e as unknown as EnemyRec;
}

function run(e: { fixedUpdate: (dt: number, g: GameHooks) => void; dead?: boolean }, g: GameHooks, n: number): void {
  for (let i = 0; i < n && !e.dead; i++) e.fixedUpdate(1 / 60, g);
}

describe('A① Daybreak 953 爆炸 AoE（AI_117 扩盒 Damage :35095-35212）', () => {
  it('扩盒边长 = trunc(52×(ai1+0.01))，出生系数域 [0.85,2.0] → 盒边 [44..104]', () => {
    expect(daybreakExplosionSide(0.85)).toBe(44);   // trunc(52×0.86)
    expect(daybreakExplosionSide(2.0)).toBe(104);   // trunc(52×2.01)
    expect(daybreakExplosionSide(1.0)).toBe(Math.trunc(52 * 1.01)); // 52
    let lo = 999, hi = 0;
    for (let i = 0; i < 400; i++) {
      const s = daybreakExplosionSide(0.85 + Math.random() * 1.15);
      lo = Math.min(lo, s); hi = Math.max(hi, s);
    }
    expect(lo).toBeGreaterThanOrEqual(44);
    expect(hi).toBeLessThanOrEqual(104);
  });

  it('附着镖死亡 → Kill 掷 953（伤满额/kb10）→ 首拍扩盒对盒内敌单次结算', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ723-C M02 位移修复:953 爆面 DV 中性档（平值断言复稳）
    const t = mkHooks();
    const px = t.player.cx, py = t.player.cy;
    // 敌摆在飞行线上（vx=6/tick×2 子步,大盒宽 60 必然捕获）
    addEnemy(t.enemies as EnemyRec[], 1, px + 12, py - 20);
    const flare = new DaybreakFlare(px, py, 6, 0, 50, 2);
    run(flare, t.hooks, 200);
    // 已命中并附着 → 敌死后目标失效 → killNow → 掷 953
    (t.enemies[0] as EnemyRec).dead = true;
    run(flare, t.hooks, 8);
    expect(t.projectiles.length).toBeGreaterThanOrEqual(1);
    const boom = (t.projectiles.find((p) => p instanceof DaybreakExplosionProj)) as DaybreakExplosionProj | undefined;
    expect(boom).toBeDefined();
    // 新敌放在爆炸盒内（min 边 44 → 距心 ≤22px 内必中）后首拍结算单次
    const bx = boom!.x + boom!.w / 2, by = boom!.y + boom!.h / 2;
    const e2 = addEnemy(t.enemies as EnemyRec[], 2, bx - 20, by - 20);
    boom!.fixedUpdate(1 / 60, t.hooks);           // 首拍:扩盒+Damage+音尘
    expect(boom!.w).toBeGreaterThanOrEqual(44);      // trunc(52×scale) 扩盒生效
    expect(boom!.h).toBe(boom!.w);
    expect(e2.hits.length).toBe(1);
    expect(e2.hits[0].d).toBe(50);          // 无 melee 类旗 → 不掷暴击、伤害原样
    expect(Math.abs(e2.hits[0].kx)).toBe(10);   // NewProjectile kb=10f（:73405）
    run(boom!, t.hooks, 30);
    expect(e2.hits.length).toBe(1);                  // 后续拍不再结算（单窗）
    expect(boom!.dead).toBe(true);
  });

  it('爆炸存续 = 3×projFrames[953]=15 tick；首拍后不再结算（usesLocalNPCImmunity 单窗）', () => {
    const t = mkHooks();
    const flare = new DaybreakFlare(50 * TILE, 90 * TILE, 4, 0, 40, 1);
    run(flare, t.hooks, 300);   // 无敌 → 计数/timeLeft 门自灭,同样掷 953
    const boom = (t.projectiles.find((p) => p instanceof DaybreakExplosionProj)) as DaybreakExplosionProj | undefined;
    expect(boom).toBeDefined();
    // 15 tick 生命周期计步（不依赖盒内目标;仅验证寿命门）
    for (let i = 0; i < 15 && !boom!.dead; i++) boom!.fixedUpdate(1 / 60, t.hooks);
    expect(boom!.dead).toBe(true);
  });
});

describe('A② Spear 三类伴生弹生成门（1458 P.cs:46749-46802）', () => {
  /** 长矛伴生掷点在缩回相(itemAnimation<max/3)——dur=T 时伸出相≈前 2/3,缩回相末 1/3 */
  function mkSpear(projId: number, dmg = 40, kb = 4) {
    const t = mkHooks();
    const calls: Array<{ x: number; y: number; vx: number; vy: number; projId: number; dmg: number; kb: number; extra?: { timeLeft?: number } }> = [];
    const dur = 30;
    const spear = new SpearProj(1, 0, 5, dur, dmg, kb, projId);
    spear.spawnProj = (x, y, vx, vy, sProj, sDmg, sKb, extra) => {
      calls.push({ x, y, vx, vy, projId: sProj, dmg: sDmg, kb: sKb, extra });
    };
    return { ...t, calls, spear, dur };
  }

  it('342 北极：缩回相一次性掷 343,v×2.4/kb×0.85;伸出相零掷', () => {
    const t = mkSpear(342, 40, 4);
    run(t.spear, t.hooks, t.dur);
    expect(t.calls.filter((c) => c.projId === 343).length).toBe(1);
    const c = t.calls[0];
    expect(c.vx / 5).toBeCloseTo(2.4, 5);       // v = dx×spd×2.4（dx=1）
    expect(c.dmg).toBe(40);                     // 伤满额
    expect(c.kb).toBeCloseTo(4 * 0.85, 5);      // kb×0.85
    // CanHit 放行（空旷地面上方视线通透）→ 有掷
    expect(c.x).toBeGreaterThan(50 * TILE);     // 弹体随前刺越过玩家中心
  });

  it('222 叶绿 partisan：缩回相一次性掷 228,速度原样/伤·kb 满额', () => {
    const t = mkSpear(222, 36, 3);
    run(t.spear, t.hooks, t.dur);
    expect(t.calls.filter((c) => c.projId === 228).length).toBe(1);
    expect(t.calls[0].vx / 5).toBeCloseTo(1, 5);  // v 原样（dx×spd/dx×spd×1）
    expect(t.calls[0].dmg).toBe(36);
    expect(t.calls[0].kb).toBe(3);
  });

  it('367 黑曜鱼叉：Next(1,4)=1..3 枚 1107+rand(3),damage×0.5/kb0/timeLeft∈[30,149],同拍齐发', () => {
    const t = mkSpear(367, 41, 7);
    run(t.spear, t.hooks, t.dur);
    expect(t.calls.length).toBeGreaterThanOrEqual(1);
    expect(t.calls.length).toBeLessThanOrEqual(3);
    const firstTick = t.calls[0];
    for (const c of t.calls) {
      expect([1107, 1108, 1109]).toContain(c.projId);
      expect(c.dmg).toBe(Math.trunc(41 * 0.5));
      expect(c.kb).toBe(0);
      expect(c.extra?.timeLeft).toBeGreaterThanOrEqual(30);
      expect(c.extra!.timeLeft!).toBeLessThanOrEqual(149);
      // 同一出生点（首拍齐发,无逐拍分批）
      expect(c.y).toBe(firstTick.y);
    }
    // 速度乘区:vX = dx×spd×fX×fG×2,fX∈[0.7,1.3]/fG∈[0.8,1.2] → ratio∈[1.12,3.12]
    const ratio = t.calls[0].vx / 5;
    expect(ratio).toBeGreaterThan(1.119);
    expect(ratio).toBeLessThan(3.121);
  });

  it('342 单发闩先于 CanHit 门判定——失线期锁定即弃掷次（latch-before-gate 真值序）', () => {
    // 墙列置于玩家(列50-52)右侧 tx=56 全高封死;缩回相首拍弹体已在 tx≈60 →
    // 玩家盒→弹体盒直线被墙截断 → canHit false
    const t = mkHooks({ wallColumn: 56, wallRows: [84, 99] });
    const calls: number[] = [];
    const spear = new SpearProj(1, 0, 5, 30, 40, 4, 342);
    spear.spawnProj = (_x, _y, _vx, _vy, sProj) => calls.push(sProj);
    run(spear, t.hooks, 30);
    expect(calls.filter((n) => n === 343).length).toBe(0);
  });
});

describe('A③ Chain Guillotines 481 出程撞块截停（tileCollide 出程真值 :5563-5572/:19632-19665）', () => {
  it('出程撞墙不再穿墙:实体停在墙面外侧并立即转回收（不反转速度走回收制速）', () => {
    // 玩家 @ tile(50,90)；墙列 tx=58 全高封死 → 水平飞行 ~70px 内必撞
    const t = mkHooks({ wallColumn: 58, wallRows: [80, 99] });
    const guil = new SpearProj(1, 0, 20, 600, 25, 4, 481);
    for (let i = 0; i < 40 && !guil.dead; i++) guil.fixedUpdate(1 / 60, t.hooks);
    const wallLeftX = 58 * TILE;
    // 弹体从未越入墙格（22px 盒左缘不可 ≥ 墙左面 − 容差）
    expect(guil.x + guil.w).toBeLessThanOrEqual(wallLeftX + 1);
    // 收刀途中会被近手门(<50px)消亡——整段循环不死则中途已转回收并回手
    run(guil, t.hooks, 200);
    expect(guil.dead).toBe(true);           // 返回段与玩家 AABB 近距 Kill(:25090-25092)
  });

  it('发射响尘/挖掘音一次接上（HitTiles 尘 + SoundID 0）', () => {
    const t = mkHooks({ wallColumn: 58, wallRows: [80, 99] });
    const guil = new SpearProj(1, 0, 20, 600, 25, 4, 481);
    for (let i = 0; i < 40 && !guil.dead; i++) guil.fixedUpdate(1 / 60, t.hooks);
    expect(t.sfxNames).toContain('dig');
  });
});

describe('A④ 光刃再掷召回门（P.cs:39717-39722 IsAPhaseblade+controlUseItem）', () => {
  it('recallGate 电平 → ai0 提前置 1 进返回段（returning true）', () => {
    const t = mkHooks();
    expect(PHASEBLADE_PROJ.has(1067)).toBe(true);
    const blade = new Boomerang(t.player.cx, t.player.cy, 14, -2, 30, 4, 1067);
    blade.recallGate = () => true;             // 持同类光刃按住使用键
    blade.fixedUpdate(1 / 60, t.hooks);     // 首 tick 即应置召回
    expect(blade.returning).toBe(true);
    // 回收朝玩家飞 → 逐步贴近直到回手消亡
    run(blade, t.hooks, 200);
    expect(blade.dead).toBe(true);
  });
  it('无 recallGate（缺省电平假）→ 光刃照常滞留出程', () => {
    const t = mkHooks();
    const blade = new Boomerang(t.player.cx, t.player.cy, 14, -2, 30, 4, 1067);
    blade.fixedUpdate(1 / 60, t.hooks);
    expect(blade.returning).toBe(false);
  });
});

describe('B⑤ 彩虹棒反弹钳档（1458 P.cs:19798-19821）', () => {
  it('快掷触墙 → 弹性主档 v=-lastV×0.99（X 轴碰撞旗标路径）', () => {
    const t = mkHooks({ wallColumn: 58, wallRows: [40, 99] });   // 横贯弹体行的墙列
    const fast = new GlowstickProj(58 * TILE - 14, 60 * TILE, 5, 0, 1089);
    let flippedAtLeastOnce = false;
    for (let i = 0; i < 30 && !flippedAtLeastOnce; i++) {
      fast.fixedUpdate(1 / 60, t.hooks);
      if (fast.vx > -5 && fast.vx < 0) flippedAtLeastOnce = true;
    }
    expect(flippedAtLeastOnce).toBe(true);
    expect(fast.vx).toBeCloseTo(-4.95, 5);     // -lastV×0.99 弹性主档
  });

  it('Y 缓降特例:lastVy∈(0,1) 触撞 → 定值 −1 上弹（防贴底蠕动,旧实现缺该档）', () => {
    const t = mkHooks();
    // y+h 恰探入地面行的第一拍（vy=0.6,前 5 tick 无重力叠加）
    const stick = new GlowstickProj(90 * TILE, 100 * TILE - 6 - 0.01, 0, 0.6, 1089);
    stick.fixedUpdate(1 / 60, t.hooks);
    expect(stick.vy).toBe(-1);
  });
});

// ===================== 终清波·WeaponProj 全域近似清偿回归（2026-09-01） =====================
// 锚定：1458 AI_003/HandleMovement/Collision 真值（详见 approx-registry 终清波节）。
describe('终清波 A·301 弹跳盾出程式重写（1457/1458 真值,1456 双门退役）', () => {
  it('掷出呼啸：出程(ai[0]==0)全程静默;入回收后每声 Item_7 带 -0.33 变调(:39578-39595)', () => {
    const t = mkHooks({ wallColumn: 62, wallRows: [80, 99] });
    const b = new Boomerang(t.player.cx - 20, t.player.cy, 14, 0, 30, 4, 301);
    for (let i = 0; i < 6 && !b.returning; i++) b.fixedUpdate(1 / 60, t.hooks);
    expect(b.returning).toBe(false);
    // 出程期间零呼啸（门内不置 soundDelay 不播声）
    expect(t.sfxWav.filter(([f]) => f === 'Item_7')).toHaveLength(0);
    // 撞墙转回收后：呼啸带 pitch
    for (let i = 0; i < 40 && !b.returning; i++) b.fixedUpdate(1 / 60, t.hooks);
    expect(b.returning).toBe(true);
    const whistles = t.sfxWav.filter(([f, p]) => f === 'Item_7' && p !== undefined);
    expect(whistles.length).toBeGreaterThanOrEqual(1);
    expect(whistles[0][1]).toBeCloseTo(-0.33, 5);
  });

  it('出程悬停钉位(Center=MountedCenter−velocity,ai[1]<30)与 Item_1 @ai[1]==20(:40017)', () => {
    const t = mkHooks();
    const b = new Boomerang(t.player.cx - 8, t.player.cy, 14, 0, 30, 4, 301);
    let item1AtPin = false;
    for (let i = 0; i < 26 && !item1AtPin; i++) {
      b.fixedUpdate(1 / 60, t.hooks);
      // ai[1]<30 阶段：弹心被钉在手侧一个弹速半径内（允许管线位移回写余量）
      const d = Math.hypot(b.cx - t.player.cx, b.cy - t.player.cy);
      if (i >= 2) expect(d).toBeLessThanOrEqual(Math.hypot(14, 0) + b.w + 6);
      if (t.sfxFiles.includes('Item_1')) item1AtPin = true;
    }
    expect(item1AtPin).toBe(true);        // ai[1]==20 帧触发
  });

  it('ai[1]>=60 转回收且速度归零（无墙无敌路径）', () => {
    const t = mkHooks();                   // 无墙列——自由空中飞行,不会被撞停
    const b = new Boomerang(t.player.cx + 240, t.player.cy, -16, 0, 30, 4, 301);
    for (let i = 0; i < 62 && !b.returning; i++) b.fixedUpdate(1 / 60, t.hooks);
    expect(b.returning).toBe(true);
  });
});

describe('终清波 B·光刃变调三档 + 182 锤头尘 + 866 尾尘（1458 头/尾段真值）', () => {
  it('1074 自旋段 Item_7 带 -0.3 变调(:39807);非 1074 光刃 Item_15 无变调档', () => {
    const t1 = mkHooks();
    const blade = new Boomerang(t1.player.cx, t1.player.cy, 12, -6, 30, 4, 1074);
    for (let i = 0; i < 16 && !blade.returning; i++) blade.fixedUpdate(1 / 60, t1.hooks);
    const pitched = t1.sfxWav.filter(([f, p]) => f === 'Item_7' && p !== undefined);
    expect(pitched.length).toBeGreaterThanOrEqual(1);
    expect(pitched[0][1]).toBeCloseTo(-0.3, 5);

    const t2 = mkHooks();
    const blade2 = new Boomerang(t2.player.cx, t2.player.cy, 12, -6, 30, 4, 1060);
    for (let i = 0; i < 16 && !blade2.returning; i++) blade2.fixedUpdate(1 / 60, t2.hooks);
    expect(t2.sfxFiles).toContain('Item_15');                 // 缺省光刃族自旋音
    expect(t2.sfxWav.filter(([, p]) => p !== undefined)).toHaveLength(0);
  });

  it('182 圣骑锤出程段 d57 锤光尘(α255/s0.75/vel×0.1 后 noGravity,:39906-39912)', () => {
    const t = mkHooks();
    const h = new Boomerang(t.player.cx - 400, t.player.cy, -14, 0, 30, 4, 182);
    for (let i = 0; i < 22 && !h.returning; i++) h.fixedUpdate(1 / 60, t.hooks);
    const d57 = t.dusts.filter((d) => d.type === 57);
    expect(d57.length).toBeGreaterThanOrEqual(1);
    expect(d57.every((d) => d.alpha === 255)).toBe(true);
    expect(d57[0].noGravity).toBe(true);
  });

  it('866 飞刀尾段(全状态)d212 尘、vel×0.1、noGravity(:40281-40289)', () => {
    const t = mkHooks();
    const k = new Boomerang(t.player.cx + 500, t.player.cy, -10, 0, 30, 4, 866);
    for (let i = 0; i < 12 && t.dusts.filter((d) => d.type === 212).length === 0; i++) {
      k.fixedUpdate(1 / 60, t.hooks);                          // rand(2)==0 掷门——12t 必出
    }
    const d212 = t.dusts.filter((d) => d.type === 212);
    expect(d212.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(d212[0].vx)).toBeLessThan(3);
    expect(d212[0].noGravity).toBe(true);
  });

  it('106 光碟撞墙溅射 LightDisc_Bounce 实装(:28787-28801,perfect306×4 主粒+白克隆)', () => {
    const t = mkHooks({ wallColumn: 58, wallRows: [40, 99] });
    const disc = new Boomerang(58 * TILE - 80, 60 * TILE, 5, 0, 30, 4, 106);
    let hits = 0;
    for (let i = 0; i < 30 && hits === 0; i++) {
      disc.fixedUpdate(1 / 60, t.hooks);
      hits = t.dusts.filter((d) => d.type === 306).length;
    }
    expect(hits).toBeGreaterThanOrEqual(8);                    // 4 主粒×(主+克隆)
    const mains = t.dusts.filter((d) => d.type === 306 && d.alpha === 200);
    expect(mains.length).toBeGreaterThanOrEqual(4);            // α200 主粒面
    expect(t.sfxNames).toContain('dig');                       // SoundID 0 共享尾保留
  });
});

describe('终清波 C·FlaironSpike 反射轴差分/Kill 尘坐标修正', () => {
  it('首次接触仅镜像速度被改的轴(vx 保持 0,vy 上抛反射；:18431-18442)', () => {
    const t = mkHooks();
    const sp = new FlaironSpike(90 * TILE, 100 * TILE - 15, 0, 6, 30, 2);
    sp.fixedUpdate(1 / 60, t.hooks);
    expect(sp.vx).toBe(0);
    expect(sp.vy).toBeLessThan(0);                             // 第 1/2 次接触反弹续飞
  });

  it('Kill 爆尘 y 坐标使用弹心 cy（cx0 误用 typo 回归钉死；P.cs:74184-74208）', () => {
    const t = mkHooks();
    const sp = new FlaironSpike(800, 100 * TILE - 25, 0, 10, 30, 2);
    (sp as unknown as { bounces: number }).bounces = 2;        // 直接预置第 2 次接触前态（MAJOR-1:第 2 次接触即 Kill）
    let cyBefore = sp.cy;
    for (let i = 0; i < 90 && !sp.dead; i++) {
      cyBefore = sp.cy;
      sp.fixedUpdate(1 / 60, t.hooks);
    }
    expect(sp.dead).toBe(true);
    const burst = t.dusts.filter((d) => d.type === 212);
    expect(burst.length).toBe(20);                             // NewDust 20 粒
    // 修复后全部尘都挂在弹心竖直平面上——typo 版会飞到 x 心平面(y≈cy 差数百 px)
    expect(burst.every((d) => Math.abs(d.y - cyBefore) < 40)).toBe(true);
  });
});

describe('终清波 D·Wet 坡面支 + 冲击波/块尘几何(窗口/Item14/dd2 音资产)', () => {
  it('948 入水:斜砖上方液体经坡面支判湿 → 转型 947(:1646-1666 清偿鉴别样本)', () => {
    // ★R3 湿段批夹具改道（2026-09-06）：湿段插位 = AI 后/位移前（原文 Update 序
    //   :16880→:16903→:17120）——掷出首拍 case0 把球重钉到玩家心,故把玩家心搬运到
    //   斜砖探针位,使湿段测位恰落在坡面支鉴定域（几何意图不变,时序对齐原文）。
    const t = mkHooks();
    const st = t.store;
    st.setTile(60, 99, 1);
    st.setSlope(60, 99, 1);          // 斜砖格本身无液体——旧"液体-only 扫描"必漏
    st.setLiquid(60, 98, 255, 1);    // 液体在斜砖上一格（原版判湿域）
    st.setTile(60, 98, 0);
    const cxp = 60 * TILE + 8, cyp = 99 * TILE + 8;            // 探针整体落在斜砖行内
    const pl = t.hooks.player as unknown as { x: number; y: number };
    pl.x = cxp - 10; pl.y = cyp - 21;                          // 玩家心=斜砖探针位（掷出重钉落点）
    const flail = new FlailProj(cxp, cyp, 30, 4, 948,
      () => false, () => ({ x: cxp + 100, y: cyp }));
    flail.fixedUpdate(1 / 60, t.hooks);
    expect(flail.projId).toBe(947);
  });

  it('262 回收起手冲击:HitTilesInACircle(Position−num117/2)+SoundID.Item14(:25054-25071)', () => {
    const t = mkHooks();
    const an = new AnchoredProj(1, 0.35, 14, 20, 2, 262);      // 下压向落地面触发
    for (let i = 0; i < 90 && !an.dead; i++) an.fixedUpdate(1 / 60, t.hooks);
    expect(t.sfxNames).toContain('wav:Item_14');               // 原 'explosion' 合成兜底退役
    expect(t.dusts.filter((d) => d.type === 14).length).toBeGreaterThanOrEqual(1);
  });

  it('1125 CascadeExplosion 首帧播 DD2 三变体随机一(WAV_MAP dd2Explosive 在盘资产)', () => {
    const t = mkHooks();
    const shot = new YoyoShotProj({ x: 800, y: 1400, vx: 1, vy: 0, projId: 1125,
      dmg: 40, kb: 2, scale: 1 });
    shot.fixedUpdate(1 / 60, t.hooks);
    const dd2 = t.sfxFiles.filter((f) => /^dd2_explosive_trap_explode_\d$/.test(f));
    expect(dd2.length).toBeGreaterThanOrEqual(1);              // mock 录制面摊开列表
    expect(new Set(dd2).size).toBeLessThanOrEqual(3);          // 候选域 = 三变体
    // 首帧爆发精确面（AI_189 :43070-43100）:d6×20(α200) + d31 num7×5∈{5,10}(α50)
    const d6 = t.dusts.filter((d) => d.type === 6 && d.alpha === 200);
    expect(d6.length).toBe(20);
    const d31 = t.dusts.filter((d) => d.type === 31 && d.alpha === 50);
    expect([5, 10]).toContain(d31.length);                     // rand(3,7)/3 ∈{1,2}
  });
});
