/**
 * ★BJ750-A 2026-11-01 issue#38 §二「入住（Town NPC）域」九项定谳回归锁。
 *
 * 逐项定谳（反编译 1457 亲读；1458 同位零漂移——本 issue 自述行号系另一 dump,
 * 锚以本仓 Terarria1457/ 为准）：
 *  ⑧ 晶塔上架：Chest.SetupShop 尾段（Chest.cs:3461-3533）——门 = 商店索引非
 *    {19 旅行商,20 骷髅商,21 酒保}（NPCInteractions.cs:489-513 槽位映射;本仓投影
 *    = vid 368/453/550）∧ DoesPositionHaveEnoughNPCs(2, 玩家中心)（TeleportPylons
 *    System.cs:224-247:isLikeATownNPC ∧ !homeless ∧ 家在 169×124 窗内 ∧ 现位距家
 *    <100 格）∧ 玩家非腐化/猩红。群系→塔 id（ItemID.cs:11296-11388 逐值核对,
 *    ★issue 自述表「4876 通用/4875 万象/4916 森林/4917 雪/4918 沙漠/4919 丛林/
 *    4920 蘑菇/4921 海洋」系误记,反编译真值 = 4876 纯净森林/4875 丛林/4916 神圣/
 *    4917 洞穴/4918 海洋/4919 沙漠/4920 雪原/4921 蘑菇/5652 地狱;4951 万能塔非
 *    环境店货=图鉴 100% 动物学家店专属）。价 = buyPrice(0,10)=10 金（Item.cs
 *    :39690-39696）。【本仓 R14-C4（红队 r14 P0,2026-08-12 蓝队清偿）已实装
 *    Game.ts 晶塔尾段——issue 运行时观察系 v0.1.82-beta 线上旧构建;本文件补
 *    行为锁（此前零测试锁该段）+排除集/窗口门/群系映射/高价钉值】
 *  ⑨ 护士：SpawnAllowed_Nurse（NPC.cs:7185-7199）`player.statLifeMax / 20 > 5`
 *    ——statLifeMax=生命水晶基础上限（Player.cs:1907）,statLifeMax2（:1909）才含
 *    生命力药水/buffs.healthBonus/mod 百分比。本仓投影 = Player.baseMaxHp。
 *  ⑩ 派对女孩：flag7 = flag6(1/40 掷) && num40>=20;`if (NPC.unlockedPartyGirl
 *    Spawn) flag7 = true;`（Main.cs:66768-66776）——解锁旗绕过 20 人门（双消费位
 *    townNPCCanSpawn[208] :66790-66791 与 num42 链 :67004-67006）。
 *  ⑪ 公主：flag9 全员集合后 `if (NPC.unlockedPrincessSpawn) flag9 = true;`
 *    （Main.cs:66933-66936）——到访旗（WorldGen.cs:5525 随档;本仓 ARRIVE_UNLOCK
 *    _FLAG 写面原在）读面此前缺失 → 死后缺任一 NPC 即不归。
 *  ⑫ 爆破专家：ItemID.Sets.ItemsThatCountAsBombsForDemolitionistToSpawn
 *    （ItemID.cs:68,21 件 vid 全集）+ `item.stack > 0`（NPC.cs:7110）。453 炸弹
 *    雕像不在集合（旧表误计）。
 *  ⑬ 入驻轮间隔：UpdateTime_SpawnTownNPCs 头门（Main.cs:66521-66533）
 *    `worldUpdateRate<=0 return; checkForSpawns++; if (checkForSpawns <
 *    7200 / worldUpdateRate) return;` = 间隔 ceil(7200/rate) tick;rate=
 *    GetWorldUpdateRate（WorldGen.cs:72594-72603,快进 1/冻结 0/否则帽 24）。
 *  ⑭ 种子前置覆盖：`if (num42==0 && infectedSeed && num4<1) num42=20; if (num42==0
 *    && vampireSeed && !infectedSeed && num27<1) num42=633;`（Main.cs:66934-66941）
 *    ——在 guide 22 之前的链最前端。
 *  ⑮ 计数域门：计数环头 `if (npc[k].active && npc[k].townNPC)`（Main.cs:66591）
 *    ——bound 被缚族（105/106/123/354/579/589/685-687,SetDefaults 无 townNPC）与
 *    453 骷髅商（:14427 无 townNPC）不进 num40/num2-num39;37 老人/368 旅商照数。
 *  ⑯ 醉酒防御：`defense = (int)((double)defense * 1.1)`（NPC.cs:53703,链尾
 *    :53701-53706）作用域 = 基础 defDefense + 树妖守护（:53549-53562）+ 进度
 *    加成全量——旧实现只乘进度段（defenseBonus 内 trunc）,基础与守护不吃倍率
 *    → 醉酒 NPC 少 1~4 防。
 * 变异接缝（每刀恰红）：⑨ maxHp↔baseMaxHp → T⑨ 爆红;⑫ 旧 6 键表/漏 stack 门 →
 *  T⑫ 爆红;⑪ 删直通臂 → T⑪ 爆红;⑩ 删旗支 → T⑩ 源码锚爆红;⑬ 固定 7200 → T⑬
 *  rate=24 档爆红;⑭ 删前置位 → T⑭ 爆红;⑮ 滤 bound/skeleton_merchant 拆除 →
 *  T⑮ 爆红;⑱ tipsy ×1.1 缩回进度段 → T⑯ 三档全爆红;⑧ 排除集/双 NPC 门/群系
 *  id 任一翻转 → T⑧ 组爆红。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game, townNpcArrivalGate } from '../src/core/Game';
import { TownNPC, townNpcProgressionBoost } from '../src/entities/TownNPC';
import { ITEM_DEFS } from '../src/data/items';
import { VANILLA_NPCS } from '../src/data/vanillaNpcs';
import { World } from '../src/world/World';
import { TILE_BY_KEY } from '../src/data/tiles';

const GAME_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** vi_<vid> 稳定 id 反查内部 def 下标（ITEM_DEFS[id].vid,方案 A 统一域,同 BJ531 桩法） */
function defIdByVid(vid: number): number {
  const i = ITEM_DEFS.findIndex((d) => d?.vid === vid);
  expect(i, `vid ${vid} 应已注册`).toBeGreaterThan(-1);
  return i;
}

