// ★BJ382（2026-09-28）幽灵兜帽吸血 per-class 补课第一批回归（BJ380 登记债,proj1457
//  族除外——留 BJ381 收刀后二窗）。
// 定谳（Terarria1457/Terraria/Projectile.cs）：原版吸血链在 Projectile.Damage() 通用
//   on-hit 段【无弹号白名单】——:13712 flag10 / :13875 canGhostHeal 门 / :13877-79
//   ghostHeal(num41, victimCenter) / :14263 numHits++ 在 proc 后（读自增前值）。
// 本批九弹（239/245/255/260/461/632/535/656/856）数据面 magic 全 true（aiStyle
//   45/48/84/100/127/167,均 ≠59）⇒ 原版全部吃吸血,无弹类例外;本仓逐类漏接,本文件
//   锁接线 + 实参口径（BJ157-②③④ 同款）。单源 = SpectreSoulProj.ghostHealProc
//   （BJ382 自 LunarNebula 私有版提升为域导出,LunarNebula 行为面不变）。
// spy 面：hurt 萰 StrikeNPC——lastStrikeDealt = 防后实扣（num41 等位）。★X2-D1 勘误
//   （2026-09-29）：hurt 返假两族异义——门拒（iframes 残窗 :13972/dontTakeDamage
//   :13978）无 proc 无 numHits++;血尽级联/普通未致命（无门位返假）原版仍受理
//   （proc :13877-79/numHits++ :14263 无死亡复查）→ 照 proc 照计数（判据=!vanillaGated）。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import { RainCloudProj } from '../src/entities/WeaponProj';
import { BeamBoltProj } from '../src/entities/MagnetSphereProj';
import { PrismProj, PrismProng, BlasterBeam, ChargedBlaster } from '../src/entities/PrismProj';
import { MedusaHeadProj } from '../src/entities/MedusaHeadProj';
import { ForbiddenSignProj } from '../src/entities/ForbiddenSignProj';
import { SparkleGuitarProj } from '../src/entities/SparkleGuitarProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';

interface StealCall {
  kind: string; dmg: number; numHits: number; x: number; y: number; isMagic: boolean;
}

const DEFENSE = 22;   // 实扣 = 入伤 − 22（num41 防后口径）

function enemySpy(id: number, tx: number, ty: number, w = 24, h = 24,
  vanillaId: number | null = 15) {
  return {
    id, x: tx * TILE, y: ty * TILE, w, h, dead: false, vanillaId, maxHp: 100,
    lastStrikeDealt: 0, attempts: 0, iframes: 0,
    hurt(this: { lastStrikeDealt: number; attempts: number }, dmg: number): boolean {
      this.attempts++;
      this.lastStrikeDealt = Math.max(0, dmg - DEFENSE);
      return true;
    },
  };
}

/** 像素坐标版（632 束线/856 曲线点承接用） */
function enemySpyPx(id: number, px: number, py: number, w = 24, h = 24,
  vanillaId: number | null = 15) {
  const e = enemySpy(id, 0, 0, w, h, vanillaId);
  e.x = px; e.y = py;
  return e;
}

function makeGame(log: StealCall[], list: unknown[], player?: unknown): GameHooks {
  return {
    world: new World(160, 200, 30, 'bj382'),
    player: player ?? {
      buffs: { has: () => false },
      equipStats: {},
      critChance: () => 4,
    },
    enemies: () => list,
    entities: { nextId: 1, add: () => {} },
    playSfxFiles: () => {}, playSfx: () => {}, playSfxFile: () => {},
    playSfxWav: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, critters: () => [], notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number,
      x: number, y: number, isMagic?: boolean) => {
      log.push({ kind, dmg, numHits, x, y, isMagic: !!isMagic });
      return 0;
    },
  } as unknown as GameHooks;
}

// ================= ① 雨云雨滴 239/245（RainCloudProj.aiDrop → hitEnemies） =================

