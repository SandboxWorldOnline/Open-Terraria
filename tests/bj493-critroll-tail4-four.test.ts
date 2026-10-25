// ★BJ493（2026-10-04）掷率收编四残余判别测试（BJ489 新登记+前在红）。
//  定谳锚（Terarria1457 亲读,行号=落刀日盘上）：
//   · ①w5 B2 锁复绿——contact 环 BJ475① :12600 DTD 头门前置（MinionProj.ts
//     `if (dontTakeDamage) continue` 先于 Inner 全链）→ 主命中尝试（hurt 调用）/
//     TimerCrit/tag ModifyHit/私表 cd/916 链电【全不达】。旧 W5 提交态「主命中
//     尝试照发 [45]（真 Enemy.hurt 内部拒）」与前置门契约冲突=前在红（BJ475①
//     落刀晚于 W5 锁,与 tests/bj475-tag-crit-batch3 §1a 同构）。
//   · ②Arrow 通用环 `critChance ?? (4+critBonus)/100` 兜底=死支：类缺省 critChance=0
//     （Arrow.ts 类字段）,?? 不认 0 为未设 ⇒ critBonus 族（弓/枪主弹/扇/泡/暮夕/
//     投掷/434 续发——Game.ts spawn 位 `X.critBonus = <冻结>`）经主环【永不暴击】。
//     原版口径（Projectile.cs:12915-12927）= owner.rangedCrit 掷,:25712-25714 逐帧
//     折入持械 item.crit/词缀 crt;弹药无一带 crit（Item.cs SetDefaults 34 处 crit
//     赋值全为武器）⇒ rollVanillaHitCrit 单源动态式=原版同算式。修=spawn 位
//     `critChance = 0.04` 路由门 + 主环中支 rollVanillaHitCrit（命中拍动态）。
//   · ③同批迁移 661 黑爆二段爆面（blackBolt661Burst——spawnFanArrow 摘喂后的活
//     读者,旧 `||` 面会把 0.04 路由门误当 4% 平率消费）。
//   · ④hitEnemies 注入支 BJ475③ 同形拆分（WeaponProj.ts——proj1457 dealContacts
//     :512 已修,hitEnemies 未接）：原版 TryConsumingTimerCrit(:12928)【无条件】
//     消费,前掷已 crit 照吃（charge>0 置 −15 :28568-71）;旧 `roll || consume`
//     短路=掷中拍 charge 残留满蓄。
//  判别力（旧码必红项）：§1 摘门 [45] 必红;§2a 命中拍换聚合掷率翻转（旧平率恒假
//    必红）/§2b 持械折入阈值抬升（旧 4% 档必红）;§3c 无类旗零 RNG（旧 4% 平率掷
//    必红）;§4a 掷中照消费 charge −15（旧短路残留 1000 必红）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Arrow } from '../src/entities/Arrow';
import { MinionProj } from '../src/entities/MinionProj';
import { hitEnemies, HitCooldown } from '../src/entities/WeaponProj';
import { ITEM_DEFS } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { prefixStat } from '../src/data/vanillaPrefixes';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');

// ---- 真环境夹具（w5/bj475 同款：真 World+真 Player+spy 敌桶） ----
const W = 200, H = 120;
const seq: string[] = [];