// =====================================================================
// ⑨ 护士到达门：statLifeMax（baseMaxHp）域,非 statLifeMax2（maxHp）
// =====================================================================
describe('BJ750 ⑨ SpawnAllowed_Nurse：statLifeMax/20>5（NPC.cs:7185-7199）', () => {
  function nurseWith(baseMaxHp: number, maxHp: number, flags: Record<string, boolean> = {}) {
    const self = Object.create(Game.prototype) as unknown as {
      player: { baseMaxHp: number; maxHp: number };
      world: { flags: Record<string, boolean>; seedFlags: Record<string, boolean> };
      townNpcSpawnAllowed(key: string): boolean;
    };
    self.player = { baseMaxHp, maxHp };
    self.world = { flags, seedFlags: {} };
    return () => self.townNpcSpawnAllowed('nurse');
  }

  it('基线上限 100（无水晶）→ false;120（一颗水晶,120/20=6>5）→ true;119 → false', () => {
    expect(nurseWith(100, 100)()).toBe(false);
    expect(nurseWith(120, 120)()).toBe(true);
    expect(nurseWith(119, 119)()).toBe(false);   // 整除边界:119/20=5 不>5
  });

  it('★域锁:生命力药水增益（statLifeMax2=maxHp 120）不吃门——baseMaxHp 100 仍 false', () => {
    expect(nurseWith(100, 120)()).toBe(false);   // 旧实现 maxHp/20=6>5 → 误 true
  });

  it('unlock 旗直通（unlockedNurseSpawn,WorldGen.cs:5515 随档）', () => {
    expect(nurseWith(100, 100, { unlockedNurseSpawn: true })()).toBe(true);
  });
});

