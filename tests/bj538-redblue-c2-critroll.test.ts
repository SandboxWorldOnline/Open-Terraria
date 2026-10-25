// ★BJ-C2（2026-10-06）红蓝 R2 掷率批 findings 清偿刀 C2——13 件判别测试。
//  定谳锚（Terarria1457 反编译亲读,行号=落刀日盘上）：
//   · 掷面总锚：Projectile.Damage() :12915-12927 `if (ownedBySomeone)` 门内三连掷
//     melee/ranged/magic 臂（读 owner.meleeCrit/rangedCrit/magicCrit——Player.cs:2413/
//     2417/:18458 字段初值基 4）+ :25712-25714 每帧无条件三系折入
//     `meleeCrit/magicCrit/rangedCrit += inventory[selectedItem].crit`（词缀 crt
//     重铸期已折进字段,Item.cs:585）⇒ 一切玩家弹掷面 = 基 4+owner 聚合+持械折入,
//     与 rollVanillaHitCrit（proj1457 单源）同算式（BJ486③ 同源定谳）。
//   · F1 发射器火箭/榴弹（30/134/397/517/588/681 数据面 ranged,vanilla-projectiles.json
//     亲读）→ :12920 ranged 臂掷≥基 4%;旧 spawn 位冻结值 `crit('ranged')+bowC?.crit
//     ?? 0` 可算 0 → GrenadeProj/Arrow 消费位 `critChance>0` 路由门闭=永不暴击。
//   · F2 爆炸掷（:12920 同臂,explodeCritRoll 逐 victim）旧 rangedCritPct() 只回
//     critChance('ranged')（缺基 4 缺折入）→ 与接触掷口径分裂,裸装玩家爆炸 0% 暴击。
//   · F3 星怒 503 melee 面/F4 圣箭坠星 92 ranged 面/F5 水晶碎块 90 ranged 面——
//     Arrow 类缺省 critChance=0=门闭 → 永不暴击;修=spawn 位 0.04 路由门。
//   · F6 集束裂片 779/783/862/863 ranged 面——旧 ClusterFragmentProj `||0.04` 平率
//     直读（丢聚合/折入,0.04 兜底掩盖门闭）→ 迁 rollVanillaHitCrit。
//   · F7 村正：原版 NewProjectile 生成【977】（Player.cs:44904,弹 155=物品 id 非
//     弹 id;旧注「弹 155 无类旗」定谳错）,977 SetDefaults melee=true（aiStyle152
//     面）→ :12916 melee 臂掷;产生位补 critChanceFn（含折入）+消费位消白抽。
//   · F9 星光斗篷星弹 726→725→724→723→1133：SetDefaults 无任何类别旗 → 原版
//     零掷——弹型改 star.projType（旧硬钉 503=错弹型）,★勿补掷门（补了造二次偏离）。
//   · F10 挥击两掷面（城镇 NPC/敌怪）——折入改 heldItemCritBonus 单源（补词缀 crt
//     半边,旧 itemCombat(vid).crit 只载 def 数据面）。
//   · F11 克盾/日曜冲撞（:21260/:21328 `Main.rand.Next(100) < meleeCrit`）/F12 矿车
//     （:27777-27792 max(melee,ranged,magic)）——p.critChance(kind) 只载装备/buff 面
//     ⇒ 补 4+heldItemCritBonus（F12 折入三系同值对 max 可外提）。
//   · F13 拍击石脉冲（1121 ranged/1131 现场定类）——strikeCritPct 补 heldItemCritBonus。
//   · F14 重定谳（R2-04「proc 不吃武器 item.crit」证伪,:25712-14 无条件折入与
//     BJ486③ 矛盾裁决=折入侧胜）：Volcano 978/血舌球 524（PvE+PvP 两产生位,均注册
//     可达）critChanceFn 补折入。
//  变异判别力：每节【旧码必红项】内注明（摘门/摘基 4/摘折入/平率直读/白抽回流/错弹型）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Arrow } from '../src/entities/Arrow';
import { GrenadeProj } from '../src/entities/WeaponProj';
import { ClusterFragmentProj } from '../src/entities/ClusterFragmentProj';
import { MuramasaSlashProj } from '../src/entities/meleeOnHitProjs';
import { minecartNpcRampage } from '../src/entities/MountCombat';
import { trySnapStrike } from '../src/stats/SnapStrike';
import { Game } from '../src/core/Game';
import { starCloakStarInfo } from '../src/core/Game';
import { ITEM_DEFS, ITEM_BY_KEY } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { prefixStat } from '../src/data/vanillaPrefixes';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import type { GameHooks } from '../src/entities/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (p: string) => readFileSync(join(HERE, '..', 'src', p), 'utf8');
const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

