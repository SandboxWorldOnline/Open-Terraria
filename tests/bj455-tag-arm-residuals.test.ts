// ★BJ455（2026-10-03）：tag/城镇臂七残余位（BJ452 新登记,N1-N5 同构位清扫）。
//  定谳锚（Terarria1457 亲读）：
//   · ①拳盒 623 城镇臂 settle：res.dmg 已含 tag-crit 预倍 ×2（resolveWhipTagHit 尾
//     WhipTag.ts:848）→ BJ445② 同构（contactTown :4996 盘上原形）=仅 res.crit 摘半+
//     crit 传参（TownNPC.hurt 防后×2+色一体 NPC.cs:82066）。623=minion 非
//     sentry/SentryShot → 6176 golem 掷不达（Projectile.cs:12962 门 sentry∪SentryShot）
//     → crit=res.crit 单源。旧形 dmg=res.dmg+crit 缺=色缺+倍序偏离。
//   · ②扑击 818 城镇臂 settle 同病同构落（818=MinionShot 非 SentryShot,golem 掷不达）。
//   · ③扑击 818 敌臂 banner 包入：818 SetDefaults friendly（P.cs:8007-8019）、AI_162
//     （:44056-44123）无直伤旁路 → 标准 Damage() 管线 → Damage_PVE banner 段
//     （:13387-91 `dmg=(int)(dmg×effect.DamageDealt.Sample)`）对其照跑;他臂均包,本臂漏包。
//   · ④Arrow 尾段第二城镇面同拍双调：原版 Damage() 单 Main.npc 数组单趟 victim 循环
//     （P.cs:12592）=每靶每拍至多一次受理,无第二城镇面;642 SetDefaults
//     usesLocalNPCImmunity+cd=10（:6906-6916）→ 修=尾面挂同源局部表 skip（face1 受理
//     拍写 localImmuneCd → 尾面同式拒跳）,原版单面。
//   · ⑤ghostHeal 门口径：原版 :13712 `flag10 |= num41>0` 位次在 StrikeNPC（:13702）后
//     【无死亡复查】（BJ405 'proc/numHits++ 在受理面无死亡复查'）→ 击杀拍照回血=
//     contact() mainGated（受理前置快照）对;post-hurt !en.dead 门错（击杀拍断供）。
//     爆弹 691/694 臂为主刀,光环/拳盒/爆裂 644 臂同构统一。
//   · ⑥Arrow 敌环局部/idStatic 三支 :12636 前门：原版 :12635-12637 `immune[owner]==0`
//     在写梯 :14031-14179 前对 usesLocal/usesIDStatic 弹同样生效（flag3 只豁免单发非
//     局部弹 :12634）→ 窗拒拍整跳不白吃私表 cd（BJ436 判例）;门读 hurt 前状态=快照纪律。
//   · ⑦拳盒/光环/扑击城镇臂 skip 谓词补 :12636 共门（contactTown :4958 同式）——
//     623/光环 cd 探针 ready() 有消费副作用=窗拒拍白吃 cd 节拍漂移;818 无消费位但
//     skip 后 settle/RNG 照跑=拒拍耗掷（掷序纪律）。
//  判别力（旧码必红项）：§N1/§N2 摘半 50+crit 参（旧 100/恒 false）;
//    §N3 banner 45（旧 30）;§N4 hp 15+尾面 0 调（旧 30/1 调）;
//    §N5 击杀拍 applyLifeSteal 照达（旧 post-hurt 门断供）;
//    §N6 窗清立即命中（旧白吃 meowHitCd/localImmuneCd/idStatic 表）;
//    §N7 623/光环窗清立即命中+818 窗拒拍 settle 整跳（旧 ready() 白吃 cd/settle 照跑）。
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