// =====================================================================
// ⑫ 爆破专家到达门:21 件炸弹系全集 + stack>0 + 453 炸弹雕像除外
// =====================================================================
describe('BJ750 ⑫ SpawnAllowed_Demolitionist（ItemID.cs:68 全集,NPC.cs:7094-7114）', () => {
  function demoWith(slots: Array<{ vid: number; stack: number } | null>) {
    const self = Object.create(Game.prototype) as unknown as {
      player: { inv: { slots: Array<{ id: number; stack: number } | null> } };
      world: { flags: Record<string, boolean>; seedFlags: Record<string, boolean> };
      townNpcSpawnAllowed(key: string): boolean;
    };
    self.player = { inv: { slots: slots.map((s) => (s ? { id: defIdByVid(s.vid), stack: s.stack } : null)) } };
    self.world = { flags: {}, seedFlags: {} };
    return () => self.townNpcSpawnAllowed('demolitionist');
  }

  it('全集 21 件逐件放行（ItemID.cs:68 CreateBoolSet 参数序）', () => {
    const BOMB_VIDS = [168, 2586, 3116, 166, 235, 3115, 167, 2896, 3547, 3196, 4423,
      1130, 1168, 4824, 4825, 4826, 4827, 4908, 4909, 5594, 5595];
    expect(BOMB_VIDS.length).toBe(21);
    for (const vid of BOMB_VIDS) {
      expect(demoWith([{ vid, stack: 1 }])(), `vid ${vid}`).toBe(true);
    }
  });

  it('★453 炸弹雕像（BombStatue 物品）不在集合 → false（旧表误计）', () => {
    expect(demoWith([{ vid: 453, stack: 99 }])()).toBe(false);
  });

  it('stack>0 门（NPC.cs:7110）：零叠空壳不计;空背包 false', () => {
    expect(demoWith([{ vid: 166, stack: 0 }])()).toBe(false);
    expect(demoWith([])()).toBe(false);
  });

  it('异域反例:矿车轨道 500/火把 8 非炸弹系 → false', () => {
    expect(demoWith([{ vid: 500, stack: 99 }])()).toBe(false);
    expect(demoWith([{ vid: 8, stack: 99 }])()).toBe(false);
  });

  it('unlock 旗直通（unlockedDemolitionistSpawn）', () => {
    const self = Object.create(Game.prototype) as unknown as {
      player: { inv: { slots: Array<{ id: number; stack: number } | null> } };
      world: { flags: Record<string, boolean>; seedFlags: Record<string, boolean> };
      townNpcSpawnAllowed(key: string): boolean;
    };
    self.player = { inv: { slots: [] } };
    self.world = { flags: { unlockedDemolitionistSpawn: true }, seedFlags: {} };
    expect(self.townNpcSpawnAllowed('demolitionist')).toBe(true);
  });
});

// =====================================================================
// ⑪ 公主到达门:unlockedPrincessSpawn 直通臂
// =====================================================================
describe('BJ750 ⑪ 公主 flag9（Main.cs:66933-66936）', () => {
  function princessWith(flags: Record<string, boolean>, seedFlags: Record<string, boolean> = {}) {
    const self = Object.create(Game.prototype) as unknown as {
      world: { flags: Record<string, boolean>; seedFlags: Record<string, boolean> };
      entities: { npcs: unknown[] };
      townNpcSpawnAllowed(key: string): boolean;
    };
    self.world = { flags, seedFlags };
    self.entities = { npcs: [] };
    return () => self.townNpcSpawnAllowed('princess');
  }

  it('★解锁旗直通:unlockedPrincessSpawn=true 且全员缺席 → true（旧实现 false=死后不归）', () => {
    expect(princessWith({ unlockedPrincessSpawn: true })()).toBe(true);
  });

  it('未解锁且缺员 → false;十周年（!getGoodWorld）直通 → true', () => {
    expect(princessWith({})()).toBe(false);
    expect(princessWith({}, { tenthAnniversary: true })()).toBe(true);
    expect(princessWith({}, { tenthAnniversary: true, getGoodWorld: true })()).toBe(false);
  });
});

