// R29 红蓝对抗回归（远程族发射数量重灾区，2026-08-25）：
//  ① Tactical Shotgun 679：SHOTGUN_PELLETS [6,6,0.05,40] + 首发同掷（:48833-48843）
//  ② Onyx Blaster 661：显形链 alpha−55/scale1.3/16×d62 暗环（:56705-56745）+
//     Kill Resize(160) AoE 二次结算 + Item14 + d240/d62 配比（:73493-73540）
//  ③ Phantasm 630：加速窗 interval 24→22→20→18（ai0 40/80/120 档）+ 每轮 volley
//     4 箭 ±15 出生散布 / speed3×(0.6..1.4)（AI_001 :68194-68295）
//  ④ Phantasm 命中侧补刀：arrow 弹命中且载体窗活 → 3×631 dmg×0.3 delay 0/15/30
//     （Projectile.cs:13935-13943）+ 631 AI_122 错峰定身/homing ×12/失效淡出
//  ⑤ Chlorophyte Shotbow/BloodRain/QuadBarrel 发射几何（Game.ts 特例支源断言 +
//     resolveBowProjOverride 换体函数直测）
//  ⑥ 弹药拖尾分型：41(d31+d6)/91(d58|d15)/120(d67 pos−v v×0.3)/225(d40)/
//     282(d171)/469(alpha−50 @t>2)/819(血尾 d5+d267)（AI_001 逐型块行号照抄）
//  ⑦ 星星炮族：955 闪烁档+Item9 循环音、728 alpha 钳100+Item9、自旋 (|vx|+|vy|) 式
//     （AI_005 :24133/:24216 + AI_151 :22338-22376——红队"无循环音/0.3 自旋"驳正）
//  ⑧ Kill 面：120/206·225/819/178/284/286(80px AoE)/BULLET_KILL_SFX 音族
import { describe, it, expect, vi } from 'vitest';   // ★BJ729-A：vi（DV 中性档钉值 mock）
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import { Arrow, BULLET_KILL_SFX } from '../src/entities/Arrow';
import {
  resolveBowProjOverride, gunAmmoSaveHit, GUN_AMMO_SAVE, projGravSpec,
} from '../src/data/vanillaItemCombat';
import { Game } from '../src/core/Game';
import type { GameHooks } from '../src/entities/types';

const gameSrc = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');

function emptyWorld(): World {
  const w = new World(160, 200, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 190, 1, 0, 0);
  return w;
}

interface DustRec {
  type: number; vx: number; vy: number; scale: number; noGravity: boolean;
  x: number; y: number; alpha: number;
}
interface AddedRec { projId?: number; ph631Delay?: number; damage?: number; vx?: number; vy?: number; x?: number; y?: number }

function makeGame(w: World, enemies: unknown[] = [], hooks: Record<string, unknown> = {}): GameHooks {
  const dusts: DustRec[] = [];
  const sfx: string[] = [];
  const added: AddedRec[] = [];
  const g = {
    world: w,
    player: {
      dead: false, iframes: 0, cx: 800, cy: 400, x: 795, y: 380, w: 10, h: 40,
      facing: 1, gravDir: 1,
      inv: { heldItem: () => null },
      equipStats: {},
      critChance: () => 4,
    },
    enemies: () => enemies, critters: () => [],
    entities: {
      nextId: 1,
      add: (e: unknown) => { added.push(e as AddedRec); },
      projectiles: [] as unknown[],
    },
    playSfx: () => {},
    playSfxFiles: (files: string[]) => { sfx.push(files.join(',')); },
    playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    broadcastParticleOrchestra: () => {},
    spawnDust: (x: number, y: number, ww: number, hh: number, type: number,
      sx = 0, sy = 0, alpha = 0, _c = null, scale = 1, noGravity = false) => {
      const d: DustRec = { type, vx: sx, vy: sy, scale, noGravity, x, y, alpha };
      dusts.push(d);
      return d as never;
    },
    dusts, sfx, added,
    ...hooks,
  };
  return g as unknown as GameHooks;
}

function rec(game: GameHooks): { dusts: DustRec[]; sfx: string[]; added: AddedRec[] } {
  return game as unknown as { dusts: DustRec[]; sfx: string[]; added: AddedRec[] };
}

