// 缺失子系统补齐批回归（2026-09-01 T1+T2）：
//   T1 黄蜂枪 1155 全行为——出手侧 2-4 连发 volley（Player.cs:48809-48820）+
//      弹 189 aiStyle36 蜂族逐段（Arrow 追踪内核复用,homing-family-parity 同法）
//      + IDStatic 静态免疫组（SetDefaults :2777-2778 identity=type=189）+
//      撞块弹反（HandleMovement :19019-19030 蜂族四型）+ Hive Pack 双 +5
//      （Damage 面 :12855-12858/:12905-12907）。
//      ★定谳钉：Projectile.cs:13752-13760 OnHit 放蜂支受理门是 `type == 999`
//      = HiveFive 悠悠球弹（物品 5294），【非】黄蜂枪——189 命中侧无放蜂，
//      本文件以行为测试钉死该否证（弹命中敌后零伴生蜂）。
//   T2 旧世界跑酷指南 6190——SetDefaults（:47656-47660）无 useStyle/useTime/
//      accessory 数据面真值 + 全物品栏在场授予 equipStats.oldStyleParkour
//      （RefreshMechanicalAccsFromItemType :12933-12936）+ 右键 6190↔6195 快换
//      （Player.cs:31804-31808,仓内 Game.swapParkourBookVisual）依赖面。
//   ★蓝队六轮 F 批（2026-09-01,F1-F4）：
//     F1 6190↔6195 快换可达性——原版手势 = !controlUseItem（ItemCheck_ManageRightClick
//        Features flag :31765;releaseUseItem 与 controlUseItem 互反 :43160）：左键未按
//        时右键边沿才换型。仓内分派曾挂在 updateUse 左键分派链（左键早退门
//        !mouseDown&&!holdOk 之后）= 纯右键帧死支——已上移右键交互块（tile 交互分派
//        之后 = !tileInteractionHappened 语义,3384/3858 同位先例）,门配 !mouseHeld。
//     F2 1121 蜂枪双重乘区 + slowMagic 缺失——useCombatWeapon wrapper（Game.ts :13385/
//        :13389）已把词缀 ps.dmg×damageMult('magic')/ps.spd 折进 cw.damage/cw.useTime,
//        1121 支原再乘一遍（带伤词缀 +30% 量级偏差）；且 cycleCooldown 不吃
//        slowMagic×2.5（原版 ItemCheck_Shoot 尾段对 mana>0 && slowMagicUse 一律
//        ApplyItemTime(sItem, 2.5) :47594-47601,1121 魔法武器同吃）。改单次应用形
//        （1155 黄蜂枪支 cw.damage/cw.useTime 直取先例 :14065/:14074）。
//     F3 1155/1121 补 onManaItemUsed()（Player.cs:42131-42137 itemAnimation>0 &&
//        item.mana>0 → ItemCheck_ApplyManaRegenDelay 回蓝延迟钟窗;邻支 :14778 先例）
//        ——漏接 = 蜂枪连发期白嫖回蓝。
//     F4 ★设计登记（189 IDStatic 三跳,Arrow.ts 并行在飞 B6B 禁改,本文件先登记意图）：
//        189 SetDefaults（:2771-2781）usesIDStaticNPCImmunity + idStaticNPCHitCooldown=10
//        + penetrate=3——原版命中节奏 = 同一敌每 10t 可再结算一跳（贴身吃满 3 跳）。
//        原版命中写位（Projectile.cs:14031-14037 usesIDStaticNPCImmunity 支）：
//        `targetNPC.immune[owner] = 0` + `perIDStaticNPCImmunity[identity,i] =
//        GameUpdateCount + 10`——【自己打的 iframes 不拦自己】,再命中节拍只由组表管;
//        读门（:12635-12637）immune[owner]==0 对该族同样生效（外源伤害照旧拦）。
//        组键 = immunityIdentity（189 缺省 = type → 189;181/566 显式
//        UseGroupStaticImmunity(181) :2686/:6185 → 两型共用 181 一张表,齐扑同敌
//        不叠伤）。仓级偏差 = Arrow 通用穿透去重（Arrow.ts「修复1」注: pierceInit>=0
//        && hitSet.has(e.id) 永久去同敌重）对该族【越权】——idStaticCheck 组表
//        （10t 过期）已就位,再被 hitSet 永久去重 ⇒ 189/181/566 永远只结算 1 跳。
//        最小改法（待 B6B 落地后微批执行,报告移交段同步留档）：
//        ① 读侧：Arrow.ts 命中环 else 支 hitSet 去重对 idStaticGroup!==null 弹豁免
//          （`pierceInit>=0 && idStaticGroup===null && hitSet.has(e.id)`）——组表
//          idStaticCheck（按组键+敌id,10t 过期）即该族同敌再命中门,键形与 181/566
//          现有两键同形兼容,零新键空间;
//        ② 写侧：e.hurt() 成功后对 idStaticGroup!==null 弹清 e.iframes（= 原版
//          targetNPC.immune[owner]=0——只清自己这一跳造成的 iframes,外源 iframes
//          照旧拦,读门不豁免）。穿透经济学不变：每受理一跳照常 pierce--
//          （:14194-14196）,penetrate=3 → 单敌至多 3 跳、节拍 ≥10t。
//        ★落地（2026-09-01 微批,B6D 设计①②原文执行）：读侧 Arrow.ts 命中环 else 支
//          已改 `pierceInit>=0 && idStaticGroup===null && hitSet.has(e.id)`;写侧已在
//          e.hurt() 主结算点后补 `hurtOk && idStaticGroup!==null → e.iframes=0`（与
//          GC1 桥双域同相：桥管近战域 registry,此处清弹幕域读面）。行为级三跳断言
//          见下方「F4 落地」describe（节拍驱动=★G10 后 GTW tick 钉钟
//          pinGameTimeTicks——idStaticCheck 已墙钟→tick 钟,与原版 GameUpdateCount
//          计数同构;旧 Date.now 16.67ms/tick 推钟版随 G1 债②退役）。
import { describe, it, expect, vi } from 'vitest';
import { newWiresRadialState } from '../src/stats/wiresRadial';   // ★BJ662 桩族补齐（BJ626 newWiresRadialState 先例）
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player, refreshMechanicalAccsFromItemType } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { Arrow, AI_STYLE36_TRACK_PARAMS } from '../src/entities/Arrow';
import { pinGameTimeTicks } from '../src/core/GameTime';   // ★BJ704-G10（G1 债②）：idStaticCheck 墙钟→GTW tick 钟,驱动面随迁钉钟
import { projectileData } from '../src/data/vanillaProjectiles';
import { projClassOfProjId } from '../src/entities/projTargets';
import { itemCombat, combatWeapon } from '../src/data/vanillaItemCombat';
import { vanillaStatOfVid, isAnyAccessory } from '../src/data/vanillaItemStats';
import { ITEM_DEFS, ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, ITEM_ONLY_NEED_ONE_OVERRIDE } from '../src/data/items';
import { invIndexOfVanilla } from '../src/data/vanillaRecipes';
import { Game, waspGunVolleyRoll, waspGunHiveBonus } from '../src/core/Game';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const W = 200, H = 200;
function makeStore(): TileStore {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  return store;
}
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; wet?: boolean; dontTakeDamage?: boolean;
  iframes?: number;
  hurt: (d: number, kx: number, ky: number, g: GameHooks) => boolean;
  hits: number[];
}
function mkEnemy(id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy, hp: 100000, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
}
function makeHooks(enemies: MockEnemy[] = []) {
  const store = makeStore();
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: {
      store,
      get groundLevel() { return 80; },
    } as unknown as GameHooks['world'],
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
    spawnDust: (() => null) as never,
  };
  (hooks as unknown as { entities: { add: (e: unknown, b?: string) => void; projectiles: unknown[] } }).entities = {
    add: (e: unknown) => { added.push(e); },
    projectiles: [],
  };
  return { hooks, store, player, added };
}
const step = (p: Arrow, ticks: number, hooks: GameHooks): void => {
  for (let i = 0; i < ticks && !p.dead; i++) p.fixedUpdate(1, hooks);
};