describe('BJ382 雨滴 239/245 ghostHeal proc（aiDrop → hitEnemies onAccepted 受理位）', () => {
  it('239 命中敌 → proc：dmg=num41 防后,numHits=0,出生点=受害者 Center,isMagic', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 79, 98);                        // 盒 1264..1288/1568..1592
    const game = makeGame(log, [e]);
    const rain = new RainCloudProj(80 * TILE, 97 * TILE, 0, 5, 130, 0, 239);
    rain.critChance = 0;
    // ★BJ726 改判史：W01(BJ723-B) hitEnemies 补 DV 掷(:12970)后防后值非确定（旧期望=
    //  平值 108=130−DEFENSE 不变,单跑实收 114/122/125… 随机漂移）——mock 0.5（tier 0,
    //  DV 恒等）恢复定值（BJ723-C M02 习语,同 §3/§4/§5）;生产 239 DV 掷=原版同构
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    rain.fixedUpdate(1, game);
    expect(e.lastStrikeDealt).toBe(130 - DEFENSE);
    expect(log.length).toBe(1);                           // ← 旧码 0 = 漏接病灶
    expect(log[0].kind).toBe('ghost');
    expect(log[0].dmg).toBe(130 - DEFENSE);
    expect(log[0].numHits).toBe(0);                       // :14263 自增在 proc 后
    expect(log[0].x).toBe(79 * TILE + 12);                // 受害者 Center（:13879）
    expect(log[0].y).toBe(98 * TILE + 12);
    expect(log[0].isMagic).toBe(true);                    // 239 magic 数据面
    expect(rain.pveNumHits).toBe(1);                      // 受理后自增
  });

  it('245 同 face（penetrate 2/magic）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 79, 98);
    const game = makeGame(log, [e]);
    const rain = new RainCloudProj(80 * TILE, 97 * TILE, 0, 5, 130, 0, 245);
    rain.critChance = 0;
    // ★BJ726 改判史：同 239——W01(BJ723-B) hitEnemies 补 DV 掷后非确定（旧期望=平值
    //  108 不变）,mock 0.5（tier 0,DV 恒等）恢复定值（BJ723-C M02 习语）
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    rain.fixedUpdate(1, game);
    expect(log.length).toBe(1);
    expect(log[0].dmg).toBe(130 - DEFENSE);
    expect(log[0].isMagic).toBe(true);
    expect(rain.pveNumHits).toBe(1);
  });

  it('拒收（hurt false）不 proc 不计数（原版 immune 门整跳）;共享免疫表 10t 不重复入账', () => {
    const log: StealCall[] = [];
    const e = enemySpy(99, 79, 98);                       // id 避让模块级共享免疫表（本文件前案已写 id1）
    e.hurt = () => { e.attempts++; return false; };
    // ★BJ393 件2 夹具忠实化：hurt 返假在真 Enemy 合同里两族异义（门拒 iframes 残窗 vs
    //  血尽级联/普通命中受理形态 Enemy.ts:14369/:15037）——本测模拟「immune 门整跳」,
    //  补 iframes=10 使 mock 与真门同相（hitEnemies vanillaGated 读字段,BJ382 时无此
    //  判据=mock 缺字段恰好掩盖;判据改 !vanillaGated 后缺字段返假会被正确读作受理）
    e.iframes = 10;
    const game = makeGame(log, [e]);
    const rain = new RainCloudProj(80 * TILE, 97 * TILE, 0, 5, 130, 0, 239);
    rain.critChance = 0;
    for (let t = 0; t < 6 && !rain.dead; t++) rain.fixedUpdate(1, game);
    expect(e.attempts).toBeGreaterThanOrEqual(1);
    expect(log.length).toBe(0);
    expect(rain.pveNumHits).toBe(0);
  });
});

// ================= ② 磁球激光 255 / 炼狱叉光束 260（BeamBoltProj） =================

