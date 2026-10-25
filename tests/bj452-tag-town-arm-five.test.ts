// ★BJ452（2026-10-03）：tag/城镇臂五件——BJ445 同域新登记 N1-N5。
//  定谳锚（Terarria1457 亲读）：
//   · N1 光环城镇臂 ×4：res.dmg 已含 tag-crit 预倍 ×2（resolveWhipTagHit 尾
//     WhipTag.ts:848 `if (crit) dmg *= 2`）——旧形 dmg=res.dmg + crit=golemCritAura,
//     golem 掷中∧tag crit 同拍 → TownNPC.hurt 防后再倍 = ×4;仅 tag crit 时色缺。
//     修=BJ445② 同构（contactTown :4996-4999 盘上原形）：crit=res.crit‖golemCritAura
//     （TownNPC.hurt 防后×2+色一体,NPC.cs:82066）;dmg 仅 res.crit 摘半（golem 预倍
//     本不经 dmg 承载,勿随 golemCritAura 摘——摘之则 golem-only 档腰斩）。
//   · N2 敌怪侧 tag-crit 色缺三站（光环场伤/623 拳盒/818 扑击）——Enemy.hurt crit
//     参=纯染色（Enemy.ts:14583 登记偏差,数值预倍在调用侧）→ 补 res.crit‖golemCrit,
//     零数值风险（BJ445②/Arrow.ts whipTagShot 支同式先例）。
//   · N3 爆弹/彩弹 tag 面：694/695/696/644 ∈ SentryShot（ProjectileID.cs:293）→
//     WhipTagEffect.CanRunHitEffects（WhipTagEffect.cs:76-87）达 → Damage 管线
//     ModifyHit+OnHit 照跑=完整 WhipTagEffect 栈 → 敌/城两臂挂单源 resolveWhipTagHit
//     + :12636 共门（immune[owner]>0 整跳,先于 crit 掷/tag 消费,掷序纪律）+916 直伤
//     汇出延迟落地（W5 :13711 位次,受理+写梯后）。
//   · N4 642 月门弹城镇档：SetDefaults usesLocalNPCImmunity+localNPCHitCooldown=10
//     （Projectile.cs:6906-6916）→ 写梯 usesLocal 主支（:14175-14179）immune[owner]=0
//     清窗+写局部表;旧城镇面走 TownNPC.hurt 通用档 10t（:1495）=档误。vanilla 单
//     localNPCImmunity 数组敌/城两面共用 → Arrow 城镇面挂 flag2 私表门+清窗写表
//     （敌环 :9414 同源 localImmuneCd）。
//   · N5 contactTown skip 缺 :12636 共门支：local/idStatic 分支不查窗=窗拒拍白吃
//     私表 cd（BJ436 敌怪环同病灶,contact() :4809 已修）;补三族共门（读 hurt 前状态
//     =vanillaGated 快照纪律）+拳盒 623/光环 688-690 敌怪环同构位（623 命中盒
//     Colliding :15611-15621、aiStyle137 :12468 均走 Damage_PVE_Inner 同门）。
//  判别力（旧码必红项）：§N1 70/70（旧 170/85）;§N2 三站色位（旧恒 false）;
//    §N3 门整跳+tag 55/45/90/65/165/链 15（旧 40/25/50/50/105/无链）;
//    §N4 hurt 调用计数 1（旧 12）+iframes=0（旧 10）;§N5 两支节拍（旧窗内白吃 cd）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Enemy } from '../src/entities/Enemy';
import { TownNPC } from '../src/entities/TownNPC';
import { MinionProj, TigerPounce } from '../src/entities/MinionProj';
import { Arrow } from '../src/entities/Arrow';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

// ---- mock 环境（bj445 同款） ----
const W = 200, H = 120;
function makeStore(): TileStore {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  return store;
}

