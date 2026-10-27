// BJ729-A 清偿刀判别锁（BJ727-A 登记债 D1/D2/D4 + S02 车道漏站）：
//  · D2 爆族敌怪臂 DV/crit 残差七面（gem[两者皆缺,census「宝石族无类旗」判语勘误:
//    121-126/597 magic=true,P.cs:2107-2114 ApplyGemStaffStats 段亲读]/659/661/1023/
//    烟花 167-170/283[ranged :3713 亲读,缺 DV+crit]/286[旧式裸掷→rollVanillaHitCrit
//    收编]）——原版 Kill 重跑 Damage() 逐 victim DV(:12970 无条件)+crit(:12915-27
//    按类旗掷);城镇臂 settle 同链同掷。
//  · D4 爆面 critter 臂（gem/617/659/661/1023/烟花/286/KILL_BURST/Dart blastDamage/
//    930 爆散——victim 循环 :12592 对小动物同链,penetrate=-1 多靶 → hitCrittersAll;
//    1044 ∈ MinionShot（ProjectileID.cs:291）CanNPCBeHit :20675 恒拒=销案）。
//  · D1 接触面城镇 voodoo 靶 15 站（443/706/611/弧族×7/461/255·260/Solution/
//    Celeb2 715-718/TrapShot B25[错注勘正:friendly 弹巫毒窄门可达+critter 可杀+
//    反射 hostile 城镇 flag2 恒命中]/MountShot/930 飞行/1045[链式补发镜像]/
//    451/356）;darkHarvestChain 链电销案（CanBeChasedBy :91141 `!friendly` 硬门
//    =城镇 NPC 永不入链,原版同构）。
//  · S02 漏站三处（BJ729-A 任务4）：crystal/scarab/cart TimerCrit 预倍残留=×4 双倍
//    →Enemy.hurt 防后单次 ×2（NPC.cs:82067）承载;sw-bj47 变异锁随迁。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Arrow } from '../src/entities/Arrow';
import { Game } from '../src/core/Game';
import { hitCrittersAll } from '../src/entities/projTargets';
import { MagicMissileProj } from '../src/entities/MissileProj';
import { ElectroSphereProj, ELECTROSPHERE_PROJ } from '../src/entities/ElectroSphereProj';
import { MoonLordWhipProc } from '../src/entities/WhipTag';
import { withMutation } from './mutation-guard';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = join(HERE, '..');
const SRC = (p: string) => readFileSync(join(GAME_ROOT, 'src', p), 'utf8');
const ARROW_SRC = join(GAME_ROOT, 'src/entities/Arrow.ts');
const MISSILE_SRC = join(GAME_ROOT, 'src/entities/MissileProj.ts');
const ELECTRO_SRC = join(GAME_ROOT, 'src/entities/ElectroSphereProj.ts');
const spawnVitest = (filter: string, tName?: string) => spawnSync('npx',
  ['vitest', 'run', filter, '--reporter=basic', ...(tName ? ['-t', tName] : [])],
  { cwd: GAME_ROOT, encoding: 'utf8', timeout: 180_000, env: { ...process.env, BJ729_MUT_SKIP: '1' } });
const itMut = process.env.BJ729_MUT_SKIP === '1' ? it.skip : it;   // 变异子进程跳过（防递归,BJ725 判例 4）
afterEach(() => vi.restoreAllMocks());

