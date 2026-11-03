// BJ677（2026-10-14）：骨蛇 OnFire 免疫缺失——定谳+落刀回归锁。
//
// 【定谳】（反编译 1457 唯一标杆）两条独立免疫链，用户主诉 = 第 2 链缺失：
//  1. lavaImmune（岩浆直伤免,NPC.cs SetDefaults else-if 链提取）——本仓已有
//     data/npcLavaImmune.ts。骨蛇 39-41 **不在**该表（入浆照吃 50 直伤/30t 冷却）。
//  2. DebuffImmunitySets（buff 施加免,NPCID.cs:395 起,693 键 = 549 非空 + 144 null）
//     ——本仓静态表 = data/vanillaNpcImmunity.ts（512 SpecificallyImmuneTo +
//     37 ImmuneToAll 双旗档,与反编译逐键 diff = 零漂移,本测试钉面锁死）。
//     骨蛇 39/40/41 SpecificallyImmuneTo [20,24,31,323]（NPCID.cs:641/:648/:655）→
//     岩浆块 AddBuff(24,420)（NPC.cs:94473）被 NPC.AddBuff buffImmune 拒绝门
//     （NPC.cs:91037 `if (buffImmune[type]) return;`）拦截 → 挨 50 直伤但不上
//     火 DoT（"岩浆烫死"主因 = DoT 累积,直伤 50/30t 慢一个量级）。
//     落刀 = npcLiquid.ts 岩浆块两支 AddBuff(24) 写位过 projStatus.debuffWriteAllowed
//     单源闸（直伤 hurt(50) 与 lavaCd=30 不受门,原版同拍）。
// 【全表普查】OnFire(24) 免疫 = 84 NPC（SpecificallyImmuneTo 含 24 的 47 个 +
//   ImmuneToAll 档 37 个——24 非鞭 debuff,IsAnNPCWhipDebuff={310,362} BuffID.cs:20）。
//   本名单由 NPCID.cs:395 表逐键解析钉死（一次性提取器,与 vanillaNpcImmunity.ts
//   逐键 diff 零漂移;主会话预判 44 名单漏数 = 漏算双旗档与 316/521/533）。
// 【派生规则】NPC.cs:17859-17868：免疫 20(Poisoned) → 30(Bleeding)+375(Hemorrhage);
//   免疫 69(Ichor) → 36(BrokenArmor)。消费侧现算 = vanillaNpcImmunity.derive。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Enemy } from '../src/entities/Enemy';
import { TILE } from '../src/core/constants';
import { updateNpcLiquid } from '../src/entities/npcLiquid';
import { npcImmuneTo, IMMUNE_ALL_NOT_WHIPS, IMMUNE_ALL_PLUS_WHIPS } from '../src/data/vanillaNpcImmunity';
import { applyBuffTicks, applyProjStatus, debuffWriteAllowed } from '../src/entities/projStatus';
import type { GameHooks } from '../src/entities/types';
import type { NpcLiquidHost } from '../src/entities/npcLiquid';

const W = 60, H = 256;

/** 岩浆池 x∈[10,30) 行 33-39 满浆、行 40 池底 */
function lavaWorld(): World {
  const w = new World(W, H, 11, 'bj677-lava-test');
  const st = w.store;
  for (let x = 10; x < 30; x++) {
    st.setTile(x, 40, 1);
    for (let y = 33; y < 40; y++) st.setLiquid(x, y, 255, 2);
  }
  return w;
}

function hooks(w: World, p: Player): GameHooks {
  return {
    world: w, player: p,
    enemies: () => [], critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {}, cutTile: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, showPickupLabel: () => {},
  } as unknown as GameHooks;
}

/** 单元级液体宿主（updateNpcLiquid 直调,绕开 AI 位移——hurt 计数精确锁冷却节拍） */
function lavaHost(vanillaId: number, onHurt?: () => void): NpcLiquidHost {
  return {
    x: 20 * TILE, y: 36 * TILE, w: 18, h: 40, vx: 0, vy: 0, cx: 20 * TILE, cy: 36 * TILE,
    vanillaId, vanilla: { aiStyle: 3 }, ai0: 0, ai1: 0,
    wet: false, wetCount: 0, honeyWet: false, shimmerWet: false, lavaWet: false,
    lavaCd: 0, onFireT: 0, onFire3T: 0, stinkyT: 0,
    inWater: false, liqFactor: 1, def: { boss: false },
    hurt: () => { onHurt?.(); },
  } as unknown as NpcLiquidHost;
}

