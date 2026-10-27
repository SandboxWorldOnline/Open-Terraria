// ★BJ723-C（2026-10-26）issue #24 玩家武器伤害审计·鞭域三件 + 魔弹 DV 三件
// （S03/S04/S05/M02）判别锁 + 变异恰红。
//
// 定谳锚（Terarria1457 亲读，逐件）：
//  · S03 鞭本体 DV：Projectile.cs:12970 `int dmg = ((!ownedBySomeone) ?
//    Main.DamageVar(num15) : Main.DamageVar(num15, Main.player[owner].luck))`——
//    Damage_PVE_Inner 单函数单遍历，敌怪/城镇受害靶同链同掷；鞭 num15=num7
//    =damage 字段（projSpecificDamageMultiplier=1，:14501 起无 aiStyle165 支）
//    =dmgNow（召唤乘区出生+逐靶衰减镜像）。每受理靶独立掷 ±15%（31 档离散/
//    f32 逐级/ToEven/owner luck 重掷取极值——damageVarRoll 单源 Main.cs:67103）。
//    鞭自体 CanRunHitEffects 恒假（WhipTagEffect.cs:95-105）⇒ 无 tag 面。
//  · S04 衰减截断：:13453-13560 switch（case 841 :13503 `damage = (int)((double)
//    damage * 0.5)`——18 鞭型全 (int) 截断、全 double 字面量域、无四舍五入无
//    Math.Max 下限）;Damage_PVE :12577-12580 头门 `if (damage <= 0) return;`
//    =截断后 damage 可达 0（皮鞭 15→7→3→1→0）,0 伤鞭整 tick 零受理（无 tag/
//    无 falloff/无写梯）;同 tick 后续受害靶照走（DV(0)=0,门在 victim 循环外）。
//  · S05 词缀 tagdmg：ApplyStatsFromSource :11129 `bonusTagDamage +=
//    item.bonusTagDamage`（Item.cs:586 前缀 tagdmg,Fabled85=3）/:11140
//    EntitySource_Parent 子弹继承;消费=:12954 `num15 += (int)((num18 +
//    (float)bonusTagDamage) * SummonTagDamageMultiplier[type])`。
//  · M02 六(+1)入口 DV：251 彩虹段/632 光棱（满充 ×3 在 AI :32022-32026 写
//    damage 字段 ⇒ DV 掷 ×3 后值,非 DV(基)×3）/461 光束/16·34·79 hitStep+
//    Kill 死亡爆 AoE（Resize → Damage() 同链）/535·536 凝视束/617 星云奥秘
//    死亡爆——全部 :12970 同掷。
//  判别力（旧码必红）：§1 三档 85/100/115（旧恒 100）/luck 重掷分布;
//    §2 [15,7,3]（旧 round+floor1=[15,8,4]）+0 伤整跳;§3 town DV;
//    §4 17（旧 14）;§5 各面 want=damageVarRoll(base)≠base（旧恒平值）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { WhipProj } from '../src/entities/WhipProj';
import { MinionProj } from '../src/entities/MinionProj';
import { Arrow } from '../src/entities/Arrow';
import { RainbowSegment } from '../src/entities/RainbowProj';
import { PrismProj, PrismProng, BlasterBeam } from '../src/entities/PrismProj';
import { MagicMissileProj } from '../src/entities/MissileProj';
import { MedusaHeadProj } from '../src/entities/MedusaHeadProj';
import { resolveWhipTagHit } from '../src/entities/WhipTag';
import { damageVarRoll } from '../src/stats/DamageVar';
import type { GameHooks } from '../src/entities/types';
import { TILE } from '../src/core/constants';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');

// ---- 通用桩敌（hurt 首参记账 = DV 掷值载体;banner 无档恒等） ----
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; hp: number; maxHp: number; vanillaId: number;
  dontTakeDamage: boolean; vx: number; vy: number; realLife: number;
  hits: number[];
  hurt: (d: number, ...a: unknown[]) => boolean;
}
const mkEnemy = (id: number, cx: number, cy: number, w = 24, h = 24): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, iframes: 0, hp: 100000, maxHp: 100000, vanillaId: 15,
    dontTakeDamage: false, vx: 0, vy: 0, realLife: -1, hits: [],
    hurt(d: number) { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};

