// ★BJ704-G24 件2 [g22-launcher-fw-blast] 清偿守卫：
//   发射器档烟花（3546 喜庆弹射器 → Arrow 载体 167-170,launcherFirework=1）Kill
//   尾段 192² Damage()（Projectile.cs:78549-78556:position 归心+Resize(192)+
//   penetrate=-1+Damage() 无 damage 门）。G22 登记：四式爆尘在而爆面整缺=对敌零伤。
//   本刀补 Dart explodeFirework 尾 blastDamage 同款（G21/G22 定谳面）：
//   CutTiles 先行（:12516→:12576 序）/damage<=0 整退/192 盒逐敌/idStatic 1t 共享桶
//   （167-170 SetDefaults :2568-2570）/iframes 门（:12635-12637）/crit 0.04 路由门。
//   修前红：B1 hurt 零记录（爆面整缺）;变异恰红=摘 blast 块全组红（/tmp/bj704g24-mutations.mjs）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { World } from '../src/world/World';
import type { GameHooks } from '../src/entities/types';
import { Arrow } from '../src/entities/Arrow';
import { pinGameTimeTicks } from '../src/core/GameTime';

interface HurtRec { d: number; kx: number; ky: number; pen: number; crit: boolean; pierce: number; fromPlayer: boolean }

const ARROW_TS = readFileSync(new URL('../src/entities/Arrow.ts', import.meta.url), 'utf8');

/** 敌桩：vanillaId=0（playerCanHitEnemy 直过/无 banner 面）;hurt 记录入 recs */
const mkEnemy = (id: number, x: number, y: number, iframes = 0) => ({
  id, x, y, w: 20, h: 40, dead: false, iframes, vanillaId: 0,
  hurt: (d: number, kx: number, ky: number, _g: unknown, pen = 0, crit = false, pierce = 0, fromPlayer = false) => {
    recs.push({ d, kx, ky, pen, crit, pierce, fromPlayer });
    return true;
  },
});
let recs: HurtRec[] = [];

const cutTiles: { x: number; y: number }[] = [];

function makeGame(enemies: unknown[]): GameHooks {
  recs = [];
  cutTiles.length = 0;
  return {
    world: new World(160, 200, 30, 'fw-blast'), player: null as unknown,
    enemies: () => enemies, critters: () => [], projectiles: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {},
    cutTile: (x: number, y: number) => { cutTiles.push({ x, y }); },
    addLightAt: () => {},
    spawnDust: () => null,
    onProjectileDeath: () => {},
    broadcastParticleOrchestra: () => {},
  } as unknown as GameHooks;
}

const kill = (a: Arrow, game: GameHooks): void => {
  (a as unknown as { killNow: (g: GameHooks) => void }).killNow(game);
};
/** 3546 出生面同构（Game.ts:18170-18188）：167+rand(4)、launcherFirework=1 */
const mkFw = (projId: number, damage = 50, vx = 8): Arrow => {
  const a = new Arrow(400, 300, vx, 0, damage, 4, projId, { grav: 0, life: 45, pierce: 1 });
  a.launcherFirework = 1;
  return a;
};

