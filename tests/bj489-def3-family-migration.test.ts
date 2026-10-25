// ★BJ489（2026-10-04）def-3 静态冻结载体活家族逐面迁移判别测试（BJ486 新登记 ⑤）：
//   家族=Game.ts useCombatWeapon 挥击面 critTotal（:18542 GetWeaponCrit 三件=基 4+
//   owner 装备/buff 聚合+持械 item.crit/词缀 crt）在 spawn 拍冻结进载体 critChance 的
//   全部「有读者」写位（28 面,普查见本测试 §1）——值含挥击面三件=数值近原版（:25712
//   定谳）,但为出生拍冻结非命中拍动态。本批逐面迁移：
//     · 共享注入支（hitEnemies :446）→ critChance>0 门 + rollVanillaHitCrit（命中拍
//       owner 装配+:25712 持械折入动态;projId 类旗定谳）;
//     · 类自有读者（prism/磁球/魔弹/飞刀/天龙/武僧/火石/彩虹/星云/月耀/破晓/手雷）
//       同式迁移;
//     · Arrow 通用环走路由集（190/304/424-426/459——critBonus 族零漂移）;
//     · 关断钉保留=测试置 0 习语（critChance≤0 → 掷面整门关,旧掷式 ≤0 恒假同相）。
//   判别力（旧冻结码必红项）：§2a 命中拍换聚合→掷率变（旧冻结阈值必红）;§2b 持械折入
//     命中拍现值（旧出生拍冻结必红）;§3a 炸弹族 28 无类旗零掷（旧 critTotal ~4%+ 必红）;
//     §3c 手雷族 30 ranged 旗动态掷;§4 关断钉（旧无门面必红）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { GameHooks } from '../src/entities/types';
import { hitEnemies, HitCooldown } from '../src/entities/WeaponProj';
import { rollVanillaHitCrit } from '../src/entities/proj1457';
import { PrismProj, PrismProng } from '../src/entities/PrismProj';
import { ITEM_DEFS } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { prefixStat } from '../src/data/vanillaPrefixes';
import { TileStore } from '../src/world/TileStore';
import { TILE } from '../src/core/constants';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');

interface HurtCall { dmg: number; crit: boolean }

function mkEnemy(id: number, x: number, y: number, w = 24, h = 24) {
  const calls: HurtCall[] = [];
  const e = {
    id, x, y, w, h, dead: false, vanillaId: 15 as number | null, maxHp: 100, hp: 100,
    iframes: 0, dontTakeDamage: false, lastStrikeDealt: 0, attempts: 0,
    get cx() { return this.x + this.w / 2; },
    get cy() { return this.y + this.h / 2; },
    hurt(this: { attempts: number; lastStrikeDealt: number }, dmg: number,
      _kx: number, _ky: number, _g: unknown, _pen: number, crit: boolean): boolean {
      this.attempts++;
      this.lastStrikeDealt = dmg;
      calls.push({ dmg, crit: !!crit });
      return true;
    },
  };
  return { e, calls };
}

/** bj383/bj488 夹具同源（全钩桩;player.critChance 可变聚合由闭包承载） */
function makeHooks(opts: {
  enemies?: unknown[];
  player?: Record<string, unknown>;
} = {}): GameHooks {
  const player = {
    equipStats: {}, cx: 80 * TILE, cy: 90 * TILE, x: 80 * TILE - 10, y: 90 * TILE - 21,
    w: 20, h: 42, dead: false, facing: 1, vx: 0, vy: 0,
    buffs: { has: () => false },
    ...opts.player,
  };
  return {
    world: { store: new TileStore(200, 120) } as never,
    player,
    enemies: () => opts.enemies ?? [],
    critters: () => [],
    npcs: () => [],
    projectiles: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    cutTilesBox: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {}, playSfxAt: () => {},
    showPickupLabel: () => {},
    addLightAt: () => {},
    spawnDust: () => null,
    startLoopSfx: () => ({ stop: () => {}, setVolume: () => {}, playing: true, dead: false }),
    stack: { anyTagged: () => false, hasActiveEffect: () => false },
  } as unknown as GameHooks;
}

afterEach(() => { vi.restoreAllMocks(); });

// ================= §1 清单全量结构锁（28 面零残留+掷率口径+锚位） =================

