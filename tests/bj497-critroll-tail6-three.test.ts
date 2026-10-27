// ★BJ497（2026-10-04）掷率收编尾五（BJ496 新登记三件,战役真正收官批）判别测试。
//  定谳锚（Terarria1457 亲读,行号=落刀日盘上;五弹数据面 ranged 全亲读——190 SetDefaults
//  :2781-2791 ranged@:2789 / 514 :5843-5852 ranged@:5850 / 631 :6781-6796 ranged@:6788 /
//  1023 :9683-9694 ranged@:9690 / 443 :5139-5150 ranged@:5146）：
//   · ①Arrow.ts 五遗留 `||` 面收编（BJ493② 主环条件改形先例）：旧面
//     `Math.random() < (this.critChance || (4 + this.critBonus) / 100)` 把 spawn 位
//     0.04 路由门误当 4% 平率消费+丢 owner 聚合/:25712 持械折入。spawn 侧逐位亲读：
//     190 首发 Game.ts :20760（BJ489 0.04 门）/190 补射 :29359（旧冻结式,本刀退役）/
//     514 通用 ranged :17556（BJ493③ 0.04 门,弹药 3108 shoot=514 → resolveAmmoProjId
//     尾链）/631 spawnPhantasmChase :4493 继承父弹 critChance（父代全族 BJ493③ 0.04 门）/
//     1023 无出生面=休眠（销案锚,见 1d）。514 双读者（首击 :9309 位+刺入 DoT :7337 位）
//     同 rollVanillaHitCrit 单源（DoT=Damage() 整段重入,每 tick 独立掷=原版同构）。
//   · ②ElectroSphereProj 443：critBonus 孤儿字段（全库无写者=恒 0）→ 旧面恒 4% 平率,
//     owner 聚合整缺——收编 rollVanillaHitCrit+critChance=0.04 路由门（BeamBoltProj
//     BJ489 同形）。MagnetSphereProj：BJ489 磁球本体已迁（掷率=255 弹读者动态）,传播链
//     三层死值（254 字段无 spawn 写位/:400 传播写/255 字段无读者）→ 摘死值,
//     critChance 透传保留（magnet-sphere.test :228 契约）。
//   · ③MedusaHeadProj ctor critBonus 死形参摘除（BJ496① 登记,BJ494⑥ 钉死面）——
//     形参/字段/`void critBonus` 三层全摘+Arrow.ts 535 转换站实参同步（本刀清形参层）。
//  判别力（旧码必红项）：§1a 190 动态翻转（旧平率 4% 恒假必红）/§1b 631 动态翻转/
//    §1c 514 双面动态翻转（首击+DoT 同流）/§1d 1023 动态翻转+休眠销案锚三件套/
//    §1e 五面零残留+补射位路由门结构锁/§2a 443 动态翻转（旧孤儿平率恒假必红）/
//    §2b 死链三层摘除+透传保留结构锁/§3 ctor 形参摘除结构锁+volley 关断钉回归锚。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Arrow } from '../src/entities/Arrow';
import { ElectroSphereProj, ELECTROSPHERE_PROJ } from '../src/entities/ElectroSphereProj';
import { MedusaHeadProj } from '../src/entities/MedusaHeadProj';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');
const strip = (s: string) => s.replace(/^\s*\/\/[^\n]*/gm, '');
/** 结构锁用：块注释一并剥离（not.toContain 断言防文档词误伤,BJ497 新增） */
const stripAll = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

// ---- 真环境夹具（bj496 同款：真 World+真 Player+spy 敌桶） ----
const W = 200, H = 120;