// =====================================================================
// ⑨-伴刀 造型师染发剂门:statLifeMax/statManaMax 基础域（Chest.cs:2698-2702）
// =====================================================================
describe('BJ750 ⑨伴 shopCondOk life400/mana200（statLifeMax/statManaMax 基础域）', () => {
  function condWith(base: { baseMaxHp: number; maxHp: number; baseMaxMana: number; maxMana: number }) {
    const self = Object.create(Game.prototype) as unknown as {
      player: typeof base;
      world: { flags: Record<string, boolean>; clock: { isDay: boolean; moonPhase: number } };
      shopCondOk(cond: string): boolean;
    };
    self.player = base;
    self.world = { flags: {}, clock: { isDay: true, moonPhase: 0 } };
    return (cond: string) => self.shopCondOk(cond);
  }

  it('★1977 生命染发剂门:baseMaxHp 350+Lifeforce 型增益（maxHp 420）不解锁', () => {
    const c = condWith({ baseMaxHp: 350, maxHp: 420, baseMaxMana: 20, maxMana: 20 });
    expect(c('life400')).toBe(false);   // 旧 maxHp>=400 → 误 true
    expect(c('mana200')).toBe(false);
  });

  it('基础域达标放行:生命水晶+果实 400 / 坠落之星 200', () => {
    const c = condWith({ baseMaxHp: 400, maxHp: 400, baseMaxMana: 200, maxMana: 200 });
    expect(c('life400')).toBe(true);
    expect(c('mana200')).toBe(true);
  });
});

// =====================================================================
// ⑬ 入驻轮间隔:7200/worldUpdateRate（ceil 语义 + 冻结停链）
// =====================================================================
describe('BJ750 ⑬ townNpcArrivalGate（Main.cs:66521-66533）', () => {
  it('rate=1:间隔 7200,首轮偏移 600（载入 ~10s forceUpdate 面）', () => {
    expect(townNpcArrivalGate(1, 600)).toBe(true);
    expect(townNpcArrivalGate(1, 599)).toBe(false);
    expect(townNpcArrivalGate(1, 7800)).toBe(true);   // 下一轮
    expect(townNpcArrivalGate(1, 7200)).toBe(false);
  });

  it('★rate=24（旅程时速顶档）:间隔 300——曾固定 7200 = 慢 24×', () => {
    expect(townNpcArrivalGate(24, 299)).toBe(true);   // min(600,299)=299 相位
    expect(townNpcArrivalGate(24, 599)).toBe(true);
    expect(townNpcArrivalGate(24, 899)).toBe(true);
    expect(townNpcArrivalGate(24, 300)).toBe(false);
    // 每 300 tick 恰一发
    let fires = 0;
    for (let t = 0; t < 3000; t++) if (townNpcArrivalGate(24, t)) fires++;
    expect(fires).toBe(10);
  });

  it('整除边界:rate=7 → floor(7200/7)=1028（C# int/int 截断,R27-4 改判史）', () => {
    // ★R27-4 改判史（红蓝定谳,2026-11-02）:原版 Main.cs:66528-66533
    //   `checkForSpawns < 7200 / worldUpdateRate`——C# int/int=floor,间隔=1028
    //   非 ceil 1029（旧锁钉 1029 系 ceil 误读;600+2×1028=2656 非 2658）。
    expect(townNpcArrivalGate(7, 600)).toBe(true);
    expect(townNpcArrivalGate(7, 1628)).toBe(true);
    expect(townNpcArrivalGate(7, 1028)).toBe(false);
    expect(townNpcArrivalGate(7, 2656)).toBe(true);   // 600+2×1028
    let fires = 0;
    for (let t = 0; t < 3000; t++) if (townNpcArrivalGate(7, t)) fires++;
    expect(fires).toBe(3);                            // 600/1628/2656
  });

  it('冻结（rate=0）:整链停（vanilla 头门 worldUpdateRate<=0 return）', () => {
    for (let t = 0; t < 20000; t += 97) expect(townNpcArrivalGate(0, t)).toBe(false);
  });
});