// ---- 真环境夹具（bj493 同源：真 World+真 Player+spy 敌桶） ----
const W = 200, H = 120;
interface SpyEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; maxHp: number; hp: number;
  vanillaId: number; dontTakeDamage: boolean; vx: number; vy: number;
  calls: Array<{ d: number; crit: boolean }>;
  hurt(d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean): boolean;
}
function mkEnemy(id: number, cx: number, cy: number, w = 38, h = 38): SpyEnemy {
  const e: SpyEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, iframes: 0, maxHp: 500000, hp: 10000,
    vanillaId: 0, dontTakeDamage: false, vx: 0, vy: 0, calls: [],
    hurt(d, _kx, _ky, _g, _pen = 0, crit = false) {
      e.calls.push({ d, crit });
      return true;
    },
  };
  return e;
}
function makeHooks(enemies: SpyEnemy[] = []): { hooks: GameHooks; player: Player } {
  const world = new World(W, H, 7, 'bj-c2-critroll');
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
afterEach(() => { vi.restoreAllMocks(); });

// ================ F1（HIGH）发射器火箭/榴弹：路由门 0.04+命中拍动态掷 ================
describe('BJ-C2/F1：发射器火箭/榴弹掷率（旧冻结 0=门闭永不暴击必红）', () => {
  it('1a 产生位=0.04 路由门,冻结写位零残留（变异:回写冻结值必红）', () => {
    const s = SRC('core/Game.ts');
    expect(s).toContain('rocket.critChance = 0.04;');
    expect(s).toContain('frag.critChance = 0.04;');
    expect(s).toContain('fw.critChance = 0.04;');
    expect(s).not.toContain("rocket.critChance = (this.player.critChance('ranged') + (bowC?.crit ?? 0)) / 100;");
    expect(s).not.toContain("frag.critChance = (this.player.critChance('ranged') + (bowC?.crit ?? 0)) / 100;");
    expect(s).not.toContain("fw.critChance = (this.player.critChance('ranged') + (bowC?.crit ?? 0)) / 100;");
  });

  it('1b 发射支接触环：裸装玩家 4% 门开——rnd 0.03 照暴（旧门闭=恒假必红）', () => {
    const e = mkEnemy(1, 640, 704);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);   // 裸装（装备/buff 聚合 0）
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);   // 空持（折入 0）
    vi.spyOn(Math, 'random').mockReturnValue(0.03);      // 0.03 < 0.04+0+0 → 暴
    const rocket = new GrenadeProj(640, 704, 0, 0, 100, 3600, 30, () => {});
    rocket.fired = true;                                  // 发射支（F1 产生位 fired=true 同态）
    step([rocket], 3, hooks);
    expect(e.calls.length).toBe(1);                       // 夹具自证（接触结算照达）
    expect(e.calls[0]!.crit).toBe(true);                  // ★主判别:门开动态掷
  });

  it('1c 命中拍换聚合+折入：critChance(50)+村正刃 671(crit16)+词缀 61(crt+5) → rnd 0.5 照暴', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    expect(itemCombat(671)?.crit).toBe(16);
    expect(prefixStat(61).crt).toBe(5);
    const e = mkEnemy(2, 640, 704);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(50);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue({ id: id671, prefix: 61 } as never);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);       // 0.5 < 0.04+0.50+0.21=0.75 → 暴
    const rocket = new GrenadeProj(640, 704, 0, 0, 100, 3600, 397, () => {});
    rocket.fired = true;
    step([rocket], 3, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                  // ★折入+聚合命中拍动态（冻结病=同值恒假）
  });

  it('1d 门关断钉：critChance=0 → 零暴（不做掷面,关断语义保留）', () => {
    const e = mkEnemy(3, 640, 704);
    const { hooks } = makeHooks([e]);
    vi.spyOn(Math, 'random').mockReturnValue(0.0);
    const rocket = new GrenadeProj(640, 704, 0, 0, 100, 3600, 30, () => {});
    rocket.fired = true;
    rocket.critChance = 0;                                // 测试置 0 习语（掷面整门关）
    step([rocket], 3, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(false);
  });
});