interface SpyEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; maxHp: number; hp: number;
  vanillaId: number; dontTakeDamage: boolean;
  calls: Array<{ d: number; crit: boolean; pierce: number }>;
  hurt(d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean): boolean;
}
function mkEnemy(id: number, cx: number, cy: number, w = 38, h = 38): SpyEnemy {
  const e: SpyEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, iframes: 0, maxHp: 500000, hp: 10000,
    vanillaId: 0, dontTakeDamage: false, calls: [],
    hurt(d, _kx, _ky, _g, _pen = 0, crit = false, pierce = 0) {
      e.calls.push({ d, crit, pierce });
      return true;
    },
  };
  return e;
}
function makeHooks(enemies: SpyEnemy[] = [], px = 60 * 16, py = 90 * 16):
  { hooks: GameHooks; player: Player } {
  const world = new World(W, H, 7, 'bj497-critroll-tail6-three');
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) world.store.setTile(x, y, 1);
  world.groundLevel = 100;
  const player = new Player(px, py, new Inventory());
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
/** 敌盒 38×38 @ (600,600) → 盒 [581,619)²;地面 y=1600 全程空中 */
const E_CX = 600, E_CY = 600;

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// ================ §1（①）Arrow 五遗留面动态掷 ================
describe('BJ497-§1：五遗留 || 面收编 rollVanillaHitCrit（旧平率 4% 恒假必红）', () => {
  it('1a 190 食人鱼 chew 环动态翻转（BJ489 路由化漏迁的现役退化修复）', () => {
    const eA = mkEnemy(1, E_CX, E_CY);
    const { hooks, player } = makeHooks([eA]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);       // 0.04 档假/0.64 档真
    const mk = (): Arrow => new Arrow(565, 585, 2, 0, 10, 1, 190,
      { grav: 0, life: 3600, piranha: { channel: () => true, aim: () => ({ x: 700, y: 600 }) } });
    const a = mk();
    a.critChance = 0.04;                                 // 迁移后 spawn 形（0.04 路由门）
    step([a], 20, hooks);
    expect(eA.calls.length).toBeGreaterThanOrEqual(1);   // 夹具自证
    expect(eA.calls[0]!.crit).toBe(false);               // 聚合 0：0.5>0.04 假
    spy.mockReturnValue(60);                             // ★命中拍换装配（旧平率面同值仍假=必红）
    const eB = mkEnemy(2, E_CX, E_CY);
    const b = mk();
    b.critChance = 0.04;
    (hooks.enemies() as unknown as SpyEnemy[]).length = 0;
    (hooks.enemies() as unknown as SpyEnemy[]).push(eB);
    step([b], 20, hooks);
    expect(eB.calls[0]!.crit).toBe(true);                // ★动态翻转
    expect(eB.calls[0]!.d).toBe(10);                     // ★S02(BJ723-B)改判:×2=Enemy.hurt 防后(旧 20=预倍形)
  });

  it('1b 631 幻象矢补刀环动态翻转（父弹 0.04 路由门旧被误读 4% 平率）', () => {
    const eA = mkEnemy(3, E_CX, E_CY);
    const { hooks, player } = makeHooks([eA]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mk = (id: number): Arrow => {
      const a = new Arrow(590, 590, 0, 0, 10, 1, 631, { grav: 0, life: 1200 });
      a.ph631Tgt = id;                                   // AI_122 补刀环直锁目标
      a.ph631Delay = 0;
      a.critChance = 0.04;
      return a;
    };
    step([mk(eA.id)], 3, hooks);
    expect(eA.calls.length).toBe(1);                     // 夹具自证（盒交叠 Kill+直伤）
    expect(eA.calls[0]!.crit).toBe(false);               // 聚合 0：假
    spy.mockReturnValue(60);
    const eB = mkEnemy(4, E_CX, E_CY);
    (hooks.enemies() as unknown as SpyEnemy[]).length = 0;
    (hooks.enemies() as unknown as SpyEnemy[]).push(eB);
    step([mk(eB.id)], 3, hooks);
    expect(eB.calls[0]!.crit).toBe(true);                // ★动态翻转
    expect(eB.calls[0]!.d).toBe(10);   // ★S02 改判:未翻倍基伤
  });

  it('1c 514 钉双读者单源：首击面+刺入 DoT 面同流动态翻转', () => {
    // 首击（in-flight 重叠 → 刺入）tick1;DoT（nailDotT>=2 隔拍再刺）tick3——
    // 同一弹两读者,均 rollVanillaHitCrit（旧 `||` 面两站同病平率）。
    const eA = mkEnemy(5, E_CX, E_CY);
    const { hooks, player } = makeHooks([eA]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const mk = (): Arrow => {
      const a = new Arrow(590, 590, 0, 0, 10, 1, 514, { grav: 0, life: 600 });
      a.critChance = 0.04;
      return a;
    };
    const a = mk();
    step([a], 3, hooks);
    expect(eA.calls.length).toBe(2);                     // 首击(t1) + DoT(t3,nailDotT 隔拍)（夹具自证）
    expect(eA.calls[0]!.d).toBe(10);                     // 首击全额（聚合 0 不暴击）
    expect(eA.calls[1]!.d).toBe(1);                      // DoT dmg×0.15 截断=1
    spy.mockReturnValue(60);
    const eB = mkEnemy(6, E_CX, E_CY);
    (hooks.enemies() as unknown as SpyEnemy[]).length = 0;
    (hooks.enemies() as unknown as SpyEnemy[]).push(eB);
    step([mk()], 3, hooks);
    expect(eB.calls.length).toBe(2);
    expect(eB.calls[0]!.crit).toBe(true);                // ★首击面动态翻转（旧平率恒假必红）
    expect(eB.calls[0]!.d).toBe(10);                     // ★S02 改判:未翻倍基伤
    expect(eB.calls[1]!.crit).toBe(true);                // ★DoT 面动态翻转（同源单掷面）
    expect(eB.calls[1]!.d).toBe(1);                      // ★S02 改判:DoT 基伤 1 未翻倍直传(旧 2=预倍形)
  });

  it('1d 1023 死亡细胞桶 Kill 爆面动态翻转+休眠销案锚三件套', () => {
    // 掷面判别：barrel1023Burst 盒结算直驱（私有面 cast 调用,BJ496 1c 先例）
    const eA = mkEnemy(7, E_CX, E_CY);
    const { hooks, player } = makeHooks([eA]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const burst = (a: Arrow): void =>
      (a as unknown as { barrel1023Burst: (g: GameHooks) => void }).barrel1023Burst(hooks);
    const mk = (): Arrow => {
      const a = new Arrow(E_CX - 9, E_CY - 9, 0, 0, 10, 1, 1023, { grav: 0 });
      a.critChance = 0.04;
      return a;
    };
    burst(mk());
    expect(eA.calls.length).toBe(1);                     // 夹具自证（192 盒内结算）
    expect(eA.calls[0]!.crit).toBe(false);
    spy.mockReturnValue(60);
    const eB = mkEnemy(8, E_CX, E_CY);
    (hooks.enemies() as unknown as SpyEnemy[]).length = 0;
    (hooks.enemies() as unknown as SpyEnemy[]).push(eB);
    burst(mk());
    expect(eB.calls[0]!.crit).toBe(true);                // ★动态翻转
    expect(eB.calls[0]!.d).toBe(10);   // ★S02 改判:未翻倍基伤
    // ★销案锚（BJ496①「1023 无出生面=休眠」定谳三件套,防休眠面无意识复活）：
    //   a.数据面在库（发射器 5460 → shoot 1023）;b.items.ts 未注册 vi_5460=不可获得;
    //   c.legacyItemIndex 5460 → vi_4286_Cherry（导入链不复活发射器）。
    const itemfunc = JSON.parse(
      readFileSync(join(HERE, '..', 'src', 'data', 'vanilla-itemfunc.json'), 'utf8')) as Record<string, { shoot?: number }>;
    expect(itemfunc['5460']?.shoot).toBe(1023);
    expect(SRC('data/items.ts')).not.toContain('vi_5460');
    const legacy = JSON.parse(
      readFileSync(join(HERE, '..', 'src', 'data', 'legacyItemIndex.generated.json'), 'utf8')) as Record<string, string>;
    expect(legacy['5460']).toBe('vi_4286_Cherry');
  });

  it('1e 结构锁：五面零残留+631/514 双面单源在位+补射位冻结式退役', () => {
    const arrow = strip(SRC('entities/Arrow.ts'));
    // 旧 `||` 面全数退役（BJ496 计数锁 5→0 换防,同文件 1e 已改）
    expect(arrow.split('Math.random() < (this.critChance || (4 + this.critBonus) / 100)').length - 1).toBe(0);
    expect(arrow.split('const crit631 = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);').length - 1).toBe(1);
    expect(arrow.split('const critN = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);').length - 1).toBe(2);
    expect(arrow).toContain('const crit = this.critChance > 0 && rollVanillaHitCrit(this.projId, game);');
    // 190 补射位（Game.ts tickPiranhaChannelRefire）冻结载体退役→0.04 路由门（与首发同形）
    const game = strip(SRC('core/Game.ts'));
    expect(game).not.toContain('pg.critChance = 0.04 + (cw.crit ?? 0)');
    expect(game.split('pg.critChance = 0.04;').length - 1).toBe(2);
  });
});

// ================ §2（②）ElectroSphere 443+磁球传播链死值 ================
describe('BJ497-§2：443 孤儿平率收编+磁球传播链死值摘除', () => {
  it('2a 443 电球命中环动态翻转（critBonus 无写者=旧面恒 4% 平率,owner 聚合整缺）', () => {
    const eA = mkEnemy(9, E_CX, E_CY);
    const { hooks, player } = makeHooks([eA]);
    const spy = vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const s = new ElectroSphereProj(E_CX, E_CY, 10);     // 类缺省 critChance=0.04 路由门
    step([s], 3, hooks);
    expect(eA.calls.length).toBe(1);                     // 夹具自证（iframes=8 后不再结算）
    expect(eA.calls[0]!.crit).toBe(false);               // 聚合 0：假
    spy.mockReturnValue(60);
    const eB = mkEnemy(10, E_CX, E_CY);
    (hooks.enemies() as unknown as SpyEnemy[]).length = 0;
    (hooks.enemies() as unknown as SpyEnemy[]).push(eB);
    const s2 = new ElectroSphereProj(E_CX, E_CY, 10);
    step([s2], 3, hooks);
    expect(eB.calls[0]!.crit).toBe(true);                // ★动态翻转（旧孤儿平率恒假必红）
    expect(eB.calls[0]!.d).toBe(10);                     // ★S02 改判:未翻倍基伤（★BJ497② 翻倍归位:旧染色零翻倍）
    expect(eB.calls[0]!.pierce).toBe(2);                 // hitPierce=2 透传（frostEligible 弹语义）
  });

  it('2b 结构锁：443 字段换形+磁球 critBonus 链三层全摘+critChance 透传保留', () => {
    const electro = stripAll(SRC('entities/ElectroSphereProj.ts'));
    expect(electro).not.toContain('critBonus');          // 孤儿字段摘除（块注释一并剥离）
    expect(electro).toContain('critChance = 0.04;');     // BeamBoltProj BJ489 同形路由门
    expect(electro).toContain('rollVanillaHitCrit(ELECTROSPHERE_PROJ, game)');
    const magnet = stripAll(SRC('entities/MagnetSphereProj.ts'));
    expect(magnet).not.toContain('critBonus');           // 254 字段+:400 传播写位全摘
    expect(magnet).toContain('bolt.critChance = this.critChance;');   // 透传保留（magnet-sphere.test :228 契约）
  });
});

// ================ §3（③）MedusaHead ctor 死形参摘除 ================
describe('BJ497-§3：MedusaHeadProj ctor critBonus 形参层清偿', () => {
  it('3a 结构锁：ctor 5 参形+535 转换站实参同步+void critBonus 摘除', () => {
    const medusa = stripAll(SRC('entities/MedusaHeadProj.ts'));
    expect(medusa).not.toContain('critBonus');                     // 形参/字段/void 三层零残留
    expect(medusa).toContain('critChance: number, armorPen: number)');
    const arrow = stripAll(SRC('entities/Arrow.ts'));
    expect(arrow).not.toContain('this.critChance, this.critBonus, this.armorPen);');
    expect(arrow).toContain('this.critChance, this.armorPen);');   // 535 转换站调用形
  });

  it('3b volley 关断钉回归锚：5 参构造 critChance=0 → 确定性不暴击（掷面=rollVanillaHitCrit 单源不变）', () => {
    const e = mkEnemy(11, E_CX, E_CY);
    const { hooks, player } = makeHooks([e], 560, 560);   // 头位近敌（<320,LOS 空中直线）
    vi.spyOn(Math, 'random').mockReturnValue(0.01);      // 旧 4% 平率面此值必暴击
    player.useTime = 10;                                 // channel 电平（松手即断的持按面）
    player.mana = 200;
    const m = new MedusaHeadProj(player, 130, 2, 0, 0);  // ★5 参形（BJ497③ 摘形参后）
    m.fixedUpdate(1 / 60, hooks);
    expect(e.calls.length).toBe(1);                      // volley 即时落账
    expect(e.calls[0]!.d).toBe(110);                     // ★S02 改判:critChance=0 关断钉 → 基伤原额(旧 130=预倍形)
    expect(e.calls[0]!.crit).toBe(false);
  });
});