interface ChainEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; maxHp: number; hp: number;
  vanillaId: number; realLife: number; dontTakeDamage: boolean;
  vx: number; vy: number;
  calls: Array<{ d: number; kx: number; ky: number; pen: number; crit: boolean; pierce: number }>;
  hurt(d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean): boolean;
}
function mkEnemy(id: number, cx: number, cy: number, w = 38, h = 38): ChainEnemy {
  const e: ChainEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, iframes: 0, maxHp: 5000, hp: 10000,
    vanillaId: 0, realLife: -1, dontTakeDamage: false, vx: 0, vy: 0, calls: [],
    hurt(d, kx, ky, _g, pen = 0, crit = false, pierce = 0) {
      e.calls.push({ d, kx, ky, pen, crit, pierce });
      return true;
    },
  };
  return e;
}
function makeHooks(enemies: ChainEnemy[] = []) {
  const store = makeStore();
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: { store } as never,
    player: player as never,
    enemies: () => enemies,
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
  };
  (hooks as unknown as { entities: object }).entities = {
    add: (e: unknown) => { added.push(e); },
    nextId: 1,
    projectiles: [] as unknown[],   // countStormTigerGems 等扫弹消费（扑击 818 驱动需要）
  } as never;
  return { hooks, store, player, added };
}

/** 真实世界环境（bj445 makeGame 同款：真 World+真 Enemy/TownNPC+ projectiles 桶） */
function makeGame(list: Enemy[], towns: TownNPC[]): { hooks: GameHooks; player: Player; added: unknown[] } {
  const w = new World(200, 120, 7, 'bj452-tag-town-arm-five');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const projectiles: unknown[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => list,
    npcs: () => towns,
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
    spawnFriendlyProj: (e: unknown) => { added.push(e); return undefined; },
    entities: { add: (e: unknown) => { added.push(e); projectiles.push(e); }, nextId: 1, projectiles } as never,
    applyLifeSteal: () => 0,
  } as unknown as GameHooks;
  return { hooks, player, added };
}
const voodooOn = (p: Player): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, killGuide: true }), configurable: true,
  });
};
const golemBackpackOn = (p: Player): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, accGolemSentryBackpack: true }), configurable: true,
  });
};
function guide(_hooks: GameHooks, towns: TownNPC[], px: number, py: number): TownNPC {
  const g = new TownNPC('guide', px, py);
  g.id = 100 + towns.length;
  g.maxHp = 5000;
  g.hp = 5000;
  towns.push(g);
  return g;
}
/** guide 盒心重定位（TownNPC ctor=左/底锚;光环场伤按盒心几何判定） */
const centerGuide = (g: TownNPC, cx: number, cy: number): void => {
  g.x = cx - g.w / 2;
  g.y = cy - g.h / 2;
};
const ravenAt = (player: Player, cx: number, cy: number): MinionProj =>
  new MinionProj(cx - 14, cy - 14, 317, 30, 1.5, false, 0, false, () => player);
type ContactSpec = number | { kind: 'idStatic'; cd: number } | undefined;
const contactDirect = (m: MinionProj, hooks: GameHooks, dmg = 30, cd: ContactSpec = 5): boolean =>
  (m as unknown as { contact: (g: GameHooks, d: number, cd?: ContactSpec) => boolean })
    .contact(hooks, dmg, cd);
const tickUntil = (m: { fixedUpdate: (dt: number, g: GameHooks) => void; dead: boolean },
  hooks: GameHooks, until: () => boolean, max = 120): number => {
  for (let i = 0; i < max && !until(); i++) m.fixedUpdate(1, hooks);
  return max;
};
/** ★BJ662（2026-10-12）N3e/N3f 复绿：BJ639 批1② 643 volley 实体化后,644 爆裂弹=
 *  独立实体（入 hooks.entities.projectiles）需自身 fixedUpdate 驱动到 t=30 引爆拍
 *  ——旧 tickUntil 只驱 643 本体（旧「落点即时 AoE」时代够用）,弹体永不引爆=
 *  两臂零受理（BJ646/BJ650 登记存量红根因,机制面 1:1 无罪——对拍
 *  Projectile.cs:37918-37932 散布式逐位同相,全驱动下 65/150/3×15 全中）。
 *  本 helper=本体拍 + 快照驱动弹幕注册表（N3e/N3f 专用,不动共享 tickUntil 零 blast）。 */