interface SpyEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; maxHp: number; hp: number;
  vanillaId: number; realLife: number; dontTakeDamage: boolean;
  vx: number; vy: number; tag: string;
  calls: Array<{ d: number; crit: boolean }>;
  hurt(d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean): boolean;
}
function mkEnemy(id: number, cx: number, cy: number, tag: string, w = 38, h = 38): SpyEnemy {
  const e: SpyEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, iframes: 0, maxHp: 500000, hp: 10000,
    vanillaId: 0, realLife: -1, dontTakeDamage: false, vx: 0, vy: 0, tag, calls: [],
    hurt(d, _kx, _ky, _g, _pen = 0, crit = false) {
      e.calls.push({ d, crit });
      seq.push(e.tag);
      return true;
    },
  };
  return e;
}
function makeHooks(enemies: SpyEnemy[] = []): { hooks: GameHooks; player: Player } {
  const world = new World(W, H, 7, 'bj493-critroll-tail4-four');
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

beforeEach(() => { seq.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

// ================ §1（①）contact 环 DTD 头门整跳（BJ475① 现役定谳形） ================
describe('BJ493-§1：MinionProj contact 环 :12600 DTD 前置门——整跳零 hurt（w5 B2 锁复绿判别）', () => {
  const ravenAt = (player: Player, cx: number, cy: number): MinionProj =>
    new MinionProj(cx - 14, cy - 14, 317, 30, 1.5, false, 0, false, () => player);
  const contactDirect = (m: MinionProj, hooks: GameHooks, dmg = 30, cd: number | undefined = 5): boolean =>
    (m as unknown as { contact: (g: GameHooks, d: number, cd?: number) => boolean }).contact(hooks, dmg, cd);

  it('1a DTD 靶整跳：主命中尝试/链电全不达（摘门=主命中 [45]/seq=[SRC] 必红）', () => {
    const src = mkEnemy(1, 600, 600, 'SRC');
    const e1 = mkEnemy(2, 700, 600, 'E1');
    src.dontTakeDamage = true;
    const { hooks, player } = makeHooks([src, e1]);
    player.tagEffectStack.tryApplyTagToNPC(4680, src.id, 0, 0);   // darkharvest tagDamage 15
    contactDirect(ravenAt(player, 600, 600), hooks);
    // ★BJ475① 定谳形：:12600 前置门 continue 先于 hurt 调用——旧 W5 锁 [45]（主命中
    // 尝试照发）整跳退役。摘门变异 → contact 照发主命中 45/seq=['SRC'] → 三断言全红。
    expect(src.calls).toEqual([]);
    expect(e1.calls).toEqual([]);                        // ★门拒跳无 916
    expect(seq).toEqual([]);
  });

  it('1b 对照组：非 DTD 靶主伤+链电照常（门只拦 DTD,夹具自证）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（contact 面首掷 ×1.0）
    const src = mkEnemy(3, 600, 600, 'SRC');
    const e1 = mkEnemy(4, 700, 600, 'E1');
    const { hooks, player } = makeHooks([src, e1]);
    player.tagEffectStack.tryApplyTagToNPC(4680, src.id, 0, 0);
    contactDirect(ravenAt(player, 600, 600), hooks);
    expect(src.calls.map((c) => c.d)).toEqual([45]);     // 30 base+15 tag
    expect(e1.calls.map((c) => c.d)).toEqual([15]);      // 916 链电落其他敌
    expect(seq).toEqual(['SRC', 'E1']);
  });
});

// ================ §2（②）Arrow 通用环动态掷（critBonus 族收编） ================
describe('BJ493-§2：Arrow 主环掷率=rollVanillaHitCrit 命中拍动态（旧 ?? 死支/平率必红）', () => {
  /** 家族载体形（迁移后 spawn 形）：projId 1（木箭,ranged 旗）+ 0.04 路由门 */
  const shotAt = (critChance: number): Arrow => {
    const a = new Arrow(520, 585, 8, 0, 10, 1, 1, { grav: 0, life: 60 });
    a.critChance = critChance;
    return a;
  };

  it('2a 命中拍换 owner 聚合 → 掷率翻转（旧平率 4% 恒假必红）', () => {
    const eA = mkEnemy(5, 600, 600, 'A');
    const { hooks, player } = makeHooks([eA]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);       // 0.04 档假/0.64 档真
    step([shotAt(0.04)], 20, hooks);
    expect(eA.calls.length).toBe(1);                     // 夹具自证
    expect(eA.calls[0]!.crit).toBe(false);               // 聚合 0：0.5>0.04 假
    spy.mockReturnValue(60);                             // ★命中拍换装配（冻结病=同值仍假）
    const eB = mkEnemy(6, 600, 600, 'B');
    (hooks.enemies() as unknown as SpyEnemy[]).length = 0;
    (hooks.enemies() as unknown as SpyEnemy[]).push(eB);
    step([shotAt(0.04)], 20, hooks);
    expect(eB.calls[0]!.crit).toBe(true);                // 0.5<0.64 真——动态读现值
  });

  it('2b :25712 持械折入命中拍现值：held 键刃 671（crit16）+词缀 61（crt+5）→ 阈值抬至 0.25', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    expect(id671).toBeGreaterThanOrEqual(0);
    expect(itemCombat(671)?.crit).toBe(16);
    expect(prefixStat(61).crt).toBe(5);
    const e = mkEnemy(7, 600, 600, 'C');
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue({ id: id671, prefix: 61 } as never);
    let d2b = 0; vi.spyOn(Math, 'random').mockImplementation(() => (d2b++ === 0 ? 0.22 : 0.5));   // 首掷=crit 阈值(0.04/0.20 档假/0.25 档真);后续=★BJ716-A DV 中性档(×1.0)
    step([shotAt(0.04)], 20, hooks);
    expect(e.calls[0]!.crit).toBe(true);                 // 命中拍折入 item.crit+crt
    expect(e.calls[0]!.d).toBe(20);                      // 10×2（crit 乘区）
  });

  it('2c 裸实例零漂移：类缺省 critChance=0 走旧 ?? 路径（关断钉/RNG 消费形不变）', () => {
    const e = mkEnemy(8, 600, 600, 'D');
    const { hooks } = makeHooks([e]);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.0);
    step([shotAt(0)], 20, hooks);                        // critChance=0（未过路由门）
    expect(e.calls[0]!.crit).toBe(false);                // 0<0 假=旧形同相（零漂移）
    expect(rnd.mock.calls.length).toBeGreaterThanOrEqual(1);   // 旧路径 RNG 消费形保留
  });
});