/** onProjectileDeath 零场桩（Object.create(Game.prototype)，同 ammo-remainder-fixes） */
function mkDeathGame(enemies: Array<Record<string, unknown>> = []) {
  const hurt: Array<[number, number]> = [];
  const sfx: string[] = [];
  const dusts: DustRec[] = [];
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  g.player = { dead: false, cx: 0, cy: 0, x: -10, y: -21, w: 20, h: 42, equipStats: {}, critChance: () => 4 };
  g.entities = {
    enemies: enemies.map((e, i) => ({
      dead: false, x: e.x ?? -10, y: e.y ?? -21, w: e.w ?? 20, h: e.h ?? 42,
      hurt: (dmg: number) => { hurt.push([i, dmg]); return true; },
    })),
    critters: [], projectiles: [], add: () => {},
  };
  g.playSfxFiles = (names: string[]) => { sfx.push(...names); };
  g.sfx = { play: () => {} };
  // ★R7 F1:hitTilesFx 全量化批后 BULLET_KILL_SFX 支会调 this.hitTilesFx → 需 world
  g.world = { store: {
    inBounds: () => false, idx: () => 0, flags: [0], type: [0],
    isActive: () => false, isSolid: () => false, isPlatform: () => false,
    half: [0], slope: [0], get: () => 0,
  } };
  g.spawnDust = (x: number, y: number, ww: number, hh: number, type: number,
    sx = 0, sy = 0, alpha = 0, c = null, scale = 1, noGravity = false) => {
    const d: DustRec = { type, vx: sx, vy: sy, scale, noGravity, x, y, alpha };
    dusts.push(d);
    return d as never;
  };
  return { g: g as never as GameHooks & { onProjectileDeath: (...a: unknown[]) => void }, hurt, sfx, dusts };
}