function makeHooks(o: { enemies?: MockEnemy[]; towns?: unknown[]; player?: Player } = {}) {
  const w = new World(200, 120, 7, 'bj723c');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = o.player ?? new Player(60 * 16, 90 * 16, new Inventory());
  const enemies = o.enemies ?? [];
  const towns = o.towns ?? [];
  const projectiles: unknown[] = [];
  const hooks = {
    world: w as never,
    player: player as never,
    enemies: () => enemies,
    npcs: () => towns as never,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    applyLifeSteal: () => 0,
    entities: { add: (e: unknown) => { projectiles.push(e); }, nextId: 1, projectiles } as never,
  } as unknown as GameHooks;
  return { hooks, player, enemies, towns, projectiles };
}

/** 鞭命中驱动（fx19/s3b 同式）：9 拍起手 → 靶移到 ai0=20 曲线控制点 → 1 拍命中 */
function landOneHit(w: WhipProj, hooks: GameHooks, ...enemies: MockEnemy[]): void {
  for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
  const p = w.pointsAt(20, true)[10];
  for (const e of enemies) { e.x = p.x - 12; e.y = p.y - 12; e.cx = p.x; e.cy = p.y; }
  w.fixedUpdate(1, hooks);
}
const mkWhip = (player: Player, dmg: number, projId = 841, itemId = 4672): WhipProj =>
  new WhipProj(player.cx, player.cy, 0, projId, itemId, dmg, 4, 30, 4, () => player);

afterEach(() => { vi.restoreAllMocks(); });

// ================= §1 S03：鞭本体 DV（敌怪环 :12970） =================
describe('BJ723C-§1 S03 鞭本体 DV（每受理靶 ±15%,31 档离散）', () => {
  it('1a 三档定值：base 100 → 85 / 100 / 115（mock -15%/0%/+15% 档;旧恒 100 必红）', () => {
    const tiers: Array<[number, number]> = [[0.0, 85], [0.5, 100], [0.9999, 115]];
    for (const [rnd, want] of tiers) {
      vi.spyOn(Math, 'random').mockReturnValue(rnd);
      const e = mkEnemy(11, 0, 0);
      const { hooks, player } = makeHooks({ enemies: [e] });
      const w = mkWhip(player, 100);
      landOneHit(w, hooks, e);
      expect(e.hits.length, `rnd=${rnd}`).toBe(1);
      expect(e.hits[0], `rnd=${rnd}`).toBe(want);   // 输入 100 旧恒 100
    }
  });

  it('1b luck 重掷取极值：luck=1（灯笼0.3+地精0.2+瓢虫0.2+币运0.3）50 连击最大值必 >100（旧 luck 无效必红）', () => {
    const { hooks, player } = makeHooks();
    const ls = (player as unknown as {
      luckState: { lanternsUp: boolean; hasGardenGnomeNearby: boolean;
        ladyBugLuckTimeLeft: number; coinLuck: number };
    }).luckState;
    ls.lanternsUp = true;                 // :29376-29379 +0.3
    ls.hasGardenGnomeNearby = true;       // :29380-29383 +0.2
    ls.ladyBugLuckTimeLeft = 43200;       // ladyBugLuck=1 → :29369 +0.2
    ls.coinLuck = 250000;                 // coinLuckValue=0.2（:18233 档）→ luck≈0.9
    expect(player.luck).toBeGreaterThan(0.85);   // 重掷概率 ≈90%
    let max = 0;
    for (let i = 0; i < 50; i++) {
      const e = mkEnemy(20 + i, 0, 0);
      const g = { ...hooks, enemies: () => [e] } as GameHooks;   // 逐击独立敌桶
      const w = mkWhip(player, 100);
      landOneHit(w, g, e);
      expect(e.hits.length).toBe(1);
      expect(e.hits[0]).toBeGreaterThanOrEqual(85);
      expect(e.hits[0]).toBeLessThanOrEqual(115);
      max = Math.max(max, e.hits[0]);
    }
    expect(max).toBeGreaterThan(100);   // luck=1 每击 max(两掷);50 击全 ≤100 概率 ~1e-28
  });

  it('1c 城镇靶同掷（Damage_PVE_Inner 单遍历同链）：voodoo 向导 base 15 → mock0.5=15/0.9=17', () => {
    for (const [rnd, want] of [[0.5, 15], [0.9, 17]] as const) {
      vi.spyOn(Math, 'random').mockReturnValue(rnd);
      const town = { ...mkEnemy(31, 0, 0, 18, 18), vanillaId: 22, bound: false };
      town.hurt = (d: number) => { town.hits.push(d); return true; };
      const { hooks, player } = makeHooks({ towns: [town] });
      Object.defineProperty(player, 'equipStats', {
        value: Object.freeze({ ...player.equipStats, killGuide: true }), configurable: true,
      });
      const w = mkWhip(player, 15);
      landOneHit(w, hooks, town as never as MockEnemy);
      expect(town.hits.length, `rnd=${rnd}`).toBe(1);
      expect(town.hits[0], `rnd=${rnd}`).toBe(want);   // 旧恒 15
    }
  });
});