describe('T1 黄蜂枪 1155：出手面（Player.cs:48809-48820）', () => {
  it('volley 掷骰 = Next(2,5)：三段位映射 2/3/4 且全域 ∈[2,4]', () => {
    expect(waspGunVolleyRoll(() => 0)).toBe(2);
    expect(waspGunVolleyRoll(() => 1 / 3)).toBe(3);
    expect(waspGunVolleyRoll(() => 2 / 3)).toBe(4);
    let min = 99, max = -1;
    for (let i = 0; i < 20000; i++) {
      const n = waspGunVolleyRoll(Math.random);
      min = Math.min(min, n); max = Math.max(max, n);
    }
    expect(min).toBe(2);
    expect(max).toBe(4);
  });

  it('Hive Pack 双 +5（:12855 穿甲 / :12905 终伤,暴击翻倍前）', () => {
    expect(waspGunHiveBonus(false)).toEqual({ dmg: 0, pen: 0 });
    expect(waspGunHiveBonus(true)).toEqual({ dmg: 5, pen: 5 });
  });

  it('物品 1155 数据面：auto 注册 + itemCombat 终值（Item.cs:14196-14212）', () => {
    expect(VANILLA_ITEM_KEY_BY_ID[1155]).toBe('vi_1155_WaspGun');
    const iid = ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[1155]];
    expect(ITEM_DEFS[iid]).toBeDefined();
    const c = itemCombat(1155)!;
    expect(c.damage).toBe(31);
    expect(c.mana).toBe(10);
    expect(c.useTime).toBe(18);
    expect(c.useAnimation).toBe(18);
    expect(c.shoot).toBe(189);
    expect(c.shootSpeed).toBe(9);
    expect(c.knockBack).toBeCloseTo(0.25, 5);
    expect(c.noMelee).toBe(true);
    expect(c.autoReuse).toBe(true);
    expect(c.magic).toBe(true);
  });
});

describe('T1 弹 189：数据面 + projClass 投影（SetDefaults :2771-2781）', () => {
  it('vanilla-projectiles 189 行逐值', () => {
    const pd = projectileData(189)!;
    expect(pd.aiStyle).toBe(36);
    expect(pd.width).toBe(8);
    expect(pd.height).toBe(8);
    expect(pd.penetrate).toBe(3);
    expect(pd.timeLeft).toBe(600);
    expect(pd.extraUpdates).toBe(3);
    expect(pd.armorPenetration).toBe(10);
    expect(pd.friendly).toBe(true);
    expect(pd.magic).toBe(true);
  });
  it('projClass 投影：189=magic（SetDefaults 直写）;181/566 仍 null（金标口径）', () => {
    expect(projClassOfProjId(189)).toBe('magic');
    expect(projClassOfProjId(181)).toBeNull();
    expect(projClassOfProjId(566)).toBeNull();
  });
  it('否证钉：189 无中毒/debuff 面（SetDefaults 无 buffType;projstatus 表无行）', () => {
    // 原版 189 SetDefaults（:2771-2781）无 buffType 赋值;Damage() 全链无 189
    // AddBuff 支——"黄蜂弹带毒"系任务稿误记，数据面 vanilla-projstatus.json
    // 无 189 行即真值投影。任一 AddBuff(20)（Poisoned）接线都将是凭空造面。
    const status = JSON.parse(readFileSync(join(__dirname, '../src/data/vanilla-projstatus.json'), 'utf8')) as Record<string, unknown>;
    expect(status['189']).toBeUndefined();
    expect((projectileData(189) ?? {}) as Record<string, unknown>).not.toHaveProperty('buffType');
  });
  it('IDStatic 静态免疫组：identity=type=189、cd 10t≈167ms（:2777-2778+P.cs:784）', () => {
    // ★F4 设计登记（2026-09-01,详见文件头 F4 段）：本断言钉的是【组表就位】面。
    //   原版三跳节奏 = usesIDStaticNPCImmunity+cd10+penetrate=3 → 同敌 10t 一跳、
    //   吃满 3 跳（命中写位 :14031-14037 immune[owner]=0+组表=count+10）。仓级
    //   Arrow hitSet（pierceInit>=0 永久去同敌重）曾越权把 189 压成 1 跳——
    //   ★两刀已随微批落地（读侧 hitSet 豁免 + 写侧 iframes 清零,键形=
    //   immunityIdentity 组键）,行为级三跳断言见下方「F4 落地」describe。
    const { hooks } = makeHooks();
    const wasp = new Arrow(60 * 16, 90 * 16, 9, 0, 31, 0.25, 189, { grav: 0 });
    expect(wasp.idStaticGroup).toBe(189);
    // ★G10（G1 债②）：字段随迁 idStaticCdTicks=10（原 167ms 墙钟基数退役）
    expect(wasp.idStaticCdTicks).toBe(10);
    // 181/566 共用组键 181（UseGroupStaticImmunity(181)）不与 189 互斥
    const bee = new Arrow(60 * 16, 90 * 16, 9, 0, 9, 1, 181, { grav: 0 });
    expect(bee.idStaticGroup).toBe(181);
    void hooks;
  });
});