describe('BJ382 磁球激光 255/炼狱叉 260 ghostHeal proc（BeamBoltProj ⑤Damage 段）', () => {
  it('255 命中敌 → proc（numHits=0,防后实扣,Center 出生）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 81, 99, 24, 24);
    Object.assign(e, { x: 81 * TILE - 4, y: 99 * TILE - 8 });   // 首子步位移 6px 后即重叠
    const game = makeGame(log, [e]);
    const bolt = new BeamBoltProj(80 * TILE, 100 * TILE, 6, 0, 130, 2, 255);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(e.lastStrikeDealt).toBe(130 - DEFENSE);
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].dmg).toBe(130 - DEFENSE);
    expect(log[0].numHits).toBe(0);
    expect(log[0].x).toBe(81 * TILE - 4 + 12);
    expect(log[0].isMagic).toBe(true);
    expect(bolt.pveNumHits).toBe(1);
    expect(bolt.dead).toBe(true);                         // 单发 flag3 命中即亡（铺束）
  });

  it('260 炼狱叉同 face', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 81, 99, 24, 24);
    Object.assign(e, { x: 81 * TILE - 4, y: 99 * TILE - 8 });
    const game = makeGame(log, [e]);
    const bolt = new BeamBoltProj(80 * TILE, 100 * TILE, 6, 0, 130, 2, 260);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(log.length).toBe(1);
    expect(log[0].numHits).toBe(0);
    expect(log[0].isMagic).toBe(true);
  });

  it('拒收不 proc 不计数', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 81, 99, 24, 24);
    Object.assign(e, { x: 81 * TILE - 4, y: 99 * TILE - 8 });
    // ★BJ395 夹具忠实化：255/260=pierce 1 单发 flag3（:12635 免疫门豁免）→ hurt 内
    //  iframes 拒收不可达,真 Enemy 可达门拒唯一载体=dontTakeDamage（:13978/外层
    //  :12600）。旧裸返假在旧布尔判据下恰被当拒收,新判据（!vanillaGated 读门位）下
    //  拒收须以门位承载。
    (e as { dontTakeDamage?: boolean }).dontTakeDamage = true;
    e.hurt = () => false;
    const game = makeGame(log, [e]);
    const bolt = new BeamBoltProj(80 * TILE, 100 * TILE, 6, 0, 130, 2, 255);
    bolt.critChance = 0;
    bolt.fixedUpdate(1, game);
    expect(log.length).toBe(0);
    expect(bolt.pveNumHits).toBe(0);
    expect(bolt.dead).toBe(true);                         // 结算独立于 proc
  });
});

// ================= ③ 棱镜光棱 632（PrismProng） =================