// ================ F2 爆炸掷：rangedCritPct 补基 4+折入（口径收口） ================
describe('BJ-C2/F2：爆炸掷阈值=原版 rangedCrit 字段值（旧缺基 4/缺折入必红）', () => {
  const callRangedCritPct = (player: unknown): number =>
    (Game.prototype as unknown as { rangedCritPct: (this: { player: unknown }) => number })
      .rangedCritPct.call({ player });

  it('2a 裸装玩家 → 恰 4（旧式回 0=爆炸 0% 暴击必红）', () => {
    expect(callRangedCritPct({ critChance: () => 0, inv: { heldItem: () => null } })).toBe(4);
  });

  it('2b 折入钉值：聚合 0+村正刃 671(crit16)+词缀 61(crt+5) → 4+0+21=25', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    expect(callRangedCritPct({ critChance: () => 0, inv: { heldItem: () => ({ id: id671, prefix: 61 }) } }))
      .toBe(25);                                          // ★词缀半边（旧 itemCombat 式=4 必红）
  });

  it('2c 口径收口对拍：爆炸掷阈值 ≡ rollVanillaHitCrit 同算式（基 4+聚合+折入）', () => {
    expect(callRangedCritPct({ critChance: () => 30, inv: { heldItem: () => null } })).toBe(34);
    expect(callRangedCritPct({ critChance: () => 11, inv: { heldItem: () => ({ id: 0, prefix: 0 }) } }))
      .toBe(15);
  });

  it('2d 裸 stub 兼容：critChance 缺法 → 回落 4（原基线,同相不变）', () => {
    expect(callRangedCritPct({})).toBe(4);
    expect(callRangedCritPct({ inv: {} })).toBe(4);
  });
});