// ==== F4 落地（2026-09-01 微批）：189 IDStatic 同敌三跳节拍（B6D 两刀行为面）====
//   读侧刀①：命中环 else 支 hitSet 永久去重对 idStaticGroup!==null 弹豁免——同敌
//   再命中门只归组表 idStaticCheck（组键+敌id,10t 过期,键空间=immunityIdentity 零新增）。
//   写侧刀②：e.hurt() 结算成功后清 e.iframes（=原版 targetNPC.immune[owner]=0
//   :14033-14036）——自己这跳设的 10t 帧不拦自己;外源 iframes 照旧被读门（:12635-37
//   同式,不豁免）拦。三跳判别器链：无刀① → 恒 1 跳（hitSet 越权）;无刀② → 敌侧
//   iframes=10 不衰减（桩不走 Enemy.fixedUpdate）→ 恒 1 跳（读门拦）。
describe('F4 落地：189 IDStatic 同敌三跳节拍（读侧豁免+写侧清帧）', () => {
  /** tick 钟：idStaticCheck 以 gameTickCount()（GTW 钟源=Main.GameUpdateCount 等价）
   *  节流——★BJ704-G10（G1 债②）墙钟 Date.now 版退役,驱动面随迁：clock.t 仍按
   *  ms 计步（1000/60=1t 恒速,调用体零改）,每写换算 tick 钉 pinGameTimeTicks
   *  （基值 60_000 偏移防与其它测试 0 档撞窗;bj209/bj274 钉钟判例）——组表 10t
   *  窗在 tick 刻度上过期,三跳节拍可观测（与原版 GameUpdateCount 计数同构）。 */
  function withTickClock(fn: (clock: { t: number }) => void): void {
    let ms = 1_000_000;
    const clock = {
      get t() { return ms; },
      set t(v: number) {
        ms = v;
        pinGameTimeTicks(60_000 + Math.round((v - 1_000_000) / (1000 / 60)));
      },
    };
    clock.t = 1_000_000;   // 初始钉
    try { fn(clock); } finally { pinGameTimeTicks(60_000 + Math.round((ms - 1_000_000) / (1000 / 60))); }
  }
  /** 真结算敌：hurt 置 10t iframes（=Enemy.hurt 通用档 :13152,pierce>1 支）——
   *  写侧刀②清帧的可观测载体（mkEnemy 桩不置帧,清帧面无从断言） */
  function mkRealEnemy(id: number, cx: number, cy: number, w: number, h: number): MockEnemy {
    const e = mkEnemy(id, cx, cy, w, h);
    e.hurt = (d: number) => { e.hp -= d; e.hits.push(d); e.iframes = 10; return true; };
    return e;
  }
  /** 巨敌盒：弹 40t 内不离盒（AI36 极速 9px/t）,命中节拍纯由组表管,几何噪声归零 */
  const BIG_W = 900, BIG_H = 400;
  const iframesOf = (e: MockEnemy): number => e.iframes ?? 0;

  it('同敌 10t 间隔三跳结算、穿透恰耗尽（penetrate=3 → 3 跳后消亡）', () => {
    const e = mkRealEnemy(21, 60 * 16, 90 * 16, BIG_W, BIG_H);
    const { hooks } = makeHooks([e]);
    const wasp = new Arrow(60 * 16, 90 * 16, 9, 0, 31, 0.25, 189, { grav: 0, life: 600 });
    expect(wasp.pierceInit).toBe(3);
    const hitTicks: number[] = [];
    // ★BJ731 改判史（2026-10-27）：0.99=无暴击但 DV 档 +15（31×1.15→36）——
    //   BJ723-B W01 起接触结算掷 :12970 DV。改 0.5=无暴击 ∧ DV tier 0 恒等档,
    //   实伤恒 31 语义保持。
    withRng(0.5, () => withTickClock((clock) => {
      for (let t = 1; t <= 60 && !wasp.dead; t++) {
        clock.t += 1000 / 60;
        wasp.fixedUpdate(1, hooks);
        if (e.hits.length > hitTicks.length) hitTicks.push(t);
      }
    }));
    expect(hitTicks).toHaveLength(3);                         // 贴身吃满 3 跳（任一刀缺席恒 1）
    expect(hitTicks[1] - hitTicks[0]).toBeGreaterThanOrEqual(10);   // 组表 10t 节拍
    expect(hitTicks[1] - hitTicks[0]).toBeLessThanOrEqual(12);      // 且窗过期即放行（非永久去重）
    expect(hitTicks[2] - hitTicks[1]).toBeGreaterThanOrEqual(10);
    expect(e.hits).toEqual([31, 31, 31]);
    expect(wasp.pierce).toBe(0);                              // 穿透恰耗尽（每受理一跳 pierce--）
    expect(wasp.dead).toBe(true);                             // 第三跳受理后通用消亡口
  });

  it('<10t 第二跳被组表拦（写侧清帧实证：拦门=组表,非 iframes;被拒跳不耗穿透）', () => {
    const e = mkRealEnemy(22, 60 * 16, 90 * 16, BIG_W, BIG_H);
    const { hooks } = makeHooks([e]);
    const w1 = new Arrow(60 * 16, 90 * 16, 9, 0, 31, 0.25, 189, { grav: 0, life: 600 });
    const w2 = new Arrow(60 * 16 + 20, 90 * 16, 9, 0, 31, 0.25, 189, { grav: 0, life: 600 });
    withRng(0.99, () => withTickClock((clock) => {
      for (let t = 1; t <= 8; t++) {                          // 窗内 8t：两弹同拍压敌
        clock.t += 1000 / 60;
        w1.fixedUpdate(1, hooks);
        w2.fixedUpdate(1, hooks);
      }
    }));
    expect(e.hits).toHaveLength(1);                           // 同组键窗内第二弹不叠伤
    expect(iframesOf(e)).toBe(0);                             // 刀②已清（若非 0,拦门归因不成立）
    expect(w1.pierce).toBe(2);                                // 受理跳照常 pierce--
    expect(w2.pierce).toBe(3);                                // 被拒跳穿透不动（continue 早退）
    withRng(0.99, () => withTickClock((clock) => {
      clock.t += (1000 / 60) * 12;                            // 推过 10t 窗
      w2.fixedUpdate(1, hooks);
    }));
    expect(e.hits).toHaveLength(2);                           // 窗过期后第二跳受理（原语义）
  });

  it('181/566 组回归：两型共用组键 181,窗内跨实例只结算一颗;成功跳不漏清帧', () => {
    const e = mkRealEnemy(23, 60 * 16, 90 * 16, BIG_W, BIG_H);
    const { hooks } = makeHooks([e]);
    const bee = new Arrow(60 * 16, 90 * 16, 9, 0, 9, 1, 181, { grav: 0, life: 600, pierce: 3 });
    const hornet = new Arrow(60 * 16 + 20, 90 * 16, 9, 0, 9, 1, 566, { grav: 0, life: 660, pierce: 4 });
    expect(bee.idStaticGroup).toBe(181);
    expect(hornet.idStaticGroup).toBe(181);                   // 两键共用一张表
    withRng(0.99, () => withTickClock((clock) => {
      for (let t = 1; t <= 8; t++) {
        clock.t += 1000 / 60;
        bee.fixedUpdate(1, hooks);
        hornet.fixedUpdate(1, hooks);
      }
    }));
    expect(e.hits).toHaveLength(1);                           // 表级共享窗内第二蜂不结算
    expect(iframesOf(e)).toBe(0);                             // 成功跳写侧清帧（181 组同享刀②）
    expect(hornet.pierce).toBe(4);                            // 被拒跳不耗穿透
    withRng(0.99, () => withTickClock((clock) => {
      clock.t += (1000 / 60) * 12;
      hornet.fixedUpdate(1, hooks);
    }));
    expect(e.hits).toHaveLength(2);                           // 窗过期后照常受理
    expect(hornet.pierce).toBe(3);                            // 受理跳 pierce--
  });
});

