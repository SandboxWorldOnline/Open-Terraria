// ★BJ290 清债刀 件1（P0——BJ288 清偿批整缺的第四件）：死亡拍割面四站回归。
//
// 原版时序（U1 已证 + 本刀亲读复核,1457/1458 同构）：Projectile.Damage()
// （Projectile.cs:12502）内 CutTiles(:12517)【先】于 Damage_PVE(:12523)——
// penetrate 耗尽亡拍 = 命中拍照割;外层 :17132 `if(!active) return` 只拦
// HandleMovement（AI/撞块）内杀位。本仓中央收口（Entity.ts）带 `!e.dead` 门
// = 死亡拍整缺 → BJ260（ChloroLeaf 227）/BJ285（13 站）前置习语,本刀补四站：
//   ① Arrow.ts 主命中管线头（盖 :9183 敌怪穿透/:9192 城镇 NPC/:8719 小动物/
//      :8704 318 臭蛋 四死亡位）——木箭等 aiStyle1/2 有限穿透弹=家族内流量最大漏网站;
//   ② WeaponProj.CounterweightProj -2 脱离克隆（penetrate 1 :64741-64744,命中即亡）;
//   ③ WeaponProj.MolotovProj 399（penetrate 1,命中敌 breakOpen 即亡）;
//      ★定谳修订：期满死原版【照割】——timeLeft-- Kill(:17308-17313) 在 Damage
//      (:17184) 之后同子步,与本仓此处前置割全同（U1 旧判语系 :17132 门误植,
//      详见 WeaponProj.ts 注;红队推翻可单点摘除）;
//   ④ Dart.ts 友方炮弹族（166 雪球 pen1/162 炮弹 pen4 经 :781 afterHit 亡）。
//      边缘站定谳=非缺口：:820/:828 小动物/城镇 NPC 死亡位在 hostile 门后
//      （原版 CutTiles 调用点 :12516 friendly 门内,hostile 弹全程无割）且现役
//      hostile 路径全型 penetrate=-1 恒不经死亡位——备案锁（勿补割）见下。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Arrow } from '../src/entities/Arrow';
import { CounterweightProj, MolotovProj } from '../src/entities/WeaponProj';
import { TrapShot } from '../src/entities/Dart';
import type { GameHooks } from '../src/entities/types';
// ★C档可移植:仓库外依赖(game/ 兄弟目录,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
const EXT_MISSING = !['Terarria1457'].every((d) => existsSync(new URL(`../../${d}`, import.meta.url)));


/** 割面/伤害序记录器：log = ['cut' | 'hurt' | 'fires', …] 按发生序 */
type Log = string[];

function victim(log: Log, x = 396, y = 400, w = 24, h = 42) {
  return {
    x, y, w, h, id: 777, dead: false, vanillaId: 21, facing: 1,
    get cx() { return this.x + this.w / 2; },
    get cy() { return this.y + this.h / 2; },
    hurt: vi.fn(() => { log.push('hurt'); return true; }),
  };
}

/** 弹域最小 GameHooks（real World/Player + 序记录 cutTile） */
function makeGame(log: Log, enemies: unknown[], opts: { realPlayer?: boolean } = {}) {
  const w = new World(160, 160, 33, 'bj290-cut');
  const player = opts.realPlayer === false
    ? {
        x: 200 * 16, y: 100 * 16, w: 20, h: 42,
        get cx() { return this.x + this.w / 2; },
        get cy() { return this.y + this.h / 2; },
        dead: true, mana: 999,
      }
    : new Player(200 * 16, 100 * 16, new Inventory());
  const g = {
    world: w,
    player,
    enemies: () => enemies,
    critters: () => [],
    npcs: () => [],
    playSfx: vi.fn(), playSfxFiles: vi.fn(), playSfxWav: vi.fn(), playSfxFile: vi.fn(),
    spawnDust: vi.fn(() => null),
    spawnParticles: vi.fn(),
    spawnDrop: vi.fn(() => null),
    addDamageNumber: vi.fn(),
    damagePlayer: vi.fn((): number => 0),
    bannerNpcActive: () => false,
    onProjectileDeath: vi.fn(),
    applyLifeSteal: vi.fn((): number => 0),
    notifyInventoryChanged: vi.fn(),
    onEnemyKilled: vi.fn(),
    spawnEnemy: vi.fn(),
    cutTile: (_x: number, _y: number) => { log.push('cut'); },
  } as never as GameHooks;
  return { g, w };
}