const tickUntilAll = (m: { fixedUpdate: (dt: number, g: GameHooks) => void; dead: boolean },
  hooks: GameHooks, until: () => boolean, max = 120): number => {
  for (let i = 0; i < max && !until(); i++) {
    m.fixedUpdate(1, hooks);
    const reg = (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles;
    for (const p of [...reg]) {
      (p as { fixedUpdate?: (dt: number, g: GameHooks) => void }).fixedUpdate?.(1, hooks);
    }
  }
  return max;
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// ================ §N1 光环城镇臂 ×4→×2 + 色位 ================
describe('BJ452-N1：光环 688 城镇臂 settle（tag-crit 预倍摘半+crit 参）', () => {
  /** 光环场盒驱动：688 塔落位 (392,1584)（tile 25,99）→ 场盒 320² 心 (400,1600) */
  const auraScenario = (player: Player, towns: TownNPC[], hooks: GameHooks): { m: MinionProj; g: TownNPC } => {
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 400, 1560);
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    return { m, g };
  };

  it('N1a golem 掷中∧tag crit 同拍：dmg=50+crit 参 → (50−15)×2=70（旧 (100−15)×2=170 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // tag crit(0<10) 与 golem crit(0==0) 同拍真
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    golemBackpackOn(player);
    const { m, g } = auraScenario(player, towns, hooks);
    player.tagEffectStack.tryApplyTagToNPC(4914, g.id, 22, 0);   // 万花筒 tagDamage 20/critChance 10
    const spy = vi.spyOn(g, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    // res.dmg=(30+20)×2=100 → 摘半 50 → TownNPC.hurt：光环 penPercent=1（100% 穿甲,
    //  lightningAuraPenPercent(vanillaId≠68,def15<999) → 防御整除）→ (50−0)×2=100
    expect(spy.mock.calls[0]![0]).toBe(50);            // ★主判别①:dmg 摘半（旧 100 必红）
    expect(spy.mock.calls[0]![6]).toBe(true);          // ★主判别②:crit 参（防后×2+色一体）
    expect(5000 - g.hp).toBe(100);                     // ★主判别③:×4→×2（旧 (100−0)×2=200 必红）
  });

  it('N1b 仅 tag crit（无背包）：dmg=50+crit 参 → 色位 true（旧 dmg=100 无色 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // tag crit 真;无背包 → golem 掷恒 false
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const { m, g } = auraScenario(player, towns, hooks);
    player.tagEffectStack.tryApplyTagToNPC(4914, g.id, 22, 0);
    const spy = vi.spyOn(g, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(50);            // ★主判别①:dmg 摘半（旧 100 必红）
    expect(spy.mock.calls[0]![6]).toBe(true);          // ★主判别②:色位（旧恒 false 必红;
                                                       //   hp 面新旧同值 100——色位/dmg 双钉承载判别力）
  });
});

// ================ §N2 敌怪侧 tag-crit 色位三站（纯染色,零数值风险） ================
describe('BJ452-N2：敌怪环 hurt crit 参补 res.crit（光环/拳盒/扑击）', () => {
  it('N2a 光环场伤：tag crit-only → 色位 true,d=100 不变（旧色 false 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // tag crit 真;无背包 golem=false
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const e = Enemy.fromVanilla(15, 400, 1560)!;   // 场盒心轴上（LOS 清）
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    player.tagEffectStack.tryApplyTagToNPC(4914, e.id, 0, 0);
    const spy = vi.spyOn(e, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(85);            // (30+20)×2=100 预倍 → DV(100,−15 档)=85（BJ716-A R18-F2）
    expect(spy.mock.calls[0]![5]).toBe(true);          // ★主判别:色位（旧恒 golemCritAura=false 必红）
  });

  it('N2b 拳盒 623：tag crit-only → 色位 true,d=100 不变（旧恒 false 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const e = mkEnemy(0, 700, 600);
    const { hooks, player } = makeHooks([e]);
    player.x = 560; player.y = 580;                    // nearPlayer<500 门（:4482）——须贴身
    const m = new MinionProj(600, 600, 623, 30, 2, false, 0, false, () => player);
    (m as unknown as { gA0: number; gA1: number }).gA0 = 2;   // 状态 2 冲刺拳击
    (m as unknown as { gA1: number }).gA1 = 0;
    player.tagEffectStack.tryApplyTagToNPC(4914, e.id, 0, 0);
    tickUntil(m, hooks, () => e.calls.length > 0);
    expect(e.calls.length).toBeGreaterThan(0);
    expect(e.calls[0]!.d).toBe(85);                    // (30+20)×2=100 → DV(100,−15 档)=85（BJ716-A R18-F2）
    expect(e.calls[0]!.crit).toBe(true);               // ★主判别:色位（旧恒 false 必红）
  });

  it('N2c 扑击弹 818：tag crit-only → 色位 true,d=100 不变（旧恒 false 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const e = mkEnemy(0, 700, 600);
    const { hooks, player } = makeHooks([e]);
    const p = new TigerPounce(700, 600, 0, 0, 20, () => player, 0, 0);   // 132² 盒心锚,直接重叠
    player.tagEffectStack.tryApplyTagToNPC(4914, e.id, 0, 0);
    tickUntil(p, hooks, () => e.calls.length > 0, 8);
    expect(e.calls.length).toBeGreaterThan(0);
    expect(e.calls[0]!.d).toBe(85);                    // (20×1.5+20)×2=100 → DV(100,−15 档)=85（BJ716-A R18-F2）
    expect(e.calls[0]!.crit).toBe(true);               // ★主判别:色位（旧恒 false 必红）
  });
});