// ---- mock 环境（bj452 同款 + bannerNpcActive/applyLifeSteal 面板） ----
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
function makeHooks(enemies: ChainEnemy[] = [], bannerVids: number[] = []) {
  const store = makeStore();
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const lifeSteal: Array<{ kind: string; dealt: number; numHits: number }> = [];
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
    applyLifeSteal: (kind: string, dealt: number, numHits: number) => {
      lifeSteal.push({ kind, dealt, numHits });
      return 0;
    },
  };
  (hooks as unknown as { bannerNpcActive: (vid: number) => boolean }).bannerNpcActive =
    (vid: number) => bannerVids.includes(vid);
  (hooks as unknown as { entities: object }).entities = {
    add: (e: unknown) => { added.push(e); },
    nextId: 1,
    projectiles: [] as unknown[],
  } as never;
  return { hooks, store, player, added, lifeSteal };
}

/** 真实世界环境（bj452 makeGame 同款：真 World+真 Enemy/TownNPC+ projectiles 桶） */
function makeGame(list: Enemy[], towns: TownNPC[]): { hooks: GameHooks; player: Player; added: unknown[] } {
  const w = new World(200, 120, 7, 'bj455-tag-arm-residuals');
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
function guide(_hooks: GameHooks, towns: TownNPC[], px: number, py: number): TownNPC {
  const g = new TownNPC('guide', px, py);
  g.id = 100 + towns.length;
  g.maxHp = 5000;
  g.hp = 5000;
  towns.push(g);
  return g;
}
/** guide 盒心重定位（TownNPC ctor=左/底锚;场伤/拳盒按盒心几何判定） */
const centerGuide = (g: TownNPC, cx: number, cy: number): void => {
  g.x = cx - g.w / 2;
  g.y = cy - g.h / 2;
};
const tickUntil = (m: { fixedUpdate: (dt: number, g: GameHooks) => void; dead: boolean },
  hooks: GameHooks, until: () => boolean, max = 120): number => {
  for (let i = 0; i < max && !until(); i++) m.fixedUpdate(1, hooks);
  return max;
};
/** 弹盒心重置到靶心（aiStyle 位移中性化——两拍夹具重叠不受 AI 位移影响） */
const recenter = (a: { x: number; y: number; w: number; h: number }, cx: number, cy: number): void => {
  a.x = cx - a.w / 2;
  a.y = cy - a.h / 2;
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// ================ §N1 拳盒 623 城镇臂 settle（摘半+crit 参） ================
describe('BJ455-N1：623 城镇臂 settle crit 色缺（BJ445② 同构）', () => {
  it('N1 tag crit-only：dmg=50+crit 参 → (50−15)×2=85（旧 dmg=100 无色 → 92 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // tag crit 真（critChance 10）;623 无 golem 掷
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    player.x = 560; player.y = 580;               // nearPlayer<500 门（guardianBody 状态 2）
    const e = mkEnemy(0, 700, 600);               // 状态 2 锚敌（gA1=0）
    (hooks as unknown as { enemies: () => unknown[] }).enemies = () => [e as never];
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 640, 608);                     // 拳盒 608..688 × 592..632 内
    const m = new MinionProj(600, 600, 623, 30, 2, false, 0, false, () => player);
    (m as unknown as { gA0: number; gA1: number }).gA0 = 2;
    (m as unknown as { gA1: number }).gA1 = 0;
    player.tagEffectStack.tryApplyTagToNPC(4914, g.id, 22, 0);   // 万花筒 tagDamage 20/critChance 10
    const spy = vi.spyOn(g, 'hurt');
    tickUntil(m, hooks, () => spy.mock.calls.length > 0);
    // res.dmg=(30+20)×2=100 → 摘半 50 → TownNPC.hurt：guide 防×0.5=15 → (50−15)×2=70
    expect(spy.mock.calls[0]![0]).toBe(50);            // ★主判别①:dmg 摘半（旧 100 必红）
    expect(spy.mock.calls[0]![6]).toBe(true);          // ★主判别②:crit 参=防后×2+色一体（旧恒 false 必红）
    expect(5000 - g.hp).toBe(70);                      // ★主判别③:防后单倍 crit（旧 100−15=85 无 crit 必红）
  });
});