// ================ F3 星怒 503：spawn 位 0.04 门（melee 面） ================
describe('BJ-C2/F3：天降三剑 503 掷率（类缺省门闭=永不暴击必红）', () => {
  it('3a spawn 位路由门在盘（变异:摘写位必红）', () => {
    expect(SRC('core/Game.ts')).toContain('star503.critChance = 0.04;');
  });
  it('3b 裸装 4% 门开：rnd 0.03 照暴（melee 面,含 :25712 折入算式）', () => {
    const e = mkEnemy(4, 600, 600);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    let d503b = 0; vi.spyOn(Math, 'random').mockImplementation(() => (d503b++ === 0 ? 0.03 : 0.5));   // 首掷=crit 阈值(0.03<0.04 照暴);后续=★BJ716-A DV 中性档(×1.0)
    const star = new Arrow(520, 585, 8, 0, 10, 1, 503, { grav: 0, life: 900, pierce: 2 });
    star.critChance = 0.04;                               // 迁移后 spawn 形
    step([star], 20, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                  // ★主判别（旧门闭必红）
    expect(e.calls[0]!.d).toBe(20);                       // 10×2（crit 乘区）
  });
  it('3c 聚合命中拍动态：critChance(60) → rnd 0.5 照暴（0.5<0.64）', () => {
    const e = mkEnemy(5, 600, 600);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(60);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const star = new Arrow(520, 585, 8, 0, 10, 1, 503, { grav: 0, life: 900, pierce: 2 });
    star.critChance = 0.04;
    step([star], 20, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);
  });
});

// ================ F4 圣箭坠星 92 / F5 水晶碎块 90：spawn 位 0.04 门（ranged 面） ================
describe('BJ-C2/F4+F5：Kill 伴生弹 92/90 掷率（类缺省门闭=永不暴击必红）', () => {
  it('4a 两 spawn 位路由门在盘（变异:摘写位必红）', () => {
    const s = SRC('core/Game.ts');
    expect(s).toMatch(/projId === 91[\s\S]{0,600}star\.critChance = 0\.04;/);
    expect(s).toContain('shard.critChance = 0.04;');
  });
  it('4b 92 ranged 面：裸装 rnd 0.03 照暴（0.04 门+rollVanillaHitCrit(92) 动态）', () => {
    const e = mkEnemy(6, 600, 600);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.03);
    const star = new Arrow(600, 600, 0, 0.1, 10, 0, 92, { starFall: { lineY: 600, gen: 0 } });
    star.critChance = 0.04;
    step([star], 3, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                  // ★主判别（旧门闭必红）
  });
  it('4c 90 ranged 面：聚合 50 → rnd 0.3 照暴（0.3<0.54,平率 4% 档必假）', () => {
    const e = mkEnemy(7, 600, 600);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(50);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    const shard = new Arrow(600, 600, 0, 0.1, 10, 0, 90, {});
    shard.critChance = 0.04;
    step([shard], 3, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                  // ★聚合动态（旧平率恒假必红）
  });
});

// ================ F6 集束裂片：迁 rollVanillaHitCrit（旧平率直读必红） ================
describe('BJ-C2/F6：集束裂片掷率收编（旧 ||0.04 平率直读丢聚合/折入必红）', () => {
  it('6a 消费位=rollVanillaHitCrit 单源+旧平率面零残留（变异:回写 || 面必红）', () => {
    const s = SRC('entities/ClusterFragmentProj.ts').replace(/^\s*\/\/[^\n]*/gm, '');
    expect(s).toContain('this.critChance > 0 && rollVanillaHitCrit(this.projId, game)');
    expect(s).not.toContain('Math.random() < (this.critChance || 0.04)');
    expect(SRC('core/Game.ts')).toContain('frag.critChance = 0.04;');
  });
  it('6b 聚合动态：critChance(50) → rnd 0.3 照暴（旧平率 0.04 档必假）', () => {
    const e = mkEnemy(8, 640, 704);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(50);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    const frag = new ClusterFragmentProj(640, 704, 0, 0, 50, 779, 40, () => {});
    frag.critChance = 0.04;                               // 迁移后 spawn 形（路由门）
    step([frag], 2, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                  // ★主判别（旧平率面必红）
  });
  it('6c 折入：聚合 0+持械 21 → rnd 0.22 照暴（0.22<0.25）', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    const e = mkEnemy(9, 640, 704);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue({ id: id671, prefix: 61 } as never);
    vi.spyOn(Math, 'random').mockReturnValue(0.22);
    const frag = new ClusterFragmentProj(640, 704, 0, 0, 50, 783, 40, () => {});
    frag.critChance = 0.04;
    step([frag], 2, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                  // ★持械折入（旧面丢折入必红）
  });
  it('6d 裸装门开兜底：聚合 0+空持 → rnd 0.03 照暴/rnd 0.5 不暴（≥基 4 面）', () => {
    const e1 = mkEnemy(10, 640, 704);
    const run1 = makeHooks([e1]);
    vi.spyOn(run1.player, 'critChance').mockReturnValue(0);
    vi.spyOn(run1.player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.03);
    const f1 = new ClusterFragmentProj(640, 704, 0, 0, 50, 779, 40, () => {});
    f1.critChance = 0.04;
    step([f1], 2, run1.hooks);
    expect(e1.calls[0]!.crit).toBe(true);
    vi.restoreAllMocks();
    const e2 = mkEnemy(11, 640, 704);
    const run2 = makeHooks([e2]);
    vi.spyOn(run2.player, 'critChance').mockReturnValue(0);
    vi.spyOn(run2.player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const f2 = new ClusterFragmentProj(640, 704, 0, 0, 50, 779, 40, () => {});
    f2.critChance = 0.04;
    step([f2], 2, run2.hooks);
    expect(e2.calls[0]!.crit).toBe(false);
  });
});

// ================ F7 村正 977：错弹型定谳勘正+critChanceFn 折入+消白抽 ================
describe('BJ-C2/F7：村正斩波 977（旧「155 无类旗不掷」定谳错必红）', () => {
  it('7a 产生位补 critChanceFn（含折入）——变异:摘注入必红', () => {
    const s = SRC('core/Game.ts');
    expect(s).toMatch(/const cut = new MuramasaSlashProj\([\s\S]{0,1600}cut\.critChanceFn/);
    expect(s).toMatch(/cut\.critChanceFn[\s\S]{0,200}heldItemCritBonus\(this\.player\.inv\.heldItem\(\)\)/);
  });
  it('7b 消费位白抽消除：fn 缺位零掷零 RNG（变异:白抽回流必红）', () => {
    const e = mkEnemy(12, 600, 600);
    const { hooks } = makeHooks([e]);
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 恒不暴档
    const cut = new MuramasaSlashProj(600, 600, 0, 0, 50, 0, 0);
    cut.critChanceFn = null;                              // 旧产生位漏注入态
    step([cut], 1, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(false);
    const drawsNull = rnd.mock.calls.length;
    vi.restoreAllMocks();
    const e2 = mkEnemy(13, 600, 600);
    const run2 = makeHooks([e2]);
    const rnd2 = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const cut2 = new MuramasaSlashProj(600, 600, 0, 0, 50, 0, 0);
    cut2.critChanceFn = () => 0;                          // 阈值 0=必假但【照掷】（对照臂）
    step([cut2], 1, run2.hooks);
    expect(e2.calls[0]!.crit).toBe(false);
    // ★白抽判别：fn=()=>0 照吃一掷,fn=null 零掷——恰差 1（其余掷流两臂对称）
    expect(drawsNull).toBe(rnd2.mock.calls.length - 1);
  });
  it('7c fn 注入掷面：阈值 0.5+携折入闭包 → rnd 0.4 照暴×2 伤（977 melee 面）', () => {
    const e = mkEnemy(14, 600, 600);
    const { hooks } = makeHooks([e]);
    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    const cut = new MuramasaSlashProj(600, 600, 0, 0, 50, 0, 0);
    cut.critChanceFn = () => 0.5;                         // 产生位 live 注入形
    step([cut], 1, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);
    expect(e.calls[0]!.d).toBeGreaterThanOrEqual(90);     // 50×DamageVar(±15%)×2 ≥ 85 档
  });
});

// ================ F9 星光斗篷星弹：projType 链+勿补掷门 ================
describe('BJ-C2/F9：斗篷星弹型=star.projType（旧硬钉 503 必红;补掷门=二次偏离必红）', () => {
  it('9a spawn 位用 star.projType、503 硬钉零残留（变异:回钉 503 必红）', () => {
    const s = SRC('core/Game.ts');
    const start = s.indexOf('const star = starCloakStarInfo(accVids, eq.starCloak);');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = s.indexOf("this.entities.add(starProj, 'projectiles');", start);
    expect(end).toBeGreaterThan(start);
    const block = s.slice(start, end);
    expect(block).toContain('star.projType');             // 弹型链消费
    expect(block).not.toContain('5, 503,');               // 旧硬钉零残留
    expect(block).not.toContain('critChance');            // ★勿补掷门（723-726/1133 原版零掷）
  });
  it('9b starCloakStarInfo 弹型链钉值（726 缺省/725 面纱/724 蜂/723 魔力/1133 蛇）', () => {
    expect(starCloakStarInfo([532], true).projType).toBe(726);
    expect(starCloakStarInfo([862], false).projType).toBe(725);
    expect(starCloakStarInfo([1247], false).projType).toBe(724);
    expect(starCloakStarInfo([4001], false).projType).toBe(723);
    expect(starCloakStarInfo([6186], false).projType).toBe(1133);
    expect(starCloakStarInfo([], false).active).toBe(false);
  });
  it('9c 726 无类旗零掷：门置 0.04 → rollVanillaHitCrit kind=null 返假零暴（勿补掷门判别）', () => {
    const e = mkEnemy(15, 600, 600);
    const { hooks } = makeHooks([e]);
    vi.spyOn(Math, 'random').mockReturnValue(0.0);        // 任何掷都暴的档
    const star = new Arrow(520, 585, 8, 0, 10, 1, 726, { grav: 0, life: 900, pierce: 2 });
    star.critChance = 0.04;                               // 即便误开门,数据面 null → 返假
    step([star], 20, hooks);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(false);                 // ★零掷面（原版本相）
  });
});

// ================ F10 挥击两掷面：heldItemCritBonus 单源 ================
describe('BJ-C2/F10：挥击两掷面折入单源（旧 itemCombat 半边必红）', () => {
  it('10a 两掷面（城镇 NPC/敌怪）=heldItemCritBonus(this.player.inv.heldItem())', () => {
    const s = SRC('core/Game.ts');
    expect(s).toMatch(/let tnCrit = Math\.random\(\) < 0\.04 \+ this\.player\.critChance\('melee'\) \/ 100\n\s*\+ heldItemCritBonus\(this\.player\.inv\.heldItem\(\)\) \/ 100;/);
    expect(s).toMatch(/let crit = Math\.random\(\) < 0\.04 \+ this\.player\.critChance\('melee'\) \/ 100[\s\S]{0,200}\+ heldItemCritBonus\(this\.player\.inv\.heldItem\(\)\) \/ 100;/);
    expect(s).not.toContain('+ (itemCombat(heldVidFly)?.crit ?? 0) / 100;');
    expect(s).not.toContain("+ (itemCombat(this.swing ? (ITEM_DEFS[this.swing.item]?.vid ?? -1) : -1)?.crit ?? 0) / 100;");
  });
  it('10b heldItemCritBonus 钉值（def crit+词缀 crt 两半边）——变异:丢词缀半边必红', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    expect(itemCombat(671)?.crit).toBe(16);               // def 数据面半边
    expect(prefixStat(61).crt).toBe(5);                   // 词缀半边
    expect(heldFoldOf({ id: id671, prefix: 61 })).toBe(21);
    expect(heldFoldOf({ id: id671 })).toBe(16);           // 无词缀=def 档
    expect(heldFoldOf(null)).toBe(0);
  });
});

// ================ F11 克盾/日曜冲撞：补基 4+折入 ================
describe('BJ-C2/F11：冲撞掷面=meleeCrit 字段值（旧缺基 4/缺折入必红）', () => {
  const driveEoC = (player: Player, hooks: GameHooks, e: SpyEnemy): void => {
    (player as unknown as { dashMovement: (g: GameHooks, eq: unknown, ix: number, spd: number, db: boolean, slow: number) => void })
      .dashMovement(hooks, { dash: 2, runSlowMul: 1, moveMult: 1, kbGlove: false }, 0, 1, false, 1);
    void e;
  };
  it('11a 克盾冲撞：裸装 rnd 0.03 照暴（基 4 门;旧 0 档必红）', () => {
    const e = mkEnemy(16, 975, 1450, 20, 20);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.03);
    player.eocDash = 15;                                  // :21627 冲撞窗
    player.dashLatched = 2;                               // ★C5-B5 闩锁位（外门=dashLatched）
    player.vx = 14.5;                                     // dash2 触发速（盒随速度外扩）
    driveEoC(player, hooks, e);
    expect(e.calls.length).toBe(1);                       // 夹具自证（冲撞结算照达）
    // ★主判别（hurt 惯例=调用侧预倍,crit 位恒 false → 以伤值判）：30×2=60
    // （旧 this.critChance 式=0 档 → 不暴 → 30 必红）
    expect(e.calls[0]!.d).toBe(60);
  });
  it('11b 克盾冲撞折入：持械 671+61（+21） → rnd 0.2 照暴（旧 0.2<0 必红）', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    const e = mkEnemy(17, 975, 1450, 20, 20);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue({ id: id671, prefix: 61 } as never);
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    player.eocDash = 15;
    player.dashLatched = 2;
    player.vx = 14.5;
    driveEoC(player, hooks, e);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(60);                       // ★词缀+def 折入（旧→30 必红）
  });
  it('11c 日曜冲撞：裸装 rnd 0.03 照暴（:21328 同式）', () => {
    const e = mkEnemy(18, 975, 1450, 20, 20);
    const { hooks, player } = makeHooks([e]);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.03);
    player.solarDashing = true;
    player.dashDelay = -1;                                // 滑行态（逐帧扫敌）
    player.dashLatched = 3;                               // ★C5-B5 闩锁位（防 dashDelay=0 清写）
    player.solarShields = 1;
    player.vx = 21.9;                                     // dash3 触发速
    (player as unknown as { dashMovement: (g: GameHooks, eq: unknown, ix: number, spd: number, db: boolean, slow: number) => void })
      .dashMovement(hooks, { dash: 0, runSlowMul: 1, moveMult: 1 }, 0, 1, false, 1);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(300);                      // ★150×2（旧→150 必红）
  });
});

// ================ F12 矿车冲撞：补基 4+折入（max 三择可外提） ================
describe('BJ-C2/F12：矿车碾压掷面（旧缺基 4/缺折入必红）', () => {
  it('12a rnd 0.05：4+聚合 0+折入 21=25 阈 → 照暴（旧 0/4 档必红）', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    const e = mkEnemy(19, 660, 600, 20, 20);              // 盒 vx 扩张后 x∈[640,675]
    const { hooks, player } = makeHooks([e]);
    const cart = { x: 640, y: 584, w: 20, h: 20, vx: 10, vy: 0, mountId: 0, superCart: false, runSpeed: 20 };
    const hits = minecartNpcRampage(cart, {
      ...(hooks as object),
      player: {
        critChance: () => 0,
        inv: { heldItem: () => ({ id: id671, prefix: 61 }) },
        dead: false, luck: 0,
      },
    } as unknown as GameHooks, () => 0.05);
    expect(hits).toBe(1);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.crit).toBe(true);                  // ★5 < 25（旧 5<4 / 5<0 必红）
  });
  it('12b 裸装基 4：rnd 0.03 照暴 / rnd 0.05 不暴（恰 4% 域）', () => {
    const mk = (rnd: number) => {
      const e = mkEnemy(20, 660, 600, 20, 20);
      const { hooks } = makeHooks([e]);
      const cart = { x: 640, y: 584, w: 20, h: 20, vx: 10, vy: 0, mountId: 0, superCart: false, runSpeed: 20 };
      const hits = minecartNpcRampage(cart, {
        ...(hooks as object),
        player: { critChance: () => 0, inv: { heldItem: () => null }, dead: false, luck: 0 },
      } as unknown as GameHooks, () => rnd);
      return { hits, crit: e.calls[0]?.crit ?? false };
    };
    expect(mk(0.03)).toEqual({ hits: 1, crit: true });    // 3 < 4 → 暴
    expect(mk(0.05)).toEqual({ hits: 1, crit: false });   // 5 ≥ 4 → 不暴（旧 0 档此处不可辨）
  });
});

