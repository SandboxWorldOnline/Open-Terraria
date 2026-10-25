// ★BJ496（2026-10-04）掷率收编尾四（BJ493 新登记三件,战役收官批）判别测试。
//  定谳锚（Terarria1457 亲读,行号=落刀日盘上;Projectile.cs Damage_PVE 单函数单遍历）：
//   · ①magic 域 critBonus 族同病收编（BJ493②③ 同构）：Game.ts spawn 拍
//     `X.critBonus = <magicCrit 冻结>`（蜂枪 1121→181/566、黄蜂枪 1155→189、毒/剧毒
//     杖 2188/1308→355/265、星力秘器→496、泡泡枪→410、天界碎裂→660、杀意牌→1024、
//     Daybloom→1114、贝希之怒→711、大地法杖→261、太空/激光枪→20/88 共 11 位）+
//     宝石法珠通用路径（fireGemStaffBolts critBonus 载体+b.critBonus）——主环 BJ493
//     路由化后 critChance>0 即入动态支,冻结写位=死写;旧 `||` 内部爆面（617 arcanum
//     /659 flame/MedusaHead 535→536 volley）把 0.04 路由门误当 4% 平率（BJ493③ 661
//     先例）→ 三面收编 rollVanillaHitCrit。181/566 数据面零旗+spawn 位 projClass
//     覆写（Player.cs:48805 magic=true）→ rollVanillaHitCrit 新增 classOverride 通道
//     （原版三连掷读【实旗】=数据面∪spawn 覆写）。
//   · ②melee 混合兜底：:43130 eater(307)——307 数据面 melee 旗,旧 critBonus 冻结
//     出生拍 meleeCrit 池且缺 :25712 持械折入;:20983 shotArrow——dmgKind 三域冻结式
//     对数据面实旗无谓（659/617/297/409/316=magic、306=melee,类别恒由弹 id 承载）。
//     两面同迁 0.04 路由门。
//   · ③BJ475③ 未接线残位三站（拆形 F11/BJ493④ 先例+golem 掷独立化）：
//     a.Arrow 主面 `roll || timerCrit || golem` 懒惰链——掷中拍 TryConsumingTimerCrit
//       被短路跳过（原版 :12928 无条件消费,前掷已 crit 照吃置 −15 :28568-71）;golem
//       掷 :12962-65 原版=独立无条件 if,短路漏抽 Next(10) 掷流（反伪影）。
//     b.whipTagShot 支 `res.crit || golem`——TimerCrit【整缺】（BJ453 注自称「既有
//       接位」与实现不符）+golem 短路+golem 单独掷中【零翻倍】缺口（tag crit ×2 已嵌
//       res.dmg,原版 crit 单布尔单翻倍）。
//     c.MinionProj contact——BJ453 已落分立形（timerCrit/monk/golem 全 eager 预求值,
//       无懒惰短路）=本批回归锚（变异判别:并链改懒惰序必红）。
//  判别力（旧码必红项）：§1a/1b magic 动态掷翻转+持械折入（旧死写恒 4% 档必红）;
//    §1c/1d 爆面动态（旧平率 4% 恒假必红）/§1e 写位零残留结构锁;§2a 307 melee 动态
//    （旧冻结面缺折入必红）/§2b 结构锁;§3a 掷中照消费 charge −15（旧短路残留 1000
//    必红）;§3b golem 掷流恢复（旧短路不抽必红）;§3c-1 whipTagShot TimerCrit 消费
//    （旧整缺必红）/§3c-2 golem 单独掷中翻倍（旧染零倍必红）;§3d contact 锚（懒惰
//    变异必红）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Arrow } from '../src/entities/Arrow';
import { MinionProj } from '../src/entities/MinionProj';
import { ITEM_DEFS } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { prefixStat } from '../src/data/vanillaPrefixes';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');
const strip = (s: string) => s.replace(/^\s*\/\/[^\n]*/gm, '');

// ---- 真环境夹具（bj493 同款：真 World+真 Player+spy 敌桶） ----
const W = 200, H = 120;