// =====================================================================
// ⑯ 醉酒防御 ×1.1 作用域:基础 + 守护 + 进度全量（NPC.cs:53703）
// =====================================================================
describe('BJ750 ⑯ tipsy 防御 ×1.1 全量作用域（NPC.cs:53701-53706）', () => {
  const F = 100;
  const DIRT = TILE_BY_KEY['dirt']!;
  function mk(flags: Record<string, boolean>) {
    const world = new World(200, 200, 100, 'bj750-tipsy');
    for (let x = 20; x <= 180; x++) world.store.setTileSilent(x, F, DIRT);
    world.clock.timeOfDay = 0.5;
    Object.assign(world.flags, flags);
    const npc = new TownNPC('guide', 100 * 16, F * 16);
    const game = {
      world, player: { x: -9999, y: -9999, w: 0, h: 0, dead: true },
      enemies: () => [], npcs: () => [npc], critters: () => [],
      spawnTownShot: () => {}, spawnParticles: () => {}, spawnBurst: () => {},
      playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {},
      achievements: { notifyProgressionEvent: () => {} },
    } as never;
    return { npc, game };
  }
  const hurtBy = (npc: TownNPC, game: never) => {
    const hp0 = npc.hp;
    npc.hurt(61, 0, 0, game, 0, 0, false, true);   // force 直击通道
    return hp0 - npc.hp;
  };
  /** tipsyNow 由 fixedUpdate buff 段置位（applyTipsy 只写 tipsyT）——先走一拍 */
  const drink = (npc: TownNPC, game: never) => {
    npc.applyTipsy(600);
    npc.fixedUpdate(1 / 60, game);
    expect(npc.tipsy).toBe(true);
  };

  it('纯函数面:defenseBonus 不再内乘 tipsy（×1.1 移交消费端合流后施加）', () => {
    const base = townNpcProgressionBoost({ ...TIPSY_BASE, tipsy: false });
    const tipsy = townNpcProgressionBoost({ ...TIPSY_BASE, tipsy: true });
    expect(base.defenseBonus).toBe(12);           // hardMode +12
    expect(tipsy.defenseBonus).toBe(12);          // ★不再 trunc(12×1.1)=13
    expect(tipsy.damageMul).toBeCloseTo(1.4 * 1.1, 9);
    expect(tipsy.chanceMul).toBeCloseTo(1.97 * 0.9, 9);
  });

  it('★全量面:向导(防 30) hardMode(+12) 醉酒 → def=trunc(42×1.1)=46（旧 30+13=43,少 3）', () => {
    const { npc, game } = mk({ hardMode: true });
    drink(npc, game as never);
    expect(hurtBy(npc, game as never)).toBe(Math.trunc(61 - 46 * 0.5));   // 38
  });

  it('零进度醉酒:防 30 → trunc(33)（旧 30,少 3→1 档）', () => {
    const { npc, game } = mk({});
    drink(npc, game as never);
    expect(hurtBy(npc, game as never)).toBe(Math.trunc(61 - Math.trunc(30 * 1.1) * 0.5));  // 44
  });

  it('守护并入全量:hardMode+树妖守护(+10) → trunc((30+12+10)×1.1)=57', () => {
    const { npc, game } = mk({ hardMode: true });
    drink(npc, game as never);
    npc.dryadWardT = 100;
    expect(hurtBy(npc, game as never)).toBe(Math.trunc(61 - 57 * 0.5));   // 32
  });

  it('清醒对照:同配置不乘（防 42/52 两档）', () => {
    const a = mk({ hardMode: true });
    expect(hurtBy(a.npc, a.game as never)).toBe(Math.trunc(61 - 42 * 0.5));
    const b = mk({ hardMode: true });
    b.npc.dryadWardT = 100;
    expect(hurtBy(b.npc, b.game as never)).toBe(Math.trunc(61 - 52 * 0.5));
  });
});

