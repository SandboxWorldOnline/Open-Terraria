// ★清偿刀 BJ445（2026-10-03）：MinionProj 域三件——①敌怪环 916 直伤延迟汇出复核
//  （W5 已落,本测按 Y2 探针同构钉双落+位次面）②contactTown/敌怪环 crit 色 omission
//  补齐 ③694/644 AoE 城镇档位核落刀。
//  定谳锚（Terarria1457 亲读）：
//   · ①②：Projectile.cs:13702 StrikeNPC(dmg,...,crit,...) → :13711 TagEffectStack.
//     OnHit（916 出 916 链电,_DarkHarvest.cs:14-20）→ :14175-14179 写梯。crit 源=
//     tag 掷率强制位（WhipTagEffect.cs:70-72 Next(100)<CritChance → changes.Crit）
//     ‖ 6176 圣殿骑士背包（Projectile.cs:12962-12965）——:13702 原版传 crit →
//     NPC.StrikeNPC_Inner :82066 `CalculateDamageNPCsTake(Damage,defense)×(crit?2:1)`
//     （防后 ×2）+ 暴击色（CombatText）。Enemy.hurt 仓内约定=crit 参仅染色（Enemy.ts
//     :14583 登记偏差,调用侧预倍承载数值）;TownNPC.hurt=crit 参防后 ×2（TownNPC.ts
//     :1486-1492,数值+色一体）→ TownHitSettle 传 crit=true 时 dmg 勿预倍（projTargets
//     TownHitSettle 注）。BJ445② 修形：敌怪环 crit 参=res.crit‖golemCrit（Arrow.ts
//     :9490 同式先例）;contactTown settle 摘 tag-crit 半还原防前值+crit 参交 TownNPC.hurt
//     防后重倍（旧形 golemCrit 防前预倍+crit 恒缺=色省略+倍序偏离 (值×2−防)≠(值−防)×2）。
//   · ③：SetDefaults 亲读——694/695/696（Projectile.cs:7356-7367）usesLocalNPCImmunity
//     +localNPCHitCooldown=30 → 写梯 :14175-14179 immune[owner]=0【清窗】非 :14182
//     通用档 10;644（:6943-6953）usesIDStaticNPCImmunity+penetrate=1（:6946）→ 写梯
//     usesIDStatic 外支命中/内支 `penetrate!=1` 不达=immune[owner]【零写】保持 0。
//     两族 :12636 immune[owner]==0 门三族共门（flag3 只豁免单发非局部弹,均不豁免）。
//     旧「城镇通用档 iframes=10 保留」系 :14182 档误档（Y2 报告③）。
//  判别力（旧码必红项）：§A1 目标面反记/反序（旧同步直调形 SRC 只吃直伤+主伤丢,
//    Y2 探针同构）;§B1/B2 crit 色位（旧恒 false）;§B3 防后 ×2+色（旧 85/45 必红）;
//    §C1/C3 清窗档（旧 iframes=10 必红）;§C2/C4 :12636 共门（旧无门必红）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Enemy } from '../src/entities/Enemy';
import { TownNPC } from '../src/entities/TownNPC';
import { MinionProj } from '../src/entities/MinionProj';
import type { GameHooks } from '../src/entities/types';

// ---- mock 环境（w5/y2 同款） ----
const W = 200, H = 120;
function makeStore(): TileStore {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  return store;
}
import { TileStore } from '../src/world/TileStore';

/** 全局命中序日志（hurt 调用序=位次钉值载体） */
const seq: string[] = [];