describe('T1 弹 189：aiStyle36 蜂族 AI 逐段（1457 :27683-27862）', () => {
  it('逐型参数 189=[9,0.2]（:27795-27798）', () => {
    expect(AI_STYLE36_TRACK_PARAMS[189]).toEqual([9, 0.2]);
  });
  it('30 update 索敌延迟后逐轴转向收敛（:27761-27764+:27823-27862）', () => {
    const e2 = mkEnemy(2, 60 * 16 - 200, 90 * 16 + 100);
    const { hooks: h2 } = makeHooks([e2]);
    const wasp = new Arrow(60 * 16, 90 * 16, -9, 0, 31, 0.25, 189, { grav: 0 });
    step(wasp, 60, h2);
    expect(wasp.dead).toBe(false);
    expect(wasp.vy).toBeGreaterThan(0);      // 延迟后朝左下敌折线转向
  });
  it('800 曼哈顿门（:27772）：远敌不锁 → 保持直飞', () => {
    const far = mkEnemy(3, 60 * 16 - 1000, 90 * 16);
    const { hooks: hFar } = makeHooks([far]);
    const wasp = new Arrow(60 * 16, 90 * 16, -9, 0, 31, 0.25, 189, { grav: 0 });
    step(wasp, 80, hFar);
    expect(wasp.dead).toBe(false);
    expect(wasp.vy).toBe(0);
  });
  it('入水消亡（:27685-27688）/ 蜂蜜豁免', () => {
    const e = mkEnemy(1, 60 * 16 + 100, 90 * 16);
    const { hooks, store } = makeHooks([e]);
    const tx = 60, ty = 90;
    store.liquid[store.idx(tx, ty)] = 200;
    store.liquidType[store.idx(tx, ty)] = 1;   // WATER（LIQUID_TYPE +1 编码）
    const wasp = new Arrow(tx * 16, ty * 16, 9, 0, 31, 0.25, 189, { grav: 0 });
    wasp.fixedUpdate(1, hooks);
    expect(wasp.dead).toBe(true);
    store.liquidType[store.idx(tx, ty)] = 3;   // HONEY 豁免（!honeyWet 门）
    const wasp2 = new Arrow(tx * 16, ty * 16, 9, 0, 31, 0.25, 189, { grav: 0 });
    wasp2.fixedUpdate(1, hooks);
    expect(wasp2.dead).toBe(false);
  });
});

describe('T1 弹 189：撞块弹反（HandleMovement :19019-19030 蜂族四型）', () => {
  it('penetrate>0 撞实心块不消亡：pierce-- + 主轴全速反号', () => {
    const { hooks, store } = makeHooks();
    for (let y = 88; y <= 92; y++) store.setTile(70, y, 1);   // 竖墙
    const wasp = new Arrow(66 * 16, 90 * 16, 9, 0, 31, 0.25, 189, { grav: 0, life: 600 });
    step(wasp, 12, hooks);
    expect(wasp.dead).toBe(false);
    expect(wasp.pierce).toBe(2);            // 3→2（命中侧/撞侧共用同一计数）
    expect(wasp.vx).toBeLessThan(0);        // 反号弹回
  });
  it('pierce 归零后不再弹反 → 通用消亡口（原版 penetrate>0 门反面）', () => {
    const { hooks, store } = makeHooks();
    for (let y = 88; y <= 92; y++) store.setTile(70, y, 1);
    const wasp = new Arrow(66 * 16, 90 * 16, 9, 0, 31, 0.25, 189, { grav: 0, life: 600 });
    // 人工压穿透=1：一次弹反耗尽后再次撞墙必死
    wasp.pierce = 1;
    wasp.pierceInit = 1;
    step(wasp, 12, hooks);
    expect(wasp.pierce).toBe(0);
    expect(wasp.dead).toBe(false);          // 第一次撞块弹反存活
    step(wasp, 200, hooks);                 // 折回再撞（或飞行耗尽前）撞墙 → 消亡
    expect(wasp.dead).toBe(true);
  });
});