interface SpyEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; maxHp: number; hp: number;
  vanillaId: number; realLife: number; dontTakeDamage: boolean;
  vx: number; vy: number;
  calls: Array<{ d: number; crit: boolean }>;
  hurt(d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean): boolean;
}
function mkEnemy(id: number, cx: number, cy: number, w = 38, h = 38): SpyEnemy {
  const e: SpyEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, iframes: 0, maxHp: 500000, hp: 10000,
    vanillaId: 0, realLife: -1, dontTakeDamage: false, vx: 0, vy: 0, calls: [],
    hurt(d, _kx, _ky, _g, _pen = 0, crit = false) {
      e.calls.push({ d, crit });
      return true;
    },
  };
  return e;
}
function makeHooks(enemies: SpyEnemy[] = []): { hooks: GameHooks; player: Player } {
  const world = new World(W, H, 7, 'bj496-critroll-tail5-three');
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) world.store.setTile(x, y, 1);
  world.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const hooks: GameHooks = {
    world: world as never,
    player: player as never,
    enemies: () => enemies,
    npcs: () => [],
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    cutTilesBox: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    spawnDust: () => null,
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    entities: { add: () => undefined, projectiles: [] } as never,
  } as unknown as GameHooks;
  return { hooks, player };
}
const step = (list: unknown[], ticks: number, hooks: GameHooks): void => {
  for (let i = 0; i < ticks; i++) {
    for (const e of list) {
      const p = e as { dead: boolean; fixedUpdate: (dt: number, g: GameHooks) => void };
      if (!p.dead) p.fixedUpdate(1, hooks);
    }
  }
};
const timerOn = (p: Player): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, accTimerCrit: true }), configurable: true,
  });
};
const golemOn = (p: Player): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, accGolemSentryBackpack: true }), configurable: true,
  });
};
const shotAt = (projId: number, critChance: number): Arrow => {
  const a = new Arrow(520, 585, 8, 0, 10, 1, projId, { grav: 0, life: 60 });
  a.critChance = critChance;
  return a;
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// ================ §1（①）magic 域动态掷+爆面收编 ================
describe('BJ496-§1：magic critBonus 族主环动态掷+617/659/Medusa 爆面（旧冻结死写/平率必红）', () => {
  it('1a 命中拍换 owner 聚合 → 掷率翻转（189 黄蜂弹 magic 臂;旧死写恒 4% 档必红）', () => {
    const eA = mkEnemy(5, 600, 600);
    const { hooks, player } = makeHooks([eA]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);       // 0.04 档假/0.64 档真
    step([shotAt(189, 0.04)], 20, hooks);
    expect(eA.calls.length).toBe(1);                     // 夹具自证
    expect(eA.calls[0]!.crit).toBe(false);               // 聚合 0：0.5>0.04 假
    spy.mockReturnValue(60);                             // ★命中拍换装配（冻结病=同值仍假）
    const eB = mkEnemy(6, 600, 600);
    (hooks.enemies() as unknown as SpyEnemy[]).length = 0;
    (hooks.enemies() as unknown as SpyEnemy[]).push(eB);
    step([shotAt(189, 0.04)], 20, hooks);
    expect(eB.calls[0]!.crit).toBe(true);                // 0.5<0.64 真——动态读现值
    expect(eB.calls[0]!.d).toBe(20);                     // 10×2（crit 乘区）
  });

  it('1b :25712 持械折入命中拍现值：held 键刃 671（crit16）+词缀 61（crt+5）→ 阈值抬至 0.25', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    expect(id671).toBeGreaterThanOrEqual(0);
    expect(itemCombat(671)?.crit).toBe(16);
    expect(prefixStat(61).crt).toBe(5);
    const e = mkEnemy(7, 600, 600);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue({ id: id671, prefix: 61 } as never);
    let d1b = 0; vi.spyOn(Math, 'random').mockImplementation(() => (d1b++ === 0 ? 0.22 : 0.5));   // 首掷=crit 阈值(0.04/0.20 档假/0.25 档真);后续=★BJ716-A DV 中性档(×1.0)
    step([shotAt(189, 0.04)], 20, hooks);
    expect(e.calls[0]!.crit).toBe(true);                 // 命中拍折入 item.crit+crt
    expect(e.calls[0]!.d).toBe(20);
  });

  /** 617 星璇秘术死亡爆面（arcanumDeathBurst）直驱：盒 R=88,敌心距 <107 必入环 */
  const burst = (a: Arrow, hooks: GameHooks): void =>
    (a as unknown as { arcanumDeathBurst: (g: GameHooks) => void }).arcanumDeathBurst(hooks);
  const flameBurst = (a: Arrow, hooks: GameHooks): void =>
    (a as unknown as { flame659DeathBurst: (g: GameHooks) => void }).flame659DeathBurst(hooks);
  const centered617 = (): Arrow => {
    const a = new Arrow(600 - 9, 600 - 9, 0, 0, 10, 1, 617, { grav: 0 });
    a.critChance = 0.04;                                 // 迁移后 spawn 形（0.04 路由门）
    return a;
  };

  it('1c 617 arcanum 爆面=命中拍动态掷（旧 `||` 面把 0.04 门当 4% 平率必红）', () => {
    // 注：mock 值取 0.3——0.5 落入 620 碎片环 `Next(-100,101)` 零向重掷死区
    // （floor(0.5×201)−100=0 恒零向）,burst 尾部 620 环将无限重掷;0.3=-40 非零向。
    const e = mkEnemy(8, 600, 600);
    const { hooks, player } = makeHooks([e]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.3);       // 0.04 档假/0.64 档真
    burst(centered617(), hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(false);                // 0.04 档：0.5 假
    spy.mockReturnValue(60);
    e.calls.length = 0;
    burst(centered617(), hooks);
    expect(e.calls[0]!.crit).toBe(true);                 // ★动态翻转（旧平率面恒假）
    expect(e.calls[0]!.d).toBe(20);
  });

  it('1d 659 flame 爆面同构收编（R=40 盒）', () => {
    const e = mkEnemy(9, 600, 600);
    const { hooks, player } = makeHooks([e]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.3);       // 同 1c：0.5=620 环零向死区
    const a659 = new Arrow(600 - 9, 600 - 9, 0, 0, 10, 1, 659, { grav: 0 });
    a659.critChance = 0.04;
    flameBurst(a659, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(false);
    spy.mockReturnValue(60);
    e.calls.length = 0;
    const b659 = new Arrow(600 - 9, 600 - 9, 0, 0, 10, 1, 659, { grav: 0 });
    b659.critChance = 0.04;
    flameBurst(b659, hooks);
    expect(e.calls[0]!.crit).toBe(true);
    expect(e.calls[0]!.d).toBe(20);
  });

  it('1f 蜂族 spawn 位类别旗覆写通道（181 数据面零旗+projClass=magic → magic 臂动态掷）', () => {
    // R29 蜂枪发蜂（Player.cs:48805 `magic=true` spawn 覆写,仓内=projClass 字段）——
    // 原版三连掷读【实旗】:rollVanillaHitCrit classOverride 通道落地判别。
    const eA = mkEnemy(30, 600, 600);
    const { hooks, player } = makeHooks([eA]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const bee = shotAt(181, 0.04);                       // 181 数据面 melee/ranged/magic 全零
    bee.projClass = 'magic';                             // spawn 位覆写（迁移后 spawn 形）
    step([bee], 20, hooks);
    expect(eA.calls.length).toBe(1);
    expect(eA.calls[0]!.crit).toBe(false);               // 聚合 0:假（override 通道闭=同值）
    spy.mockReturnValue(60);
    const eB = mkEnemy(31, 600, 600);
    (hooks.enemies() as unknown as SpyEnemy[]).length = 0;
    (hooks.enemies() as unknown as SpyEnemy[]).push(eB);
    const bee2 = shotAt(181, 0.04);
    bee2.projClass = 'magic';
    step([bee2], 20, hooks);
    expect(eB.calls[0]!.crit).toBe(true);                // ★override 通道开:magic 臂 0.64 档真
    expect(eB.calls[0]!.d).toBe(20);
  });

  it('1e 结构锁：Game.ts 11 位 magic 写位+通用路径 critBonus 载体=零残留,0.04 路由门在位', () => {
    const s = strip(SRC('core/Game.ts'));
    for (const gone of [
      'bee.critBonus = this.player.critChance',
      'wasp.critBonus = this.player.critChance',
      'fang.critBonus = this.player.critChance',
      'sfArrow.critBonus = this.player.critChance',
      'bub.critBonus = this.player.critChance',
      'shard.critBonus = this.player.critChance',
      'card.critBonus = this.player.critChance',
      'bloom.critBonus = this.player.critChance',
      'bolt.critBonus = this.player.critChance',
      'b261.critBonus = this.player.critChance',
      'zap.critBonus = this.player.critChance',
      'const critBonus = this.player.critChance',        // fireGemStaffBolts 载体
      'b.critBonus = critBonus;',                        // mkBolt 写位
    ]) {
      expect(s).not.toContain(gone);
    }
    for (const gate of [
      'bee.critChance = 0.04;',
      'wasp.critChance = 0.04;',
      'fang.critChance = 0.04;',
      'sfArrow.critChance = 0.04;',
      'bub.critChance = 0.04;',
      'shard.critChance = 0.04;',
      'card.critChance = 0.04;',
      'bloom.critChance = 0.04;',
      'bolt.critChance = 0.04;',
      'b261.critChance = 0.04;',
      'zap.critChance = 0.04;',
      'b.critChance = 0.04;',
    ]) {
      expect(s).toContain(gate);
    }
    // 爆面三站收编（617/659 箭域 + MedusaHead 535→536 volley）——新面在位+
    // MedusaHead 旧 `||` 面零残留。★BJ497①（2026-10-04）五遗留面已全数收编（:1848
    // barrel1023[休眠销案锚]/:5372 crit631/:7337+:9309 钉 514 双面/:10424 食人鱼 190,
    // 判别测试 tests/bj497-critroll-tail6-three.test.ts）——计数锁 5→0 换防（收编后
    // 本形残留=无意识回潮）。
    const arrow = strip(SRC('entities/Arrow.ts'));
    expect(arrow.split('Math.random() < (this.critChance || (4 + this.critBonus) / 100)').length - 1).toBe(0);
    expect(arrow).toContain('const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);');
    const medusa = strip(SRC('entities/MedusaHeadProj.ts'));
    expect(medusa).toContain('rollVanillaHitCrit(this.projId, game)');
    expect(medusa).not.toContain('(this.critChance || (4 + this.critBonus) / 100)');
  });
});

// ================ §2（②）melee 混合兜底 ================
describe('BJ496-§2：melee 混合兜底收编（307 eater 动态掷+shotArrow dmgKind 冻结式退役）', () => {
  it('2a eater 307 数据面 melee 臂动态掷（旧冻结面缺 :25712 持械折入必红）', () => {
    const eA = mkEnemy(10, 600, 600);
    const { hooks, player } = makeHooks([eA]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null as never);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const a307 = shotAt(307, 0.04);
    a307.friendly307 = true;                             // 307 锁定帧 friendly=true（:27789-27792,锁定前不结算）
    step([a307], 20, hooks);
    expect(eA.calls.length).toBe(1);
    expect(eA.calls[0]!.crit).toBe(false);               // 聚合 0：假
    // 命中拍折入：聚合 0 + held 671(crit16)+词缀 61(crt+5) → 阈值 0.25
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue({ id: id671, prefix: 61 } as never);
    const eB = mkEnemy(11, 600, 600);
    (hooks.enemies() as unknown as SpyEnemy[]).length = 0;
    (hooks.enemies() as unknown as SpyEnemy[]).push(eB);
    let d2a = 0; vi.spyOn(Math, 'random').mockImplementation(() => (d2a++ === 0 ? 0.22 : 0.5));   // 首掷=crit 阈值(0.25 档真);后续=★BJ716-A DV 中性档(×1.0)
    const b307 = shotAt(307, 0.04);
    b307.friendly307 = true;
    step([b307], 20, hooks);
    expect(eB.calls[0]!.crit).toBe(true);                // ★melee 臂折入（旧冻结面无从承载）
    expect(eB.calls[0]!.d).toBe(20);
  });

  it('2b 结构锁：eater/shotArrow 冻结写位零残留+0.04 路由门在位', () => {
    const s = strip(SRC('core/Game.ts'));
    expect(s).not.toContain('eater.critBonus = this.player.critChance');
    expect(s).not.toContain("shotArrow.critBonus = this.player.critChance(dmgKind === 'magic'");
    expect(s).toContain('eater.critChance = 0.04;');
    expect(s).toContain('shotArrow.critChance = 0.04;');
  });
});

// ================ §3（③）三站拆形+golem 掷流恢复 ================
describe('BJ496-§3：TimerCrit 掷中照消费+golem 掷独立化（主面/whipTagShot/contact 三站）', () => {
  it('3a 主面掷中拍 TimerCrit 照消费（roll=true charge 置 −15;旧短路残留 1000 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);      // 0.01<0.04=掷中
    const { hooks, player } = makeHooks([]);
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = mkEnemy(12, 600, 600);
    (hooks.enemies() as unknown as SpyEnemy[]).push(e);
    step([shotAt(1, 0.04)], 20, hooks);                  // 1=木箭 ranged 臂
    expect(e.calls.length).toBe(1);                      // 夹具自证
    expect(e.calls[0]!.crit).toBe(true);                 // 掷中 crit（两形态同）
    expect(player.accTimerCritCharge).toBe(-15);         // ★主判别:照消费（旧恒 1000 必红）
  });

  it('3b golem 掷流恢复：TimerCrit 强制拍 SentryShot Next(10) 照抽（旧短路漏抽必红）', () => {
    // 装备 6176 背包+TimerCrit 满蓄,664=SentryShot 表成员（data face 零旗→roll 零 RNG,
    // else 支 1 抽;timerCrit 强制（尘 20 抽）;golem 在装备位时【每命中必抽 1】——
    // 旧懒惰链 timerCrit 真即短路跳过 golem=两运行抽数恒等。抽数差分判别（AI 面
    // RNG 恒定 mock 下两运行同量,差分只含 golem 掷）。
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { hooks: hooksA, player: playerA } = makeHooks([]);
    golemOn(playerA);
    timerOn(playerA);
    playerA.accTimerCritCharge = 1000;
    const eA = mkEnemy(13, 600, 600);
    (hooksA.enemies() as unknown as SpyEnemy[]).push(eA);
    const spyA = vi.spyOn(Math, 'random');
    const a664 = shotAt(664, 0);
    a664.whipTagShot = false;
    step([a664], 20, hooksA);
    const countA = spyA.mock.calls.length;
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const { hooks: hooksB, player: playerB } = makeHooks([]);
    timerOn(playerB);                                    // 无背包=golem 整段门闭零抽
    playerB.accTimerCritCharge = 1000;
    const eB = mkEnemy(14, 600, 600);
    (hooksB.enemies() as unknown as SpyEnemy[]).push(eB);
    const spyB = vi.spyOn(Math, 'random');
    const b664 = shotAt(664, 0);
    b664.whipTagShot = false;
    step([b664], 20, hooksB);
    const countB = spyB.mock.calls.length;
    expect(countA).toBeGreaterThan(countB);              // ★主判别:golem 掷流恢复
  });

  it('3c-1 whipTagShot 支 TimerCrit 消费（旧整缺必红）+roll/TimerCrit 源翻倍归位', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);       // 无 tag→res.crit=false;crit 全赖 TimerCrit;★BJ716-A:DV 中性档(×1.0)
    const { hooks, player } = makeHooks([]);
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = mkEnemy(15, 600, 600);
    (hooks.enemies() as unknown as SpyEnemy[]).push(e);
    const a = shotAt(1120, 0);                           // 1120=MinionShot 表成员（零旗零掷）
    a.whipTagShot = true;
    step([a], 20, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                 // TimerCrit 强制（旧支恒 false 必红）
    expect(e.calls[0]!.d).toBe(20);                      // ★翻倍归位（新源补一次 ×2）
    expect(player.accTimerCritCharge).toBe(-15);         // ★消费（旧整缺恒 1000 必红）
  });

  it('3c-2 whipTagShot golem 单独掷中→翻倍归位（旧形只染 crit 色零翻倍必红）+Next(10) 照抽', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);      // 0.05→Next(10)=0=golem 掷中;DV 亦掷 −14 档(10×0.86=8.6→ToEven 9)
    const { hooks, player } = makeHooks([]);
    golemOn(player);                                     // 664=SentryShot+背包→golem 掷可达
    const e = mkEnemy(16, 600, 600);
    (hooks.enemies() as unknown as SpyEnemy[]).push(e);
    const a = shotAt(664, 0);
    a.whipTagShot = true;                                // 哨兵塔射弹走 tag 支
    step([a], 20, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                 // golem 强制（旧同相=回归锚）
    expect(e.calls[0]!.d).toBe(18);                      // ★主判别:翻倍（旧 10 必红）;DV(10,−14 档)=9×2（BJ716-A R18-F2）
  });

  it('3d MinionProj contact 锚（BJ453 分立形回归位）：tag crit 命中拍 TimerCrit 照消费', () => {
    // contact 面 timerCrit/monk/golem 皆 eager 预求值=BJ475③ 处方已落——本位=回归锚
    // （变异判别:并链改 `res.crit || timerCrit` 懒惰序 → tag crit 短路消费必红）。
    let d3d = 0; vi.spyOn(Math, 'random').mockImplementation(() => (d3d++ === 0 ? 0.05 : 0.5));   // 首掷=tag 4679 crit 10%:5<10 命中;后续=★BJ716-A DV 中性档(×1.0)
    const src = mkEnemy(17, 600, 600);
    const { hooks, player } = makeHooks([src]);
    timerOn(player);
    player.accTimerCritCharge = 1000;
    player.tagEffectStack.tryApplyTagToNPC(4679, src.id, 0, 0);   // tagDamage 8+crit 10%
    const raven = new MinionProj(600 - 14, 600 - 14, 317, 30, 1.5, false, 0, false, () => player);
    (raven as unknown as { contact: (g: GameHooks, d: number, cd?: number) => boolean })
      .contact(hooks, 30, 5);
    expect(src.calls.length).toBe(1);
    expect(src.calls[0]!.crit).toBe(true);               // tag crit（res.crit）
    expect(src.calls[0]!.d).toBe(76);                    // (30+8)×2 已嵌 res.dmg 单翻倍
    expect(player.accTimerCritCharge).toBe(-15);         // ★锚:TimerCrit 照消费（懒惰变异必红）
  });
});