interface MockTown {
  id: number; vanillaId: number; x: number; y: number; w: number; h: number;
  dead: boolean; bound: boolean; calls: unknown[][];
  hurt: (...a: unknown[]) => boolean;
}
const mkTown = (vanillaId: number, cx: number, cy: number, id = 1): MockTown => {
  const calls: unknown[][] = [];
  return {
    id, vanillaId, x: cx - 12, y: cy - 12, w: 24, h: 24,
    dead: false, bound: false, calls,
    hurt(...a: unknown[]) { calls.push(a); return true; },
  };
};
interface MockCritter {
  id: number; vanillaId: number; x: number; y: number; w: number; h: number;
  dead: boolean; iframes: number; dontTakeDamage: boolean; calls: unknown[][];
  hurt: (...a: unknown[]) => boolean;
}
const mkBird = (cx: number, cy: number, id = 50): MockCritter => {
  const calls: unknown[][] = [];
  return {
    id, vanillaId: 74, x: cx - 8, y: cy - 6, w: 16, h: 12,
    dead: false, iframes: 0, dontTakeDamage: false, calls,
    hurt(...a: unknown[]) { calls.push(a); return true; },
  };
};
interface SpyEnemy {
  id: number; vanillaId: number; x: number; y: number; w: number; h: number;
  dead: boolean; iframes: number; dontTakeDamage: boolean; calls: Array<{ d: number; crit: boolean }>;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean) => boolean;
}
const mkEnemy = (id: number, cx: number, cy: number): SpyEnemy => {
  const e = { calls: [] } as unknown as SpyEnemy;
  Object.assign(e, {
    id, vanillaId: 3, x: cx - 10, y: cy - 10, w: 20, h: 20,
    dead: false, iframes: 0, dontTakeDamage: false,
    hurt(d: number, _kx: number, _ky: number, _g: GameHooks, _pen = 0, crit = false) {
      e.calls.push({ d, crit });
      return true;
    },
  });
  return e;
};
/** 扁平 hooks（Arrow 爆面/接触面直驱——各消费口全可选链或浅读） */
const mkHooks = (opts: {
  enemies?: SpyEnemy[]; critters?: MockCritter[]; towns?: MockTown[];
  eq?: Record<string, boolean>; critAgg?: number; luck?: number;
  onAdd?: (e: unknown) => void;
}): GameHooks => ({
  player: {
    luck: opts.luck ?? 0,
    equipStats: opts.eq ?? {},
    critChance: () => opts.critAgg ?? 0,
  } as never,
  npcs: () => opts.towns ?? [],
  enemies: () => opts.enemies ?? [],
  critters: () => opts.critters ?? [],
  // ★仅按需注入:617 爆 620 碎片段零向重掷 while 环对常量 mock(0.5→双轴恒0)死循环
  //  ——无 onAdd 的用例关 entities.add 门（碎片/gore 生成面不进,城镇/critter 臂不受影响）
  ...(opts.onAdd ? { entities: { add: (e: unknown) => { opts.onAdd?.(e); } } } : {}),
  world: { difficulty: 0, seedFlags: {} } as never,
  spawnDust: () => null,
} as unknown as GameHooks);