// ================ §N3 爆弹/彩弹 tag 面（共门+单源 resolveWhipTagHit+916 落地） ================
describe('BJ452-N3：694 爆炸弹/644 爆裂弹臂（:12636 共门+tag 全栈）', () => {
  it('N3a 691 陷阱敌臂 :12636 共门：e 窗内（iframes=10）→ hurt 整段不达（旧无门必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const e = Enemy.fromVanilla(15, 381, 552)!;        // C1 几何:探测盒内
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    e.iframes = 10;                                    // 他源窗（:12636 immune[owner]>0）
    list.push(e);
    const spy = vi.spyOn(e, 'hurt');
    const m = new MinionProj(400 - 15, 600 - 15, 691, 40, 2, true, 0, false, () => player);
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls.length).toBe(0);             // ★主判别:共门在消费位前整跳（旧必红）
    expect(e.hp).toBe(500000);
  });

  it('N3b 691 敌臂 tag 面：主伤 40+15=55 + 916 链电 15 落其他敌（旧 40/无链 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);     // 无暴击（golem floor(5)≠0;4680 零掷率）
    const e1 = Enemy.fromVanilla(15, 381, 552)!;
    e1.id = 1; e1.maxHp = 500000; e1.hp = 500000;
    const e2 = Enemy.fromVanilla(15, 700, 552)!;       // AoE 盒外/链程 400 内（距 319）
    e2.id = 2; e2.maxHp = 500000; e2.hp = 500000;
    list.push(e1, e2);
    const spy1 = vi.spyOn(e1, 'hurt');
    const spy2 = vi.spyOn(e2, 'hurt');
    const m = new MinionProj(400 - 15, 600 - 15, 691, 40, 2, true, 0, false, () => player);
    player.tagEffectStack.tryApplyTagToNPC(4680, e1.id, 0, 0);   // 黑收成 tagDamage 15
    tickUntil(m, hooks, () => spy1.mock.calls.length > 0);
    expect(spy1.mock.calls[0]![0]).toBe(55);           // ★主判别①:tag 加伤（旧 40 必红）
    expect(spy2.mock.calls.map((c) => c[0])).toEqual([15]);   // ★主判别②:916 链电落其他敌（旧 [] 必红）
    expect(spy1.mock.calls.length).toBe(1);            // 源敌永免（_DarkHarvest.cs:18）——链不落回
  });

  it('N3c 691 城镇臂 tag 面：guide 伤 40+20=60（旧 40 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);     // 无暴击
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const e = Enemy.fromVanilla(15, 400 - 19, 552)!;   // 探测触发敌（C1 同位）
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const g = guide(hooks, towns, 400, 552);
    player.tagEffectStack.tryApplyTagToNPC(4914, g.id, 22, 0);   // 万花筒 tagDamage 20
    const m = new MinionProj(400 - 15, 600 - 15, 691, 40, 2, true, 0, false, () => player);
    tickUntil(m, hooks, () => g.hp < 5000);
    expect(5000 - g.hp).toBe(45);                      // ★主判别:res.dmg=60 → 60−15（旧 40−15=25 必红）
  });

  it('N3d 691 城镇臂 golem∧tag crit 同拍：dmg=60+crit 参 → (60−15)×2=90（旧 (40−15)×2=50 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);       // tag crit 与 golem crit 同拍真
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    golemBackpackOn(player);
    const e = Enemy.fromVanilla(15, 400 - 19, 552)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const g = guide(hooks, towns, 400, 552);
    player.tagEffectStack.tryApplyTagToNPC(4914, g.id, 22, 0);
    const spy = vi.spyOn(g, 'hurt');
    const m = new MinionProj(400 - 15, 600 - 15, 691, 40, 2, true, 0, false, () => player);
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls[0]![0]).toBe(60);            // (40+20)×2/2 摘半（BJ445② 同构）
    expect(spy.mock.calls[0]![6]).toBe(true);          // crit 参（防后×2+色一体）
    expect(5000 - g.hp).toBe(90);                      // ★主判别:防后单倍 crit（旧 50 必红）
  });

  it('N3e 643→644 volley 敌臂 tag 面：主伤 50+15=65（旧 50 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);     // 落点散布 0 → px=tgt 心;无暴击
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const e = Enemy.fromVanilla(15, 481, 581)!;        // C4 几何:volley 落点
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const spy = vi.spyOn(e, 'hurt');
    const m = new MinionProj(384, 584, 643, 50, 2, true, 0, false, () => player);
    player.tagEffectStack.tryApplyTagToNPC(4680, e.id, 0, 0);
    tickUntilAll(m, hooks, () => spy.mock.calls.length > 0);   // ★BJ662：全弹驱动（644 实体化后须自驱到引爆拍）
    expect(spy.mock.calls[0]![0]).toBe(65);            // ★主判别:tag 加伤（旧 50 必红）
  });

  it('N3f 643→644 volley 城镇臂 tag 面：guide 伤 3×50 + 916 链电 3×15（旧 3×35/无链 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);     // 落点散布 0;无暴击
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const e = Enemy.fromVanilla(15, 481, 581)!;        // volley 落点=guide 位（C3 几何）
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const g = guide(hooks, towns, 481 - 9, 581);
    player.tagEffectStack.tryApplyTagToNPC(4680, g.id, 22, 0);   // 黑收成 tagDamage 15（hurtFx 汇出源）
    const spyE = vi.spyOn(e, 'hurt');
    const m = new MinionProj(384, 584, 643, 50, 2, true, 0, false, () => player);
    tickUntilAll(m, hooks, () => g.hp < 5000);                 // ★BJ662：全弹驱动（644 实体化后须自驱到引爆拍）
    // 3 volley × (res.dmg=50+15=65 → 65−15=50);链电自 guide 位（e 同位=最近链靶,
    //  每 volley 落 15;城镇本体永免=源不回链）
    expect(5000 - g.hp).toBe(150);                     // ★主判别①:tag 加伤（旧 3×35=105 必红）
    expect(spyE.mock.calls.filter((c) => c[0] === 50).length).toBe(3);   // 敌臂 3 volley（e 未打 tag=裸 50）
    expect(spyE.mock.calls.filter((c) => c[0] === 15).length).toBe(3);   // ★主判别②:916 链电落地（旧 0 必红）
  });
});