// ================ §N2 扑击 818 城镇臂 settle（同构落） ================
describe('BJ455-N2：818 城镇臂 settle crit 色缺（同构）', () => {
  it('N2 tag crit-only：dmg=50+crit 参+kb=0 → 85（旧 100/恒 false/92 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 700, 600);                     // 扑击 132² 盒心锚,直接重叠
    const p = new TigerPounce(700, 600, 0, 0, 20, () => player, 0, 0);
    player.tagEffectStack.tryApplyTagToNPC(4914, g.id, 22, 0);
    const spy = vi.spyOn(g, 'hurt');
    tickUntil(p, hooks, () => spy.mock.calls.length > 0, 8);
    // dmg0=max(1,round(20×1.5))=30（gems=0）→ (30+20)×2=100 → 摘半 50
    expect(spy.mock.calls[0]![0]).toBe(50);            // ★主判别①:dmg 摘半（旧 100 必红）
    expect(spy.mock.calls[0]![6]).toBe(true);          // ★主判别②:crit 参（旧恒 false 必红）
    expect(spy.mock.calls[0]![1]).toBe(0);             // kb=0（StrikeNPC 双门不进 :82144）
    expect(5000 - g.hp).toBe(70);                      // ★主判别③:防后单倍 crit（旧 85 无 crit 必红）
  });
});

// ================ §N3 扑击 818 敌臂 banner 包入（先定谳后落刀） ================
describe('BJ455-N3：818 敌臂 hurt 未包 applyBannerDamageDealt', () => {
  it('N3 旗下（蓝史莱姆旗 1683）：d=45（30×1.5）（旧裸 30 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（818 扑击首掷 ×1.0）
    const e = mkEnemy(0, 700, 600);
    e.vanillaId = 1;                               // 蓝史莱姆族旗 npcToBanner[1]=69 → item 1683
    const { hooks } = makeHooks([e as never], [1]);
    const p = new TigerPounce(700, 600, 0, 0, 20, () => hooks.player, 0, 0);
    tickUntil(p, hooks, () => e.calls.length > 0, 8);
    expect(e.calls.length).toBeGreaterThan(0);
    // 定谳：818=标准 Damage() 管线（friendly :8007-8019,AI_162 无直伤旁路）→
    // Damage_PVE :13387-91 banner 段照跑 → (int)(30×1.5)=45（他臂同式先例）
    expect(e.calls[0]!.d).toBe(45);                    // ★主判别:banner 乘区（旧 30 必红）
  });
});

// ================ §N4 Arrow 尾段第二城镇面同拍双调（先定谳后落刀） ================
describe('BJ455-N4：Arrow 642 尾面局部表门（原版单面 → 双调修门控）', () => {
  it('N4 悬停 642 对 guide：hp=15+尾面 0 调（旧同拍双调 hp=30/尾面 1 调 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 400, 552);
    const a = new Arrow(400 - 9, 552 - 9, 0, 0, 30, 1, 642, { grav: 0, life: 40 });
    const spy = vi.spyOn(g, 'hurt');
    a.fixedUpdate(1, hooks);
    // 定谳：原版 Damage() 单趟 victim 循环=每靶每拍至多一次受理——face1（BJ452 N4
    // 城镇面）受理拍写 localImmuneCd=10 → 尾面（:9850,同源局部表 skip）同拍拒跳
    expect(5000 - g.hp).toBe(15);                      // ★主判别①:单面单受理（旧 30 必红）
    expect(spy.mock.calls.filter((c) => c[9] === 642).length).toBe(1);   // face1 1 调
    expect(spy.mock.calls.filter((c) => c[9] === 0).length).toBe(0);     // ★主判别②:尾面 0 调（旧 1 必红）
    for (let i = 1; i < 5; i++) a.fixedUpdate(1, hooks);
    expect(5000 - g.hp).toBe(15);                      // 私表门节流 5t（BJ452 N4 判别保持）
    expect(spy.mock.calls.filter((c) => c[9] === 642).length).toBe(1);
  });
});