describe('BJ677 A. 静态表面锁（vanillaNpcImmunity = NPCID.cs:395 DebuffImmunitySets）', () => {
  it('骨蛇 39/40/41 SpecificallyImmuneTo [20,24,31,323] 逐值（@NPCID.cs:641/:648/:655）', () => {
    for (const id of [39, 40, 41]) {
      // 表内四值全真
      for (const b of [20, 24, 31, 323]) expect(npcImmuneTo(id, b)).toBe(true);
      // 派生（20→30 Bleeding/375 Hemorrhage,NPC.cs:17859-17863）
      expect(npcImmuneTo(id, 30)).toBe(true);
      expect(npcImmuneTo(id, 375)).toBe(true);
      // 表外邻值全假（39 诅咒地狱火/44 霜火/36 破甲（无 69 不派生）/70 剧毒/153 暗焰/189 破晓）
      for (const b of [36, 39, 44, 70, 137, 153, 189, 203, 204, 324]) {
        expect(npcImmuneTo(id, b)).toBe(false);
      }
    }
  });

  it('派生规则第二支：免疫 69(Ichor) → 36(BrokenArmor)（NPC.cs:17864-17867;268=[20,69]）', () => {
    expect(npcImmuneTo(268, 36)).toBe(true);
    expect(npcImmuneTo(268, 20)).toBe(true);
    expect(npcImmuneTo(268, 69)).toBe(true);
    expect(npcImmuneTo(268, 30)).toBe(true);   // 20 派生
    expect(npcImmuneTo(268, 375)).toBe(true);  // 20 派生
    expect(npcImmuneTo(268, 24)).toBe(false);  // 无 24
  });

  it('OnFire(24) 免疫全表 84 NPC 钉面（47 SpecificallyImmuneTo 含 24 + 37 ImmuneToAll 档）', () => {
    // 名单 = NPCID.cs:395 表逐键解析（提取器与 vanillaNpcImmunity.ts 逐键 diff 零漂移）。
    // 免疫 OnFire 的原版怪（名字取自 NPCID.cs const short 表）:
    const ON_FIRE_IMMUNE = [
      23,   // Meteor Head（非 lavaImmune——入浆吃 50 直伤不上火）
      24,   // Fire Imp
      39, 40, 41, // Bone Serpent 头/身/尾（BJ677 主诉）
      59,   // Lava Slime
      60,   // Hellbat
      62,   // Demon
      66,   // Voodoo Demon
      68,   // Dungeon Guardian（ImmuneToAll+Whips）
      70,   // Spike Ball
      72,   // Blazing Wheel（ImmuneToAll+Whips）
      82,   // Wraith（ImmuneToAll 非鞭）
      83, 84, // Cursed Hammer / Enchanted Sword
      113, 114, // Wall of Flesh / Wall of Flesh Eye（★非 The Hungry）
      134, 135, 136, // The Destroyer 头/身/尾（ImmuneToAll）
      139,  // Probe（ImmuneToAll）
      140,  // Possessed Armor
      151,  // Lava Bat
      156,  // Red Devil
      179,  // Crimson Axe
      245, 246, 247, 248, 249, // Golem 族
      253,  // Reaper（ImmuneToAll）
      277, 278, 279, 280, // Hell Armored Bones 族
      288,  // Dungeon Spirit（ImmuneToAll）
      315,  // Headless Horseman
      316,  // Ghost（14 项长表含 24）
      327, 328, // Pumpking / PumpkingBlade
      329,  // Hellhound
      330,  // Poltergeist（ImmuneToAll）
      341,  // Present Mimic
      384,  // Force Bubble（ImmuneToAll）
      392, 393, 394, 395, // Martian Saucer 族（ImmuneToAll）
      418,  // Solar Corite
      422,  // Lunar Tower Vortex（ImmuneToAll）
      439, 440, // Cultist Boss / Clone（ImmuneToAll+Whips）
      454, 455, 456, 457, 458, 459, // Cultist Dragon 头/身×4/尾（ImmuneToAll）
      467,  // Deadly Sphere
      473, 474, 475, 476, // Big Mimic 四属地
      482, 483, // Granite Golem / Granite Flyer
      491, 492, 493, // Pirate Ship / Cannon / Stardust Tower（ImmuneToAll）
      507, 517, // Nebula / Solar Tower（ImmuneToAll）
      520,  // Martian Walker
      521,  // Ancient Cultist Squidhead（14 项长表含 24）
      533,  // Desert Djinn（14 项长表含 24）
      549,  // DD2 Lane Portal（ImmuneToAll+Whips）
      551,  // Betsy
      583, 584, 585, // Fairy 三色（ImmuneToAll）
      629,  // Ice Mimic
      631,  // Rock Golem
      662,  // Pirate Ghost（ImmuneToAll）
      686, 687, // Bound Town Slime 紫/黄（ImmuneToAll+Whips）
      690,  // Statue Mimic（ImmuneToAll;aiStyle 21 永不沾水族,岩浆不湿）
    ];
    expect(ON_FIRE_IMMUNE.length).toBe(84);
    for (const id of ON_FIRE_IMMUNE) expect(npcImmuneTo(id, 24)).toBe(true);
    // 双旗档并集 = 37 键,逐一在两档内
    expect(IMMUNE_ALL_NOT_WHIPS.size + IMMUNE_ALL_PLUS_WHIPS.size).toBe(37);
    // 对照组：不上表者不免疫（僵尸 3 无条目/蓝史 1 只免 20/The Hungry 115/116 只免 31
    // ——wiki「唯一不禁 On Fire 的地狱敌怪」,npcLiquid.ts 岩浆块注释同锚）
    for (const id of [1, 2, 3, 115, 116, 121]) expect(npcImmuneTo(id, 24)).toBe(false);
  });

  it('鞭档语义（ApplyToNPC,NPCDebuffImmunityData.cs:14-24）:ImmuneToAll 非鞭档免 24 不免鞭 310/362;+Whips 档连鞭全免', () => {
    expect(IMMUNE_ALL_NOT_WHIPS.has(82)).toBe(true);       // Wraith
    expect(npcImmuneTo(82, 24)).toBe(true);
    expect(npcImmuneTo(82, 310)).toBe(false);              // ScytheWhipEnemyDebuff
    expect(npcImmuneTo(82, 362)).toBe(false);              // EelWhipNPCDebuff
    expect(IMMUNE_ALL_PLUS_WHIPS.has(68)).toBe(true);      // Dungeon Guardian
    expect(npcImmuneTo(68, 310)).toBe(true);
    expect(npcImmuneTo(68, 362)).toBe(true);
    expect(npcImmuneTo(72, 24)).toBe(true);                // Blazing Wheel(+Whips)
  });
});