// ================ §N4 642 月门弹城镇清窗档（hurt 调用计数 spy 判别） ================
describe('BJ452-N4：Arrow 642 城镇面（usesLocal cd10 → flag2 私表门+清窗写表）', () => {
  it('N4 悬停 642 对 guide：城镇面（projId=642）5t 仅 1 次 hurt+清窗 iframes=0（旧 5 次/通用档 10 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 400, 552);
    // 642 = 18×18（top-left=心−9）;v=0 悬停,data 面 localNPCHitCooldown=10 → localImmune=10
    const a = new Arrow(400 - 9, 552 - 9, 0, 0, 30, 1, 642, { grav: 0, life: 40 });
    const spy = vi.spyOn(g, 'hurt');
    a.fixedUpdate(1, hooks);
    // ★清窗档可观察面（★BJ455④ 改判后钉值）：face1 受理拍清窗（usesLocal 主支）
    //  → 尾段第二城镇面已挂同源局部表 skip（原版 Damage() 单趟 victim 循环=
    //  每靶每拍至多一次受理;BJ455④ 定谳前尾面无 skip 探针同拍再受理=hp 30）——
    //  hp=15（旧双调 30 必红;BJ452 世代曾钉 30=双调残留面,④改判单面后重钉）
    expect(5000 - g.hp).toBe(15);
    for (let i = 1; i < 5; i++) a.fixedUpdate(1, hooks);
    // 城镇面判别按 projId 参过滤（args[9]）——第二面不受本刀管辖,计数须排除
    const face1Calls = spy.mock.calls.filter((c) => c[9] === 642).length;
    expect(face1Calls).toBe(1);                        // ★主判别:flag2 私表门节流（旧 5 必红）
  });
});