/** ⑯ 纯函数面入参基线（空旗标 + hardMode 单旗） */
const TIPSY_BASE = (() => {
  // townNpcProgressionFromWorld 不导出 flag 面外的构造——直接手排 hardMode 单旗档
  return {
    combatBookWasUsed: false, combatBookVolumeTwoWasUsed: false,
    downedSlimeKing: false, downedBoss1: false, downedDeerclops: false,
    downedBoss2: false, downedBoss3: false, downedQueenBee: false,
    hardMode: true, downedQueenSlime: false, downedMechBoss1: false,
    downedMechBoss2: false, downedMechBoss3: false, downedPlantBoss: false,
    downedEmpressOfLight: false, downedFishron: false, downedGolemBoss: false,
    downedAncientCultist: false, skyblockLowTiles: false, tipsy: false,
  } as Parameters<typeof townNpcProgressionBoost>[0];
})();

// =====================================================================
// ⑧ 晶塔上架:shopStockFor 尾段条件链（Chest.cs:3461-3533）
// =====================================================================
describe('BJ750 ⑧ 晶塔尾段（Chest.cs:3461-3533,R14-C4 实装面补行为锁）', () => {
  const P_TX = 50, P_TY = 100;
  /** 玩家 + 两个入住 NPC（家在玩家 169×124 窗内、本体贴家）+ 全平原 scene 桩 */
  function shopWith(opts: {
    npcs?: TownNPC[]; scene?: Record<string, boolean>; npcKey?: string;
  } = {}) {
    const self = Object.create(Game.prototype) as unknown as {
      shopStockFor(npc: TownNPC): Array<[number, number] | [number, number, number]>;
      world: unknown; player: unknown; scene: unknown; entities: unknown;
      partyState: unknown; travelStock: unknown[];
    };
    self.world = {
      seedFlags: {}, flags: {}, crimson: false,
      clock: { moonPhase: 0, isDay: true, bloodMoon: false, halloween: false, eclipse: false },
      weather: undefined, oreTiersPH: { silver: 169 }, groundLevel: 105, rockLevel: 140,
      bestiary: { completion: () => ({ percent: 0 }) },
    };
    self.player = {
      x: P_TX * 16, y: P_TY * 16, cx: P_TX * 16 + 8, cy: P_TY * 16 + 20,
      inv: { slots: [] }, golferScoreAccumulated: 0, equipStats: {},
    };
    self.scene = {
      zoneCorrupt: false, zoneCrimson: false, zoneSnow: false, zoneDesert: false,
      zoneBeach: false, zoneJungle: false, zoneHallow: false, zoneGlowshroom: false,
      zoneUnderworldHeight: false, belowSurface: false,
      ...opts.scene,
    };
    const npc1 = new TownNPC('merchant', (P_TX + 2) * 16, P_TY * 16);
    npc1.home = { x: P_TX + 2, y: P_TY };
    const npc2 = new TownNPC('dryad', (P_TX - 2) * 16, P_TY * 16);
    npc2.home = { x: P_TX - 2, y: P_TY };
    self.entities = { npcs: opts.npcs ?? [npc1, npc2] };
    self.partyState = { manualParty: false, genuineParty: false };
    self.travelStock = [];
    const seller = new TownNPC(opts.npcKey ?? 'merchant', P_TX * 16, P_TY * 16);
    return { stock: () => self.shopStockFor(seller), seller };
  }
  const vids = (stock: Array<[number, number] | [number, number, number]>) => stock.map((e) => e[0]);

  it('★双入住 NPC + 平原地表 → 商人店上架 4876 纯净森林塔,价 10 金（buyPrice(0,10)）', () => {
    const { stock } = shopWith();
    const hit = stock().find((e) => e[0] === 4876);
    expect(hit, '晶塔 4876 应上架（issue#38 ⑧ 主诉求）').toBeDefined();
    expect(hit![1]).toBe(100000);
  });

  it('窗口门:仅 1 个入住 NPC → 不上架（DoesPositionHaveEnoughNPCs(2,…)）', () => {
    const only = new TownNPC('merchant', (P_TX + 2) * 16, P_TY * 16);
    only.home = { x: P_TX + 2, y: P_TY };
    const { stock } = shopWith({ npcs: [only] });
    expect(vids(stock())).not.toContain(4876);
  });

  it('窗口门: homeless（无家）NPC 不计数;bound 被缚族不计数（isLikeATownNPC∧!homeless）', () => {
    const homeless = new TownNPC('dryad', (P_TX - 2) * 16, P_TY * 16);   // 无 home
    const bound = new TownNPC('wizard', (P_TX - 3) * 16, P_TY * 16);
    bound.home = { x: P_TX - 3, y: P_TY };
    bound.bound = true;
    const { stock } = shopWith({ npcs: [new TownNPC('merchant', (P_TX + 2) * 16, P_TY * 16), homeless, bound]
      .map((n, i) => (i === 0 ? (n.home = { x: P_TX + 2, y: P_TY }, n) : n)) });
    expect(vids(stock())).not.toContain(4876);
  });

  it('邪恶环境排斥:玩家在腐化 → 不上架（:3470 !ZoneCorrupt && !ZoneCrimson）', () => {
    const { stock } = shopWith({ scene: { zoneCorrupt: true } });
    expect(vids(stock())).not.toContain(4876);
    const { stock: sc2 } = shopWith({ scene: { zoneCrimson: true } });
    expect(vids(sc2())).not.toContain(4876);
  });

  it('★排除集:旅行商 368 / 骷髅商 453 / 酒保 550 三店永不上架（shopIndex 19/20/21）', () => {
    for (const key of ['travelling_merchant', 'skeleton_merchant', 'tavernkeep']) {
      const { stock } = shopWith({ npcKey: key });
      const got = vids(stock());
      expect(got.some((v) => [4876, 4875, 4916, 4917, 4918, 4919, 4920, 4921, 5652].includes(v)),
        `${key} 店不应有晶塔`).toBe(false);
    }
  });

  it('★群系 id 映射（ItemID.cs:11296-11388 逐值;issue 自述表系误记,此处钉反编译真值）', () => {
    const snow = shopWith({ scene: { zoneSnow: true } });
    expect(vids(snow.stock())).toContain(4920);         // Snow(非 4917)
    expect(vids(snow.stock())).not.toContain(4876);     // 雪原非纯净
    const jungle = shopWith({ scene: { zoneJungle: true } });
    expect(vids(jungle.stock())).toContain(4875);       // Jungle(非 4919)
    const desert = shopWith({ scene: { zoneDesert: true } });
    expect(vids(desert.stock())).toContain(4919);       // Desert(非 4918)
    const hallow = shopWith({ scene: { zoneHallow: true } });
    expect(vids(hallow.stock())).toContain(4916);       // Hallow(非 4916→森林误记)
    const shroom = shopWith({ scene: { zoneGlowshroom: true } });
    expect(vids(shroom.stock())).toContain(4921);       // Mushroom(非 4920)
    const beach = shopWith({ scene: { zoneBeach: true } });
    expect(vids(beach.stock())).toContain(4918);        // Ocean(非 4921)
  });

  it('洞穴带:belowSurface 且无群系 → 4917 洞穴塔,4876 不上（:3506-3509）', () => {
    const { stock } = shopWith({ scene: { belowSurface: true } });
    expect(vids(stock())).toContain(4917);
    expect(vids(stock())).not.toContain(4876);
  });

  it('地狱带:zoneUnderworldHeight → 5652 地狱塔（:3492-3498）', () => {
    const { stock } = shopWith({ scene: { zoneUnderworldHeight: true } });
    expect(vids(stock())).toContain(5652);
  });
});