// ================= §D2 爆面 DV/crit 补齐（敌怪臂+城镇臂同链同掷） =================
describe('BJ729-A D2：爆族敌怪臂 DV/crit 残差七面', () => {
  it('D2-1 661 黑爆：敌臂 DV 掷（mock0.5 恒等档）+crit ranged 动态（旧无 DV 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const e = mkEnemy(9, 600, 600);
    const hooks = mkHooks({ enemies: [e] });
    const a = new Arrow(600 - 9, 600 - 9, 0, 0, 48, 6, 661, { grav: 0 });
    a.critChance = 0.04;
    (a as unknown as { blackBolt661Burst: (g: GameHooks) => void }).blackBolt661Burst(hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(48);              // DV tier0 恒等（旧裸 this.damage 形同值,判别在 D2-1b）
    expect(e.calls[0]!.crit).toBe(false);        // agg0 → 0.5<0.04 false
    // 判别档：agg60 → crit true（ranged 掷 :12920）
    const e2 = mkEnemy(10, 600, 600);
    const hooks2 = mkHooks({ enemies: [e2], critAgg: 60 });
    const b = new Arrow(600 - 9, 600 - 9, 0, 0, 48, 6, 661, { grav: 0 });
    b.critChance = 0.04;
    (b as unknown as { blackBolt661Burst: (g: GameHooks) => void }).blackBolt661Burst(hooks2);
    expect(e2.calls[0]!.crit).toBe(true);
  });
  it('D2-1b 661 DV 判别档：mock0.9999 → 48×1.15=55（回退裸值 48 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const e = mkEnemy(11, 600, 600);
    const a = new Arrow(600 - 9, 600 - 9, 0, 0, 48, 6, 661, { grav: 0 });
    a.critChance = 0.04;
    (a as unknown as { blackBolt661Burst: (g: GameHooks) => void }).blackBolt661Burst(mkHooks({ enemies: [e] }));
    expect(e.calls[0]!.d).toBe(55);
  });
  it('D2-2 gem 爆面：magic crit 掷勘误锁（census「宝石族无类旗零掷」错——agg60 → crit true）+DV', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    const e = mkEnemy(12, 600, 600);
    const a = new Arrow(600 - 9, 600 - 9, 0, 0, 100, 6, 124, { grav: 0 });   // 黄玉弹
    a.critChance = 0.04;
    (a as unknown as { gem: Record<string, boolean> }).gem = { aoeExplosion: true };
    (a as unknown as { gemAoeBurst: (g: GameHooks) => void }).gemAoeBurst(mkHooks({ enemies: [e], critAgg: 60 }));
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);         // magic 掷（旧静态 false 必红）
    expect(e.calls[0]!.d).toBe(33);              // dmg=trunc(100×0.35)=35;DV@0.3 → tier −6 → 35×0.94=32.9 → toEven 33
  });
  it('D2-3 286 爆炸弹（Game.onProjectileDeath）：DV+crit 收编 rollVanillaHitCrit（旧裸掷必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const hurt: Array<{ d: number; crit: boolean }> = [];
    const fake: Record<string, unknown> = {
      player: { dead: false, cx: 9999, cy: 9999, luck: 0, equipStats: {}, critChance: () => 60 },
      entities: {
        enemies: [{ dead: false, x: -10, y: -10, w: 20, h: 20,
          hurt: (d: number, _kx: number, _ky: number, _g: unknown, _p: number, crit: boolean) => { hurt.push({ d, crit }); return true; } }],
        critters: [], npcs: [], add: () => {},
      },
      playSfxFiles: () => {}, spawnDust: () => null, spawnParticles: () => {},
      world: { store: { inBounds: () => false, idx: () => 0, flags: [0], type: [0], isActive: () => false, isSolid: () => false, isPlatform: () => false, half: [0], slope: [0], get: () => 0 } },
    };
    (Game.prototype as unknown as { onProjectileDeath: (...a: unknown[]) => void })
      .onProjectileDeath.call(fake, 286, -10, -10, 4, 4, 0, 0, 15, { hostile: false, kb: 2, arpen: 0, sc: 1 });
    expect(hurt.length).toBe(1);
    expect(hurt[0]!.d).toBe(15);                 // DV tier0 恒等
    expect(hurt[0]!.crit).toBe(true);            // agg60+0.5 → rollVanillaHitCrit true（旧裸掷 critChance('ranged')/100=0.6 同真,判别在 M4 变异）
  });
  it('D2-S 结构锁：七面 DV/crit 形态（gem/659/661/1023/烟花/283/286）+城镇 settle 同链', () => {
    const arrow = SRC('entities/Arrow.ts');
    expect(arrow).toContain('const critGemAoe = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);');
    expect(arrow).toContain('crit283');
    const game = SRC('core/Game.ts');
    expect(game).toContain("crit: rollVanillaHitCrit(286, this as unknown as import('../entities/types').GameHooks)");
    expect(game).toContain('hitCrittersAll({ x: cx286 - R286, y: cy286 - R286, w: R286 * 2, h: R286 * 2, projId: 286 }');
    // 城镇 settle 同链同掷（DV 入 settle）
    expect(SRC('entities/Arrow.ts')).toContain("() => ({ dmg: damageVarRoll(dmg, ((game.player as unknown as { luck?: number } | null)?.luck) ?? 0), crit: this.critChance > 0 && rollVanillaHitCrit(this.projId, game), penPercent: this.settlePen }))");
  });
});