describe('BJ489-§1：def-3 家族全清单结构锁（写位零残留+读者掷率口径+projId 锚）', () => {
  const gameCode = () => SRC('core/Game.ts').replace(/^\s*\/\/[^\n]*/gm, '');   // 剥注释行防锚注自噬

  it('1a 挥击面 24 个冻结写位=盘上零残留（原 X.critChance = critTotal 全数摘除）', () => {
    const s = gameCode();
    const removed = [
      'wave', 'thrownBomb', 'bom', 'spear', 'anchored', 'flailP', 'head', 'bub',
      'yoyo', 'sphere', 'bolt260', 'star', 'cloud', 'bl', 'prism', 'm',
      'knife', 'flare', 'spin', 'glaive', 'ghast',
    ];
    for (const v of removed) {
      expect(new RegExp(`^\\s*${v}\\.critChance\\s*=\\s*critTotal;`, 'm').test(s)).toBe(false);
    }
    // 双写位名（250/634 各一）+ 304 专支 knife：逐位显式锚
    expect(s).not.toContain('bolt.critChance = critTotal;');
    expect(s).not.toContain('knife.critChance = critTotal;');
  });

  it('1b Arrow 路由集三写位=0.04 路由门（值不作掷率消费）+旧冻结式零残留', () => {
    const s = gameCode();
    expect(s).toContain('probe2.critChance = 0.04;');
    expect(s).toContain('pg.critChance = 0.04;');
    expect(s).toContain('knife.critChance = 0.04;');
    expect(s).not.toContain('probe2.critChance = critTotal;');
    expect(s).not.toContain('pg.critChance = critTotal;');
  });

  it('1c Arrow 路由集内容锁：190/304/424-426/459（critBonus 族零漂移边界）', () => {
    const s = SRC('entities/Arrow.ts').replace(/^\s*\/\/[^\n]*/gm, '');
    expect(s).toContain('const DEF3_VANILLA_ROLL_PROJS = new Set([190, 304, 424, 425, 426, 459]);');
    // 通用环=路由集成员走 rollVanillaHitCrit,非成员旧路径保持
    expect(s).toContain('DEF3_VANILLA_ROLL_PROJS.has(this.projId)');
    // ★BJ496①③（2026-10-04）：主环掷入 classOverride=this.projClass（spawn 位类别
    //  旗覆写通道——181/566 蜂族数据面零旗,原版三连掷读实旗）;旧形（无第 4 参）退役。
    expect(s).toContain('this.critChance > 0 && rollVanillaHitCrit(this.projId, game, 0, this.projClass)');
    expect(s).toContain('this.critChance ?? (4 + this.critBonus) / 100');   // 旧路径原样
  });

  it('1d 各载体读者掷率口径=rollVanillaHitCrit（逐文件计数锚）', () => {
    const counts: Array<[string, number]> = [
      ['entities/WeaponProj.ts', 5],        // hitEnemies 注入支+手雷接触环×2+破晓 636+悠悠球伴生 1125/1130/1134/1135（★BJ494）
      ['entities/Arrow.ts', 11],       // ★BJ496①③：通用环+661 爆面+617/659 爆面+whipTagShot 支（旧 2）;★BJ497①：五遗留面收编（:1848 1023/:5372 631/:7337+:9309 514 双面/:10424 190,5→10）;★BJ704-G24：烟花 167-170 爆面 AoE 掷率（killNow :5202 critFw,10→11——该批漏改本计数锚,BJ708-G28 顺手清记账）
      ['entities/MagnetSphereProj.ts', 1],  // 255/260 BeamBoltProj
      ['entities/LunarNebula.ts', 3],       // 634/635 飞行盒+Kill 爆+645
      ['entities/RainbowProj.ts', 1],       // 251 段
      ['entities/PrismProj.ts', 2],         // 632 光棱+461 光束
      ['entities/MissileProj.ts', 4],       // 16/34/79 直击+Kill 爆+491+星怒 9（BJ486③ 既有）
      ['entities/MonkStaffFury.ts', 4],     // 697/699/700+武僧蓄爆 25（BJ486④ 既有）
      ['entities/SkyDragonFury.ts', 4],     // 707+708/709/1110（★BJ492② 右键三型收编,swCrit 载体退役）
      ['entities/DeadCellsFlint.ts', 2],    // 1043 波+1041 尖刺
    ];
    for (const [f, n] of counts) {
      const hits = SRC(f).split('rollVanillaHitCrit(').length - 1;
      expect(hits).toBe(n);
    }
  });

  it('1e 载体类 projId 锚+路由门缺省面（GrenadeProj/BeamBoltProj/MagnetSphereProj 0.04）', () => {
    const wp = SRC('entities/WeaponProj.ts');
    expect(wp).toContain('readonly projId = 636;');          // DaybreakFlare
    expect(SRC('entities/MissileProj.ts')).toContain('readonly projId = 491;');   // FlyingKnifeProj
    // GrenadeProj 类缺省 0.04（路由门;旧 0=掷面恒关会造成手雷族 ranged 旗永不掷）——
    // 锁定在 GrenadeProj 类段内（防懒惰匹配跨类滑窗;M7 变异判别面）
    const gpStart = wp.indexOf('export class GrenadeProj');
    const gpEnd = wp.indexOf('export class GlowstickProj');
    expect(gpStart).toBeGreaterThanOrEqual(0);
    expect(gpEnd).toBeGreaterThan(gpStart);
    const gp = wp.slice(gpStart, gpEnd);
    expect(/contactKb = 0;\s*\n\s*\/\*\* ★BJ489 def-3：值不作掷率消费[\s\S]*?\*\/\s*\n\s*critChance = 0\.04;/.test(gp)).toBe(true);
    expect(gp.split('critChance = 0.04;').length - 1).toBe(1);   // 段内唯一缺省位
    const msp = SRC('entities/MagnetSphereProj.ts');
    expect(/critChance = 0\.04;/.test(msp)).toBe(true);      // BeamBoltProj+球本体双位
    expect(/critChance = 0;/.test(msp)).toBe(false);
  });

  it('1f 悠悠球传播链保留（克隆/二号球/配重球关断钉载体零漂移）', () => {
    const s = gameCode();
    expect(s).toContain('clone.critChance = yoyo.critChance;');
    expect(s).toContain('second.critChance = lastYoyo.critChance;');
    expect(s).toContain('cwE.critChance = src?.critChance ?? 0.04;');
  });

  it('1g emitFlintSpikes 入参载体=关断钉传播面（1041 尖刺掷率走实体面 rollVanillaHitCrit）', () => {
    const f = SRC('entities/DeadCellsFlint.ts');
    expect(f).toContain('spike.critChance = critChance;');   // 传播写位保留（钉载体）
    expect(f).toContain('this.critChance > 0 && rollVanillaHitCrit(this.projId, game)');
  });
});