describe('BJ677 B. 岩浆行为锁（updateNpcLiquid,Collision_LavaCollision NPC.cs:94459-94482）', () => {
  it('骨蛇 39 入浆：50 直伤照吃（hurt 每 30t 一拍）但 onFireT 恒 0（AddBuff(24) 被拒）', () => {
    const w = lavaWorld();
    const p = new Player(45 * TILE, 30 * TILE, new Inventory());
    const h = hooks(w, p);
    let hurtCount = 0;
    const b = lavaHost(39, () => { hurtCount++; });
    for (let i = 0; i < 90; i++) updateNpcLiquid(b, h as never, w.store);   // t1/t31/t61 三拍
    expect(hurtCount).toBe(3);            // 直伤保留 = 原版（StrikeNPCNoInteraction(50) 不在 buffImmune 门内）
    expect(b.onFireT).toBe(0);            // ★BJ677 主诉修复位：DoT 不上
    expect(b.lavaWet).toBe(true);         // 岩浆减速档照走（非 lavaImmune）
    expect(b.lavaCd).toBe(30 - (90 - 61)); // 第 61 拍置 30 后倒数
  });

  it('对照组僵尸 3：同窗同拍 hurt×3 但 onFireT=7（免疫差异唯一变量）', () => {
    const w = lavaWorld();
    const p = new Player(45 * TILE, 30 * TILE, new Inventory());
    const h = hooks(w, p);
    let hurtCount = 0;
    const b = lavaHost(3, () => { hurtCount++; });
    for (let i = 0; i < 90; i++) updateNpcLiquid(b, h as never, w.store);
    expect(hurtCount).toBe(3);            // 直伤节拍与骨蛇全同
    expect(b.onFireT).toBe(7);            // AddBuff(24,420)=7s 照上（wiki:僵尸可被点燃）
  });

  it('同问题族普查锁：陨石怪 23/地狱装甲骨 277（OnFire 免疫非 lavaImmune）= 骨蛇同相;恶魔 62 双免毫发无伤', () => {
    const w = lavaWorld();
    const p = new Player(45 * TILE, 30 * TILE, new Inventory());
    const h = hooks(w, p);
    for (const id of [23, 277]) {
      let hurtCount = 0;
      const b = lavaHost(id, () => { hurtCount++; });
      for (let i = 0; i < 90; i++) updateNpcLiquid(b, h as never, w.store);
      expect(hurtCount).toBe(3);          // 直伤照吃
      expect(b.onFireT).toBe(0);          // 不上火
    }
    // 恶魔 62：lavaImmune（data/npcLavaImmune.ts）+ OnFire 免疫 → 零伤零火零冷却
    let demonHurt = 0;
    const d = lavaHost(62, () => { demonHurt++; });
    for (let i = 0; i < 90; i++) updateNpcLiquid(d, h as never, w.store);
    expect(demonHurt).toBe(0);
    expect(d.onFireT).toBe(0);
    expect(d.lavaWet).toBe(true);         // :94524 lavaWet 置位在 !lavaImmune 门之外
  });

  it('The Hungry 115：wiki「唯一不禁 On Fire 的地狱敌怪」——入浆照样上火（反向对照）', () => {
    const w = lavaWorld();
    const p = new Player(45 * TILE, 30 * TILE, new Inventory());
    const h = hooks(w, p);
    const b = lavaHost(115);
    for (let i = 0; i < 90; i++) updateNpcLiquid(b, h as never, w.store);
    expect(b.onFireT).toBe(7);
  });

  it('E2E：Enemy.fromVanilla(39) 入浆【无伤无火】（noTileCollide 支整块跳过）;僵尸 3 上火', () => {
    // ★issue#46 N04（2026-11-03 改判史）：本断言旧形为「39 掉血 50（直伤照吃）」——
    // 那是**未分流**的结果。1457 NPC.cs:91605-91618：`if (!noTileCollide)
    // UpdateCollision(); else { position += velocity; if (WetCollision) TryRemoving... }`
    // ——Collision_LavaCollision 唯一调用点 :93668 在 UpdateCollision 内，故
    // noTileCollide 族（骨蛇 39/40/41 SetDefaults noTileCollide+noGravity）**既不
    // 吃岩浆直伤也不置 lavaWet/wet**，穿墙支只清可水灭效果。本组 6 个 updateNpcLiquid
    // 直调用例仍显式走非穿墙支（第 4 参缺省 false），语义不变。
    const w = lavaWorld();
    const p = new Player(45 * TILE, 30 * TILE, new Inventory());
    const h = hooks(w, p);
    const serpent = Enemy.fromVanilla(39, 20 * TILE, 36 * TILE)!;
    const hp0 = serpent.hp;
    for (let i = 0; i < 3; i++) serpent.fixedUpdate(1 / 60, h as never);
    expect(serpent.hp).toBe(hp0);           // 穿墙支无岩浆直伤
    expect(serpent.onFireT).toBe(0);        // 不上火（另：buffImmune 门本就拒 24）
    expect(serpent.lavaWet).toBe(false);    // UpdateCollision 跳过 ⇒ lavaWet 不置位
    const z = Enemy.fromVanilla(3, 20 * TILE, 36 * TILE)!;
    for (let i = 0; i < 3; i++) z.fixedUpdate(1 / 60, h as never);
    expect(z.onFireT).toBeGreaterThan(0);   // 对照组（非穿墙）照上
  });
});

