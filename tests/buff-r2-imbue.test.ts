// R2 武器浸剂回归：敌 debuff DoT/ichor/midas + 浸剂→debuff 映射链（对 1456 Player.cs :6141/:11604/:92585）
import { describe, it, expect } from 'vitest';
import { Enemy } from '../src/entities/Enemy';
import { rollCoins, type NpcDropCtx } from '../src/drops/NpcDrops';
import { BuffType } from '../src/stats/Buffs';
import { TileStore } from '../src/world/TileStore';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';
import { RNG } from '../src/core/rng';

const W = 60, H = 60;
function makeHooks() {
  const store = new TileStore(W, H);
  const player = new Player(30 * 16, 30 * 16, new Inventory());
  const hooks: GameHooks = {
    world: { store } as never,
    player: player as never,
    enemies: () => [],
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
  return { hooks, store, player };
}

describe('R2 敌 debuff DoT（NPC.cs:92585/92697/92708，lifeRegen/2=HP/s）', () => {
  it('毒 6HP/s / 毒液 30HP/s / 诅咒焰 24HP/s 滴血', () => {
    const { hooks } = makeHooks();
    const e = new Enemy('zombie', 10 * 16, 10 * 16);
    e.iframes = 0; e.hp = 1000; e.hpBarT = 0;
    // 毒 1 秒（world 挂在 hooks.world.store 形态与运行时一致）
    e.poisonT = 1;
    e.fixedUpdate(1, hooks as never);
    expect(e.hp).toBe(1000 - 6);
    // 毒液 1 秒
    e.hp = 1000; e.venomT = 1;
    e.fixedUpdate(1, hooks as never);
    expect(e.hp).toBe(1000 - 30);
    // 诅咒焰 1 秒
    // ★issue#46 N06（2026-11-03 改判史）：旧期望 24 = 逐效果累加器的 1 秒均值。
    // 原版统一批次：诅咒焰 AddFlamable(48,10) → 60 帧跨 2 批 = 20（门槛 1200，
    // 残账 −480 结转——本例同实体连跑三窗，carry 已含在期望内）。
    e.hp = 1000; e.cursedT = 1;
    e.fixedUpdate(1, hooks as never);
    expect(e.hp).toBe(1000 - 20);
  });

  it('ichor：checkArmorPenetration 单池（NPC.cs:81913-81938）——pool>def 钳 def/2 恰抵半防', () => {
    const { hooks } = makeHooks();
    const e = new Enemy('zombie', 10 * 16, 10 * 16);
    e.hp = 1000; e.iframes = 0;
    const def = e.def.defense ?? 0;
    const noIchor = Math.max(1, Math.round(100 - def * 0.5));
    e.hurt(100, 0, 0, hooks as never);
    expect(1000 - e.hp).toBe(noIchor);
    // 有 ichor（2026-08-15 起 Enemy.hurt 走 npcCheckArmorPenetration 1:1）：
    // pool=15 > 僵尸 def → 钳 floor(def/2)，恰与 -def*0.5 抵消 → 满额伤害
    e.hp = 1000; e.iframes = 0;
    e.ichorT = 5;
    e.hurt(100, 0, 0, hooks as never);
    const penAdd = def > 0 ? (15 > def ? Math.floor(def / 2) : Math.floor(15 / 2)) : 0;
    expect(1000 - e.hp).toBe(Math.max(1, Math.round(100 + penAdd - def * 0.5)));
  });
});

describe('R2 midas 掉钱乘区（NPC.cs:80424 ×1.10-1.51）', () => {
  it('midas 期望值高于无 midas（同 RNG 种子族均值）', () => {
    let plain = 0, gold = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const c1: NpcDropCtx = { rng: new RNG(seed) } as never;
      const c2: NpcDropCtx = { rng: new RNG(seed) } as never;
      plain += rollCoins(1000, c1, false).reduce((a, d) => a + d.n, 0);
      gold += rollCoins(1000, c2, false, true).reduce((a, d) => a + d.n, 0);
    }
    expect(gold).toBeGreaterThan(plain);
    const ratio = gold / plain;
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(1.6);
  });
});

describe('R2 浸剂 Buff 登记链', () => {
  it('8 浸剂 + 狱火 BuffType 与 vanillaBuff 编号一致（:11604-11636/:9896）', async () => {
    const { BUFF_DEFS } = await import('../src/stats/Buffs');
    expect(BUFF_DEFS[BuffType.ImbueVenom].vanillaBuff).toBe(71);
    expect(BUFF_DEFS[BuffType.ImbueCursed].vanillaBuff).toBe(73);
    expect(BUFF_DEFS[BuffType.ImbueFire].vanillaBuff).toBe(74);
    expect(BUFF_DEFS[BuffType.ImbueGold].vanillaBuff).toBe(75);
    expect(BUFF_DEFS[BuffType.ImbueIchor].vanillaBuff).toBe(76);
    expect(BUFF_DEFS[BuffType.ImbueNano].vanillaBuff).toBe(77);
    expect(BUFF_DEFS[BuffType.ImbueParty].vanillaBuff).toBe(78);
    expect(BUFF_DEFS[BuffType.ImbuePoison].vanillaBuff).toBe(79);
    expect(BUFF_DEFS[BuffType.Inferno].vanillaBuff).toBe(116);
  });
  it('vi_ 浸剂药水数据：consumable+buffType 齐（1340 毒液/2348 狱火）', async () => {
    const { itemFuncOfVid } = await import('../src/data/vanillaItemFunc');
    expect(itemFuncOfVid(1340)).toMatchObject({ consumable: 1, buffType: 71 }); // Flask of Venom
    expect(itemFuncOfVid(1354)).toMatchObject({ consumable: 1, buffType: 74 }); // Flask of Fire
    expect(itemFuncOfVid(1359)).toMatchObject({ consumable: 1, buffType: 79 }); // Flask of Poison
    expect(itemFuncOfVid(2348)).toMatchObject({ consumable: 1, buffType: 116 }); // Inferno Potion
  });
});