// ================ §3（③）ranged critBonus 族 spawn 位迁移锁 ================
describe('BJ493-§3：ranged critBonus 族 13 位迁移（冻结写位零残留+0.04 路由门+661 爆面收编）', () => {
  it('3a Game.ts 13 位冻结写位=零残留+0.04 路由门在位', () => {
    const s = SRC('core/Game.ts');
    for (const gone of [
      'a.critBonus = crit;',                        // 434 续发（crit 形参随迁退役）
      'b1.critBonus = this.player.critChance',
      'b2.critBonus = b1.critBonus;',
      'a3.critBonus = critTotal;',                  // spawnFanArrow（661/4703/弓扇）
      'bb.critBonus = bubbleCrit;',                 // 异星泡泡爆裂箭
      'carrier.critBonus = critTotal;',             // 630 幻象弓载体
      'ar.critBonus = critTotal;',                  // 幻影凤凰 volley 箭
      'bowArrow.critBonus = critTotal;',            // 弓/枪主弹
      'pa.critBonus = bowArrow.critBonus;',         // 霰弹族弹丸
      'fire.critBonus = this.player.critChance',    // 燃烧瓶火云 400-402
      'smk.critBonus = this.player.critChance',     // 烟雾弹 196
      'thrownArrow.critBonus = this.player.critChance',   // 投掷族
      'beeGrenade.critBonus = this.player.critChance',    // 蜜雷锋 183
    ]) {
      expect(s).not.toContain(gone);
    }
    for (const gate of [
      'a.critChance = 0.04;',
      'b1.critChance = 0.04;',
      'b2.critChance = 0.04;',
      'a3.critChance = 0.04;',
      'bb.critChance = 0.04;',
      'carrier.critChance = 0.04;',
      'ar.critChance = 0.04;',
      'bowArrow.critChance = 0.04;',
      'pa.critChance = 0.04;',
      'fire.critChance = 0.04;',
      'smk.critChance = 0.04;',
      'thrownArrow.critChance = 0.04;',
      'beeGrenade.critChance = 0.04;',
    ]) {
      expect(s).toContain(gate);
    }
    expect(s).not.toContain('const critTotal = this.player.critChance(\'ranged\')');   // 载体值退役
    expect(s).toContain('spd434, arpen434, go434, burst434.n - 1);');   // 434 形参链更新
  });

  it('3b 661 黑爆二段爆面=rollVanillaHitCrit 收编（旧 || 面会把 0.04 门误当平率）', () => {
    const s = SRC('entities/Arrow.ts').replace(/^\s*\/\/[^\n]*/gm, '');
    // ★BJ496①③ 计数随迁：通用环+661 爆面+617/659 爆面+whipTagShot 支 = 5 处（旧 2）;
    // ★BJ497① 五遗留面收编（1023 barrel/631/514 双面/190）→ 10 处;
    // ★BJ704-G24 烟花 167-170 爆面 AoE 掷率（critFw）10→11——该计数锚曾漏改,
    //   BJ716-A 顺手清记账（源注「BJ708-G28 顺手清」未落,现补）
    expect(s.split('rollVanillaHitCrit(').length - 1).toBe(11);
    expect(s).toContain('const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);');   // 爆面
  });

  it('3c 无类旗成员零掷（196 烟雾=原版零掷;旧平率面 4% 掷必红）', () => {
    // 196 SetDefaults :2825-2831 无 melee/ranged/magic 旗 → 原版 :12915-27 零掷。
    // 迁移形：0.04 路由门 → rollVanillaHitCrit kind=null 捷径返假（不掷不耗 RNG;
    // 注：烟尾尘掷属 AI 面,RNG 计数非零,判别位=crit 布尔）。
    const e = mkEnemy(9, 600, 600, 'SMK');
    const { hooks } = makeHooks([e]);
    vi.spyOn(Math, 'random').mockReturnValue(0.02);      // 旧平率面 0.02<0.04 必暴;196 无类旗零掷→首掷即 DV
    const smk = new Arrow(520, 585, 8, 0, 10, 1, 196, { grav: 0, life: 60, pierce: 1 });
    smk.critChance = 0.04;                               // 迁移后 spawn 形
    step([smk], 20, hooks);
    expect(e.calls.length).toBe(1);                      // 夹具自证（伤害面照常）
    expect(e.calls[0]!.crit).toBe(false);                // ★主判别:零掷（旧平率面必红）
    expect(e.calls[0]!.d).toBe(8);                       // DV(10,−15 档)=8.5→ToEven 8（BJ716-A;×2 不达保持）
  });
});

