// 电圈发射器 2796 导弹链回归（2026-08-24 补）：
//   442 导弹（AI_001 type 段 Projectile.cs:55689-55740）：锁定格 ai[0]/[1] =
//   发射时刻鼠标格（Player.cs:49905-49908 tileTargetX/Y + :25586-25604 钳）——
//   ★直线飞向锁定点（AI 段无 velocity 修正式，"追踪" = ≤16px 到点即 Kill
//   :55704-55710）+ α 255 起 −90/4t 渐显（:55691-55703，计数不复位 → 4/5/6 三拍
//   归零）+ alpha==0 后 120t 超时（:55708-55712）+ 青蓝光 (0.3,0.45,0.8)（:55713）
//   + 每 3t 8 粒 135 尘旋转环（scale 1.5/noGravity/绕速度角，v×0.66，:55714-55730）；
//   Kill（:74919-74945）= Item94 音 + 135 尘×Next(3,7)（scale 2.1/noGravity/×2）+
//   80×80 盒内旧 443 置替换态（ai[1]=1 + v=(新心−旧心)/5）+ 心部生成电球 443。
//   443 电球（aiStyle 77 :31192-31285）：α −50/t 渐显 / 替换态 +51/t 至 255 Kill /
//   ai[0] 120t 脉冲（盒 80×max(scale5,scale6)=60..80）/ 帧 3t 4 帧 / 226 尘环 /
//   timeLeft 300（:11067）/ 命中 immune[owner]=8（:14072-14074）。
//   ★弹型结论（用户报"外星霰弹枪子弹带追踪/青色"归因勘误）：异星泡泡枪 2797 泡沫
//   444 爆裂射出的是【弹药弹型】（localAI[0]=projToShoot=PickAmmo 结果，火枪弹→14，
//   Player.cs:48032-48047 + PickAmmo :54107），非 442 族——442=电圈发射器导弹
//   （ProjectileID.cs:1342 ElectrosphereMissile）、443=电球、444=泡沫。442 的
//   锁定点/尘环/青光全属 2796，与 2797 无关。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../src/core/Game';
import { Arrow } from '../src/entities/Arrow';
import { ElectroSphereProj, ELECTROSPHERE_LIFE, ELECTROSPHERE_IFRAMES } from '../src/entities/ElectroSphereProj';
import { damageVarRoll } from '../src/stats/DamageVar';   // ★G37-A：DV 域锁（bj735a 判例形）
import { TileStore } from '../src/world/TileStore';
import { resolveAmmoProjId, forceGunProjId } from '../src/data/vanillaItemCombat';
import type { GameHooks } from '../src/entities/types';
import type { VDust } from '../src/fx/VanillaDust';

const gameSrc = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
const arrowSrc = readFileSync(new URL('../src/entities/Arrow.ts', import.meta.url), 'utf8');