// ================= §2 S04：衰减 (int) 截断 + 0 伤整跳 =================
describe('BJ723C-§2 S04 衰减截断（:13503 case 841 (int)(damage×0.5),无 floor1）', () => {
  it('2a 皮鞭 15 打三目标 15→7→3（mock0.5 DV 恒等档;旧 round+floor1=[15,8,4] 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const a = mkEnemy(41, 0, 0), b = mkEnemy(42, 0, 0), c = mkEnemy(43, 0, 0);
    const { hooks, player } = makeHooks({ enemies: [a, b, c] });
    const w = mkWhip(player, 15);
    landOneHit(w, hooks, a, b, c);
    expect([a.hits, b.hits, c.hits]).toEqual([[15], [7], [3]]);
    expect((w as unknown as { dmgNow: number }).dmgNow).toBe(1);   // 3×0.5 截断=1（再衰减态）
  });

  it('2b 截断到 0：base 1 同拍双靶 [1,0]（第 2 靶 DV(0)=0,门在 victim 循环外）;次拍整跳', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const a = mkEnemy(51, 0, 0), b = mkEnemy(52, 0, 0), d = mkEnemy(53, 0, 0);
    const { hooks, player } = makeHooks({ enemies: [a, b, d] });
    const w = mkWhip(player, 1);
    landOneHit(w, hooks, a, b);   // d 先移开（同拍不进 a/b 位）
    d.x = -9999; d.cx = -9999;
    expect(a.hits).toEqual([1]);
    expect(b.hits).toEqual([0]);                       // dmgNow=trunc(1×0.5)=0 后同拍照走
    expect((w as unknown as { dmgNow: number }).dmgNow).toBe(0);
    // 次拍（回摆扫过同域）:Damage_PVE 头门 damage<=0 整退 → 新靶零受理
    const p2 = w.pointsAt(22, true)[10];
    d.x = p2.x - 12; d.y = p2.y - 12; d.cx = p2.x; d.cy = p2.y;
    for (let i = 0; i < 70 && !w.dead; i++) w.fixedUpdate(1, hooks);
    expect(d.hits.length).toBe(0);                     // 旧 floor1 恒 1 伤连击必红
  });
});