afterEach(() => { vi.restoreAllMocks(); });

// ================================================================
// ① Arrow 主命中管线：死亡拍割面（CutTiles :12517 先于 Damage_PVE :12523）
// ================================================================
describe.skipIf(EXT_MISSING)('BJ290-① Arrow 死亡拍割面（木箭 penetrate 1 命中即亡拍照割）', () => {
  it('木箭首中即亡拍：割面先于 hurt（旧=中央割 !e.dead 门死亡拍整缺）', () => {
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const log: Log = [];
    const en = victim(log);
    const { g } = makeGame(log, [en]);
    const a = new Arrow(400, 416, 2, 0, 15, 2, 1);   // 木箭 10×10,penetrate 缺省 1
    expect(a.pierce).toBe(1);
    a.fixedUpdate(1 / 60, g);
    expect(a.dead).toBe(true);                        // 首中即亡（penetrate 耗尽）
    expect(en.hurt).toHaveBeenCalledTimes(1);
    const cutIdx = log.indexOf('cut');
    expect(cutIdx).toBeGreaterThanOrEqual(0);         // ★死亡拍照割（旧=整缺）
    expect(log.indexOf('hurt')).toBeGreaterThan(cutIdx); // 原版序：割(:12517)→伤(:12523)
    randSpy.mockRestore();
  });

  it('撞块死（HandleMovement 杀位）：死亡拍零割（活拍照割对照=原版 :17132 !active 门语义）', () => {
    const log: Log = [];
    const { g, w } = makeGame(log, []);
    for (let y = 20; y <= 34; y++) w.store.setTileSilent(30, y, 1);   // x=30 竖墙(480px)
    const a = new Arrow(460, 416, 6, 0, 15, 2, 1);
    let deathTickCuts = -1;
    for (let t = 0; t < 10 && !a.dead; t++) {
      const before = log.length;
      a.fixedUpdate(1 / 60, g);
      if (a.dead) deathTickCuts = log.slice(before).filter((x) => x === 'cut').length;   // 死亡拍新增割数
    }
    expect(a.dead).toBe(true);
    expect(log.length).toBeGreaterThan(0);            // 活拍照割（中央割同拍幂等双报面）
    // 死亡拍：既有 :8139 撞块面只报【单格】collision tile（1~2 条）;若本刀管线前置割
    // 误在死亡拍跑,弹盒(+1 外沿)整盒上报必 ≥4 条 —— <4 即证死亡拍管线未达（:17132 门）
    expect(deathTickCuts).toBeLessThan(4);            // ★撞块杀位死亡拍无整盒割（勿扩大）
  });
});