describe('BJ677 C. 弹幕/施加链门锁（projStatus 单源闸,2026-08-13 D5 起已接——本批复核）', () => {
  it('debuffWriteAllowed/applyBuffTicks：骨蛇拒 24/31,放行 39(CursedInferno);僵尸放行 24', () => {
    expect(debuffWriteAllowed({ vanillaId: 39 }, 24)).toBe(false);
    expect(debuffWriteAllowed({ vanillaId: 39 }, 31)).toBe(false);   // Confused 免疫顺带生效
    expect(debuffWriteAllowed({ vanillaId: 39 }, 39)).toBe(true);
    expect(debuffWriteAllowed({ vanillaId: 3 }, 24)).toBe(true);
    // applyBuffTicks（AddBuff max 合并 + 免疫门）
    const ser = { vanillaId: 39, onFireT: 0, confusedT: 0, cursedT: 0 };
    applyBuffTicks(ser as never, 24, 420);
    applyBuffTicks(ser as never, 31, 300);
    expect(ser.onFireT).toBe(0);
    expect(ser.confusedT).toBe(0);
    applyBuffTicks(ser as never, 39, 300);
    expect(ser.cursedT).toBe(5);           // 非免疫 buff 照施加
    const z = { vanillaId: 3, onFireT: 0 };
    applyBuffTicks(z as never, 24, 420);
    expect(z.onFireT).toBe(7);
  });

  it('applyProjStatus 表驱动链（978 AddBuff(24,180) chance=1）：骨蛇零上火,僵尸 3s', () => {
    const ser = { vanillaId: 39, onFireT: 0 };
    applyProjStatus(978, ser as never);
    expect(ser.onFireT).toBe(0);
    const z = { vanillaId: 3, onFireT: 0 };
    applyProjStatus(978, z as never);
    expect(z.onFireT).toBe(3);
  });

  it('debuffImmuneOverride 运行时豁免位优先于静态表（AI_001 熔岩史莱姆 :61312-61316 复位语义）', () => {
    const e = { vanillaId: 39, onFireT: 0, debuffImmuneOverride: new Map([[24, false]]) };
    applyBuffTicks(e as never, 24, 420);
    expect(e.onFireT).toBe(7);             // 运行时复位 → 照施加
  });
});