describe('BJ382 棱镜光棱 632 ghostHeal proc（PrismProng 线碰撞命中）', () => {
  it('充能中段命中 → proc（无 ×3,dmg=防后,numHits=0）', () => {
    // ★BJ723-C M02：632 DV 首掷后防后值非确定——mock 0.5（tier 0,DV 恒等）恢复定值
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const parent = new PrismProj(0, 1, 100, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    parent.x = 80 * TILE; parent.y = 98 * TILE;
    parent.charge = 60;
    const prong = new PrismProng(0, 100, 2);
    prong.parent = parent;
    prong.critChance = 0;
    parent.prongs.push(prong);
    prong.fixedUpdate(1 / 60, game);                      // 首拍定锚/束向
    // 敌 48×48 盒心钉在束线 d=60 处
    const bx = prong.cx + prong.vx * 60, by = prong.cy + prong.vy * 60;
    const e = enemySpyPx(1, bx - 24, by - 24, 48, 48);
    const g2 = { ...game, enemies: () => [e] } as unknown as GameHooks;
    g2.applyLifeSteal = game.applyLifeSteal;
    prong.fixedUpdate(1 / 60, g2);
    expect(e.lastStrikeDealt).toBe(100 - DEFENSE);        // charge<180 无 ×3
    expect(log.length).toBe(1);
    expect(log[0].kind).toBe('ghost');
    expect(log[0].numHits).toBe(0);
    expect(log[0].isMagic).toBe(true);                    // 632 magic 数据面
    expect(prong.pveNumHits).toBe(1);
  });

  it('同拍两敌 numHits 衰减 0→1（:14263 逐受理自增）', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const parent = new PrismProj(0, 1, 100, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    parent.x = 80 * TILE; parent.y = 98 * TILE;
    parent.charge = 60;
    const prong = new PrismProng(0, 100, 2);
    prong.parent = parent;
    prong.critChance = 0;
    parent.prongs.push(prong);
    prong.fixedUpdate(1 / 60, game);
    const bx = prong.cx, by = prong.cy;
    const a = enemySpyPx(1, bx + prong.vx * 60 - 24, by + prong.vy * 60 - 24, 48, 48);
    const b = enemySpyPx(2, bx + prong.vx * 180 - 24, by + prong.vy * 180 - 24, 48, 48);
    const g2 = { ...game, enemies: () => [a, b] } as unknown as GameHooks;
    g2.applyLifeSteal = game.applyLifeSteal;
    prong.fixedUpdate(1 / 60, g2);
    expect(log.map((c) => c.numHits)).toEqual([0, 1]);
    expect(prong.pveNumHits).toBe(2);
  });
});

// ================= ④ 充能爆破炮光束 461（BlasterBeam） =================

describe('BJ382 充能爆破炮光束 461 ghostHeal proc（BlasterBeam 线碰撞命中）', () => {
  it('同拍两敌 numHits 衰减 0→1;防后实扣', () => {
    // ★BJ723-C M02：461 DV 首掷后防后值非确定——mock 0.5（tier 0,DV 恒等）恢复定值
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const cb = new ChargedBlaster(1, 0, 130, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    cb.x = 80 * TILE; cb.y = 99 * TILE;
    const beam = new BlasterBeam(130, 2);
    beam.parent = cb;
    beam.critChance = 0;
    const bcx = cb.cx + cb.dirX * 16, bcy = cb.cy;        // 锚定束心（dir=(1,0)）
    const a = enemySpyPx(1, bcx + 48 - 24, bcy - 24, 48, 48);
    const b = enemySpyPx(2, bcx + 168 - 24, bcy - 24, 48, 48);
    const g2 = { ...game, enemies: () => [a, b] } as unknown as GameHooks;
    g2.applyLifeSteal = game.applyLifeSteal;
    beam.fixedUpdate(1 / 60, g2);
    expect(a.lastStrikeDealt).toBe(130 - DEFENSE);
    expect(log.map((c) => c.numHits)).toEqual([0, 1]);
    expect(log.every((c) => c.kind === 'ghost' && c.isMagic)).toBe(true);
    expect(beam.pveNumHits).toBe(2);
  });

  it('拒收（门拒形态 iframes>0,hurt false）不 proc 不计数——★X2-D1 夹具忠实化', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const cb = new ChargedBlaster(1, 0, 130, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    cb.x = 80 * TILE; cb.y = 99 * TILE;
    const beam = new BlasterBeam(130, 2);
    beam.parent = cb;
    beam.critChance = 0;
    const bcx = cb.cx + cb.dirX * 16, bcy = cb.cy;
    const a = enemySpyPx(1, bcx + 48 - 24, bcy - 24, 48, 48);
    a.hurt = () => false;
    // ★X2-D1 夹具忠实化：hurt 返假两族异义（门拒 iframes 残窗 vs 血尽级联/普通
    //  未致命受理形态）——461 hurt 传 pierce=0 → iframes 门可达,门拒形态须以
    //  【调用前】iframes 值承载（真 Enemy :13972 读前值）。
    a.iframes = 5;
    const g2 = { ...game, enemies: () => [a] } as unknown as GameHooks;
    g2.applyLifeSteal = game.applyLifeSteal;
    beam.fixedUpdate(1 / 60, g2);
    expect(log.length).toBe(0);
    expect(beam.pveNumHits).toBe(0);
  });

  it('受理（普通未致命形态,hurt 返假无门位）照 proc 照计数——★X2-D1 判别面', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const cb = new ChargedBlaster(1, 0, 130, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    cb.x = 80 * TILE; cb.y = 99 * TILE;
    const beam = new BlasterBeam(130, 2);
    beam.parent = cb;
    beam.critChance = 0;
    const bcx = cb.cx + cb.dirX * 16, bcy = cb.cy;
    const a = enemySpyPx(1, bcx + 48 - 24, bcy - 24, 48, 48);
    a.hurt = () => false;                                 // 血尽级联/普通未致命形态（无门位）
    const g2 = { ...game, enemies: () => [a] } as unknown as GameHooks;
    g2.applyLifeSteal = game.applyLifeSteal;
    beam.fixedUpdate(1 / 60, g2);
    expect(log.length).toBe(1);                           // 非门拒=受理 → proc 照达
    expect(log[0].numHits).toBe(0);
    expect(beam.pveNumHits).toBe(1);
  });
});

// ================= ⑤ 美杜莎凝视束 536（MedusaHeadProj volley 即时结算） =================

describe('BJ382 美杜莎 volley 536 ghostHeal proc（每目标独立束,numHits 恒 0 档）', () => {
  it('单目标 → proc（结算载体 536 magic,dmg=防后,Center 出生）', () => {
    // ★BJ723-C M02：凝视束 DV 首掷后防后值非确定——mock 0.5（tier 0,DV 恒等）恢复定值
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const log: StealCall[] = [];
    const p = new Player(80 * TILE, 100 * TILE, new Inventory());
    p.useTime = 10;                                       // channel 电平
    p.mana = 200;
    const e = enemySpy(1, 81, 100);                       // 距手 17px < 320
    const game = makeGame(log, [e], p);
    const m = new MedusaHeadProj(p, 130, 2, 0, 0);    // critChance=0 关断钉（BJ497③ 摘死形参后 5 参形）;掷面 rollVanillaHitCrit owner 聚合 0=不暴击
    m.fixedUpdate(1 / 60, game);
    expect(e.lastStrikeDealt).toBe(130 - DEFENSE);
    expect(log.length).toBe(1);                           // ← 旧码 0 = 漏接病灶
    expect(log[0].kind).toBe('ghost');
    expect(log[0].dmg).toBe(130 - DEFENSE);
    expect(log[0].numHits).toBe(0);
    expect(log[0].isMagic).toBe(true);                    // 536 magic 数据面
    (m as unknown as { retire(): void }).retire();        // 清静态在场单例
  });

  it('同 volley 三目标全 0 档（原版逐目标独立 NewProjectile(536),numHits 逐弹独立）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ723-C M02：DV 恒等档定值
    const log: StealCall[] = [];
    const p = new Player(80 * TILE, 100 * TILE, new Inventory());
    p.useTime = 10; p.mana = 200;
    const a = enemySpy(1, 81, 100);
    const b = enemySpy(2, 82, 100);
    const c = enemySpy(3, 83, 100);
    const game = makeGame(log, [a, b, c], p);
    const m = new MedusaHeadProj(p, 130, 2, 0, 0);
    m.fixedUpdate(1 / 60, game);
    expect(log.map((x) => x.numHits)).toEqual([0, 0, 0]); // ← 与 634/656 的衰减面判别
    expect(a.lastStrikeDealt).toBe(130 - DEFENSE);
    (m as unknown as { retire(): void }).retire();
  });
});

// ================= ⑥ 禁戒沙暴柱 656（ForbiddenSignProj.runContactHits） =================

describe('BJ382 禁戒沙暴柱 656 ghostHeal proc（柱身盒接触,numHits 与 :14245 hitCount 分立）', () => {
  it('命中敌 → proc（numHits=0,防后实扣）;hitCount 照走', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 79, 98);                        // 柱列内（px=80）
    const game = makeGame(log, [e], {
      cx: 40 * TILE, cy: 50 * TILE, y: 50 * TILE, equipStats: { critMagic: 0 },
    });
    const storm = new ForbiddenSignProj(80 * TILE, 97 * TILE, 130);
    storm.fixedUpdate(1 / 60, game);
    expect(e.lastStrikeDealt).toBe(130 - DEFENSE);
    expect(log.length).toBe(1);                           // ← 旧码 0 = 漏接病灶
    expect(log[0].kind).toBe('ghost');
    expect(log[0].dmg).toBe(130 - DEFENSE);
    expect(log[0].numHits).toBe(0);
    expect(log[0].isMagic).toBe(true);                    // 656 magic 数据面
    expect(storm.pveNumHits).toBe(1);
    expect(storm.hitCount).toBe(1);                       // localAI[0] 独立计数
  });

  it('同拍两敌 numHits 衰减 0→1', () => {
    const log: StealCall[] = [];
    const a = enemySpy(1, 79, 98);
    const b = enemySpy(2, 80, 98);
    const game = makeGame(log, [a, b], {
      cx: 40 * TILE, cy: 50 * TILE, y: 50 * TILE, equipStats: { critMagic: 0 },
    });
    const storm = new ForbiddenSignProj(80 * TILE, 97 * TILE, 130);
    storm.fixedUpdate(1 / 60, game);
    expect(log.map((c) => c.numHits)).toEqual([0, 1]);
    expect(storm.pveNumHits).toBe(2);
    expect(storm.hitCount).toBe(2);
  });

  it('拒收不 proc 不计数不记帽（pveNumHits=0,hitCount=0）——★BJ385 受理位修正（BJ382 既有位登记债清偿：localImmune 写/:14245 hitCount++ 原版在 StrikeNPC :13702 后受理面内,拒收跳 :12634-12637 整跳 return 三写全不达;旧 iframes 残窗虚增帽反模式退役）', () => {
    const log: StealCall[] = [];
    const e = enemySpy(1, 79, 98);
    // ★BJ395 夹具忠实化：本测试自述拒收形态=「iframes 残窗」（:12634-12637 整跳
    //  return）——残窗须以【调用前】iframes 值承载（真 Enemy :13972 读前值）,
    //  旧裸返假缺载体=新判据下拒收形态不可见（tallEnemy/flakyEnemy 同式）。
    e.iframes = 2;
    e.hurt = () => false;
    const game = makeGame(log, [e], {
      cx: 40 * TILE, cy: 50 * TILE, y: 50 * TILE, equipStats: { critMagic: 0 },
    });
    const storm = new ForbiddenSignProj(80 * TILE, 97 * TILE, 130);
    storm.fixedUpdate(1 / 60, game);
    expect(log.length).toBe(0);
    expect(storm.pveNumHits).toBe(0);
    expect(storm.hitCount).toBe(0);                       // ★BJ385：拒收面不再 ++（受理位）
  });
});