// ================ §N5 ghostHeal 门口径（击杀拍照回血,先定谳后统一） ================
describe('BJ455-N5：ghostHeal 门径统一（:13712 flag10 无死亡复查 → 受理前置快照）', () => {
  it('N5a 爆弹 691 臂击杀拍：applyLifeSteal 照达（旧 post-hurt !en.dead 断供 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const e = Enemy.fromVanilla(15, 381, 552)!;        // C1 几何:探测盒+AoE 盒内
    e.id = 1; e.maxHp = 500000; e.hp = 20;             // 40 伤一击致死
    list.push(e);
    const spyLife = vi.spyOn(hooks as unknown as { applyLifeSteal: () => number }, 'applyLifeSteal');
    const m = new MinionProj(400 - 15, 600 - 15, 691, 40, 2, true, 0, false, () => player);
    tickUntil(m, hooks, () => e.dead);
    expect(e.dead).toBe(true);                         // 击杀拍已发生（判别前提）
    expect(spyLife.mock.calls.length).toBeGreaterThan(0);   // ★主判别:击杀拍照回血（旧 0 必红）
  });

  it('N5b 光环 688 臂击杀拍：applyLifeSteal 照达（同构统一 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const e = Enemy.fromVanilla(15, 400, 1560)!;       // 场盒心轴上
    e.id = 1; e.maxHp = 500000; e.hp = 10;             // 30 伤一击致死
    list.push(e);
    const spyLife = vi.spyOn(hooks as unknown as { applyLifeSteal: () => number }, 'applyLifeSteal');
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    tickUntil(m, hooks, () => e.dead);
    expect(e.dead).toBe(true);
    expect(spyLife.mock.calls.length).toBeGreaterThan(0);   // ★主判别:同构统一
  });

  it('N5c 拳盒 623 臂击杀拍：applyLifeSteal 照达（同构统一 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    player.x = 560; player.y = 580;
    const e = Enemy.fromVanilla(15, 700, 600)!;        // 状态 2 锚敌+拳盒内
    e.id = 0; e.maxHp = 500000; e.hp = 10;
    list.push(e);
    const spyLife = vi.spyOn(hooks as unknown as { applyLifeSteal: () => number }, 'applyLifeSteal');
    const m = new MinionProj(600, 600, 623, 30, 2, false, 0, false, () => player);
    (m as unknown as { gA0: number; gA1: number }).gA0 = 2;
    (m as unknown as { gA1: number }).gA1 = 0;
    tickUntil(m, hooks, () => e.dead);
    expect(e.dead).toBe(true);
    expect(spyLife.mock.calls.length).toBeGreaterThan(0);   // ★主判别:同构统一
  });
});