describe('T1 否证钉：189 命中侧无放蜂（999 陷阱拆除）', () => {
  it('弹命中敌后零伴生蜂（Projectile.cs:13752 支 type==999=HiveFive 非黄蜂枪）', () => {
    const e = mkEnemy(1, 60 * 16 + 40, 90 * 16);
    const { hooks, added } = makeHooks([e]);
    const wasp = new Arrow(60 * 16, 90 * 16, 9, 0, 31, 0.25, 189, { grav: 0, life: 600 });
    step(wasp, 30, hooks);
    expect(e.hits.length).toBeGreaterThan(0);   // 已结算命中
    const bees = added.filter((a) => a instanceof Arrow
      && [181, 566, 189].includes((a as Arrow).projId));
    expect(bees.length).toBe(0);                // 无任何伴生蜂生成
  });
});

describe('T2 旧世界跑酷指南 6190：SetDefaults 真值 + 生效链', () => {
  it('数据面：auto 注册 + value 350000（sellPrice(0,7)×5 :47657）+ rare 10', () => {
    expect(VANILLA_ITEM_KEY_BY_ID[6190]).toBe('vi_6190_OldStyleParkourBook');
    expect(VANILLA_ITEM_KEY_BY_ID[6195]).toBe('vi_6195_OldStyleParkourBookInactive');
    const iid = ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[6190]];
    expect(ITEM_DEFS[iid].value).toBe(350000);
    // rare 走 vanilla-itemrare（SetShopValues(ItemRarityColor.StrongRed10)）
    const rare = JSON.parse(readFileSync(join(__dirname, '../src/data/vanilla-itemrare.json'), 'utf8')) as Record<string, number>;
    expect(rare['6190']).toBe(10);
    expect(rare['6195']).toBe(10);
  });
  it('非配饰真值（:47656-47660 无 accessory;不在 ACC_STATS_1457）', () => {
    expect(vanillaStatOfVid(6190)).toBeNull();
    expect(vanillaStatOfVid(6195)).toBeNull();
    const iid = ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[6190]];
    expect(isAnyAccessory(iid)).toBe(false);
    // 无使用面：itemCombat 无条目 = 无 useStyle/useTime/useAnimation/shoot
    expect(itemCombat(6190)).toBeNull();
  });
  it('在场授予：refreshMechanicalAccsFromItemType(6190) → oldStyleParkour（:12933）', () => {
    const mk = () => ({ mechShowWires: false, autoActuator: false, autoPaint: false,
      dontHurtCritters: false, preventAllItemPickups: false, hasLucyTheAxe: false,
      oldStyleParkour: false });
    const f1 = mk();
    refreshMechanicalAccsFromItemType(f1, 6190);
    expect(f1.oldStyleParkour).toBe(true);
    const f2 = mk();
    refreshMechanicalAccsFromItemType(f2, 6195);   // 未激活态不授予
    expect(f2.oldStyleParkour).toBe(false);
  });
  it('右键快换依赖面：两型 def 可解析 + EmergencyStacking 覆写表已含（:47878）', () => {
    expect(invIndexOfVanilla(6190)).toBeGreaterThanOrEqual(0);
    expect(invIndexOfVanilla(6195)).toBeGreaterThanOrEqual(0);
    expect(ITEM_ONLY_NEED_ONE_OVERRIDE[6190]).toBe(true);
    expect(ITEM_ONLY_NEED_ONE_OVERRIDE[6195]).toBe(true);
  });
  it('l10n：ItemTooltip 两键已入产物（zh-Hans 真值 / en-US 真值）', () => {
    for (const loc of ['zh-Hans', 'en-US']) {
      const l = JSON.parse(readFileSync(join(__dirname, `../public/l10n/${loc}.json`), 'utf8')) as Record<string, Record<string, string>>;
      const it16 = l.ItemTooltip ?? {};
      expect(it16.OldStyleParkourBook, `${loc} active tooltip`).toBeTruthy();
      expect(it16.OldStyleParkourBookInactive, `${loc} inactive tooltip`).toBeTruthy();
      // 键名走原版 Pascal 键（ItemTooltip.OldStyleParkourBook）
      expect((l.ItemName ?? {}).OldStyleParkourBook).toBeTruthy();
    }
  });
});

// ==== 蓝队六轮 F 批（2026-09-01）====
//   F2/F3 走 useCombatWeapon 真链（Object.create(Game.prototype) 最小桩——词缀折叠
//   wrapper 与 1121/1155 专支全是真代码,只旁路挥击/音效/锚点渲染面）；
//   F1 走 updateUse 真链（右键交互块手势面）。

/** 掷骰确定性：固定 Math.random（0.25 下 1121 nBee=1/普蜂 +0、1155 nWasp=2） */
function withRng<T>(value: number, fn: () => T): T {
  const spy = vi.spyOn(Math, 'random').mockReturnValue(value);
  try { return fn(); } finally { spy.mockRestore(); }
}

/** useCombatWeapon 最小桩（1121/1155 魔法支）：heldPrefixStat 走【真实现】
 *  （读槽位 prefix → prefixStat 表）——词缀折叠 wrapper 不桩,单次应用形才可验 */