// ================= §3 S05：召唤杖词缀 tagdmg 透传 =================
describe('BJ723C-§3 S05 词缀 tagdmg（:11129 出生继承 → :12954 tag 项并入）', () => {
  /** 皮鞭 4672 标记（TagDamage=4）挂到敌 */
  const tagLeather = (player: Player, e: { id: number }) =>
    player.tagEffectStack.tryApplyTagToNPC(4672, e.id, 0, 0);

  it('3a 单元：Fabled tagdmg3 + 皮鞭标 4 + 基伤 10 → resolveWhipTagHit=17（旧缺传=14）', () => {
    const { hooks, player } = makeHooks();
    const e = mkEnemy(61, 80 * TILE, 80 * TILE);
    tagLeather(player, e);
    const res = resolveWhipTagHit(e as never, 10, hooks, () => {}, 1,
      e.cx, e.cy, player, 3);
    expect(res.dmg).toBe(17);                          // 10+trunc((4+3)×1)
    const res0 = resolveWhipTagHit(e as never, 10, hooks, () => {}, 1,
      e.cx, e.cy, player, 0);
    expect(res0.dmg).toBe(14);                         // 无词缀回归锚
  });

  it('3b 集成：MinionProj（乌鸦 317 接触面）bonusTagDmg=3 → 被标敌 hurt=17（旧 14）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // DV 恒等档:17 原值直读
    const e = mkEnemy(62, 60 * TILE, 60 * TILE);
    const { hooks, player } = makeHooks({ enemies: [e] });
    tagLeather(player, e);
    const m = new MinionProj(e.cx - 8, e.cy - 8, 317, 10, 1.5, false, 0, false, () => player);
    m.bonusTagDmg = 3;
    (m as unknown as { contact: (g: GameHooks, d: number, cd?: number) => boolean })
      .contact(hooks, 10, 5);
    expect(e.hits.length).toBe(1);
    expect(e.hits[0]).toBe(17);                        // 旧 bonusTagDamage 默认 0 = 14
  });

  it('3c 集成：whipTagShot 箭（389 MinionShot 载体）bonusTagDmg=3 → 17（旧 14）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const e = mkEnemy(63, 60 * TILE, 60 * TILE);
    const { hooks, player } = makeHooks({ enemies: [e] });
    tagLeather(player, e);
    const a = new Arrow(e.cx - 4, e.cy - 4, 0, 0, 10, 1.5, 389, { grav: 0, life: 60 });
    a.whipTagShot = true;
    a.bonusTagDmg = 3;
    a.fixedUpdate(1, hooks);
    expect(e.hits.length).toBe(1);
    expect(e.hits[0]).toBe(17);
  });

  it('3d 结构锁：出生注入 + 15 面 resolveWhipTagHit 透传 + 子体继承（防静默回退）', () => {
    expect(SRC('core/Game.ts')).toContain('m.bonusTagDmg = ps?.tagdmg ?? 0;');
    expect(SRC('core/Game.ts')).toContain('bird.bonusTagDmg = inst4281?.prefix ? prefixStat(inst4281.prefix).tagdmg : 0;');
    const minion = SRC('entities/MinionProj.ts');
    expect(minion.split('this.bonusTagDmg').length - 1).toBeGreaterThanOrEqual(15);
    expect(minion).toContain('this.hostRef()?.bonusTagDmg ?? 0, this.projId)');
    expect(minion).toContain('a.bonusTagDmg = b.bonusTagDmg = this.bonusTagDmg;');
    expect(SRC('entities/Arrow.ts')).toContain('undefined, this.bonusTagDmg);');
  });
});