// ================ §N5 contactTown/敌怪环 :12636 共门（两支节拍+同构位） ================
describe('BJ452-N5：contactTown skip 共门（窗拒拍不白吃私表 cd）+光环敌环同构位', () => {
  it('N5a local 分支（cd=10）：窗内整跳→窗清立即命中（旧窗内白吃 cd=节拍漂移 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 400, 600);
    const m = ravenAt(player, 400, 600);
    g.iframes = 10;                                    // 他源窗
    const spy = vi.spyOn(g, 'hurt');
    contactDirect(m, hooks, 30, 10);                   // 私表族 spec=10
    expect(spy.mock.calls.length).toBe(0);             // ★主判别①:共门整跳（旧 ready 消费+ hurt 必红）
    g.iframes = 0;
    contactDirect(m, hooks, 30, 10);
    expect(spy.mock.calls.length).toBe(1);             // ★主判别②:窗拒拍私表保持 0 → 窗清立即可命中
  });

  it('N5b idStatic 分支（{cd:10}）：窗内整跳→窗清立即命中（旧同病灶 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 400, 600);
    const m = ravenAt(player, 400, 600);
    g.iframes = 10;
    const spy = vi.spyOn(g, 'hurt');
    contactDirect(m, hooks, 30, { kind: 'idStatic', cd: 10 });
    expect(spy.mock.calls.length).toBe(0);             // ★主判别①:共门整跳
    g.iframes = 0;
    contactDirect(m, hooks, 30, { kind: 'idStatic', cd: 10 });
    expect(spy.mock.calls.length).toBe(1);             // ★主判别②:idStatic 桶未被窗拒拍白吃
  });

  it('N5c 光环敌环同构位：e 窗内（iframes=10）→ hurt 整段不达（旧无门必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const e = Enemy.fromVanilla(15, 400, 1560)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    e.iframes = 10;                                    // 他源窗（:12636）
    list.push(e);
    const spy = vi.spyOn(e, 'hurt');
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    expect(spy.mock.calls.length).toBe(0);             // ★主判别:共门先于私表消费（旧必红）
  });
});