function magicGame(vid: number, o?: { prefix?: number; mana?: number }) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  // ★BJ662（2026-10-12）updateUse 头 tickWiresRadial（BJ572）读 this.wiresRadial——Object.create 壳无构造器字段 → flowerUpdate(st=undefined) TypeError（存量桩族缺件,持物非 wire 工具走早退支,桩仅为通路）
  (g as unknown as { wiresRadial: unknown }).wiresRadial = newWiresRadialState();
  const player = new Player(50 * TILE, 90 * TILE, new Inventory());
  const iid = ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[vid]];
  player.inv.add(iid, 1);
  // 词缀直写槽位（inv.add 的 fillRange 空槽支不带 prefix——与被测链无关,heldPrefixStat
  // 真实现读槽位 prefix → prefixStat 表,词缀折叠 wrapper 照真跑）
  if (o?.prefix) player.inv.heldItem()!.prefix = o.prefix;
  player.mana = o?.mana ?? 100;
  const added: unknown[] = [];
  g.player = player;
  g.entities = { add: (e: unknown) => { added.push(e); }, projectiles: [] };
  g.input = { mouseDown: true, mouseHeld: true, rightDown: false, mouseX: 700, mouseY: 300, uiBlocking: false };
  g.camera = { screenToWorld: () => [800, 0] };
  g.sfx = { play: () => {}, playWavFile: () => true, playFiles: () => true };
  g.achievements = { handleSpecialEvent: () => {} };
  g.cb = { onInventoryChanged: () => {}, onToast: () => {} };
  g.swing = null;                       // 动画不在途（TAIL_SILENCE 门旁路）
  g.mining = null;
  g.world = { store: { get: () => 0 } };
  g.useSwing = () => {};                // 挥击旁路（本批只验出手/冷却/钟窗）
  g.playUseSound = () => {};            // 音效旁路
  g.resolveShotAnchor = (_k: string, ang: number) =>
    ({ x: player.cx + Math.cos(ang) * 18, y: player.cy + Math.sin(ang) * 18 });
  return { g, player, added };
}

function fireCombatWeapon(g: Record<string, unknown>, vid: number): void {
  const def = ITEM_DEFS[ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[vid]]];
  (g as unknown as { useCombatWeapon: (cw: unknown, def: unknown) => void })
    .useCombatWeapon(combatWeapon(def), def);
}

describe('F2 蜂枪 1121 单次应用形（wrapper 折叠后直取 = Player.cs:48797 beeDamage(Damage)）', () => {
  it('无词缀：单蜂 9 伤 / useTime 12 / 耗魔 5（基线不变式）', () => {
    const { g, player, added } = magicGame(1121);
    withRng(0.25, () => fireCombatWeapon(g, 1121));
    expect(added).toHaveLength(1);                    // nBee=1（Next(1,4)=1、两 Next(6)≠0）
    const bee = added[0] as Arrow;
    expect(bee.projId).toBe(181);
    expect(bee.damage).toBe(9);                       // cw.damage=round(9×1×1) 直取
    expect(player.mana).toBe(95);                     // cwCost=5
    expect(player.useTime).toBe(12);                  // getSlowMagicUseTime 透传（不空蓝）
    expect(player.slowMagicUse).toBe(false);
  });

  it('Mythical(83)：蜂伤 10 单次应用——旧双乘 12 作反证钉', () => {
    const { g, player, added } = magicGame(1121, { prefix: 83 });
    withRng(0.25, () => fireCombatWeapon(g, 1121));
    const bee = added[0] as Arrow;
    // wrapper round(9×1.15)=10 → 专支直取 10；旧码再乘 = round(10×1.15)=12
    expect(bee.damage).toBe(10);
    expect(bee.damage).not.toBe(12);
    // useTime：wrapper round(12×0.9)=11 → 直取 11；旧码再乘 = round(11×0.9)=10
    expect(player.useTime).toBe(11);
    expect(player.useTime).not.toBe(10);
  });

  it('空蓝 slowMagic：useTime ×2.5（ApplyItemTime(sItem,2.5) :47594-47601）——旧值 12 反证钉', () => {
    const { g, player } = magicGame(1121, { mana: 2 });
    withRng(0.25, () => fireCombatWeapon(g, 1121));
    expect(player.mana).toBe(0);                      // statMana=0（:53243）
    expect(player.slowMagicUse).toBe(true);           // DoRunOutOfManaEffect（:53258-53261）
    expect(player.useTime).toBe(30);                  // floor(2.5×12)
    expect(player.useTime).not.toBe(12);              // 旧码 cycleCooldown 不吃 slowMagic
  });
});

describe('F3 onManaItemUsed 回蓝延迟钟窗（Player.cs:42131-42137,邻支 Game.ts :14778 先例）', () => {
  it('1121：manaAnimTicks = useTime（漏接时恒 0 = 连发期白嫖回蓝）', () => {
    const { g, player } = magicGame(1121);
    withRng(0.25, () => fireCombatWeapon(g, 1121));
    expect(player.useTime).toBe(12);
    expect(player.manaAnimTicks).toBe(12);
  });
  it('1155：manaAnimTicks = useTime（空蓝 ×2.5 同式折入）', () => {
    const { g, player } = magicGame(1155, { mana: 2 });
    withRng(0.25, () => fireCombatWeapon(g, 1155));
    expect(player.slowMagicUse).toBe(true);
    expect(player.useTime).toBe(45);                  // floor(2.5×18)
    expect(player.manaAnimTicks).toBe(45);
  });
});

describe('F2/F3 黄蜂枪 1155 出手链单次应用形（Player.cs:48809-48820）', () => {
  it('无词缀：2 蜂 31 伤 / useTime 18 / 耗魔 10 / 弹 189', () => {
    const { g, player, added } = magicGame(1155);
    withRng(0.25, () => fireCombatWeapon(g, 1155));
    expect(added).toHaveLength(2);                    // Next(2,5) 首掷 0.25 → 2
    for (const w of added) {
      expect((w as Arrow).projId).toBe(189);
      expect((w as Arrow).damage).toBe(31);           // cw.damage 直取（无 Hive Pack）
    }
    expect(player.mana).toBe(90);
    expect(player.useTime).toBe(18);
  });
  it('Mythical(83)：蜂伤 36 单次应用（旧双乘 41 作反证钉）/ useTime 16', () => {
    const { g, added } = magicGame(1155, { prefix: 83 });
    withRng(0.25, () => fireCombatWeapon(g, 1155));
    expect((added[0] as Arrow).damage).toBe(36);      // round(31×1.15)=35.65→36
    expect((added[0] as Arrow).damage).not.toBe(41);  // round(36×1.15)=41.4→41（旧双乘面）
    expect((g.player as Player).useTime).toBe(16);    // wrapper round(18×0.9)=16.2→16
  });
});