// ================= §4 M02：专用魔弹 DV 六(+1)入口 =================
describe('BJ723C-§4 M02 专用魔弹 DV（:12970,与 BJ716-A Arrow 主环同式）', () => {
  /** 通用判别：mock0.9（+12% 档）→ hurt 值 = damageVarRoll(base) ≠ base（旧恒平值必红） */
  it('4a 251 彩虹段（RainbowProj）：base 100 → 112', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const e = mkEnemy(71, 60 * TILE, 60 * TILE);
    const { hooks } = makeHooks({ enemies: [e] });
    const seg = new RainbowSegment(e.cx, e.cy, 1, 0, 100, 2);
    seg.fixedUpdate(1 / 60, hooks);
    expect(e.hits.length).toBe(1);
    expect(e.hits[0]).toBe(112);
  });

  it('4b 632 光棱（PrismProng）：charge<180 base 100 → 112;满充 ×3 折入 DV 基（base 25 → 64,非 63/75）', () => {
    // 朝上束（0,-1）：makeHooks 铺地 100-119 行,向下束 2 格即截;向上束
    // scanLen ~1568 → 敌 +60px 沿束可达（bj489 3d 空世界夹具的等价换向）
    const parent = new PrismProj(0, -1, 25, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    parent.x = 80 * TILE; parent.y = 98 * TILE;
    parent.charge = 60;
    const prong = new PrismProng(0, 100, 2);
    prong.parent = parent;
    parent.prongs.push(prong);
    prong.fixedUpdate(1 / 60, makeHooks().hooks);      // 首拍定锚/束向
    const bx = prong.cx + prong.vx * 60, by = prong.cy + prong.vy * 60;   // bj489 3d 同式
    const e1 = mkEnemy(72, bx, by, 48, 48);
    const g1 = makeHooks({ enemies: [e1] });
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    prong.fixedUpdate(1 / 60, g1.hooks);
    expect(e1.hits.length).toBe(1);
    expect(e1.hits[0]).toBe(112);                      // 100×1.12

    const parent2 = new PrismProj(0, -1, 25, 2, () => true, () => ({ x: 0, y: 0 }), () => true);
    parent2.x = 80 * TILE; parent2.y = 98 * TILE;
    parent2.charge = 200;                              // 满充
    const prong2 = new PrismProng(0, 25, 2);
    prong2.parent = parent2;
    parent2.prongs.push(prong2);
    prong2.fixedUpdate(1 / 60, makeHooks().hooks);
    const bx2 = prong2.cx + prong2.vx * 60, by2 = prong2.cy + prong2.vy * 60;
    const e2 = mkEnemy(73, bx2, by2, 48, 48);
    const g2 = makeHooks({ enemies: [e2] });
    vi.spyOn(Math, 'random').mockReturnValue(0.0);     // -15% 档
    prong2.fixedUpdate(1 / 60, g2.hooks);
    expect(e2.hits.length).toBe(1);
    // 折入式 DV(25×3)=64;外乘式 DV(25)×3=63;无 DV=75 —— 三态判别
    expect(e2.hits[0]).toBe(64);
  });

  it('4c 461 光束（BlasterBeam,充能爆破炮）：base 100 → 112', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const e = mkEnemy(74, 60 * TILE + 200, 60 * TILE);
    const { hooks } = makeHooks({ enemies: [e] });
    const b = new BlasterBeam(100, 2);
    // 锚定束：Center=父心+向×16,束长 LaserScan（proj-wet-six :742 同式 fake 父）
    b.parent = { dead: false, cx: 60 * TILE, cy: 60 * TILE, dirX: 1, dirY: 0 } as never;
    b.fixedUpdate(1 / 60, hooks);
    expect(e.hits.length).toBe(1);
    expect(e.hits[0]).toBe(112);
  });

  it('4d 16 魔法飞弹（hitStep + Kill 死亡爆 AoE 双面）：base 100 → [112,112]', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const e = mkEnemy(75, 70 * TILE, 40 * TILE, 40, 40);
    const { hooks } = makeHooks({ enemies: [e] });
    const m = new MagicMissileProj(60 * TILE, 40 * TILE, 6, 0, {
      projId: 16, damage: 100, knockback: 7.5, useTime: 22,
      channelCb: () => true, aimCb: () => ({ x: 70 * TILE, y: 40 * TILE }),
      payMana: () => true,
    });
    for (let i = 0; i < 80 && e.hits.length < 2 && !m.dead; i++) m.fixedUpdate(1 / 60, hooks);
    expect(e.hits).toEqual([112, 112]);   // 接触面 + Kill Resize 死亡爆 AoE 同掷（旧恒 [100,100]）
    m.destroy();
  });

  it('4e 535/536 美杜莎凝视束（volley 即时结算,逐目标独立掷）：base 130 → oracle', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    // makeHooks 玩家固定位 (60*TILE, 90*TILE)——敌置 +17px（320px 索敌域内,bj382 同距）
    const e = mkEnemy(76, 60 * TILE + 17, 90 * TILE);
    const { hooks, player } = makeHooks({ enemies: [e] });
    player.useTime = 10;
    player.mana = 200;
    const want = damageVarRoll(130, 0);
    expect(want).not.toBe(130);                        // +12% 档自证非恒等
    const m = new MedusaHeadProj(player, 130, 2, 0, 0);   // critChance=0 关断钉
    m.fixedUpdate(1 / 60, hooks);
    expect(e.hits.length).toBe(1);
    expect(e.hits[0]).toBe(want);
    (m as unknown as { retire(): void }).retire();
  });

  it('4f 617 星云奥秘死亡爆（arcanumDeathBurst）：base 70 → oracle ≠ 70', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const e = mkEnemy(77, 0, 0);
    const { hooks, enemies } = makeHooks({ enemies: [] });
    const a = new Arrow(800, 1500, 2, 0, 70, 5, 617, { grav: 0, life: 20, pierce: 3 });
    for (let i = 0; i < 19 && !a.dead; i++) a.fixedUpdate(1, hooks);
    expect(a.dead).toBe(false);                        // 尚未死 → 死亡拍待置敌
    e.x = a.cx - 12; e.y = a.cy - 12; e.cx = a.cx; e.cy = a.cy;
    enemies.push(e);                                   // 死亡拍注入靶（避飞行段接触/追踪面）
    const want = damageVarRoll(70, 0);
    expect(want).not.toBe(70);
    a.fixedUpdate(1, hooks);                           // life 尽 → killNow → 爆
    expect(a.dead).toBe(true);
    expect(e.hits.length).toBe(1);
    expect(e.hits[0]).toBe(want);
  });

  it('4g 结构锁：六(+1)入口掷位 + 鞭 DV/截断/0 伤门（防静默回退）', () => {
    const whip = SRC('entities/WhipProj.ts');
    expect(whip.split('damageVarRoll(this.dmgNow').length - 1).toBe(2);   // 敌怪环+城镇 settle
    expect(whip.split('Math.trunc(this.dmgNow * (WHIP_FALLOFF[this.projId] ?? 1));').length - 1).toBe(2);
    expect(whip).toContain('if (this.dmgNow <= 0) return;');
    expect(whip).not.toContain('Math.max(1, Math.round(this.dmgNow');
    expect(SRC('entities/RainbowProj.ts')).toContain('damageVarRoll(this.damage');
    const prism = SRC('entities/PrismProj.ts');
    expect(prism.split('damageVarRoll(').length - 1).toBe(3);             // 632 光棱+461 光束两掷位; ★BJ729-A 改判史注（2026-10-27）：D1 B21 城镇臂接线 +1 掷位（461 光束巫毒靶 settle 镜像敌臂 DV）——两掷位扩为三,锁语义=面存在性非清单冻结（BJ725-A 判例 3）
    expect(prism).toContain('damageVarRoll(charge >= 180 ? this.damage * 3 : this.damage');
    expect(prism).not.toContain('if (charge >= 180) dmg *= 3;');
    const missile = SRC('entities/MissileProj.ts');
    expect(missile.split('damageVarRoll(this.damage').length - 1).toBe(5)   // ★BJ725-A 改判史注：BJ723-C D1 清偿后 +2 面（FlyingKnife 491 hitStep/StarfuryStar 9 hitStep）——M02 六(+1)入口扩为八(+1); ★BJ727-A 改判史注（2026-10-27）：C-D4 族刀 KILL_BURST 城镇臂接线 +1 掷位（killNow 79/16/34 城镇 victim 同链同掷）——八(+1)扩为九(+1),锁语义=面存在性非清单冻结（BJ725-A 判例 3）; // hitStep+Kill 爆+Kill 爆城镇臂
    expect(SRC('entities/MedusaHeadProj.ts')).toContain('damageVarRoll(this.damage');
    const arrow = SRC('entities/Arrow.ts');
    expect(arrow).toContain('const dmgB617 = damageVarRoll(this.damage');
  });
});