// ================ §4（④）hitEnemies 注入支掷中照消费（BJ475③ 同形） ================
describe('BJ493-§4：hitEnemies F11——TimerCrit 消费独立于 critChance 掷中（:12928 无条件）', () => {
  const runHit = (hooks: GameHooks, e: SpyEnemy, critChance: number): void => {
    const carrier = {
      x: e.x - 5, y: e.y - 5, w: 10, h: 10, vx: 1,
      damage: 50, knockback: 0, projId: 153, critChance,   // 153=melee 旗（BJ489 §2 同锚）
    };
    hitEnemies(carrier as never, hooks, new HitCooldown(), 10, 1, 0);
  };

  it('4a 掷中拍（roll=true）：crit=true 且 charge 照消费置 −15（旧短路残留 1000 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);        // 0.01<0.04=掷中
    const { hooks, player } = makeHooks([]);
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = mkEnemy(10, 60 * 16, 90 * 16, 'H4A');
    (hooks.enemies() as unknown as SpyEnemy[]).push(e);
    runHit(hooks, e, 0.04);
    expect(e.calls.length).toBe(1);                        // 夹具自证
    expect(e.calls[0]!.crit).toBe(true);                   // 掷中 crit（两形态同）
    expect(player.accTimerCritCharge).toBe(-15);           // ★主判别:照消费（旧恒 1000 必红）
  });

  it('4b 掷空拍（roll=false）：TimerCrit 强制 crit+charge −15（回归锚=无条件面）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);        // 0.99>0.04=掷空
    const { hooks, player } = makeHooks([]);
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = mkEnemy(11, 60 * 16, 90 * 16, 'H4B');
    (hooks.enemies() as unknown as SpyEnemy[]).push(e);
    runHit(hooks, e, 0.04);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                   // TimerCrit 强制（回归锚）
    expect(player.accTimerCritCharge).toBe(-15);
  });

  it('4c 无饰品零行为变：掷中 crit=true/charge 不动（equipStats 门回归锚）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const { hooks, player } = makeHooks([]);
    player.accTimerCritCharge = 1000;
    const e = mkEnemy(12, 60 * 16, 90 * 16, 'H4C');
    (hooks.enemies() as unknown as SpyEnemy[]).push(e);
    runHit(hooks, e, 0.04);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                   // 掷中（与 TimerCrit 无关）
    expect(player.accTimerCritCharge).toBe(1000);          // 无 6170:零消费
  });
});