interface ChainEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; maxHp: number; hp: number;
  vanillaId: number; realLife: number; dontTakeDamage: boolean;
  vx: number; vy: number; tag: string;
  calls: Array<{ d: number; kx: number; ky: number; pen: number; crit: boolean; pierce: number }>;
  hurt(d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean): boolean;
}
function mkEnemy(id: number, cx: number, cy: number, tag: string, w = 38, h = 38): ChainEnemy {
  const e: ChainEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, iframes: 0, maxHp: 5000, hp: 10000,
    vanillaId: 0, realLife: -1, dontTakeDamage: false, vx: 0, vy: 0, tag, calls: [],
    hurt(d, kx, ky, _g, pen = 0, crit = false, pierce = 0) {
      e.calls.push({ d, kx, ky, pen, crit, pierce });
      seq.push(e.tag);
      // Enemy.hurt :14427-14428 写梯镜像（pierce 三态）
      if (pierce === -3) e.iframes = 0;
      else if (pierce !== -2 && pierce !== 1) e.iframes = 10;
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
  (hooks as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities = {
    add: (e: unknown) => { added.push(e); },
  };
  return { hooks, store, player, added };
}
const step = (list: unknown[], ticks: number, hooks: GameHooks): void => {
  for (let i = 0; i < ticks; i++) {
    for (const e of list) {
      const p = e as { dead: boolean; fixedUpdate: (dt: number, g: GameHooks) => void };
      if (!p.dead) p.fixedUpdate(1, hooks);
    }
  }
};
/** 乌鸦 317 contact() 直驱（Y2 同式:确定单发,AI 态机无关） */
const ravenAt = (player: Player, cx: number, cy: number): MinionProj =>
  new MinionProj(cx - 14, cy - 14, 317, 30, 1.5, false, 0, false, () => player);
const contactDirect = (m: MinionProj, hooks: GameHooks, dmg = 30, cd: number | undefined = 5): boolean =>
  (m as unknown as { contact: (g: GameHooks, d: number, cd?: number) => boolean }).contact(hooks, dmg, cd);

// ---- 真实世界环境（哨兵 AI 驱动,y2 makeGame 同款） ----
function makeGame(list: Enemy[], towns: TownNPC[]): { hooks: GameHooks; player: Player; added: unknown[] } {
  const w = new World(200, 120, 7, 'bj445-aoe-town');
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

beforeEach(() => { seq.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

// ---- §A ①敌怪环 916 延迟汇出复核（W5 已落;Y2 探针同构夹具钉双落+位次） ----
describe('BJ445-§A：contact() 敌怪环 916 双落+位次（Y2 探针同构,darkharvest）', () => {
  it('A1 主伤 26+链电 15 双落、源敌零直伤记录、主先链后（:13702→:13711 位次钉值）', () => {
    // Y2 探针同构：darkharvest tag（4680,tagDamage 15,mul 1）+ 基伤 11 →
    // 主命中 = 11+15 = 26（Y2 报告「主伤 26」同钉）;旧同步直调形=hurtFx 直调源敌
    // 先置 iframes → 主 hurt 被窗拒整丢、只落直伤（Y2 实测「只落直伤」）。
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（R18-F2 主环首掷 ×1.0）
    const src = mkEnemy(0, 600, 600, 'SRC');
    const e1 = mkEnemy(1, 700, 600, 'E1');
    const { hooks, player } = makeHooks([src, e1]);
    player.tagEffectStack.tryApplyTagToNPC(4680, src.id, 0, 0);
    contactDirect(ravenAt(player, 600, 600), hooks, 11);
    expect(src.calls.map((c) => c.d)).toEqual([26]);   // ★主判别:主伤 26 双落不丢（旧形=[15]）
    expect(src.calls[0].crit).toBe(false);             // darkharvest 无 critChance → 零掷
    expect(e1.calls.map((c) => c.d)).toEqual([15]);    // ★目标面:链电落其他敌（:18 源敌永免）
    expect(seq).toEqual(['SRC', 'E1']);                // ★位次:直伤不早于主 hurt 受理
  });

  it('A2 主命中门拒（dontTakeDamage）→ 链电不落地（:13711 不可达）', () => {
    const src = mkEnemy(0, 600, 600, 'SRC');
    const e1 = mkEnemy(1, 700, 600, 'E1');
    src.dontTakeDamage = true;
    const { hooks, player } = makeHooks([src, e1]);
    player.tagEffectStack.tryApplyTagToNPC(4680, src.id, 0, 0);
    contactDirect(ravenAt(player, 600, 600), hooks, 11);
    // ★BJ475①（2026-10-03）形态升级:contact 环补 :12600 外环头门（BJ467⑥ 同构,
    //  `flag2 && (!dontTakeDamage || ZappingJellyfish)` 先于 Inner 全链）——DTD 靶
    //  整跳=StrikeNPC(:13702)/OnHit(:13711) 全不达,主命中【不达 hurt】（旧档=外环
    //  无门+hurt 内部 :14241 拒收形,[26] 锁定的是彼时仓内相,与原版外环门偏差;
    //  BJ467⑥ §6a-6d 已把「DTD 靶 hurt 0 调」定为同构正确相）。链电不落地主判据
    //  保持：汇出位 en.hurtFx 在 hurt 前,环头整跳=hurtFx 不挂→916 恒不可达。
    expect(src.calls.map((c) => c.d)).toEqual([]);     // ★外环整跳:主命中不达 hurt（旧 [26] 必红=旧相锁）
    expect(e1.calls).toEqual([]);                      // ★门拒跳无 916（汇出延迟面,主判据保持）
    expect(seq).toEqual([]);                           // hurtFx 不挂 → 无 SRC 入序（旧 ['SRC']）
  });
});

// ---- §B ②crit 色判别（tag 掷率位 + 6176 背包位;旧恒 false 必红） ----
describe('BJ445-§B：crit 色补齐（敌怪环色面/城镇臂防后 ×2）', () => {
  it('B1 敌怪环 tag 掷率 crit（万花筒 4914 critChance 10）：d=100 色位 true（数值不变=纯染色）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // Next(100)<10 → 0<10 恒真
    const src = mkEnemy(0, 600, 600, 'SRC');
    const { hooks, player } = makeHooks([src]);
    player.tagEffectStack.tryApplyTagToNPC(4914, src.id, 0, 0);   // tagDamage 20/critChance 10
    contactDirect(ravenAt(player, 600, 600), hooks);
    // ★BJ730 改判史：旧值 85（BJ716-A 时点形 (30+20)×2=100 预倍后 DV）→ 新值 42
    //  ——BJ723-B S02（2026-10-26）crit ×2 移 Enemy.hurt 防后（NPC.cs:82067 两步式）,
    //  敌怪环预翻倍清偿后 spy 记录=未倍 DV 值:50×0.85=42.5→toEvenRound 42。
    expect(src.calls[0].d).toBe(42);                   // (30+20)=50 → DV(50,−15 档)=42（×2 在 hurt 防后）
    expect(src.calls[0].crit).toBe(true);              // ★主判别:色位（旧恒 false 必红）
    expect(seq).toEqual(['SRC']);                      // 万花筒无链电（OnTaggedHit=粒子面）
  });

  it('B2 敌怪环 6176 背包强制 crit（:12962-12965）：d=60 色位 true（哨兵位弹,sentry‖SentryShot 谓词）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);               // Next(10)==0 → 恒真
    const src = mkEnemy(0, 600, 600, 'SRC');
    const { hooks, player } = makeHooks([src]);
    golemBackpackOn(player);
    // 6176 谓词 = sentry‖SentryShot[type]（:12962-12965）——哨兵位载体直驱
    const sentryRaven = new MinionProj(586, 586, 317, 30, 1.5, true, 0, false, () => player);
    contactDirect(sentryRaven, hooks);
    // ★BJ730 改判史：旧值 52（30×2=60 预倍后 DV 再 ×2）→ 新值 26——同 B1,BJ723-B
    //  S02 crit ×2 移 hurt 防后:30×0.85=25.5→toEvenRound 26（银行家舍入 25.5→26）。
    expect(src.calls[0].d).toBe(26);                   // 30 → DV(30,−15 档)=26（×2 在 hurt 防后）
    expect(src.calls[0].crit).toBe(true);              // ★主判别:色位（旧恒 false 必红）
  });

  it('B3 城镇臂 tag crit：settle 摘半+crit 参 → TownNPC.hurt 防后 ×2（(50−15)×2=70,旧 85 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const g = guide(hooks, towns, 400, 600);
    player.tagEffectStack.tryApplyTagToNPC(4914, g.id, 22, 0);   // tagDamage 20/critChance 10
    const m = ravenAt(player, 400, 600);
    contactDirect(m, hooks);
    // res.dmg = (30+20)×2 = 100,res.crit=true → settle dmg=100/2=50 + crit=true
    // → TownNPC.hurt：(50−def15)×2 = 70（NPC.cs:82066 原序;暴击色一体）。
    // 旧形：dmg=100 防前（crit 恒缺）→ 100−15=85 且无色。
    expect(5000 - g.hp).toBe(70);      // ★主判别:防后双精度+色（旧 85 必红）
  });

  it('B4 城镇臂 6176 背包 crit：raw 30+crit 参 → (30−15)×2=30（旧预倍 60−15=45 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    golemBackpackOn(player);
    const g = guide(hooks, towns, 400, 600);
    // 哨兵位载体（6176 谓词 sentry‖SentryShot :12962-12965）
    const m = new MinionProj(386, 586, 317, 30, 1.5, true, 0, false, () => player);
    contactDirect(m, hooks);
    // 旧形 golemCrit 防前预倍 dmg=60 → 45;新形 crit 参防后 ×2 → (30−15)×2=30（原版序）。
    expect(5000 - g.hp).toBe(30);      // ★主判别:倍序归位+色（旧 45 必红）
  });
});

// ---- §C ③694/644 AoE 城镇档位（哨兵 AI 驱动冒烟） ----
describe('BJ445-§C：694 爆炸弹/644 爆裂弹城镇臂（usesLocal 30 清窗/idStatic 零写还原+共门）', () => {
  it('C1 691 爆炸机关城镇臂：guide 掉血+iframes=0（usesLocal :14175 清窗,旧 10 必红）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    // 探测盒触发敌（Center−48 处,canBeChasedBy 门）——guide 同位吃 AoE
    const e = Enemy.fromVanilla(15, 400 - 19, 552)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const g = guide(hooks, towns, 400, 552);
    const m = new MinionProj(400 - 15, 600 - 15, 691, 40, 2, true, 0, false, () => player);
    for (let i = 0; i < 120 && g.hp === 5000; i++) m.fixedUpdate(1, hooks);
    expect(5000 - g.hp).toBeGreaterThan(0);   // ★通道在位（Y2 已落）
    expect(g.iframes).toBe(0);                // ★主判别:usesLocal 清窗档（旧通用档 10 必红）
  });

  it('C2 694 臂 :12636 共门：guide 窗内（iframes=10）→ hurt 整段不达（门拒位次判别）', () => {
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const e = Enemy.fromVanilla(15, 400 - 19, 552)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const g = guide(hooks, towns, 400, 552);
    g.iframes = 10;                           // 他源窗未清（:12636 immune[owner]>0）
    const hurtSpy = vi.spyOn(g, 'hurt');      // 门拒=hurt 整段不达（TownNPC.hurt :1419
    //  自带窗拒会遮蔽 outcome 面,hurt 调用计数=唯一可判别位）
    const m = new MinionProj(400 - 15, 600 - 15, 691, 40, 2, true, 0, false, () => player);
    for (let i = 0; i < 120; i++) m.fixedUpdate(1, hooks);
    expect(g.hp).toBe(5000);
    expect(hurtSpy).not.toHaveBeenCalled();   // ★主判别:共门在 skip 位整跳（旧无门必红）
  });

  it('C3 643 彩虹水晶 644 volley 城镇臂：guide 掉血+iframes=0（零写还原,旧 10 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // 落点散布 (0.5−0.5)×2k=0 → px=tgt 心
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player, added } = makeGame(list, towns);
    voodooOn(player);
    const e = Enemy.fromVanilla(15, 481, 581)!;      // fromVanilla=中心锚 → 心 (481,581)
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    // TownNPC ctor=（左,底）锚 → guide 盒心=(481,581)=volley 落点（14px 半宽 AoE 带内）
    const g = guide(hooks, towns, 481 - 9, 581);
    const m = new MinionProj(384, 584, 643, 50, 2, true, 0, false, () => player);
    // ★BJ703-F 夹具勘误（2026-10-21,存量红分诊=夹具病）：BJ639 批1②（2026-10-11）
    //  volley 实体化后 644=独立 RainbowCrystalBurst 实体（t=30 自爆 60×60 双臂），
    //  旧只驱 643 本体 = 爆弹永不引爆 → 城镇臂恒 0（BJ646/BJ650 登记红根因,同
    //  bj452 N3e/N3f 的 BJ662 tickUntilAll 修法）。本刀补全弹驱动。
    for (let i = 0; i < 120 && g.hp === 5000; i++) {
      m.fixedUpdate(1, hooks);
      const reg = (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles;
      for (const p of [...reg]) {
        (p as { fixedUpdate?: (dt: number, g: GameHooks) => void }).fixedUpdate?.(1, hooks);
      }
    }
    expect(added.length).toBeGreaterThanOrEqual(3);  // volley ≥1 轮 ×3 爆弹（通道在位）
    expect(5000 - g.hp).toBeGreaterThan(0);   // ★通道在位（Y2 已落）
    expect(g.iframes).toBe(0);                // ★主判别:零写还原清窗（旧通用档 10 必红）
  });

  it('C4 644 臂 :12636 共门：guide 窗内（iframes=10）→ hurt 整段不达（门拒位次判别）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const list: Enemy[] = [], towns: TownNPC[] = [];
    const { hooks, player } = makeGame(list, towns);
    voodooOn(player);
    const e = Enemy.fromVanilla(15, 481, 581)!;
    e.id = 1; e.maxHp = 500000; e.hp = 500000;
    list.push(e);
    const g = guide(hooks, towns, 481 - 9, 581);
    g.iframes = 10;
    const hurtSpy = vi.spyOn(g, 'hurt');      // 门拒=hurt 整段不达（同 C2 判别位）
    const m = new MinionProj(384, 584, 643, 50, 2, true, 0, false, () => player);
    // ★BJ703-F 夹具勘误（同 C3）：全弹驱动到引爆拍——负断言须有真弹爆炸做威胁
    //  才有判别力（旧只驱本体=恒零调用=守卫失明,「夹具喂幻影」判例）。
    for (let i = 0; i < 120; i++) {
      m.fixedUpdate(1, hooks);
      const reg = (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles;
      for (const p of [...reg]) {
        (p as { fixedUpdate?: (dt: number, g: GameHooks) => void }).fixedUpdate?.(1, hooks);
      }
    }
    expect(g.hp).toBe(5000);
    expect(hurtSpy).not.toHaveBeenCalled();   // ★主判别:共门在 skip 位整跳（旧无门必红）
  });
});