describe('§1 发射器烟花 Kill 192² Damage()（:78549-78556）', () => {
  it('B1 爆面结算：盒内敌 hurt 恰一次,伤=damage,critChance 缺省 0=零掷确定性,kb 向=sign(vx),fromPlayer=true', () => {
    pinGameTimeTicks(10_000);
    // Arrow 167 w=14（json width）→ cx=407,cy=307;盒=[311,503]×[211,403]
    const e1 = mkEnemy(9101, 380, 250);
    const game = makeGame([e1]);
    kill(mkFw(167, 50, 8), game);
    expect(recs.length).toBe(1);
    expect(recs[0]!.d).toBe(50);
    expect(recs[0]!.kx).toBe(4);            // sign(vx=8)×kb4（num40=direction,:13652）
    expect(recs[0]!.fromPlayer).toBe(true);
    expect(recs[0]!.crit).toBe(false);      // critChance=0 → 0.04 路由门关=零 RNG
    expect(recs[0]!.pierce).toBe(0);        // penetrate=-1 语义（Kill 尾 :78555）
  });

  it('B2 盒外敌不结算（右缘 503 外一格）', () => {
    pinGameTimeTicks(10_001);
    const eOut = mkEnemy(9102, 505, 250);
    const game = makeGame([eOut]);
    kill(mkFw(167, 50), game);
    expect(recs.length).toBe(0);
  });

  it('B3 四型 167-170 各自爆面结算（idStatic 键=type 逐型分桶）', () => {
    pinGameTimeTicks(10_002);
    for (const t of [167, 168, 169, 170]) {
      const e = mkEnemy(9100 + t, 380, 250);
      const game = makeGame([e]);
      kill(mkFw(t, 40), game);
      expect(recs.length, `type ${t}`).toBe(1);
      expect(recs[0]!.d).toBe(40);
      recs = [];
    }
  });

  it('B4 idStatic 1t 共享桶：同 tick 同型第二发对同敌不二结算（SetDefaults :2568-2570 cd=1）', () => {
    pinGameTimeTicks(10_003);
    const e = mkEnemy(9201, 380, 250);
    const game = makeGame([e]);
    kill(mkFw(167, 50), game);
    kill(mkFw(167, 50), game);              // 同型同 tick 第二爆 → 窗拒收
    expect(recs.length).toBe(1);
  });

  it('B5 iframes 门：接触杀同敌（iframes>0）爆面拒收（:12635-12637 immune[owner]==0 读面）', () => {
    pinGameTimeTicks(10_004);
    const e = mkEnemy(9301, 380, 250, 5);
    const game = makeGame([e]);
    kill(mkFw(167, 50), game);
    expect(recs.length).toBe(0);
  });

  it('B6 damage=0：无伤但 192² 割面照跑（CutTiles 先行 :12516→damage 门 :12576）', () => {
    pinGameTimeTicks(10_005);
    const e = mkEnemy(9401, 380, 250);
    const game = makeGame([e]);
    kill(mkFw(167, 0), game);
    expect(recs.length).toBe(0);
    // 割面覆盖 192 盒：盒 [311,503]×[211,403] → 格列 19..31、行 13..25（cutTilesBox
    // 记录含排除界,断言角格在内即可——精确边界已由 ProjCutTiles 既有测试锁）
    const cols = cutTiles.map((c) => c.x), rows = cutTiles.map((c) => c.y);
    expect(Math.min(...cols)).toBeLessThanOrEqual(19);
    expect(Math.max(...cols)).toBeGreaterThanOrEqual(31);
    expect(Math.min(...rows)).toBeLessThanOrEqual(13);
    expect(Math.max(...rows)).toBeGreaterThanOrEqual(25);
  });

  it('B7 killNow 幂等（头门 :71763-71766）:二调不双爆', () => {
    pinGameTimeTicks(10_006);
    const e = mkEnemy(9501, 380, 250);
    const game = makeGame([e]);
    const fw = mkFw(167, 50);
    kill(fw, game);
    kill(fw, game);
    expect(recs.length).toBe(1);
  });
});

describe('§2 结构锁（防静默回退）', () => {
  it('S1 爆块在位：192 割面 + idStatic 窗长单源 + 原版锚注', () => {
    expect(ARROW_TS).toContain('cutTilesBox(game, fwbX, fwbY, 192, 192)');
    expect(ARROW_TS).toContain('projectileData(this.projId)?.idStaticNPCHitCooldown ?? 10');
    expect(ARROW_TS).toContain(':78549-78556');
    expect(ARROW_TS).toContain('[g22-launcher-fw-blast] 清偿');
  });
  it('S2 idStatic 三件套门序（外环门→盒重叠→iframes→idStatic→hurt）', () => {
    const i = ARROW_TS.indexOf('if (this.projId >= 167 && this.projId <= 170) {\n      const fwbX');
    expect(i).toBeGreaterThan(0);
    const blk = ARROW_TS.slice(i, i + 2200);
    const iDont = blk.indexOf('dontTakeDamage');
    const iBox = blk.indexOf('fwbX + 192 > e.x');
    const iIfr = blk.indexOf('iframes ?? 0) > 0');
    const iIds = blk.indexOf('idStaticCheck(this.projId');
    const iHurt = blk.indexOf('e.hurt(');
    expect(iDont).toBeGreaterThan(-1);
    expect(iBox).toBeGreaterThan(iDont);
    expect(iIfr).toBeGreaterThan(iBox);
    expect(iIds).toBeGreaterThan(iIfr);
    expect(iHurt).toBeGreaterThan(iIds);
  });
});