// ================================================================
// ② CounterweightProj -2 脱离克隆：penetrate 1 命中即亡拍照割
// ================================================================
describe.skipIf(EXT_MISSING)('BJ290-② 配重球 -2 脱离态死亡拍割面（:64741-64744 penetrate 1）', () => {
  function makeCW(log: Log, en: unknown) {
    const { g } = makeGame(log, [en], { realPlayer: false });
    // realPlayer:false 桩缺 yoyoStringAnchor/equipStats → 换真 Player
    const p = new Player(200 * 16, 100 * 16, new Inventory());
    (g as { player: unknown }).player = p;
    const cw = new CounterweightProj(400, 416, 20, 4, 556, -2, {
      owner: () => p,
      channel: () => false,
      yoyoInPlay: () => true,
      mouseDelta: () => ({ dx: 0, dy: 0 }),
    });
    return { g, cw };
  }

  it('-2 首中即亡拍：割面先于 hurt（aiStyle 99 段两排除表均无 556-561/1079）', () => {
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const log: Log = [];
    const en = victim(log);
    const { g, cw } = makeCW(log, en);
    cw.fixedUpdate(1 / 60, g);
    expect(cw.dead).toBe(true);                       // penetrate 1 一次命中即亡
    expect(en.hurt).toHaveBeenCalledTimes(1);
    const cutIdx = log.indexOf('cut');
    expect(cutIdx).toBeGreaterThanOrEqual(0);         // ★死亡拍照割（旧=整缺）
    expect(log.indexOf('hurt')).toBeGreaterThan(cutIdx);
    randSpy.mockRestore();
  });

  it('-2 撞墙亡（chX 支）：HandleMovement 杀位原版不割,先于割位 return', () => {
    const log: Log = [];
    const { g, w } = makeGame(log, [], { realPlayer: false });
    const p = new Player(200 * 16, 100 * 16, new Inventory());
    (g as { player: unknown }).player = p;
    for (let y = 20; y <= 34; y++) w.store.setTileSilent(31, y, 1);   // x=31 竖墙
    const cw = new CounterweightProj(480, 416, 20, 4, 556, -2, {
      owner: () => p, channel: () => false, yoyoInPlay: () => true,
      mouseDelta: () => ({ dx: 0, dy: 0 }),
    });
    (cw as { vx: number }).vx = 6;
    let deathTickCuts2 = -1;
    for (let t = 0; t < 10 && !cw.dead; t++) {
      const before = log.length;
      cw.fixedUpdate(1 / 60, g);
      if (cw.dead) deathTickCuts2 = log.slice(before).filter((x) => x === 'cut').length;
    }
    expect(cw.dead).toBe(true);
    expect(deathTickCuts2).toBe(0);                   // 撞墙杀位=原版 !active 门不割
  });
});

// ================================================================
// ③ MolotovProj 399：命中敌 breakOpen 即亡拍照割（+期满定谳修订面）
// ================================================================
describe.skipIf(EXT_MISSING)('BJ290-③ 燃烧瓶 399 死亡拍割面（penetrate 1 命中敌即裂）', () => {
  function makeMolotov(log: Log, enemies: unknown[], x = 400, y = 416, vx = 1, vy = 0) {
    const fires = vi.fn(() => { log.push('fires'); });
    const { g } = makeGame(log, enemies, { realPlayer: false });
    const m = new MolotovProj(x, y, vx, vy, 25, fires);
    return { g, m, fires };
  }

  it('命中敌即裂拍：割面先于火云出口（:12517 先于 :12523→Kill 链）', () => {
    const log: Log = [];
    const en = victim(log);
    const { g, m, fires } = makeMolotov(log, [en]);
    m.fixedUpdate(1 / 60, g);
    expect(m.dead).toBe(true);                        // breakOpen 即亡
    expect(fires).toHaveBeenCalledTimes(6);           // 火云出口（六朵火云,:70918-70927）
    const cutIdx = log.indexOf('cut');
    expect(cutIdx).toBeGreaterThanOrEqual(0);         // ★死亡拍照割（旧=整缺）
    expect(log.indexOf('fires')).toBeGreaterThan(cutIdx);
  });

  it('撞块裂（moveAndCollide 杀位）：原版 :17132 门不割——勿扩大', () => {
    const log: Log = [];
    const { g, m, fires } = makeMolotov(log, [], 400, 452, 0, 4);
    for (let x = 20; x <= 34; x++) (g.world as World).store.setTileSilent(x, 31, 1);
    let deathTickCuts3 = -1;
    for (let t = 0; t < 8 && !m.dead; t++) {
      const before = log.length;
      m.fixedUpdate(1 / 60, g);
      if (m.dead) deathTickCuts3 = log.slice(before).filter((x) => x === 'cut').length;
    }
    expect(m.dead).toBe(true);
    expect(fires).toHaveBeenCalledTimes(6);
    expect(deathTickCuts3).toBe(0);                   // ★撞块杀位死亡拍零割（勿扩大）
  });

  it('期满裂：★BJ290 定谳修订——原版 timeLeft Kill(:17308) 在 Damage(:17184) 后同子步 → 期满拍【照割】', () => {
    const log: Log = [];
    const { g, m, fires } = makeMolotov(log, [], 400, 416, 0, 0);
    (m as unknown as { timeLeft: number }).timeLeft = 1;
    m.fixedUpdate(1 / 60, g);
    expect(m.dead).toBe(true);
    expect(fires).toHaveBeenCalledTimes(6);
    expect(log).toContain('cut');                     // 期满拍割面（U1 旧判语误植,修订面）
  });
});