/** 442 行为桩：真 TileStore（全空气）+ 尘/音/生成记录 */
const mkMissileHooks = (enemies: unknown[] = []) => {
  const dusts: VDust[] = [];
  const sfx: string[] = [];
  const spawned: unknown[] = [];
  const store = new TileStore(400, 400);
  const g = {
    world: { store } as never,
    player: { dead: false, cx: -9999, cy: -9999, x: -9999, y: -9999, w: 20, h: 42 } as never,
    enemies: () => enemies,
    critters: () => [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: (files: string[]) => { sfx.push(...files); },
    showPickupLabel: () => {},
    spawnDust: (_x: number, _y: number, _w: number, _h: number, type: number,
      sx = 0, sy = 0, alpha = 0, _c = null, scale = 1, noGravity = false) => {
      const d = {
        active: true, x: _x, y: _y, vx: sx, vy: sy, type, scale, alpha,
        noGravity, fadeIn: 0, color: null, rotation: 0, fx: 0, fy: 0,
        followPlayer: false, followOnce: false, dyeVid: -1, noLight: false, noLightEmittance: false,
      } as unknown as VDust;
      dusts.push(d);
      return d;
    },
    entities: { add: (e: unknown) => { spawned.push(e); }, projectiles: spawned },
    onProjectileDeath: (Object.create(Game.prototype) as unknown as {
      onProjectileDeath: GameHooks['onProjectileDeath'];
    }).onProjectileDeath,
  } as unknown as GameHooks & { dusts: VDust[]; sfx: string[]; spawned: unknown[] };
  return Object.assign(g, { dusts, sfx, spawned });
};

describe('442 导弹：直线飞向锁定点（AI_001 :55689-55740，无逐帧转向）', () => {
  it('速度恒定（无 homing 修正式）；到点 ≤16px Kill（:55704-55710）', () => {
    // 锁定格 103 → 点 (103×16+8, 100×16+8) = (1656, 1608)；出生 (1600,1600) 向 +x 8/t
    const g = mkMissileHooks();
    const m = new Arrow(1600, 1600, 8, 0, 40, 2, 442, { aimPoint: { tx: 103, ty: 100 } });
    const v0x = m.vx, v0y = m.vy;
    let ticks = 0;
    while (!m.dead && ticks < 60) { m.fixedUpdate(1 / 60, g); ticks++; }
    expect(m.dead).toBe(true);
    expect(ticks).toBe(6);                       // t6 弹心距点 9px ≤16 → 杀（位移前判定）
    expect(m.cx).toBeGreaterThan(1640);          // 死在点前 ≤16px
    expect(m.cx).toBeLessThanOrEqual(1656);
    expect(v0x).toBe(8); expect(v0y).toBe(0);    // 全程零转向
  });

  it('渐显曲线：α 255→(t4)165→(t5)75→(t6)0（计数不复位语义 :55691-55703）', () => {
    const g = mkMissileHooks();
    const m = new Arrow(1600, 1600, 4, 0, 40, 2, 442, { aimPoint: { tx: 300, ty: 300 } });
    expect(m.alpha).toBe(255);
    m.fixedUpdate(1 / 60, g); m.fixedUpdate(1 / 60, g); m.fixedUpdate(1 / 60, g);
    expect(m.alpha).toBe(255);                   // t1-3 仅计数
    m.fixedUpdate(1 / 60, g);
    expect(m.alpha).toBe(165);                   // t4
    m.fixedUpdate(1 / 60, g);
    expect(m.alpha).toBe(75);                    // t5
    m.fixedUpdate(1 / 60, g);
    expect(m.alpha).toBe(0);                     // t6 钳 0
  });

  it('alpha==0 后 120t 超时 Kill（:55708-55712）——远点弹 t125 杀', () => {
    const g = mkMissileHooks();
    const m = new Arrow(1600, 1600, 4, 0, 40, 2, 442, { aimPoint: { tx: 5, ty: 5 } });
    for (let t = 0; t < 124; t++) m.fixedUpdate(1 / 60, g);
    expect(m.dead).toBe(false);                  // 渐显 6t（首拍即计超时）+ 119
    m.fixedUpdate(1 / 60, g);
    expect(m.dead).toBe(true);                   // 第 120 个 alpha==0 拍
  });

  it('青蓝光仅 alpha==0 期（:55713）：渐显期 null、之后 (0.3,0.45,0.8)', () => {
    const g = mkMissileHooks();
    const m = new Arrow(1600, 1600, 4, 0, 40, 2, 442, { aimPoint: { tx: 300, ty: 300 } });
    for (let t = 0; t < 5; t++) m.fixedUpdate(1 / 60, g);
    expect(m.lightRGB).toBeNull();
    m.fixedUpdate(1 / 60, g);                    // t6 α→0
    expect(m.lightRGB).toEqual([0.3, 0.45, 0.8]);
  });

  it('135 尘旋转环：每 3t 恰 8 粒（scale 1.5/noGravity/环距 ≤√80/v=v₀×0.66，:55714-55730）', () => {
    const g = mkMissileHooks();
    const m = new Arrow(1600, 1600, 6, 0, 40, 2, 442, { aimPoint: { tx: 300, ty: 300 } });
    for (let t = 0; t < 5; t++) m.fixedUpdate(1 / 60, g);
    expect(g.dusts.length).toBe(0);              // 渐显期（α>0）无环
    const cxBefore = m.cx, cyBefore = m.cy;      // 尘位 = 本拍位移前弹心（AI 段先于位移）
    m.fixedUpdate(1 / 60, g);                    // t6：α 钳 0 拍同 tick 进 α==0 段 → cnt 2→3 首环
    expect(g.dusts.length).toBe(8);
    for (const d of g.dusts) {
      expect(d.type).toBe(135);
      expect(d.scale).toBe(1.5);
      expect(d.noGravity).toBe(true);
      const off = Math.hypot(d.x - cxBefore, d.y - cyBefore);
      expect(off).toBeLessThanOrEqual(10 + 1e-9);   // |(−8+2sinθ,−4cosθ)| ≤ 10（θ=3π/2）
      expect(d.vx).toBeCloseTo(6 * 0.66, 6);
      expect(d.vy).toBeCloseTo(0, 6);
    }
    g.dusts.length = 0;
    m.fixedUpdate(1 / 60, g); m.fixedUpdate(1 / 60, g);     // t7/t8 空拍
    expect(g.dusts.length).toBe(0);
    m.fixedUpdate(1 / 60, g);                    // t9 再环
    expect(g.dusts.length).toBe(8);
  });
});

describe('442 Kill（:74919-74945）：Item94 + 135 尘爆 + 电球 443 生成/替换', () => {
  it('音 Item_94；尘 3-6 粒 type 135 scale 2.1 noGravity ×2；恰 1 颗 443（伤透传）', () => {
    const g = mkMissileHooks();
    g.onProjectileDeath!(442, 1000, 1000, 14, 14, 8, 0, 40, { hostile: false });
    expect(g.sfx).toContain('Item_94');
    expect(g.dusts.length).toBeGreaterThanOrEqual(3);
    expect(g.dusts.length).toBeLessThanOrEqual(6);
    for (const d of g.dusts) {
      expect(d.type).toBe(135);
      expect(d.scale).toBe(2.1);
      expect(d.noGravity).toBe(true);
    }
    expect(g.spawned.length).toBe(1);
    const s = g.spawned[0] as ElectroSphereProj;
    expect(s).toBeInstanceOf(ElectroSphereProj);
    expect(s.damage).toBe(40);
    expect(s.cx).toBe(1007);                     // Center（:74944）
    expect(s.cy).toBe(1007);
  });

  it('hostile 门（owner ≠ Main.myPlayer）不生成 443', () => {
    const g = mkMissileHooks();
    g.onProjectileDeath!(442, 1000, 1000, 14, 14, 8, 0, 40, { hostile: true });
    expect(g.spawned.length).toBe(0);
  });

  it('80×80 盒内旧 443 → 替换态 + 速度=(新心−旧心)/5（:74933-74940）；盒外不动', () => {
    const g = mkMissileHooks();
    const near = new ElectroSphereProj(1030, 1007, 40);   // 心距 23 <40
    const far = new ElectroSphereProj(1200, 1007, 40);
    g.spawned.push(near, far);
    (g as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles = g.spawned;
    g.onProjectileDeath!(442, 1000, 1000, 14, 14, 8, 0, 40, { hostile: false });
    expect(near.replaced).toBe(true);
    expect(near.vx).toBeCloseTo((1007 - 1030) / 5, 6);
    expect(far.replaced).toBe(false);
    expect(g.spawned.length).toBe(3);            // 旧二 + 新一
  });
});

describe('443 电球（aiStyle 77 :31192-31285）', () => {
  const mkFoe = (iframes = 0) => {
    const taken: Array<{ d: number; pen: number; crit: boolean }> = [];
    const foe = {
      x: 1580, y: 1580, w: 24, h: 48, id: 7, dead: false, vanillaId: null,
      cx: 1592, cy: 1604, iframes,
      hurt: (d: number, _kx: number, _ky: number, _g: unknown, pen: number, crit: boolean) => {
        taken.push({ d, pen, crit });
        return false;
      },
    };
    return { foe, taken };
  };

  it('寿命 300t（:11067）；脉冲盒 60..80 绕心缩放', () => {
    const g = mkMissileHooks();
    const s = new ElectroSphereProj(1600, 1600, 40);
    const sizes = new Set<number>();
    for (let t = 0; t < 299; t++) { s.fixedUpdate(1 / 60, g); sizes.add(s.w); }
    expect(s.dead).toBe(false);
    s.fixedUpdate(1 / 60, g);
    expect(s.dead).toBe(true);
    expect(ELECTROSPHERE_LIFE).toBe(300);
    for (const z of sizes) { expect(z).toBeGreaterThanOrEqual(60); expect(z).toBeLessThanOrEqual(80); }
  });

  it('命中：伤全额 + immune[owner]=8（:14072-14074）；8t 内不二跳、8t 后再跳', () => {
    const { foe, taken } = mkFoe(0);
    const g = mkMissileHooks([foe]);
    const s = new ElectroSphereProj(1592, 1604, 40);   // 压敌心
    s.fixedUpdate(1 / 60, g);
    expect(taken.length).toBe(1);
    // ★G37-A（D6,2026-10-31）改判史：443 敌臂补 DV :12970 逐靶掷（BJ729-A 登记债
    //  清偿）→ 旧平值钉 40 改 31 档 DV 域锁（bj735a 判例形,luck=0 单掷域）。
    const dvDomain443 = new Set<number>();
    for (let i = 0; i < 31; i++) dvDomain443.add(damageVarRoll(40, 0, () => i / 31));
    expect(dvDomain443.has(taken[0].d)).toBe(true);
    expect(foe.iframes).toBe(ELECTROSPHERE_IFRAMES);
    for (let t = 0; t < 8; t++) {
      foe.iframes = Math.max(0, (foe.iframes ?? 0) - 1);    // Enemy.update :1704 递减
      s.fixedUpdate(1 / 60, g);
    }
    expect(taken.length).toBe(2);                // 第 8 拍 iframes 归 0 → 再跳
  });

  it('替换态：+51/t 至 255 Kill（5 拍）；期间不结算伤害（friendly=false）', () => {
    const { foe, taken } = mkFoe(0);
    const g = mkMissileHooks([foe]);
    const s = new ElectroSphereProj(2600, 1600, 40);   // 远离敌盒渐显
    for (let t = 0; t < 6; t++) s.fixedUpdate(1 / 60, g);   // α=0
    s.x = foe.cx - s.w / 2; s.y = foe.cy - s.h / 2;   // 压上敌盒
    s.replaced = true;                           // 邻近新球置位（:74936）
    for (let t = 0; t < 4; t++) s.fixedUpdate(1 / 60, g);
    expect(s.dead).toBe(false);
    s.fixedUpdate(1 / 60, g);
    expect(s.dead).toBe(true);                   // 0→51→…→255 第 5 拍
    expect(taken.length).toBe(0);
    // 对照：α=255 出生即被替换 → 原版首拍即 Kill（alpha<255 门不过）
    const s2 = new ElectroSphereProj(2600, 1600, 40);
    s2.replaced = true;
    s2.fixedUpdate(1 / 60, g);
    expect(s2.dead).toBe(true);
  });

  it('渐显：α −50/t（:31205-31213）6 拍归零；226 尘环每帧 1-3 枚', () => {
    const g = mkMissileHooks();
    const s = new ElectroSphereProj(1600, 1600, 40);
    expect(s.alpha).toBe(255);
    for (let t = 0; t < 6; t++) s.fixedUpdate(1 / 60, g);
    expect(s.alpha).toBe(0);
    expect(g.dusts.length).toBeGreaterThanOrEqual(6);
    expect(g.dusts.length).toBeLessThanOrEqual(18);   // 每帧 1 + 1/2 + 1/4
    for (const d of g.dusts) expect(d.type).toBe(226);
  });
});

describe('弹型结论锁定（泡沫 444 爆裂 = 弹药弹型，非 442 族）', () => {
  it('PickAmmo 链：2797+火枪弹(97) → 14（:54107 item.shoot 直替换）；forceGunProjId 不改 2797', () => {
    expect(resolveAmmoProjId(2797, 97, 97, 444, 14)).toBe(14);
    expect(forceGunProjId(2797, 14)).toBe(14);
    // 对照：电圈发射器 2796 恒 442（:46539-46541）
    expect(forceGunProjId(2796, 999)).toBe(442);
  });

  it('Game 源码锚：2797 回调透传 projId（localAI[0]）/ 2796 传 aimPt 锁定格', () => {
    expect(gameSrc).toContain('const bubblePid = projId;');
    expect(gameSrc).toContain('bowVid2 === 2796');
    expect(gameSrc).toContain('bowArrow.aimPt');
    expect(arrowSrc).toContain('aimPoint?: { tx: number; ty: number }');
    expect(arrowSrc).toContain('projId === 442 && this.aimPt');
  });

  it('442 数据行（vanilla-projectiles.json：aiStyle 1 / 14×14 / timeLeft 600 / ranged）', () => {
    // 直飞语义由 projGravSpec(442).grav===0 锁（arrow-gravity-parity 已测），此处锁数据行
    const src = readFileSync(new URL('../src/data/vanilla-projectiles.json', import.meta.url), 'utf8');
    const row = JSON.parse(src)['442'];
    expect(row.aiStyle).toBe(1);
    expect(row.width).toBe(14);
    expect(row.timeLeft).toBe(600);
    expect(row.ranged).toBe(true);
  });
});