// ================= §D4 爆面 critter 臂 =================
describe('BJ729-A D4：爆面 critter 臂（hitCrittersAll 多靶语义）', () => {
  it('D4-1 617 星璇死亡爆：盒内鸟被击（fromPlayer=true;旧零受击必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bird = mkBird(600, 600);
    const a = new Arrow(600 - 9, 600 - 9, 0, 0, 10, 1, 617, { grav: 0 });
    a.critChance = 0.04;
    (a as unknown as { arcanumDeathBurst: (g: GameHooks) => void })
      .arcanumDeathBurst(mkHooks({ critters: [bird] }));
    expect(bird.calls.length).toBe(1);
    expect(bird.calls[0]![7]).toBe(true);        // arg7=fromPlayer（DPS/旗杀账）
  });
  it('D4-2 KILL_BURST（16 魔法飞弹）：Kill 爆盒内鸟被击', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bird = mkBird(1600, 1600);
    const m = new MagicMissileProj(1600 - 8, 1600 - 8, 1, 0, {
      projId: 16, damage: 100, knockback: 2, useTime: 30, payMana: () => true,
      channelCb: () => false, aimCb: () => ({ x: 0, y: 0 }),
    });
    (m as unknown as { killNow: (g: GameHooks) => void }).killNow(mkHooks({ critters: [bird] }));
    expect(bird.calls.length).toBe(1);
  });
  it('D4-3 1044 销案锁：MinionShot 表成员 → CanNPCBeHit :20675 恒拒（接臂=死码,勿再登记）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bird = mkBird(600, 600);
    // 直验原语门（DeadCellsMushroom 不接 critter 臂=销案本体,见 S 锁注释）
    expect(hitCrittersAll({ x: 500, y: 500, w: 200, h: 200, projId: 1044 }, mkHooks({ critters: [bird] }))).toBe(0);
    expect(bird.calls.length).toBe(0);
  });
  it('D4-S 结构锁：爆面 critter 臂全在位 + 1044 销案注', () => {
    const arrow = SRC('entities/Arrow.ts');
    for (const anchor of [
      "this.pveNumHits += hitCrittersAll({ x: this.cx - R, y: this.cy - R, w: R * 2, h: R * 2, projId: this.projId }, game);",
      "this.pveNumHits += hitCrittersAll({ x: this.cx - R661, y: this.cy - R661, w: R661 * 2, h: R661 * 2, projId: this.projId }, game);",
      "this.pveNumHits += hitCrittersAll({ x: this.cx - R23, y: this.cy - R23, w: R23 * 2, h: R23 * 2, projId: this.projId }, game);",
      "hitCrittersAll({ x: this.cx - 96, y: this.cy - 96, w: 192, h: 192, projId: this.projId }, game);",
    ]) expect(arrow).toContain(anchor);
    expect(SRC('entities/DeadCellsMushroom.ts')).toContain('critter 臂【不接】——1044 ∈ ProjectileID');
    expect(SRC('entities/MissileProj.ts')).toContain('hitCrittersAll({ x: this.cx - R, y: this.cy - R, w: R * 2, h: R * 2, projId: this.projId }, game);');
    expect(SRC('entities/Dart.ts')).toContain('hitCrittersAll({ x: cx - r, y: cy - r, w: r * 2, h: r * 2,');
    expect(SRC('entities/Mounts.ts')).toContain('hitCrittersAll({ x: this.cx - R, y: this.cy - R, w: R * 2, h: R * 2, projId: this.projId }, game);');
  });
});
// ================= §D1 接触面城镇 voodoo 靶 =================
describe('BJ729-A D1：接触面城镇 voodoo 靶 + 443 critter 臂', () => {
  it('D1-1 ElectroSphere 443：guide+killGuide 盒内 → hurt（crit 镜像/critAgg60）;鸟同拍被击;无娃娃 no-op', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const t = mkTown(22, 800, 800);
    const bird = mkBird(800, 800, 51);
    const es = new ElectroSphereProj(800, 800, 40);
    es.critChance = 0.04;
    es.fixedUpdate(1 / 60, mkHooks({ towns: [t], critters: [bird], eq: { killGuide: true }, critAgg: 60 }));
    expect(t.calls.length).toBe(1);
    expect(t.calls[0]![0]).toBe(40);             // 敌臂面级无 DV（D6 族登记）,基伤直传
    expect(t.calls[0]![6]).toBe(true);           // crit 镜像（agg60+0.5<0.64;旧无城镇臂必红）
    expect(t.calls[0]![8]).toBe(true);           // fromPlayer
    expect(t.calls[0]![9]).toBe(443);            // srcProjId
    expect(bird.calls.length).toBe(1);           // critter 臂（census B17 点名双缺）
    // 无娃娃 → 城镇零受理（critter 照常——两臂独立门）
    const t2 = mkTown(22, 800, 800, 2);
    const bird2 = mkBird(800, 800, 52);
    const es2 = new ElectroSphereProj(800, 800, 40);
    es2.critChance = 0.04;
    es2.fixedUpdate(1 / 60, mkHooks({ towns: [t2], critters: [bird2], eq: {} }));
    expect(t2.calls.length).toBe(0);
    expect(bird2.calls.length).toBe(1);
  });
  it('D1-2 MoonLordWhipProc 1045：guide+killGuide → hurt(penPercent=50)+链式补发+受理即亡;无娃娃 no-op', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const added: unknown[] = [];
    const t = mkTown(22, 600, 600);
    let proc: MoonLordWhipProc | null = null;
    const hooks1045 = mkHooks({ towns: [t], eq: { killGuide: true }, onAdd: (e) => added.push(e) });
    MoonLordWhipProc.spawn(hooks1045,
      (e) => { proc = e as MoonLordWhipProc; added.push(e); },
      { x: 600, y: 600, w: 24, h: 24 }, { x: 0, y: 0 }, 0);
    expect(proc).toBeTruthy();
    // 挪到 guide 盒内再 tick（速度归零防两子步位移漂出盒;旋转对零向量恒零）
    const p1045 = proc as unknown as { x: number; y: number; w: number; h: number; vx: number; vy: number };
    p1045.x = 588; p1045.y = 588; p1045.w = 16; p1045.h = 16; p1045.vx = 0; p1045.vy = 0;
    (proc as unknown as { fixedUpdate: (dt: number, g: GameHooks) => void })
      .fixedUpdate(1 / 60, hooks1045);
    expect(t.calls.length).toBe(1);
    expect(t.calls[0]![4]).toBe(50);             // armorPenetration=50（:9910 敌臂镜像）
    expect(added.length).toBe(2);                // 链式补发 gen+1（:14015-14018 victim 无关）
    expect((proc as unknown as { dead: boolean }).dead).toBe(true);   // penetrate 1 受理即亡
    // 无娃娃：零受理零补发不亡
    const t2 = mkTown(22, 600, 600, 3);
    const added2: unknown[] = [];
    let proc2: MoonLordWhipProc | null = null;
    const hooks1045b = mkHooks({ towns: [t2], onAdd: (e) => added2.push(e) });
    MoonLordWhipProc.spawn(hooks1045b,
      (e) => { proc2 = e as MoonLordWhipProc; added2.push(e); },
      { x: 600, y: 600, w: 24, h: 24 }, { x: 0, y: 0 }, 0);
    const p1045b = proc2 as unknown as { x: number; y: number; w: number; h: number; vx: number; vy: number };
    p1045b.x = 588; p1045b.y = 588; p1045b.w = 16; p1045b.h = 16; p1045b.vx = 0; p1045b.vy = 0;
    (proc2 as unknown as { fixedUpdate: (dt: number, g: GameHooks) => void })
      .fixedUpdate(1 / 60, hooks1045b);
    expect(t2.calls.length).toBe(0);
    expect(added2.length).toBe(1);
    expect((proc2 as unknown as { dead: boolean }).dead).toBe(false);
  });
  it('D1-S 结构锁：15 站 hitTownNpcs 全在位 + B25 双臂/hostile 分支 + 链电销案注', () => {
    const faces: Array<[string, string]> = [
      ['entities/ElectroSphereProj.ts', "hitTownNpcs(this, game, Math.max(1, Math.trunc(this.damage)), 0, 'playerProj',"],
      ['entities/PhoenixBowProj.ts', "hitTownNpcs(this, game, Math.round(this.damage),"],
      ['entities/SolarEruption.ts', "hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * 2, 'playerProj', this.projId,"],
      ['entities/SwingArc.ts', 'hitTownNpcs(this, game, this.damage,'],
      ['entities/PrismProj.ts', "hitTownNpcs(this, game, this.damage, this.vx * this.knockback, 'playerProj', this.projId,"],
      ['entities/MagnetSphereProj.ts', "hitTownNpcs(this, game, Math.max(1, Math.trunc(this.damage)), 0,"],
      ['entities/SolutionProj.ts', "hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * this.knockback,"],
      ['entities/Celeb2.ts', "hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * this.knockback,"],
      ['entities/Dart.ts', "'playerProj', tpB25 ?? this.projId ?? 0,"],
      ['entities/Mounts.ts', "hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * this.knockback,"],
      ['entities/WhipTag.ts', "hitTownNpcs(this, game, this.damage, 0, 'playerProj', 1045,"],
      ['entities/TideSlash.ts', "hitTownNpcs(this, game, this.damage, Math.sign(this.vx) * this.knockback,"],
      ['entities/SpectreSoulProj.ts', "hitTownNpcs(this, game, this.damage, 0, 'playerProj', this.projId)"],
    ];
    for (const [f, anchor] of faces) expect(SRC(f), f).toContain(anchor);
    // 弧族七站（generic/973/972/933/974/976/321）
    const arc = SRC('entities/SwingArc.ts');
    expect((arc.match(/hitTownNpcs\(this, game, this\.damage,/g) ?? []).length).toBe(7);
    // B25 错注勘正 + hostile 反射分支 + critter 臂
    const dart = SRC('entities/Dart.ts');
    expect(dart).toContain('错注勘正');
    expect(dart).toContain("'hostile', tpB25 ?? this.projId ?? 0,");
    expect(dart).toContain('const nCritB25 = hitCrittersAll(');
    // 链电销案注（CanBeChasedBy !friendly）
    expect(SRC('entities/WhipTag.ts')).toContain('darkHarvestChain 链电城镇臂销案');
  });
});