// =====================================================================
// ⑩⑭⑮ 源码自包含块钉死（Game 无 DOM 不可整体构造,BJ432/BJ531 同族备案）
// =====================================================================
describe('BJ750 ⑩⑭⑮ 源码锚（updateTownNpcArrival 域）', () => {
  const src = readFileSync(join(GAME_ROOT, 'src/core/Game.ts'), 'utf8');
  const fnStart = src.indexOf('private updateTownNpcArrival');
  expect(fnStart).toBeGreaterThan(-1);
  const fnSrc = src.slice(fnStart, src.indexOf('private checkForHousesNearPlayer', fnStart));

  it('⑩ 派对女孩旗绕过 20 人门在位（Main.cs:66768-66776 flag7 直通）', () => {
    expect(fnSrc).toMatch(/\['party_girl', !has\('party_girl'\)\s*&& \(\(n >= 20 && allow\('party_girl'\)\) \|\| !!this\.world\.flags\.unlockedPartyGirlSpawn\)\]/);
  });

  it('⑭ 种子前置覆盖在 guide 之前（Main.cs:66934-66941）', () => {
    const seedArm = fnSrc.indexOf("['dryad', !has('dryad') && !!this.world.seedFlags?.infectedSeed]");
    const zooArm = fnSrc.indexOf("['zoologist', !has('zoologist') && !!this.world.seedFlags?.vampireSeed");
    const guideArm = fnSrc.indexOf("['guide', !has('guide')]");
    expect(seedArm).toBeGreaterThan(-1);
    expect(zooArm).toBeGreaterThan(-1);
    expect(guideArm).toBeGreaterThan(-1);
    expect(seedArm, 'infectedSeed 树妖前置位须在 guide 前').toBeLessThan(guideArm);
    expect(zooArm, 'vampireSeed 动物学家前置位须在 guide 前').toBeLessThan(guideArm);
    // vampireSeed 臂带 !infectedSeed 合取（原版 :66938 字面）
    expect(fnSrc.slice(zooArm, zooArm + 200)).toContain('!this.world.seedFlags?.infectedSeed');
  });

  it('⑮ 计数域门:bound + skeleton_merchant 排除在位（Main.cs:66591 townNPC 门投影）', () => {
    expect(fnSrc).toMatch(/n instanceof TownNPC && !n\.dead\s*&& !n\.bound && n\.npcKey !== 'skeleton_merchant'/);
  });

  it('⑬ 间隔门接线:fixedUpdate 消费 townNpcArrivalGate（防拆纯函数留死桩）', () => {
    expect(src).toMatch(/if \(townNpcArrivalGate\(/);
    expect(src).toMatch(/export function townNpcArrivalGate/);
  });

  it('⑪ 写读回路:ARRIVE_UNLOCK_FLAG.princess 旗与读面同键（WorldGen.cs:5525 ↔ Main.cs:66933）', () => {
    expect(src).toMatch(/princess: 'unlockedPrincessSpawn'/);
    expect(src).toMatch(/flags\.unlockedPrincessSpawn\) return true/);
  });

  it('⑫ 源码钉值:21 件 vid 全集按 ItemID.cs:68（防回退旧 6 键表）', () => {
    const m = fnSrc2(src).match(/const bombVids = new Set\(\[([\d,\s]+)\]\)/);
    expect(m, 'bombVids 集合缺位').toBeTruthy();
    const got = m![1].split(',').map((s) => Number(s.trim())).sort((a, b) => a - b);
    const want = [166, 167, 168, 235, 1130, 1168, 2586, 2896, 3115, 3116, 3196, 3547,
      4423, 4824, 4825, 4826, 4827, 4908, 4909, 5594, 5595].sort((a, b) => a - b);
    expect(got).toEqual(want);
  });

  /** ⑫ 的 case 块在 townNpcSpawnAllowed（updateTownNpcArrival 之前） */
  function fnSrc2(s: string): string {
    const start = s.indexOf('private townNpcSpawnAllowed');
    return s.slice(start, s.indexOf('private updateTownNpcArrival', start));
  }
});