// ================ F13 拍击石脉冲：strikeCritPct 补折入 ================
describe('BJ-C2/F13：拍击石/焰爆石脉冲掷率（旧缺折入必红）', () => {
  const equip = (p: Player, vid: number): void => {
    Object.defineProperty(p, 'equipStats', {
      value: Object.freeze({ ...(p as unknown as { equipStats: Record<string, unknown> }).equipStats, [vid === 6178 ? 'accPyroclast' : 'accSnappingStone']: true }),
      configurable: true,
    });
  };
  const capturedPulses = (hooks: GameHooks): Array<{ critChance: number; projId: number }> => {
    const out: Array<{ critChance: number; projId: number }> = [];
    (hooks as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities.add =
      (e: unknown) => {
        const p = e as { critChance?: number; projId?: number };
        if (p && typeof p.critChance === 'number' && p.projId) out.push({ critChance: p.critChance, projId: p.projId });
        return undefined;
      };
    return out;
  };
  it('13a 焰爆石 kind1：持械 671+61（+21） → 脉冲载体 0.25（旧 0.04 必红）', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    const e1 = mkEnemy(21, 1080, 1440, 16, 24);
    const { hooks, player } = makeHooks([e1, mkEnemy(22, 1140, 1440, 16, 24)]);
    equip(player, 6178);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue({ id: id671, prefix: 61 } as never);
    const pulses = capturedPulses(hooks);
    trySnapStrike(hooks, player, 1, 960, 1440, 999);
    expect(pulses.length).toBeGreaterThanOrEqual(1);      // 夹具自证（脉冲已出）
    expect(pulses[0]!.critChance).toBeCloseTo(0.25, 5);   // ★4+0+21=25pp（旧 0.04 必红）
  });
  it('13b 拍击石 kind0（ranged 面）：折入同式 0.25', () => {
    const id671 = ITEM_DEFS.findIndex((d) => d?.vid === 671);
    const { hooks, player } = makeHooks([mkEnemy(23, 1040, 1440, 16, 24)]);   // kind0 maxRange=120（STRICT <）
    equip(player, 6167);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue({ id: id671, prefix: 61 } as never);
    const pulses = capturedPulses(hooks);
    trySnapStrike(hooks, player, 0, 960, 1440, 999);
    expect(pulses.length).toBeGreaterThanOrEqual(1);
    expect(pulses[0]!.projId).toBe(1121);                 // ranged 面（数据面 static ranged）
    expect(pulses[0]!.critChance).toBeCloseTo(0.25, 5);
  });
  it('13c 空持零漂移：折入 0 → 恰 0.04（基 4 档不变）', () => {
    const { hooks, player } = makeHooks([mkEnemy(24, 1080, 1440, 16, 24)]);
    equip(player, 6178);
    vi.spyOn(player, 'critChance').mockReturnValue(0);
    vi.spyOn(player.inv, 'heldItem').mockReturnValue(null);
    const pulses = capturedPulses(hooks);
    trySnapStrike(hooks, player, 1, 960, 1440, 999);
    expect(pulses.length).toBeGreaterThanOrEqual(1);
    expect(pulses[0]!.critChance).toBeCloseTo(0.04, 5);
  });
});