// ================================================================
// ④ Dart 友方炮弹族：afterHit 计数归零亡拍照割（:781）
// ================================================================
describe.skipIf(EXT_MISSING)('BJ290-④ TrapShot 炮弹族死亡拍割面（166 雪球 pen1 / 162 炮弹 pen4）', () => {
  it('雪球 166 首中即亡拍：割面先于 hurt（vanilla friendly;:12516 门内）', () => {
    const log: Log = [];
    const en = victim(log);
    const { g } = makeGame(log, [en], { realPlayer: false });
    const d = new TrapShot(400, 416, 1, 0, 12, 'snowball');
    expect(d.hostile).toBe(false);
    expect((d as unknown as { pierceLeft: number }).pierceLeft).toBe(1);
    d.fixedUpdate(1 / 60, g);
    expect(d.dead).toBe(true);                        // afterHit 计数归零
    expect(en.hurt).toHaveBeenCalledTimes(1);
    const cutIdx = log.indexOf('cut');
    expect(cutIdx).toBeGreaterThanOrEqual(0);         // ★死亡拍照割（旧=整缺）
    expect(log.indexOf('hurt')).toBeGreaterThan(cutIdx);
  });

  it('炮弹 162 末击亡拍：割面在（4 发计数耗尽同拍）', () => {
    const log: Log = [];
    const en = victim(log);
    const { g } = makeGame(log, [en], { realPlayer: false });
    const d = new TrapShot(400, 416, 1, 0, 30, 'cannonball');
    (d as unknown as { pierceLeft: number }).pierceLeft = 1;   // 末击档（前 3 跳已耗）
    d.fixedUpdate(1 / 60, g);
    expect(d.dead).toBe(true);
    const cutIdx = log.indexOf('cut');
    expect(cutIdx).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('hurt')).toBeGreaterThan(cutIdx);
  });
});

// ================================================================
// 边缘站定谳 + 结构锁（备案：Dart :820/:828 hostile 死亡位勿补割）
// ================================================================
describe.skipIf(EXT_MISSING)('BJ290-件1 结构锁（修复站在位 + 备案站零补割）', () => {
  const src = (f: string) => readFileSync(resolve(__dirname, '..', 'src', 'entities', f), 'utf8');

  it('四站 cutTilesBox 调用位全数在位（源锚）', () => {
    expect(src('Arrow.ts')).toContain("if (!this.hostile && !this.reflected) cutTilesBox(game, this.x, this.y, this.w, this.h);");
    expect(src('WeaponProj.ts').match(/cutTilesBox\(game, this\.x/g)!.length).toBeGreaterThanOrEqual(6);
    expect(src('Dart.ts')).toContain('if (!this.hostile) cutTilesBox(game, this.x, this.y, this.w, this.h);');
  });

  it('备案锁：Dart 小动物/城镇 NPC 死亡位零补割（原版 hostile 无割面+现役 -1 穿透恒不经）', () => {
    const s = src('Dart.ts');
    // ★BJ716-A 顺手清记账:BJ704-G22 烟花域扫面清偿加 fireworkUpdate 头割草站
    //  （死亡拍小盒照割,:17184 位）→ 计数 1→2;敌环前置站语义不变（hostile 门内不落第三处）
    expect(s.match(/cutTilesBox\(game, this\.x/g)!.length).toBe(2);
    expect(s).toContain('★BJ290 件1 备案锁');
  });

  it('原版锚：CutTiles 调用点与两道门行号活证（1457）', () => {
    const cs = readFileSync(resolve(__dirname, '..', '..', 'Terarria1457', 'Terraria', 'Projectile.cs'), 'utf8');
    expect(cs).toContain('CutTiles();');
    expect(cs).toContain('private void CutTiles()');
    expect(cs).toContain('private bool CanCutTiles()');
  });
});
