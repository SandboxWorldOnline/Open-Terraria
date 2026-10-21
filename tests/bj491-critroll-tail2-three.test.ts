// ★BJ491（2026-10-04）掷率尾批二·三件判别测试（BJ490 新登记）：
//   ① 天龙之怒 3858 右键面 owner 聚合段折入（BJ490② 登记债清偿,双面对称收口）。
//      定谳链：右键 alt 出生 708/709/1110 三型 SetDefaults（Projectile.cs :7493/:7510/
//      :10342 亲读）皆 melee=true → 原版两面同走 Projectile.Damage :12916
//      `melee && Next(1,101) <= owner.meleeCrit`（:25712-14 逐帧折入=基 4+持械
//      item.crit+crt+装备/buff 聚合）→ 两面应对称;左键 707 面现役=rollVanillaHitCrit
//      动态单源（BJ489 def-3 迁移,agg 折入内嵌）,右键面=出生拍静态冻结载体（BJ490②
//      亲读定谳:SkyDragonFury 四型号 Math.random()<critChance 直消费,不经单源动态面）
//      → 最小面=注入端补 agg 段 this.player.critChance('melee')（暴怒/狼人/穿刺项圈等
//      装备/buff 档,Player.critChance 与 rollVanillaHitCrit 聚合口径同源）。
//   ② MinionProj contact() 面 hitCritters projId 穿线（BJ490③ 623 拳盒/BJ488①
//      settleCritterHit 单源同构）。途经 id 类旗定谳表（SetDefaults 亲读,数据面对拍）：
//      688/689/690（:7327-7339）=sentry 无三类旗;946（:8924-8939）=minion 无三类旗;
//      1093（:10197-10210）/1112（:10364-10377）=minion 无三类旗 → 全系零掷
//      （kind=null 捷径返假,零 RNG,行为与缺 projId 零差）,TimerCrit :12928 消费照达。
//   ③ armorpen-stub-nan-guard 站数钉过期复绿（BJ184 网,守卫面不动）：WhipProj 1→2
//      （:756 Y2 城镇 settle flatPen=原版 Damage_PVE_Inner :12852 num6 玩家分量 +
//      :851 敌怪环 hurt 参——原 :626 三元臂行漂）+ MinionProj 3→5（:3266/:3299/:3431
//      946/阿比盖尔臂 BJ453-467 域主清偿连带 + :4921/:5021 StrikeNPC :12068 两源）。
//  判别力（旧码必红项）：§1a 右键面 agg 段结构锁（旧式无 agg 必红）+ 左键面 critTotal
//    agg 段对称锚;§1b 708/709/1110 melee 旗数据面钉值（若拔旗=对称前提塌必红）;
//    §1c 注入端折入算术=单源折入算术同值;§2a contact() 穿线结构锁（旧缺位必红）;
//    §2b 六 id 类旗定谳表+零 RNG 钉值（若误加类旗必红）;§2c 穿线后掷/消费运行时
//    （TimerCrit 不回归锚）;§2d 负控=无类旗 id 穿线前后行为零差;§3a/3b 两文件站
//    身份锁+守卫形（拆站/摘 ?? 必红）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'path';
import type { GameHooks } from '../src/entities/types';
import { hitCritters } from '../src/entities/projTargets';
import { rollVanillaHitCrit } from '../src/entities/proj1457';
import { projectileData } from '../src/data/vanillaProjectiles';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { prefixStat } from '../src/data/vanillaPrefixes';
import { ITEM_DEFS } from '../src/data/items';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME, 'src', p), 'utf8');        // p 相对 src/
const TST = (p: string) => readFileSync(join(GAME, 'tests', p), 'utf8');      // p 相对 tests/
const PX = 80, PY = 90, T = 16;

/** 剥块注释+行注释（armorpen 网 stripComments 同式） */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
}