// ================= §2 动态性判别（冻结病负向锁） =================

describe('BJ489-§2：命中拍动态（旧出生拍冻结码必红）', () => {
  it('2a hitEnemies 注入支：命中拍换 owner 聚合 → 同 random 值掷率翻转（冻结阈值必红）', () => {
    let agg = 0;
    const mk = () => makeHooks({
      player: { critChance: () => agg, inv: { heldItem: () => null } },
    });
    // 家族载体形态：critChance=0.04 路由门（迁移后 spawn 位不再注入冻结率）+ai3 回旋镖 153 melee 旗
    const carrier = { x: 60 * TILE, y: 60 * TILE, w: 22, h: 22, vx: 1,
      damage: 10, knockback: 1, projId: 153, critChance: 0.04 };
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // 0.04 档假 / 0.54 档真
    const a = mkEnemy(41, 60 * TILE, 60 * TILE);
    const gA = mk(); gA.enemies = () => [a.e] as never;
    hitEnemies({ ...carrier }, gA, new HitCooldown(), 10, 1, 0);
    expect(a.calls[0].crit).toBe(false);             // 聚合 0：0.5<0.04 假
    agg = 50;                                        // ★命中拍换装配（挥击拍冻结病=同值仍假）
    const b = mkEnemy(42, 60 * TILE, 60 * TILE);
    const gB = mk(); gB.enemies = () => [b.e] as never;
    hitEnemies({ ...carrier }, gB, new HitCooldown(), 10, 1, 0);
    expect(b.calls[0].crit).toBe(true);              // 0.5<0.54 真——动态读现值
  });

  it('2b :25712 持械折入命中拍现值：held 键匙刃 671（crit16）+词缀 61（crt+5）→ 阈值抬至 0.25', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    expect(id671).toBeGreaterThanOrEqual(0);
    expect(itemCombat(671)?.crit).toBe(16);
    expect(prefixStat(61).crt).toBe(5);
    const carrier = { x: 60 * TILE, y: 60 * TILE, w: 22, h: 22, vx: 1,
      damage: 10, knockback: 1, projId: 153, critChance: 0.04 };
    vi.spyOn(Math, 'random').mockReturnValue(0.22);  // 0.04/0.20 档假 / 0.25 档真
    const e = mkEnemy(43, 60 * TILE, 60 * TILE);
    const g = makeHooks({
      enemies: [e.e],
      player: { critChance: () => 0, inv: { heldItem: () => ({ id: id671, prefix: 61 }) } },
    });
    hitEnemies({ ...carrier }, g, new HitCooldown(), 10, 1, 0);
    expect(e.calls[0].crit).toBe(true);              // 命中拍折入 item.crit+crt（冻结载体不带此段）
  });
});

// ================= §3 抽样型为判别（bomb/spear/yoyo/prism） =================