// ================= ⑦ 星璇之音 856（SparkleGuitarProj 直击+Kill 爆裂同链） =================

describe('BJ382 星璇之音 856 ghostHeal proc（直击受理 + Kill 爆裂轮同弹 numHits 累积）', () => {
  it('直击 a（0 档）→ Kill 爆裂命中 b（1 档）——同一弹对象 :72840 Damage() numHits 累积', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, [], {
      cx: 70 * TILE, cy: 100 * TILE, x: 70 * TILE - 11, y: 100 * TILE - 22, w: 22, h: 44,
    });
    const g = new SparkleGuitarProj(80 * TILE, 100 * TILE, 50, 0, 130, 80 * TILE, 100 * TILE);
    g.critChance = 0;
    g.fixedUpdate(1 / 60, game);                          // 首子步定曲线位（≈玩家手前）
    const a = enemySpyPx(1, g.cx - 16, g.cy - 16, 32, 32);
    const b = enemySpyPx(2, g.cx + 40, g.cy - 24, 48, 48); // 爆裂盒（弹心±64）内
    const g2 = { ...game, enemies: () => [a, b] } as unknown as GameHooks;
    g2.applyLifeSteal = game.applyLifeSteal;
    g.fixedUpdate(1 / 60, g2);
    expect(a.lastStrikeDealt).toBe(130 - DEFENSE);
    expect(g.dead).toBe(true);                            // 直击耗穿 → 同拍 Kill 爆裂
    expect(log.map((c) => c.numHits)).toEqual([0, 1]);
    expect(log.every((c) => c.kind === 'ghost' && c.isMagic)).toBe(true);
    expect(g.pveNumHits).toBe(2);
  });

  it('拒收（门拒形态 iframes>0,hurt false）不 proc 不计数（爆裂轮跳过已标免疫敌）——★X2-D1 夹具忠实化', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, [], {
      cx: 70 * TILE, cy: 100 * TILE, x: 70 * TILE - 11, y: 100 * TILE - 22, w: 22, h: 44,
    });
    const g = new SparkleGuitarProj(80 * TILE, 100 * TILE, 50, 0, 130, 80 * TILE, 100 * TILE);
    g.critChance = 0;
    g.fixedUpdate(1 / 60, game);
    const a = enemySpyPx(1, g.cx - 16, g.cy - 16, 32, 32);
    a.hurt = () => false;
    // ★X2-D1 夹具忠实化：hurt 返假两族异义——856 hurt 传 pierce=0 → iframes 门可达,
    //  门拒形态须以【调用前】iframes 值承载（真 Enemy :13972 读前值）。
    a.iframes = 5;
    const g2 = { ...game, enemies: () => [a] } as unknown as GameHooks;
    g2.applyLifeSteal = game.applyLifeSteal;
    g.fixedUpdate(1 / 60, g2);
    expect(log.length).toBe(0);
    expect(g.pveNumHits).toBe(0);
  });

  it('受理（普通未致命形态,hurt 返假无门位）照 proc 照计数（直击 a 0 档 + 爆裂 b 1 档）——★X2-D1 判别面', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, [], {
      cx: 70 * TILE, cy: 100 * TILE, x: 70 * TILE - 11, y: 100 * TILE - 22, w: 22, h: 44,
    });
    const g = new SparkleGuitarProj(80 * TILE, 100 * TILE, 50, 0, 130, 80 * TILE, 100 * TILE);
    g.critChance = 0;
    g.fixedUpdate(1 / 60, game);
    const a = enemySpyPx(1, g.cx - 16, g.cy - 16, 32, 32);
    const b = enemySpyPx(2, g.cx + 40, g.cy - 24, 48, 48); // 爆裂盒（弹心±64）内,直击未触
    a.hurt = () => false;                                 // 血尽级联/普通未致命形态（无门位）
    b.hurt = () => false;
    const g2 = { ...game, enemies: () => [a, b] } as unknown as GameHooks;
    g2.applyLifeSteal = game.applyLifeSteal;
    g.fixedUpdate(1 / 60, g2);
    expect(log.length).toBe(2);                           // 直击受理 + 爆裂轮受理（返假≠拒收）
    expect(log.map((c) => c.numHits)).toEqual([0, 1]);    // 同弹 numHits 累积
    expect(g.pveNumHits).toBe(2);
  });
});