function makeHooks(opts: {
  critters?: unknown[];
  player?: Record<string, unknown>;
} = {}): GameHooks {
  const player = {
    equipStats: {}, cx: PX * T, cy: PY * T, x: PX * T - 10, y: PY * T - 21,
    w: 20, h: 42, dead: false, facing: 1, vx: 0, vy: 0,
    buffs: { has: () => false },
    ...opts.player,
  };
  return {
    world: { store: null } as never,
    player,
    enemies: () => [],
    critters: () => opts.critters ?? [],
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

interface HurtCall { dmg: number; crit: boolean }

/** critter 桩（BJ490 mkCritter 同形:iframes>0 返假不落账;黑化复权体=vanillaId+运行时位） */
function mkCritter(id: number, x: number, y: number, w = 24, h = 24,
  opts: { iframes?: number; vanillaId?: number | null; blackened?: boolean } = {}) {
  const calls: HurtCall[] = [];
  const c: Record<string, unknown> = {
    id, x, y, w, h, dead: false,
    iframes: opts.iframes ?? 0, dontTakeDamage: false,
    vanillaId: opts.vanillaId ?? null, blackenedCritter: opts.blackened === true,
    hurt(d: number, _kx: number, _ky: number, _g: unknown, _pen: number, crit: boolean): boolean {
      if ((c.iframes as number) > 0) return false;
      calls.push({ dmg: d, crit: !!crit });
      return true;
    },
  };
  return { c, calls };
}

/** TimerCrit 消费侦听桩 */
function timerSpy(ret = true): { box: number[][]; fn: (g: unknown, x: number, y: number, w: number, h: number) => boolean } {
  const box: number[][] = [];
  return { box, fn: (_g, x, y, w, h) => { box.push([x, y, w, h]); return ret; } };
}

afterEach(() => { vi.restoreAllMocks(); });

// ============ ① 3858 右键面 owner 聚合段折入（双面对称收口） ============

describe('BJ491-①：天龙之怒 3858 右键面掷率（agg 段——★BJ492② 起载体退役归单源）', () => {
  it('1a 结构锁：右键面掷率单源收编,swCrit 载体退役（★BJ492② 衔接判语兑现）+ 左键面 critTotal 同折对称锚', () => {
    const s = SRC('core/Game.ts');
    // 右键面现役形（★BJ492② 载体退役锁——swCrit 计算+三处写位整摘,冻结载体复辟必红;
    //  原「crt 段=BJ490②,agg 段=本刀」结构钉随载体退役移交单源动态面,判别力演进注记
    //  见 bj490 §2a 同款）
    expect(s).not.toMatch(/const swCrit = /);
    expect(s).not.toContain('shot.critChance = swCrit');
    expect(s).not.toContain('swingP.critChance = swCrit');
    expect(s).not.toContain('circle.critChance = shot.critChance');
    // 左键 707 面 critTotal（:18542-18544 一带,kind 分派三元）——agg 段对称锚
    expect(s).toMatch(/const critTotal = 0\.04 \+ \(itemCombat\(critVid\)\?\.crit \?\? 0\) \/ 100\s*\n\s*\+ this\.player\.critChance\(dmgKind === 'magic' \? 'magic' : dmgKind === 'ranged' \? 'ranged' : 'melee'\) \/ 100\s*\n\s*\+ \(ps\?\.crt \?\? 0\) \/ 100;/);
    // 支位锚：3858 右键分派门与左键 707 分派支
    expect(s).toContain('(heldDef.vid ?? -1) === 3858');
    expect(s).toContain('cw.shoot === 707');
  });

  it('1b 对称前提钉值：708/709/1110 SetDefaults melee 旗（:7499/:7516/:10350 亲读,数据面同值）', () => {
    for (const id of [708, 709, 1110]) {
      const pd = projectileData(id);
      expect(pd?.melee, `proj ${id} melee`).toBe(true);   // 三类掷 :12916 melee 臂达=两面同走 owner.meleeCrit
      expect(pd?.ranged ?? false, `proj ${id} ranged`).toBe(false);
      expect(pd?.magic ?? false, `proj ${id} magic`).toBe(false);
    }
    expect(itemCombat(3858)?.knockBack ?? 0).toBe(5);     // 右键面 swKb 底值锚（:48135 kb+4 前）
  });

  it('1c 折入算术同值：注入端三段式 ≡ 单源三段式（heldItemCritBonus 同款算式,BJ488③④）', async () => {
    const { heldItemCritBonus } = await import('../src/entities/proj1457');
    const id3858 = ITEM_DEFS.findIndex((d) => d?.vid === 3858);
    expect(id3858).toBeGreaterThanOrEqual(0);             // 3858 在册（BJ488 4c 同形探针）
    const heldBonus = heldItemCritBonus({ id: id3858, prefix: 61 });
    // 注入端（swCrit,右键面）武器侧增量 = item.crit + 词缀 crt
    const inj = ((itemCombat(3858)?.crit ?? 0) + prefixStat(61).crt) / 100;
    expect(inj).toBeCloseTo(heldBonus / 100, 12);         // 单源 heldItemCritBonus=同款算式
    expect(heldBonus).toBe(5);                            // item.crit=0（Item.cs:34105 无 crit 赋值）+crt 5
    // 两面全式对拍：agg=50 装备/buff 档 → 0.04+0.05+0.50=0.59（旧右键式=0.09 必红钉）
    const agg = 50;
    expect(0.04 + inj + agg / 100).toBeCloseTo(0.59, 12);
    expect(0.04 + inj).not.toBeCloseTo(0.04 + inj + agg / 100, 12);   // 旧式缺 agg 段差判别力
  });
});

// ============ ② contact() 面 hitCritters projId 穿线（类旗定谳表） ============

describe('BJ491-②：MinionProj contact() hitCritters projId 穿线（BJ490③/BJ488① 同构）', () => {
  it('2a 结构锁：contact() 自盒双支携 projId: this.projId（旧缺位必红;623 拳盒另位不混）', () => {
    const s = SRC('entities/MinionProj.ts');
    expect(s).toMatch(/const hitbox = pad\s*\n\s*\? \{ x: this\.x - pad, y: this\.y - pad, w: this\.w \+ pad \* 2, h: this\.h \+ pad \* 2, projId: this\.projId \}\s*\n\s*: \{ x: this\.x, y: this\.y, w: this\.w, h: this\.h, projId: this\.projId \};/);
    // 623 拳盒位（BJ490③ 既有穿线,防误并）
    expect(s).toMatch(/hitCritters\(\s*\{ x: this\.cx \+ this\.facing \* 40 - 40, y: this\.cy - 20, w: 80, h: 40, projId: this\.projId \},/);
  });

  it('2b 途经 id 类旗定谳表：688-690/946/1093/1112 全系无三类旗 → rollVanillaHitCrit 零 RNG 返假', () => {
    const table: Array<[number, string]> = [
      [688, 'sentry 旗（:7327-7339）'], [689, 'sentry 旗'], [690, 'sentry 旗'],
      [946, 'minion 旗（:8924-8939）'],
      [1093, 'minion 旗（:10197-10210）'], [1112, 'minion 旗（:10364-10377）'],
    ];
    const g = makeHooks({ critters: [], player: { critChance: () => 50 } });
    const rnd = vi.spyOn(Math, 'random');
    for (const [id, tag] of table) {
      const pd = projectileData(id);
      expect(pd?.melee ?? false, `proj ${id}（${tag}）melee`).toBe(false);
      expect(pd?.ranged ?? false, `proj ${id}（${tag}）ranged`).toBe(false);
      expect(pd?.magic ?? false, `proj ${id}（${tag}）magic`).toBe(false);
      expect(rollVanillaHitCrit(id, g), `proj ${id} roll`).toBe(false);   // kind=null 捷径
    }
    expect(rnd).not.toHaveBeenCalled();                   // ★六 id 全程零 RNG（误加类旗必红）
    // minion/sentry 身份钉值（数据面在册位;688-690 sentry 旗=仓内 ctx 显式承载）
    expect(projectileData(946)?.minion).toBe(true);
    expect(projectileData(1093)?.minion).toBe(true);
    expect(projectileData(1112)?.minion).toBe(true);
    expect(projectileData(688)?.aiStyle).toBe(137);       // AI_137 闪电光环塔
  });

  it('2c 穿线运行时（946+黑化 critter+TimerCrit 满蓄）：零掷+消费达+crit 翻转（不回归锚）', () => {
    const t = timerSpy(true);
    const rnd = vi.spyOn(Math, 'random');
    const { c, calls } = mkCritter(11, PX * T, PY * T, 24, 24, { vanillaId: 645, blackened: true });
    const g = makeHooks({
      critters: [c],
      player: { critChance: () => 0, tryConsumingTimerCrit: t.fn },
    });
    // contact() 自盒同形（本体盒,pad=0 支）+ 穿线位
    const hit = hitCritters(
      { x: PX * T - 12, y: PY * T - 12, w: 24, h: 24, projId: 946 },
      g, { minion: true });
    expect(hit).toBe(true);                               // 黑化复权体放行（:20680-20688）
    expect(rnd).not.toHaveBeenCalled();                   // ★946 无类旗零掷
    expect(t.box.length).toBe(1);                         // ★TimerCrit :12928 消费达
    expect(t.box[0]).toEqual([c.x, c.y, c.w, c.h] as unknown as number[]);
    expect(calls[0].crit).toBe(true);
    expect(calls[0].dmg).toBe(5);                         // 定伤 shim 不预倍（RB10d-D1 面）
  });

  it('2d 负控：无类旗 id 穿线 vs projId 缺位——零 RNG 双同相（行为零差判别面）', () => {
    const rnd = vi.spyOn(Math, 'random');
    for (const projId of [946, undefined]) {
      const t = timerSpy(false);
      const { c, calls } = mkCritter(12, PX * T, PY * T, 24, 24, { vanillaId: 645, blackened: true });
      const g = makeHooks({
        critters: [c],
        player: { critChance: () => 0, tryConsumingTimerCrit: t.fn },
      });
      const hit = hitCritters(
        { x: PX * T - 12, y: PY * T - 12, w: 24, h: 24, ...(projId !== undefined ? { projId } : {}) },
        g, { minion: true });
      expect(hit, `projId=${projId}`).toBe(true);
      expect(rnd).not.toHaveBeenCalled();                 // 穿线前后均零掷=零差
      expect(calls[0].crit, `projId=${projId} crit`).toBe(false);
    }
  });
});

// ============ ③ armorpen 站数现役形（BJ184 网守卫面不动） ============

describe('BJ491-③：armorpen 站数钉现役形（WhipProj 2/MinionProj 4,逐站身份锁）', () => {
  const READ = /\b(?:eq|equipStats\??)\.armorPen\b/g;

  it('3a WhipProj 2 站身份锁：:851 敌怪环 hurt 参 + Y2 城镇 settle flatPen（均 ?? 0 卫）', () => {
    const src = stripComments(SRC('entities/WhipProj.ts'));
    const hits = [...src.matchAll(READ)];
    expect(hits.length).toBe(2);                          // 站数=现役钉
    // 站 1：敌怪环 hurt armorPen 参（原 :626 三元臂行漂,wpOwner 形）
    expect(src).toMatch(/wpOwner\.equipStats\.armorPen \?\? 0/);
    // 站 2：Y2 settle 城镇臂 flatPen 透传（:12852 num6 玩家分量/:13686 消费）
    expect(src).toMatch(/flatPen = owner \? \(\(owner as unknown as \{ equipStats\?: \{ armorPen\?: number \} \}\)\s*\n\s*\.equipStats\?\.armorPen \?\? 0\) : 0;/);
    for (const m of hits) {                               // 守卫形：读后必 ??
      expect(/^\s*\?\?/.test(src.slice((m.index ?? 0) + m[0].length)), m[0]).toBe(true);
    }
  });

  it('3b MinionProj 4 站身份锁：4×两源站（contact 敌怪环/946 城镇/ai156Strike/contactTown,玩家 AP+弹幕 AP）', () => {
    const src = stripComments(SRC('entities/MinionProj.ts'));
    const hits = [...src.matchAll(READ)];
    // ★BJ703-F 钉勘误（2026-10-21,存量红分诊=钉陈旧非回归）：5→4——BJ684 批
    //  （2026-10-15）把阿比盖尔臂两单源站（旧 :3893 `const pen =`/:4070 直读）收编进
    //  ai156Strike 共享结算体 :5162;BJ703-D4（2026-10-21）把 946 城镇臂 flatPen 同改
    //  两源 :4960。四站全两源（StrikeNPC :12068 玩家 AP+:12852 弹幕 AP 原序——
    //  contact 敌怪环 :7689 旧批已两源）。守卫面（?? 紧随）逐站复核全绿。
    expect(hits.length).toBe(4);                          // 站数=现役钉
    // 两源站 4：:7689 contact 敌怪环 / :4960 946 城镇 flatPen / :5162 ai156Strike /
    //   :7789 contactTown——伴读 projectileData().armorPenetration 不入 READ 闸
    //   =equipStats 源只记 1 次
    expect(src.match(/\+ \(projectileData\(this\.projId\)\?\.armorPenetration \?\? 0\)/g)?.length).toBe(4);
    for (const m of hits) {
      expect(/^\s*\?\?/.test(src.slice((m.index ?? 0) + m[0].length)), m[0]).toBe(true);
    }
  });

  it('3c 钉值对拍：armorpen 网 FILES 钉=本文件身份锁（2/4,漂移互证）', () => {
    const guard = TST('armorpen-stub-nan-guard.test.ts');
    expect(guard).toContain("['src/entities/WhipProj.ts', 2]");
    expect(guard).toContain("['src/entities/MinionProj.ts', 4]");
  });
});