describe('BJ489-§3：抽样型定谳判别', () => {
  it('3a bomb：28/29 炸弹族 SetDefaults 无类旗（P.cs:1108-1123）→ 零掷（旧 critTotal 冻结掷必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0);   // 若误掷必中
    const g = makeHooks({ player: { critChance: () => 50 } });
    expect(rollVanillaHitCrit(28, g)).toBe(false);   // Bomb：原版零掷（原冻结 critTotal≈4%+ 可掷=病）
    expect(rollVanillaHitCrit(29, g)).toBe(false);   // Dynamite 同支
    expect(rollVanillaHitCrit(37, g)).toBe(false);   // Sticky Bomb
  });

  it('3b 手雷族 30 ranged 旗（P.cs:1131）→ 命中拍动态掷可达（GrenadeProj 类缺省 0.04 路由门）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.03);
    const g = makeHooks({ player: { critChance: () => 0, inv: { heldItem: () => null } } });
    expect(rollVanillaHitCrit(30, g)).toBe(true);    // 0.03<0.04 基档真（ranged 旗掷面在）
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(rollVanillaHitCrit(30, g)).toBe(false);   // 阈值上界对照
  });

  it('3c spear/yoyo：ai19/ai99 全族 melee 旗掷面在+载体写位零残留（222/541 抽样）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const g = makeHooks({ player: { critChance: () => 0, inv: { heldItem: () => null } } });
    expect(rollVanillaHitCrit(222, g)).toBe(false);  // 0.5<0.04 假=掷面在且阈值正确
    expect(rollVanillaHitCrit(541, g)).toBe(false);
    vi.spyOn(Math, 'random').mockReturnValue(0.03);
    expect(rollVanillaHitCrit(222, g)).toBe(true);   // 基档可达
    expect(rollVanillaHitCrit(541, g)).toBe(true);
    const s = SRC('core/Game.ts').replace(/^\s*\/\/[^\n]*/gm, '');
    expect(s).not.toContain('spear.critChance = critTotal;');
    expect(s).not.toContain('yoyo.critChance = critTotal;');
  });

  it('3d prism：632 光棱掷率=rollVanillaHitCrit（magic 旗）+命中拍聚合可掷（bj382 夹具同式）', () => {
    const parent = new PrismProj(0, 1, 100, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    parent.x = 80 * TILE; parent.y = 98 * TILE;
    parent.charge = 60;
    const prong = new PrismProng(0, 100, 2);         // critChance 类缺省 0.04=路由门
    prong.parent = parent;
    parent.prongs.push(prong);
    prong.fixedUpdate(1 / 60, makeHooks());          // 首拍定锚/束向
    const bx = prong.cx + prong.vx * 60, by = prong.cy + prong.vy * 60;
    const { e, calls } = mkEnemy(51, bx - 24, by - 24, 48, 48);
    const g = makeHooks({
      enemies: [e],
      player: { critChance: () => 50, inv: { heldItem: () => null } },
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // 0.5<0.54 → crit
    prong.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(true);                // 命中拍聚合 50 掷中（冻结 0.04 档必假）
    expect(calls[0].dmg).toBe(200);                  // 100×2（charge<180 无 ×3）
  });
});

// ================= §4 关断钉保留（测试置 0 习语） =================

describe('BJ489-§4：critChance=0 关断钉=掷面整门关（聚合/held 再高也不掷）', () => {
  it('4a hitEnemies 注入支钉：载体 critChance=0 + 聚合 50 + random 0 → 照假（r1/s2/bj420 同相）', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);   // 旧掷式 0<0.04 必暴
    const e = mkEnemy(61, 60 * TILE, 60 * TILE);
    const g = makeHooks({ enemies: [e.e], player: { critChance: () => 50 } });
    const pinned = { x: 60 * TILE, y: 60 * TILE, w: 22, h: 22, vx: 1,
      damage: 10, knockback: 1, projId: 153, critChance: 0 };
    hitEnemies({ ...pinned }, g, new HitCooldown(), 10, 1, 0);
    expect(e.calls[0].crit).toBe(false);             // ★门关=零掷（RNG 零消费）
    expect(rnd.mock.calls.length).toBe(0);
  });

  it('4b 类自有读者钉：prong 置 0（bj380/bj382 习语）→ 命中照常 crit 位假+dmg 原值', () => {
    const parent = new PrismProj(0, 1, 100, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    parent.x = 80 * TILE; parent.y = 98 * TILE;
    parent.charge = 60;
    const prong = new PrismProng(0, 100, 2);
    prong.parent = parent;
    prong.critChance = 0;                            // ★关断钉
    parent.prongs.push(prong);
    prong.fixedUpdate(1 / 60, makeHooks());
    const bx = prong.cx + prong.vx * 60, by = prong.cy + prong.vy * 60;
    const { e, calls } = mkEnemy(62, bx - 24, by - 24, 48, 48);
    const g = makeHooks({ enemies: [e], player: { critChance: () => 50 } });
    vi.spyOn(Math, 'random').mockReturnValue(0.0);   // 若门未关必暴
    prong.fixedUpdate(1 / 60, g);
    expect(calls.length).toBe(1);
    expect(calls[0].crit).toBe(false);
    expect(calls[0].dmg).toBe(100);                  // 原值（×2 不达）
  });
});