// ================ §N6 Arrow 敌环局部/idStatic 三支 :12636 前门 ================
describe('BJ455-N6：Arrow 局部/idStatic 分支 :12636 共门（窗拒拍不白吃私表）', () => {
  it('N6a 502 喵刀：窗内整跳私表保持 0 → 窗清立即命中（旧白吃 meowHitCd 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const e = Enemy.fromVanilla(15, 400, 552)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const spy = vi.spyOn(e, 'hurt');
    const a = new Arrow(400 - 8, 552 - 8, 0, 0, 30, 1, 502, { grav: 0, life: 40 });
    e.iframes = 10;                                    // 他源窗
    recenter(a, e.cx, e.cy);
    a.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(0);             // 窗内不命中（新旧同相）
    e.iframes = 0;
    recenter(a, e.cx, e.cy);
    a.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(1);             // ★主判别:窗清立即命中（旧 cd=9 白吃 必红）
  });

  it('N6b 642 局部免疫支：窗内整跳 → 窗清立即命中（旧白吃 localImmuneCd 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const e = Enemy.fromVanilla(15, 400, 552)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const spy = vi.spyOn(e, 'hurt');
    const a = new Arrow(400 - 9, 552 - 9, 0, 0, 30, 1, 642, { grav: 0, life: 40 });
    e.iframes = 10;
    recenter(a, e.cx, e.cy);
    a.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(0);
    e.iframes = 0;
    recenter(a, e.cx, e.cy);
    a.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(1);             // ★主判别:窗清立即命中（旧 必红）
  });

  it('N6c 376 idStatic 支：窗内整跳 → 窗清立即命中（旧白吃 idStatic 表 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    const e = Enemy.fromVanilla(15, 400, 552)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const spy = vi.spyOn(e, 'hurt');
    const a = new Arrow(400 - 6, 552 - 6, 0, 0, 30, 1, 376, { grav: 0, life: 40 });
    e.iframes = 10;
    recenter(a, e.cx, e.cy);
    a.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(0);
    e.iframes = 0;
    recenter(a, e.cx, e.cy);
    a.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(1);             // ★主判别:窗清立即命中（旧 必红）
  });
});

// ================ §N7 拳盒/光环/扑击城镇臂 skip :12636 共门 ================
describe('BJ455-N7：三私表臂 skip 共门（窗拒拍不白吃 cd/settle）', () => {
  it('N7a 623 城镇臂：窗内整跳私表保持 0 → 窗清立即命中（旧 ready() 白吃 cd 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    player.x = 560; player.y = 580;
    const e = mkEnemy(0, 700, 600);                    // 状态 2 锚敌
    (hooks as unknown as { enemies: () => unknown[] }).enemies = () => [e as never];
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 640, 608);                          // 拳盒内
    const m = new MinionProj(600, 600, 623, 30, 2, false, 0, false, () => player);
    (m as unknown as { gA0: number; gA1: number }).gA0 = 2;
    (m as unknown as { gA1: number }).gA1 = 0;
    const spy = vi.spyOn(g, 'hurt');
    g.iframes = 10;                                    // 他源窗
    m.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(0);             // 窗内不命中（新旧同相）
    g.iframes = 0;
    m.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(1);             // ★主判别:窗清立即命中（旧 cd=5→4 白吃 必红）
  });

  it('N7b 光环 688 城镇臂：窗内整跳 → 窗清立即命中（旧 ready(3) 白吃 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 400, 1560);                         // 场盒心轴上（LOS 清）
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    const spy = vi.spyOn(g, 'hurt');
    g.iframes = 10;
    tickUntil(m, hooks, () => (m as unknown as { auraSide: number }).auraSide > 0);
    m.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(0);             // 窗内不命中（新旧同相）
    g.iframes = 0;
    m.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(1);             // ★主判别:窗清立即命中（旧 必红）
  });

  it('N7c 扑击 818 城镇臂：窗拒拍 settle 整跳（hurtFx 不落=不耗掷,旧 settle 照跑 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 0, 0);
    centerGuide(g, 700, 600);                          // 扑击 132² 盒心锚
    const p = new TigerPounce(700, 600, 0, 0, 20, () => player, 0, 0);
    const spy = vi.spyOn(g, 'hurt');
    g.iframes = 10;
    p.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(0);             // 窗内不命中（新旧同相）
    // ★主判别:settle 整跳——settle 副作用 tn.hurtFx 挂载不发生（旧 skip=hitSet 读门
    //  无窗支 → settle 照跑 hurtFx 挂载=拒拍耗掷 必红）
    expect((g as unknown as { hurtFx?: unknown }).hurtFx).toBeUndefined();
    g.iframes = 0;
    p.fixedUpdate(1, hooks);
    expect(spy.mock.calls.length).toBe(1);             // 窗清照常受理
  });
});