/** updateUse 最小桩（6190/6195 右键快换手势面）：右键交互块全链可达 */
function parkourGame(vid: 6190 | 6195, input: Record<string, unknown>, prevRightDown = false) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  // ★BJ662（2026-10-12）updateUse 头 tickWiresRadial（BJ572）读 this.wiresRadial——Object.create 壳无构造器字段 → flowerUpdate(st=undefined) TypeError（存量桩族缺件,持物非 wire 工具走早退支,桩仅为通路）
  (g as unknown as { wiresRadial: unknown }).wiresRadial = newWiresRadialState();
  const player = new Player(50 * TILE, 90 * TILE, new Inventory());
  // SW-FX46 重锚（2026-09-12）：手持物直写热栏槽 0（magicGame :446 同法先例）。
  // ★定谳：原 `inv.add(...)` 曾落热栏系旧 ③ 空格支升序臂（0..49）把 6837 落槽 0;
  //   SW-BN5（2026-09-08,Inventory.fillBagArms 三臂化 1:1）后非收藏件改降序臂,
  //   且热栏空格臂被 useStyle!==0 门控（Player.cs GetItem :39671-39680 门面
  //   `!isACoin && useStyle != 0`——6190 SetDefaults :47656-47660 无 useStyle →
  //   itemUseStyleOf=0,原版捡起同样不落热栏）→ 6837 实落槽 49,heldItem()=null,
  //   F1 四用例齐读 null.id。生产落位 1:1 无罪,壳陈旧——快换面被测的是「热栏
  //   持物右键互换」,直写槽位即被测手势的真起点。
  player.inv.slots[0] = { id: invIndexOfVanilla(vid), stack: 1 };
  g.player = player;
  g.entities = { add: () => {}, projectiles: [], npcs: [], critters: [], enemies: [] };
  g.input = { mouseDown: false, mouseHeld: false, rightDown: true, mouseX: 700, mouseY: 300,
    uiBlocking: false, downAction: () => false, ...input };
  g.camera = { tileUnder: () => [60, 60], screenToWorld: () => [800, 0] };
  g.renderer = { canvas: { width: 800, height: 600 }, fullMap: { open: false },
    timeUiHover: false, weatherUiHover: false };
  g.smartCursor = { showing: false };
  g.annotateMode = false;
  g.mining = null;
  g.housingMode = null;
  g.recallChannel = null;
  g.golfWhistleAt = null;
  g.minecart = null;
  g.cartKeyLatch = false;
  g.swing = null;
  g._prevMouseDown = false;
  g._prevRightDown = prevRightDown;
  g.world = { store: { get: () => 0 }, flags: {} };
  g.tryFaceHeldAim = () => {};
  g.itemFuncTool = () => undefined;
  g.inTileRange = () => false;
  g.findChestNear = () => null;
  g.talkToNearbyNpc = () => false;
  g.interactAt = () => {};
  g.sfx = { play: () => {}, playWavFile: () => true, playFiles: () => true };
  g.achievements = { handleSpecialEvent: () => {} };
  g.cb = { onInventoryChanged: () => {}, onToast: () => {} };
  return { g, player };
}

const runUse = (g: Record<string, unknown>): void =>
  (g as unknown as { updateUse: (dt: number) => void }).updateUse(1 / 60);

describe('F1 6190↔6195 快换可达性（原版手势 !controlUseItem,Player.cs:31765/:31804-31808）', () => {
  it('纯右键帧：手持 6190 右键边沿 → 换 6195 + 吞边沿（:31844 mouseRightRelease=false）', () => {
    const { g, player } = parkourGame(6190, {});
    runUse(g);
    expect(player.inv.heldItem()!.id).toBe(invIndexOfVanilla(6195));
    expect((g.input as { rightDown: boolean }).rightDown).toBe(false);
  });
  it('手持 6195 → 换回 6190（快换表双向）', () => {
    const { g, player } = parkourGame(6195, {});
    runUse(g);
    expect(player.inv.heldItem()!.id).toBe(invIndexOfVanilla(6190));
  });
  it('按住左键期间点右键：不换型（原版排除态 !controlUseItem,:43160 releaseUseItem 同源）', () => {
    const { g, player } = parkourGame(6190, { mouseHeld: true });
    runUse(g);
    expect(player.inv.heldItem()!.id).toBe(invIndexOfVanilla(6190));
    expect((g.input as { rightDown: boolean }).rightDown).toBe(true);   // 未吞边沿
  });
  it('右键非边沿帧（mouseRightRelease 已假,6190 不在 ItemsThatAllowRepeatedRightClick）：不换型', () => {
    const { g, player } = parkourGame(6190, {}, true);
    runUse(g);
    expect(player.inv.heldItem()!.id).toBe(invIndexOfVanilla(6190));
  });
});

// =====================================================================
// M3 HiveFive 999 每击 1/3 放蜂（Projectile.cs:13752-13760，P4 遗留清偿 2026-09-02）
//   原式：type==999 && owner==Main.myPlayer && Next(3)==0 →
//     NewProjectile(Center, (Center−target.Center).SafeNormalize(Zero)×0.25,
//                   player.beeType(), player.beeDamage(damage/2), player.beeKB(kb), owner)
//     + 落桶后 `.melee = true` 覆写（Z-F1 槽 = Arrow.projClass 实例字段）
//   ★无 ai[0] 门（545 支的 ai[0]!=-2 门在其后一块）——回收/脱离态命中同享放蜂
// =====================================================================
import { YoyoProj } from '../src/entities/WeaponProj';