// ================= §S02 S02 车道漏站（任务4伴生） =================
describe('BJ729-A S02：TimerCrit 预倍漏站三处（crystal/scarab/cart ×4→×2）', () => {
  it('S02-S 结构锁：三站零预倍残留 + Enemy.hurt 防后单次承载注', () => {
    expect(SRC('core/Game.ts')).not.toContain('eowFifth * (scarabTimerCrit ? 2 : 1)');
    expect(SRC('core/Game.ts')).not.toContain('explodeFriendlyVictimDamage(40, en) * (crystalTimerCrit ? 2 : 1)');
    expect(SRC('entities/Minecart.ts')).not.toContain('SUPER_CART_LASER_DMG) * (cartTimerCrit ? 2 : 1)');
    expect(SRC('entities/Minecart.ts')).toContain('e.hurt(applyBannerDamageDealt(game, e, SUPER_CART_LASER_DMG), 0, 0, game, 0, cartTimerCrit, 0, true);');
  });
});

// ================= 变异恰红（withMutation,子进程隔离） =================
describe('BJ729-A 变异恰红', () => {
  itMut('M1 ElectroSphere 城镇臂 crit 镜像摘除 → D1-1 红', () => {
    withMutation(ELECTRO_SRC,
      '() => ({ crit: this.critChance > 0 && rollVanillaHitCrit(ELECTROSPHERE_PROJ, game),',
      '() => ({ crit: false,',
      () => {
        const r = spawnVitest('bj729a-clearance', 'D1-1');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D1-1');
      }, { label: 'BJ729a-M1' });
  });
  itMut('M2 gem 爆面 crit 掷摘除（回静态 false）→ D2-2 红', () => {
    withMutation(ARROW_SRC,
      'const critGemAoe = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);',
      'const critGemAoe = false;',
      () => {
        const r = spawnVitest('bj729a-clearance', 'D2-2');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D2-2');
      }, { label: 'BJ729a-M2' });
  });
  itMut('M3 KILL_BURST critter 臂摘除 → D4-2 红', () => {
    withMutation(MISSILE_SRC,
      "hitCrittersAll({ x: this.cx - R, y: this.cy - R, w: R * 2, h: R * 2, projId: this.projId }, game);",
      '',
      () => {
        const r = spawnVitest('bj729a-clearance', 'D4-2');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D4-2');
      }, { label: 'BJ729a-M3' });
  });
  itMut('M4 286 crit 收编摘除（回退裸掷形）→ D2-3 红（agg60 crit 位）', () => {
    withMutation(join(GAME_ROOT, 'src/core/Game.ts'),
      "crit: rollVanillaHitCrit(286, this as unknown as import('../entities/types').GameHooks),",
      "crit: Math.random() < (this.player.critChance('ranged') / 100),",
      () => {
        // 旧裸掷漏基 4%+持械折入:agg60 → 0.5<0.6 同真——判别档改 DV 面:settle dmg
        // 摘除回退入参同值不判别,故 crit 位收编形本身为锁（agg0 档 0.5<0.04 恒假
        // vs rollVanillaHitCrit 基 4% 同假——判别在结构:D2-S 锁 rollVanillaHitCrit 形态）
        const r = spawnVitest('bj729a-clearance', 'D2-S');
        expect(r.status, '变异须证红').not.toBe(0);
        expect(r.stdout).toContain('D2-S');
      }, { label: 'BJ729a-M4' });
  });
});