// ================ F14 重定谳：978/524 critChanceFn 补折入 ================
describe('BJ-C2/F14：Volcano 978/血舌球 524 掷率（「不吃武器 crit」旧谳证伪,缺折入必红）', () => {
  it('14a 三产生位（978/524 PvE/524 PvP）critChanceFn 含 heldItemCritBonus 折入', () => {
    const s = SRC('core/Game.ts');
    expect(s).toMatch(/blast\.critChanceFn[\s\S]{0,200}heldItemCritBonus\(this\.player\.inv\.heldItem\(\)\)/);
    expect(s.match(/glob\.critChanceFn[\s\S]{0,200}heldItemCritBonus\(this\.player\.inv\.heldItem\(\)\)/g)?.length).toBe(2);
    // 旧式（无折入）单行写位零残留（作用域限 glob/blast 注入位;bee.critChance 门值
    // 载体 Arrow 消费面只作 >0 路由门=行为中性,不在本刀域）
    expect(s).not.toContain("glob.critChanceFn = (): number => Math.min(1, 0.04 + this.player.critChance('melee') / 100);");
    expect(s).not.toContain("glob.critChanceFn = (): number => Math.min(1, (4 + this.player.critChance('melee')) / 100);");
  });
  it('14b 重定谳登记：VolcanoBlastProj 旧谳注已勘正（证伪留痕在盘）', () => {
    const s = SRC('entities/VolcanoBlastProj.ts');
    expect(s).toContain('BJ-C2/F14');
    expect(s).toContain(':25712-14');                     // 折入锚留痕
  });
  it('14c MuramasaSlashProj 白抽防御形在盘（F7 消费位）', () => {
    const s = SRC('entities/meleeOnHitProjs.ts').replace(/^\s*\/\/[^\n]*/gm, '');
    expect(s).toContain('if (this.critChanceFn) crit = this.critChanceFn() > Math.random();');
    expect(s).not.toContain('(this.critChanceFn?.() ?? 0) > Math.random()');
  });
});

/** F10 钉值辅助：heldItemCritBonus 单源直读（proj1457 导出） */
import { heldItemCritBonus } from '../src/entities/proj1457';
function heldFoldOf(held: { id: number; prefix?: number } | null): number {
  return heldItemCritBonus(held);
}