describe('R29 §4 战术霰弹枪 679', () => {
  it('SHOTGUN_PELLETS 含 679:[6,6,0.05,40] 且 4703 已移出（专用支承载角向扰动）', () => {
    expect(gameSrc).toContain('679: [6, 6, 0.05, 40]');
    expect(gameSrc).not.toMatch(/SHOTGUN_PELLETS[^;]*4703:\s*\[/);
    // 首发弹丸也吃散布（六发全掷,:48836 无首发精确档）
    expect(gameSrc).toMatch(/bowVid2 === 534 \|\| bowVid2 === 964 \|\| bowVid2 === 679/);
  });
});

describe('R29 §5 玛瑙爆破枪 661 黑爆', () => {
  it('projGravSpec(661)=无重力直线（AI1_NO_DROP 表）', () => {
    expect(projGravSpec(661).grav).toBe(0);
  });
  it('显形链：alpha−55/子步、scale→1.3、归零拍 16 枚 d62 暗环', () => {
    const g = makeGame(emptyWorld());
    const a = new Arrow(800, 100, 7, 0, 48, 6, 661, {});
    expect(a.alpha).toBe(255);
    a.fixedUpdate(1 / 60, g);                       // EU=1 → 两子步:255→200→145
    expect(a.drawScale).toBeCloseTo(1.3, 5);
    a.fixedUpdate(1 / 60, g);                       // →90→35
    expect(rec(g).dusts.filter((d) => d.type === 62).length).toBe(0);
    a.fixedUpdate(1 / 60, g);                       // 归零拍 → 16×d62 环
    expect(rec(g).dusts.filter((d) => d.type === 62).length).toBe(16);
    expect(a.alpha).toBe(0);
  });
  it('Kill 二段 AoE：160px 盒内敌全额伤结算 + Item14 + d240/d62 尘配比', () => {
    // ★BJ729-A（2026-10-27,D2 残差清偿）DV 中性档钉值：661 Kill 重跑 Damage() 逐
    //  靶 DV（:12970）补齐后未 mock 期望 48 必漂（41-55）——0.5 → tier 0 → ×1.0
    //  恒等档（BJ716-A 同款修法）;crit 掷 0.5<0.04+agg 恒 false 同钉。
    const rvi661 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // 近敌放在弹道下方但仍在爆点 80px 盒内（避开接触命中,单验 AoE 结算）
    const near = { x: 830, y: 130, w: 20, h: 20, dead: false, hurt: (..._a: unknown[]) => true };
    const far = { x: 1400, y: 900, w: 20, h: 20, dead: false, hurt: (..._a: unknown[]) => true };
    const g = makeGame(emptyWorld(), [near, far]);
    const a = new Arrow(800, 100, 7, 0, 48, 6, 661, {});
    const hurtSpy: number[] = [];
    (near as unknown as { hurt: (d: number) => boolean }).hurt = (d: number) => { hurtSpy.push(d); return true; };
    a.life = 2;                                     // 寿命尽 → killNow → 黑爆（全消亡路径同口）
    for (let i = 0; i < 4 && !a.dead; i++) a.fixedUpdate(1 / 60, g);
    expect(a.dead).toBe(true);
    expect(hurtSpy.length).toBe(1);                 // 近敌吃 AoE、远敌不波及
    expect(hurtSpy[0]).toBe(48);                    // 黑爆=弹体全额伤
    const r = rec(g);
    expect(r.sfx).toContain('Item_14');
    expect(r.dusts.filter((d) => d.type === 240).length).toBeGreaterThanOrEqual(4);
    expect(r.dusts.filter((d) => d.type === 62).length).toBeGreaterThanOrEqual(16);
    rvi661.mockRestore();
  });
});

describe('R29 §1 幻象弓 630 载体 + 631 追踪矢', () => {
  function carrier(g: GameHooks): Arrow {
    const a = new Arrow(800, 400, 11, 0, 50, 2, 630, { grav: 0 });
    a.ph630Ctl = {
      channel: () => true,
      aim: () => ({ x: 1200, y: 400 }),
      volley: () => ({ pid: 1, dmg: 60, kb: 3, speed: 15 }),
    };
    return a;
  }
  it('加速窗：volley 间隔序列随 ai0 计龄 24→22（≥40）→20（≥80）→18（≥120）', () => {
    const g = makeGame(emptyWorld());
    const a = carrier(g);
    const gaps: number[] = [];
    let since = -1;
    let prevArrows = 0;
    for (let t = 0; t < 220 && gaps.length < 4; t++) {
      a.fixedUpdate(1 / 60, g);
      const n = rec(g).added.length;
      if (n > prevArrows) {
        if (since >= 0) gaps.push(since + 1);        // 两次出膛之间的 update 数=interval
        since = 0;
        prevArrows = n;
      } else if (since >= 0) {
        since++;
      }
    }
    // 首轮在 t=0 触发（ai[1] 出生 0）;其后间隔按计龄降档。220t 内跨 ≥40/≥80 档。
    expect(gaps[0]).toBe(24);                        // age<40 恒 24t
    expect(gaps).toContain(22);                      // 跨入 ≥40 档
    expect(gaps.every((x, i) => i === 0 || x <= gaps[i - 1])).toBe(true);   // 单调不增
  });
  it('每轮 volley 出膛 4 箭：出生点 ±15 散布、速度带 speed3×[0.6,1.4]、noDropItem', () => {
    const g = makeGame(emptyWorld());
    const a = carrier(g);
    a.fixedUpdate(1 / 60, g);
    const batch = rec(g).added.filter((e) => e.projId === 1);
    expect(batch.length).toBe(4);
    for (const b of batch) {
      expect(Math.abs((b.x ?? 0) - 800)).toBeLessThanOrEqual(15.001);
      expect(Math.abs((b.y ?? 0) - 400)).toBeLessThanOrEqual(15.001);
      const spd = Math.hypot(b.vx ?? 0, b.vy ?? 0);
      expect(spd).toBeGreaterThanOrEqual(15 * 0.6 - 0.01);
      expect(spd).toBeLessThanOrEqual(15 * 1.4 + 0.01);
      // 方向 = 重瞄后的载体速度向（+x）
      expect(b.vx).toBeGreaterThan(0);
    }
  });
  it('volley 解析失败（无弹药）→ 载体下一拍 Kill', () => {
    const g = makeGame(emptyWorld());
    const a = new Arrow(800, 400, 11, 0, 50, 2, 630, { grav: 0 });
    a.ph630Ctl = { channel: () => true, aim: () => ({ x: 1200, y: 400 }), volley: () => null };
    a.fixedUpdate(1 / 60, g);                        // 首拍 volley → null → Kill
    expect(a.dead).toBe(true);
  });
  it('channel 断开 → 下一 volley 拍 Kill（canShoot 门）', () => {
    const g = makeGame(emptyWorld());
    let held = true;
    const a = new Arrow(800, 400, 11, 0, 50, 2, 630, { grav: 0 });
    a.ph630Ctl = {
      channel: () => held, aim: () => ({ x: 1200, y: 400 }),
      volley: () => ({ pid: 1, dmg: 60, kb: 3, speed: 15 }),
    };
    a.fixedUpdate(1 / 60, g);
    held = false;
    for (let i = 0; i < 30 && !a.dead; i++) a.fixedUpdate(1 / 60, g);
    expect(a.dead).toBe(true);
  });
  it('命中侧补刀：木箭命中敌 + 载体窗活 → 3×631（dmg×0.3 截断、delay 0/15/30、kb0）', async () => {
    const enemy = {
      x: 820, y: 390, w: 30, h: 30, id: 7, dead: false, iframes: 0,
      hurt: () => true,
    };
    const g = makeGame(emptyWorld(), [enemy]);
    Arrow.phantasmWindowUntil = performance.now() + 500;
    const a = new Arrow(805, 400, 10, 0, 40, 2, 1, { grav: 0 });   // 木箭穿入敌盒
    for (let i = 0; i < 4 && !a.dead; i++) a.fixedUpdate(1 / 60, g);
    const chase = rec(g).added.filter((e) => e.projId === 631);
    expect(chase.length).toBe(3);
    for (const c of chase) {
      expect(c.damage).toBe(Math.trunc(40 * 0.3));   // 12
      // 方向 = 归一(目标−源点)×6——模长恒 6,向右半边（源点=玩家盒内随机点）
      expect(Math.hypot(c.vx ?? 0, c.vy ?? 0)).toBeCloseTo(6, 4);
      expect(c.vx).toBeGreaterThan(0);
      expect(c.ph631Delay === 0 || c.ph631Delay === 15 || c.ph631Delay === 30).toBe(true);
    }
    expect(chase.map((c) => c.ph631Delay).sort((a1, b1) => (a1 ?? 0) - (b1 ?? 0))).toEqual([0, 15, 30]);
  });
  it('631 AI_122：延迟期定身、有效目标 homing ×12 渐显、失效态恢复撞块淡出', () => {
    const enemy = { x: 1000, y: 395, w: 30, h: 30, id: 7, dead: false };
    const g = makeGame(emptyWorld(), [enemy]);
    const c = new Arrow(800, 400, 6, 0, 12, 0, 631, { grav: 0 });
    c.ph631Tgt = 7;
    c.ph631Delay = 2;
    expect(c.alpha).toBe(255);
    c.fixedUpdate(1 / 60, g);
    expect(c.vx).toBe(0); expect(c.vy).toBe(0);
    c.fixedUpdate(1 / 60, g);                        // delay 归零（仍定身）
    c.fixedUpdate(1 / 60, g);                        // homing 生效
    const sp = Math.hypot(c.vx, c.vy);
    expect(sp).toBeGreaterThan(11.9); expect(sp).toBeLessThan(12.1);
    // EU=1 → 每拍两子步：延迟占前两子步,余四子步 homing 各 −15 渐显
    expect(c.alpha).toBe(255 - 15 * 4);
    // 失效态：清目标后非零速 → 恢复撞块 + alpha+=10/子步（EU=1 → 两子步 +20）
    c.ph631Tgt = -1;
    const beforeAlpha = c.alpha;
    c.fixedUpdate(1 / 60, g);
    expect(c.noTileCollide).toBe(false);
    expect(c.alpha).toBe(beforeAlpha + 20);
  });
});

describe('R29 §3/§9 弓族换弹支（resolveBowProjOverride 直测）', () => {
  it('血雨弓 4381 无条件恒换 819（无视弹药品种与熔火箭袋）', () => {
    expect(resolveBowProjOverride(4381, 1, false).projId).toBe(819);
    expect(resolveBowProjOverride(4381, 2, false).projId).toBe(819);   // 非木箭也换
    expect(resolveBowProjOverride(4381, 1, true).projId).toBe(819);    // 熔火箭袋被压制
  });
  it('骷髅弓 4058 仅对骨箭弹药 474 换 117，其他弹药照常', () => {
    expect(resolveBowProjOverride(4058, 474, false).projId).toBe(117);
    expect(resolveBowProjOverride(4058, 1, false).projId).toBe(1);
    expect(resolveBowProjOverride(4058, 474, true).projId).toBe(117);
  });
});

describe('R29 §13 省弹三档（GUN_AMMO_SAVE）', () => {
  it('3475 仅耗 1/3、3930 省 1/2、3540 仅耗 1/3（掷序语义正确）', () => {
    let save3475 = 0, save3930 = 0, save3540 = 0;
    for (let i = 0; i < 3000; i++) {
      if (gunAmmoSaveHit(3475, Math.random())) save3475++;
      if (gunAmmoSaveHit(3930, Math.random())) save3930++;
      if (gunAmmoSaveHit(3540, Math.random())) save3540++;
    }
    expect(save3475 / 3000).toBeGreaterThan(0.6);      // roll!==0 才省 ≈ 2/3
    expect(save3475 / 3000).toBeLessThan(0.73);
    expect(save3930 / 3000).toBeGreaterThan(0.44);     // roll===0 省 ≈ 1/2
    expect(save3930 / 3000).toBeLessThan(0.56);
    expect(save3540 / 3000).toBeGreaterThan(0.6);
    expect(GUN_AMMO_SAVE[98][1]).toBe(true);           // 旧档不受影响
  });
  it('Celeb2 muzzle 回调接 roll 口 + 3104 豁免（源断言）', () => {
    expect(gameSrc).toMatch(/gunAmmoSaveRoll\(bowVid2\)/);
    expect(gameSrc).toMatch(/3104[\s\S]{0,80}gunAmmoSaveRoll\(bowVid2\)/);
  });
});

describe('R29 §2/§7 多发型特例支（Game.ts 源断言）', () => {
  it('叶绿素射弹弓 1229：梯次累积 min(i,3) 组 ±nrand(35)*0.04', () => {
    expect(gameSrc).toMatch(/bowVid2 === 1229/);
    expect(gameSrc).toMatch(/Math\.min\(ic, 3\)[\s\S]{0,120}nrand\(35\) \* 0\.04/);
  });
  it('血雨弓 4381 天降支：Next(61)*−朝向/(x*10+中心)/11/vx×Next(55,80)*0.01', () => {
    expect(gameSrc).toMatch(/bowVid2 === 4381/);
    expect(gameSrc).toMatch(/\(bxr \* 10 \+ this\.player\.cx\) \/ 11/);
    expect(gameSrc).toMatch(/\(55 \+ Math\.floor\(Math\.random\(\) \* 25\)\) \* 0\.01/);
  });
  it('四管霰弹枪 4703：rand×π/2 角向扰动 + SafeNormalize×原长', () => {
    expect(gameSrc).toMatch(/bowVid2 === 4703/);
    expect(gameSrc).toMatch(/Math\.random\(\) \* \(Math\.PI \/ 2\)/);
    expect(gameSrc).toMatch(/fv47x \/ fl47 \* len4703/);
  });
  it('幻象弓 3540：本体出手改射 630 载体（在场唯一性守卫）', () => {
    expect(gameSrc).toMatch(/bowVid2 === 3540/);
    expect(gameSrc).toMatch(/projId === 630/);
  });
  it('发条突击步枪 434：点射档位 + multishot 注册 + 动画窗+rd14 冷却', () => {
    expect(gameSrc).toMatch(/bowVid2 === 434/);
    expect(gameSrc).toMatch(/spawnClockworkBurstShot/);
    // ★BJ651-R3：rd 段词缀烘定（reuseDelayBakedOf,Item.cs:569）——原裸表值式退役
    expect(gameSrc).toMatch(/animDur434 \+ reuseDelayBakedOf\(bowVid2, ps\?\.spd \?\? 1\)/);
    // 档位方向：i=1 中档 ×=1.05、i≥2 大档 ×=1.1（itemAnimation 倒数语义）
    expect(gameSrc).toMatch(/_cw434Idx === 1[\s\S]{0,140}\*= 1\.05/);
    expect(gameSrc).toMatch(/_cw434Idx >= 2[\s\S]{0,140}\*= 1\.1/);
  });
});

describe('R29 §11 弹药飞行拖尾族', () => {
  it.each([
    [41, [31, 6]],            // 地狱火箭烟+火双尘/update
  ])('地狱火箭 41 每 update d31+d6 双尘 noGravity', (pid, types) => {
    const g = makeGame(emptyWorld());
    const a = new Arrow(800, 100, 5, 0, 10, 0, pid as number, {});
    a.fixedUpdate(1 / 60, g);
    for (const t of types as number[]) {
      expect(rec(g).dusts.some((d) => d.type === t && d.noGravity)).toBe(true);
    }
  });
  it('冰雪弓箭 120：d67 出生点=position−velocity 且速度继承×0.3', () => {
    const g = makeGame(emptyWorld());
    const a = new Arrow(800, 100, 6, -2, 10, 0, 120, {});
    a.fixedUpdate(1 / 60, g);
    const d = rec(g).dusts.find((x) => x.type === 67);
    expect(d).toBeDefined();
    expect(d!.vx).toBeCloseTo(6 * 0.3, 5);
    expect(d!.noGravity).toBe(true);
  });
  it.each([[91], [225]])('圣箭/叶绿箭 %i 半概率尘（跑 60 步必有 d58|d15 / d40）', (pid) => {
    const g = makeGame(emptyWorld());
    const a = new Arrow(800, 100, 5, 0, 10, 0, pid, {});
    for (let i = 0; i < 60 && !a.dead; i++) a.fixedUpdate(1 / 60, g);
    const types = rec(g).dusts.map((d) => d.type);
    if (pid === 91) expect(types.some((t) => t === 58 || t === 15)).toBe(true);
    else expect(types).toContain(40);
  });
  it('毒液箭 282：d171 fadeIn1.5 noGravity;蜂箭 469 alpha255 起前 3 拍满隐后渐显', () => {
    const g = makeGame(emptyWorld());
    const a282 = new Arrow(800, 100, 5, 0, 10, 0, 282, {});
    a282.fixedUpdate(1 / 60, g);
    const d171 = rec(g).dusts.find((x) => x.type === 171);
    expect(d171).toBeDefined();
    expect((d171 as unknown as { fadeIn?: number }).fadeIn ?? 0).toBeGreaterThan(0);
    const g2 = makeGame(emptyWorld());
    const a469 = new Arrow(800, 100, 5, 0, 10, 0, 469, {});
    expect(a469.alpha).toBe(255);                    // SetDefaults :5437（本批补列）
    a469.fixedUpdate(1 / 60, g2);
    a469.fixedUpdate(1 / 60, g2);
    expect(a469.alpha).toBe(255);                    // localAI≤2 不衰减
    a469.fixedUpdate(1 / 60, g2);
    expect(a469.alpha).toBe(255 - 50);               // 之后 −50/update
  });
  it('血箭 819：首拍 8×d5 尘爆 + alpha 渐显 + 血迹回铺', () => {
    const g = makeGame(emptyWorld());
    const a = new Arrow(800, 100, 8, 0, 10, 0, 819, {});
    expect(a.alpha).toBe(255);
    a.fixedUpdate(1 / 60, g);
    expect(rec(g).dusts.filter((d) => d.type === 5).length).toBeGreaterThanOrEqual(8 + 5 - 2);
    expect(a.alpha).toBeLessThan(255);               // EU=1 → −20×2/拍 渐显
    expect(a.alpha).toBeGreaterThanOrEqual(215);
  });
});

describe('R29 §8 星星炮族行为面（注册前置,检测先行）', () => {
  it('自旋系数：( |vx|+|vy| )×0.01(955) / ×0.005(728)——红队 0.3 系数驳正', () => {
    const arrowSrc = readFileSync(new URL('../src/entities/Arrow.ts', import.meta.url), 'utf8');
    expect(arrowSrc).toMatch(/955: a => \(Math\.abs\(a\.vx\) \+ Math\.abs\(a\.vy\)\) \* 0\.01/);
    expect(arrowSrc).toMatch(/728: a => \(Math\.abs\(a\.vx\) \+ Math\.abs\(a\.vy\)\) \* 0\.005/);
  });
  it('955：Item_9 星啸 20-59t 节拍 + 闪烁档 0↔200;728：alpha 钳 100 半透', () => {
    const g = makeGame(emptyWorld());
    const a = new Arrow(800, 100, 14, 0, 55, 3, 955, {});
    expect(a.alpha).toBe(50);
    let item9 = 0;
    for (let i = 0; i < 130 && !a.dead; i++) {
      const n0 = rec(g).sfx.length;
      a.fixedUpdate(1 / 60, g);
      item9 += rec(g).sfx.slice(n0).filter((s) => s.includes('Item_9')).length;
    }
    expect(item9).toBeGreaterThanOrEqual(2);
    expect(a.alpha).toBeGreaterThanOrEqual(0);
    expect(a.alpha).toBeLessThanOrEqual(200);
    const b = new Arrow(800, 100, 20, 0, 60, 5, 728, {});
    b.fixedUpdate(1 / 60, g);
    expect(b.alpha).toBe(245);                       // 255−10
    for (let i = 0; i < 20; i++) b.fixedUpdate(1 / 60, g);
    expect(b.alpha).toBe(100);                       // 钳 100
  });
  it('Kill：Item10 + 7×d58 + 8+4×d278 双色环 + gore（onProjectileDeath 分支）', () => {
    const { g, sfx, dusts } = mkDeathGame();
    g.onProjectileDeath(955, 0, 0, 18, 18, 10, 0, 55, {});
    expect(sfx).toContain('Item_10');
    expect(dusts.filter((d) => d.type === 58).length).toBe(7);
    expect(dusts.filter((d) => d.type === 278).length).toBe(12);   // 8 CornflowerBlue + 4 Gold
    g.onProjectileDeath(728, 0, 0, 24, 24, -20, 0, 60, {});
    expect(dusts.filter((d) => d.type === 278).length).toBe(24);
  });
});

describe('R29 §12 弹药 Kill 面 + 子弹火花音族', () => {
  it('冰箭 120：dig 音 + 10×d67（前 5 noGravity,v×0.2）', () => {
    const { g, dusts } = mkDeathGame();
    g.onProjectileDeath(120, 0, 0, 10, 10, 5, 0, 10, {});
    const d67s = dusts.filter((d) => d.type === 67);
    expect(d67s.length).toBe(10);
    expect(d67s.filter((d) => d.noGravity).length).toBe(5);
    expect(d67s.every((d) => Math.abs(d.vx) < 5 * 0.2 + 0.01)).toBe(true);
  });
  it('叶绿箭 225：SoundID6(dig 变体)+5×d40;血箭 819：dig+20×d5', () => {
    const a = mkDeathGame();
    a.g.onProjectileDeath(225, 0, 0, 10, 10, 0, 0, 10, {});
    expect(a.dusts.filter((d) => d.type === 40).length).toBe(5);
    const b = mkDeathGame();
    b.g.onProjectileDeath(819, 0, 0, 10, 10, 6, 0, 10, {});
    expect(b.dusts.filter((d) => d.type === 5).length).toBe(20);
  });
  it('爆炸弹 286：Item14 + owner 本机 80px AoE 二次结算（近敌吃、远敌免）', () => {
    // ★BJ729-A（D2 残差清偿）DV 中性档钉值：286 Kill 重跑 DV+crit 收编后未 mock
    //  期望 15 必漂（13-17）——0.5 → tier 0 → ×1.0 恒等档,crit 掷同钉 false。
    const rvi286 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const near = { x: 20, y: -10, w: 20, h: 20 };    // 距爆心(0,0) ~28px ⊂ 80 盒
    const far = { x: 300, y: 300, w: 20, h: 20 };
    const { g, hurt, sfx, dusts } = mkDeathGame([near, far]);
    g.onProjectileDeath(286, -10, -10, 4, 4, 0, 0, 15, { hostile: false, kb: 2, arpen: 0, sc: 1 });
    expect(sfx).toContain('Item_14');
    expect(hurt.length).toBe(1);
    expect(hurt[0][1]).toBe(15);
    expect(dusts.filter((d) => d.type === 31).length).toBe(7);
    expect(dusts.filter((d) => d.type === 6).length).toBe(6);      // 3 循环×双枚
    rvi286.mockRestore();
  });
  it('子弹撞块火花音族 BULLET_KILL_SFX：1458 全量 24 型（含红队漏记的 389）', () => {
    for (const id of [14, 20, 88, 36, 83, 84, 389, 104, 279, 100, 110, 180,
      207, 357, 242, 302, 257, 259, 285, 287, 576, 577, 876, 968]) {
      expect(BULLET_KILL_SFX.has(id)).toBe(true);
    }
    const { g, sfx } = mkDeathGame();
    g.onProjectileDeath(14, 0, 0, 4, 4, 6, 0, 8, {});
    expect(sfx).toContain('Item_10');
  });
});