describe('M3 HiveFive 999：YoyoProj 命中链放蜂 proc（Projectile.cs:13752-13760）', () => {
  function mkYoyo(projId: number, cx = 2000, cy = 2000): YoyoProj {
    const y = new YoyoProj(cx - 8, cy - 8, 30, 2, projId, 200, () => true, () => ({ x: 0, y: 0 }));
    return y;
  }

  it('掷中（Next(3)==0）：背敌向 ×0.25 出蜂,伤 = trunc(damage/2),球心出生', () => {
    const y = mkYoyo(999, 2000, 2000);                    // 中心 (2000,2000),damage 30
    const e = mkEnemy(1, 2040, 2000);                     // 敌心在球心 +40x → 蜂速 (-0.25, 0)
    const { hooks } = makeHooks([e]);
    const bees: Array<{ x: number; y: number; vx: number; vy: number; dmg: number; kb: number }> = [];
    y.spawnBee = (x, yy, vx, vy, dmg, kb) => bees.push({ x, y: yy, vx, vy, dmg, kb });
    withRng(0, () => (y as unknown as { onYoyoHit: (e: unknown, g: GameHooks) => void }).onYoyoHit(e, hooks));
    expect(bees).toHaveLength(1);
    expect(bees[0]).toEqual({ x: 2000, y: 2000, vx: -0.25, vy: 0, dmg: 15, kb: 2 });
  });

  it('零距档：SafeNormalize(Zero)=零向量 → 零速出蜂（原版 SafeNormalize(Vector2.Zero)）', () => {
    const y = mkYoyo(999, 2000, 2000);
    const e = mkEnemy(1, 2000, 2000);                     // 球心=敌心
    const { hooks } = makeHooks([e]);
    const bees: Array<{ vx: number; vy: number }> = [];
    y.spawnBee = (x, yy, vx, vy) => bees.push({ vx, vy });
    withRng(0, () => (y as unknown as { onYoyoHit: (e: unknown, g: GameHooks) => void }).onYoyoHit(e, hooks));
    expect(bees).toHaveLength(1);
    expect(bees[0].vx).toBe(0);
    expect(bees[0].vy).toBe(0);
  });

  it('掷不中（Next(3)!=0）：无伴生蜂', () => {
    const y = mkYoyo(999);
    const e = mkEnemy(1, 2040, 2000);
    const { hooks } = makeHooks([e]);
    const bees: unknown[] = [];
    y.spawnBee = () => bees.push(1);
    withRng(0.999, () => (y as unknown as { onYoyoHit: (e: unknown, g: GameHooks) => void }).onYoyoHit(e, hooks));
    expect(bees).toHaveLength(0);
  });

  it('型号门：非 999 悠悠球（545 Cascade）同命中面零放蜂', () => {
    const y = mkYoyo(545);
    const e = mkEnemy(1, 2040, 2000);
    const { hooks } = makeHooks([e]);
    const bees: unknown[] = [];
    y.spawnBee = () => bees.push(1);
    withRng(0, () => (y as unknown as { onYoyoHit: (e: unknown, g: GameHooks) => void }).onYoyoHit(e, hooks));
    expect(bees).toHaveLength(0);
  });

  it('无 ai[0] 门：脱离态（ai0=-2）命中同样放蜂（545 支的排除门不在 999 支）', () => {
    const y = mkYoyo(999);
    y.ai0 = -2;
    const e = mkEnemy(1, 2040, 2000);
    const { hooks } = makeHooks([e]);
    const bees: unknown[] = [];
    y.spawnBee = () => bees.push(1);
    withRng(0, () => (y as unknown as { onYoyoHit: (e: unknown, g: GameHooks) => void }).onYoyoHit(e, hooks));
    expect(bees).toHaveLength(1);
  });
});

describe('M3 HiveFive 999：Game.spawnBee 落桶三链（Player.cs:12506-12531 + :13759 melee 覆写）', () => {
  function beeGame(strongBees: boolean) {
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    // ★BJ662（2026-10-12）updateUse 头 tickWiresRadial（BJ572）读 this.wiresRadial——Object.create 壳无构造器字段 → flowerUpdate(st=undefined) TypeError（存量桩族缺件,持物非 wire 工具走早退支,桩仅为通路）
    (g as unknown as { wiresRadial: unknown }).wiresRadial = newWiresRadialState();
    const player = new Player(50 * TILE, 90 * TILE, new Inventory());
    if (strongBees) {
      // 蜂巢背包 3333 走真装备链（equipStats 为计算 getter,不可直写——r30r31 ⑤ 同法）
      player.inv.armor[3] = { id: invIndexOfVanilla(3333), stack: 1 };
    }
    const added: Array<{ bucket?: string }> = [];
    g.player = player;
    g.entities = { add: (e: unknown, b?: string) => { added.push(Object.assign(e as object, { bucket: b })); }, projectiles: [] };
    const y = new YoyoProj(100, 100, 30, 2, 999, 200, () => true, () => ({ x: 0, y: 0 }));
    (g as unknown as { wireYoyoCallbacks: (y: YoyoProj, id: number) => void }).wireYoyoCallbacks(y, 999);
    return { g, player, added, y };
  }

  it('普蜂档：弹 181 / 伤 dmg+Next(2) / kb 原值 / melee 旗 + 近战暴击池 + 穿甲池', () => {
    const { player, added, y } = beeGame(false);
    withRng(0.4, () => y.spawnBee!(100, 100, 0.25, 0, 12, 2));   // 0.4×2=floor 0 → 普蜂伤 +0
    expect(added).toHaveLength(1);
    const bee = added[0] as unknown as Arrow & { bucket?: string };
    expect(bee.bucket).toBe('projectiles');
    expect(bee.projId).toBe(181);
    expect(bee.damage).toBe(12);                                 // 12+floor(0.4×2)=12+0
    expect(bee.knockback).toBe(2);                               // 普蜂 kb 原值
    expect(bee.projClass).toBe('melee');                         // :13759 spawn 位覆写
    expect(bee.critChance).toBeCloseTo(Math.min(1, (4 + player.critChance('melee')) / 100), 10);
    expect(bee.armorPen).toBe(player.equipStats.armorPen + player.meleeArmorPen);
  });

  it('强蜂档（strongBees）：掷 0 → 弹 566 / 伤 dmg+1 / kb 0.5+KB×1.1', () => {
    const { added, y } = beeGame(true);
    withRng(0, () => y.spawnBee!(100, 100, 0, 0.25, 12, 2));     // 首掷 Next(2)=0 中强蜂
    const bee = added[0] as unknown as Arrow;
    expect(bee.projId).toBe(566);
    expect(bee.damage).toBe(13);                                 // 12 + Next(1,4)=1（掷 0）
    expect(bee.knockback).toBeCloseTo(0.5 + 2 * 1.1, 10);
    expect(bee.projClass).toBe('melee');
  });

  it('普蜂伤 +1 档（Next(2)=1）：掷 0.5 → floor(1)', () => {
    const { added, y } = beeGame(false);
    withRng(0.5, () => y.spawnBee!(100, 100, 0, 0, 12, 2));      // floor(0.5×2)=1
    expect((added[0] as unknown as Arrow).damage).toBe(13);
  });
});
