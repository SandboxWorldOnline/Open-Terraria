// G7(2026-08-13):StatusNPC 复杂块入表 + Enemy 16 debuff 字段效果对账。
//   · 16 字段 DoT/穿甲逐条断言(源码锚 = NPC.cs UpdateNPC_BuffApplyDOTs :92577 起,
//     lifeRegen 单位 2×HP/s;穿甲 = checkArmorPenetration :81912-81945)
//   · 提取表新增条目对账(12 型号:ai1==i 定向族 / remix 族 / 85 ai0 / 694 套装门)
//   · Oiled/Slimed 语义修正回归(:92728-92737 flat +25;:92623 等六处 Slimed 翻倍)
import { describe, it, expect, vi } from 'vitest';
import { Enemy } from '../src/entities/Enemy';
import { applyProjStatus } from '../src/entities/projStatus';
import tableJson from '../src/data/vanilla-projstatus.json';
import { TileStore } from '../src/world/TileStore';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';

const TABLE = tableJson as unknown as Record<string, Array<Record<string, number | string | undefined>>>;

function makeHooks() {
  const store = new TileStore(60, 60);
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
  return hooks;
}

/** 新敌 + 1 秒步进,返回掉血量(字段直写,不经 AddBuff 免疫表) */
function dotLoss(field: string, hp = 1000): number {
  const e = new Enemy('zombie', 10 * 16, 10 * 16);
  e.iframes = 0; e.hp = hp; e.hpBarT = 0;
  (e as unknown as Record<string, number>)[field] = 1;
  // 贴附族层数模型（2026-08-15 起）：DoT = 层数池驱动（NPC.cs:92740+ num=场上附着
  // 弹数）——buff 计时字段只开门，单层伤害须 push 一层（等价一枚贴附弹在场）
  const STICKER: Record<string, 169 | 183 | 337 | 344> = {
    javelinT: 169, stardustT: 183, spikeT: 337, butcherT: 344,
  };
  if (STICKER[field]) e.addStickerStack(STICKER[field], 900);
  e.fixedUpdate(1, makeHooks() as never);
  return hp - e.hp;
}

describe('G7 16 debuff 字段 DoT(NPC.cs UpdateNPC_BuffApplyDOTs :92577+)', () => {
  it('30 Bleeding = 12 HP/s(:92592-92601 lifeRegen-24)', () => {
    expect(dotLoss('bleedT')).toBe(12);
  });
  it('36 BrokenArmor = 受击无视 20 防(:81919-81921 armorPen+20)', () => {
    const hooks = makeHooks();
    const e = new Enemy('zombie', 10 * 16, 10 * 16);
    const def = e.def.defense ?? 0;
    expect(def).toBeGreaterThan(0);   // 前置:有防可穿
    expect(def).toBeLessThanOrEqual(20); // 前置:20 足以穿尽
    e.hp = 1000; e.iframes = 0;
    e.hurt(1000, 0, 0, hooks as never);
    const base = 1000 - e.hp;
    e.hp = 1000; e.iframes = 0; e.brokenArmorT = 5;
    e.hurt(1000, 0, 0, hooks as never);
    expect(1000 - e.hp).toBe(1000);   // 防御被 20 穿尽 → 全额
    expect(1000 - e.hp).toBeGreaterThan(base);
  });
  it('44 Frostburn = 8 HP/s(:92648-92660 lifeRegen-16)', () => {
    expect(dotLoss('frostburnT')).toBe(8);
  });
  it('137 Slimed = 六火系 DoT 翻倍(:92623 等 6 处 drippingSlime)', () => {
    // onFire(:92616-92630 基档 4)与 onFire3(:92632-92644 基档 15)均翻倍
    const e = new Enemy('zombie', 10 * 16, 10 * 16);
    e.iframes = 0; e.hp = 1000; e.hpBarT = 0; e.onFireT = 1; e.slimedT = 1;
    e.fixedUpdate(1, makeHooks() as never);
    expect(1000 - e.hp).toBe(8);      // 4 ×2
    const e2 = new Enemy('zombie', 10 * 16, 10 * 16);
    e2.iframes = 0; e2.hp = 1000; e2.hpBarT = 0; e2.onFire3T = 1; e2.slimedT = 1;
    e2.fixedUpdate(1, makeHooks() as never);
    expect(1000 - e2.hp).toBe(30);    // 15 ×2
  });
  it('151 SoulDrain = 25 HP/s(:92927-92935 lifeRegen-50)', () => {
    expect(dotLoss('soulDrainT')).toBe(25);
  });
  it('153 ShadowFlame = 15 HP/s(:92712-92724 lifeRegen-30)', () => {
    expect(dotLoss('shadowFlameT')).toBe(15);
  });
  it('169 BoneJavelin = 单层 3 HP/s(:92740-92758 num2×6)', () => {
    expect(dotLoss('javelinT')).toBe(3);
  });
  it('183 StardustBleed = 单层 20 HP/s(:92846-92863 num10×40)', () => {
    expect(dotLoss('stardustT')).toBe(20);
  });
  it('189 Daybreak = 单层 100 HP/s(:92807-92841 num8×200,零层兜底 1)', () => {
    expect(dotLoss('daybreakT')).toBe(100);
  });
  it('203 BetsysCurse = 受击无视 40 防(:81922-81924 armorPen+40)', () => {
    const hooks = makeHooks();
    const e = new Enemy('zombie', 10 * 16, 10 * 16);
    const def = e.def.defense ?? 0;
    expect(def).toBeGreaterThan(0);
    expect(def).toBeLessThanOrEqual(40);
    e.hp = 1000; e.iframes = 0; e.betsysCurseT = 5;
    e.hurt(1000, 0, 0, hooks as never);
    expect(1000 - e.hp).toBe(1000);   // 40 穿尽僵尸防 → 全额
  });
  it('204 Oiled = 六火系在身时 flat +25 HP/s(:92728-92737 单块 -50)', () => {
    // 单火系:15(onFire3)+25(Oiled)=40——非"按系翻倍"(旧实现 30,已修)
    const e = new Enemy('zombie', 10 * 16, 10 * 16);
    e.iframes = 0; e.hp = 1000; e.hpBarT = 0; e.onFire3T = 1; e.oiledT = 1;
    e.fixedUpdate(1, makeHooks() as never);
    expect(1000 - e.hp).toBe(40);
    // 无火系在身:Oiled 不独立生效
    const e2 = new Enemy('zombie', 10 * 16, 10 * 16);
    e2.iframes = 0; e2.hp = 1000; e2.hpBarT = 0; e2.oiledT = 1;
    e2.fixedUpdate(1, makeHooks() as never);
    expect(1000 - e2.hp).toBe(0);
  });
  it('204 Oiled 多火系并存只叠一次(单块语义,不按系重复)', () => {
    // ★issue#46 N06（2026-11-03 改判史）：旧期望 65 = 逐效果浮点累加器的 1 秒均值。
    // 原版统一批次（NPC.cs:92821-92878）：onFire3(30,5)+frostburn2(50,10)+oiled(50,10)
    // → loss=130/t、batch=max(5,10,10)=10、门槛 1200 → dt=1（60tick）跨 6 批 = 60，
    // 残账 −600 结转。按系重复叠 Oiled 会得 loss 180 → 8 批 = 80，判别力保留。
    const e = new Enemy('zombie', 10 * 16, 10 * 16);
    e.iframes = 0; e.hp = 1000; e.hpBarT = 0;
    e.onFire3T = 1; e.frostburn2T = 1; e.oiledT = 1;
    e.fixedUpdate(1, makeHooks() as never);
    expect(1000 - e.hp).toBe(60);
  });
  it('323 OnFire3 = 15 HP/s(:92632-92644 lifeRegen-30)', () => {
    expect(dotLoss('onFire3T')).toBe(15);
  });
  it('324 Frostburn2 = 25 HP/s(:92668-92680 lifeRegen-50)', () => {
    // ★issue#46 N06：50/t + batch 10（门槛 1200）→ 60 帧跨 2 批 = 20（残账 −600）
    expect(dotLoss('frostburn2T')).toBe(20);
  });
  it('337 TentacleSpike = 单层 3 HP/s(:92761-92779 num4×6)', () => {
    expect(dotLoss('spikeT')).toBe(3);
  });
  it('344 BloodButcherer = 单层 4 HP/s(:92786-92804 num6×8)', () => {
    expect(dotLoss('butcherT')).toBe(4);
  });
  it('375 Hemorrhage = 100 HP/s(:92604-92611 lifeRegen-200)', () => {
    // ★issue#46 N06：200/t + batch 40（门槛 4800）→ 60 帧跨 2 批 = 80（残账 −2400）
    expect(dotLoss('hemorrhageT')).toBe(80);
  });
});

describe('G7 提取表新增条目对账(tools/extract-projstatus.mjs 复杂形状)', () => {
  it('ai1==i 定向族(598/636/971/975/614)入表,带 gate+src', () => {
    // StrikeNPC :12421 先写 ai[1]=victimIndex 再调 StatusNPC → 首击恒真
    expect(TABLE['598']).toEqual([{ buff: 169, chance: 1, src: 11341, gate: 'ai1==i', durMin: 900, durMax: 900 }]);
    expect(TABLE['636']).toEqual([{ buff: 189, chance: 1, src: 11345, gate: 'ai1==i', durMin: 300, durMax: 300 }]);
    expect(TABLE['971']).toEqual([{ buff: 337, chance: 1, src: 11349, gate: 'ai1==i', durMin: 540, durMax: 540 }]);
    expect(TABLE['975']).toEqual([{ buff: 344, chance: 1, src: 11353, gate: 'ai1==i', durMin: 540, durMax: 540 }]);
    expect(TABLE['614']).toEqual([{ buff: 183, chance: 1, src: 11381, gate: 'ai1==i', durMin: 900, durMax: 900 }]);
  });
  it('remix 局部变量族(15/954/979)取基档,ALT 分支记 gate', () => {
    // 15(:10907-10914):1/2 掷 OnFire 300t
    expect(TABLE['15']).toEqual([{ buff: 24, chance: 0.5, src: 11570, gate: 'remixWorld→323', durMin: 300, durMax: 300 }]);
    // 954(1457:11397-11411):外层 1/2 × 互斥双分支(1/3→60-239t,2/3→60-119t)
    expect(TABLE['954']!.map((e) => [e.buff, e.chance, e.gate, e.durMin, e.durMax]))
      .toEqual([[24, 1 / 6, 'remixWorld→323', 60, 239], [24, 1 / 3, 'remixWorld→323', 60, 119]]);
    // 979(:10770-10784):基档 44 Frostburn,remix→324
    expect(TABLE['979']!.map((e) => [e.buff, e.gate, e.durMin, e.durMax]))
      .toEqual([[44, 'remixWorld→324', 60, 239], [44, 'remixWorld→324', 60, 119]]);
  });
  it('85 ai0 三元(1457:11660-11663)取 else 档 323,ai0==1→324 记 gate', () => {
    expect(TABLE['85']).toEqual([{ buff: 323, chance: 1, src: 11660, gate: 'ai0==1→324', durMin: 1200, durMax: 1200 }]);
  });
  it('694-696 setHuntressT2 套装门(1457:11440)Oiled 240-510t', () => {
    for (const t of ['694', '695', '696']) {
      expect(TABLE[t]).toEqual([{ buff: 204, chance: 1, src: 11440, gate: 'setHuntressT2', durMin: 240, durMax: 510 }]);
    }
  });
  it('全表条目均带 src 行号(落在 StatusNPC 1457:11176-11734 区间)', () => {
    for (const [k, list] of Object.entries(TABLE)) {
      for (const en of list) {
        expect(en.src, `type ${k} 缺 src`).toBeGreaterThanOrEqual(11176);
        expect(en.src, `type ${k} src 越界`).toBeLessThanOrEqual(11734);
      }
    }
  });
});

describe('G7 applyProjStatus 新条目贯通(15/85 表驱动化 + 694 套装门)', () => {
  it('15:1/2 掷 OnFire 5s(替代旧手工块,基档 24)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.49);
    const e: Record<string, number> = {};
    applyProjStatus(15, e);
    expect(e.onFireT).toBe(5);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const e2: Record<string, number> = {};
    applyProjStatus(15, e2);
    expect(e2.onFireT).toBeUndefined();
    vi.restoreAllMocks();
  });
  it('85:默认档 OnFire3 20s(替代旧手工块,ai0==1→324 登记 gate)', () => {
    const e: Record<string, number> = {};
    applyProjStatus(85, e);
    expect(e.onFire3T).toBe(20);
  });
  it('614(星尘细胞弹)→ StardustBleed 15s(183 字段贯通)', () => {
    const e: Record<string, number> = {};
    applyProjStatus(614, e);
    expect(e.stardustT).toBe(15);     // 900t
  });
  it('476 → SoulDrain 0.5s(151 字段贯通)', () => {
    const e: Record<string, number> = {};
    applyProjStatus(476, e);
    expect(e.soulDrainT).toBe(0.5);   // 30t
  });
  it('694 Oiled 套装门:无 ctx 不施加,有 setHuntressT2 施加 4-8.5s', () => {
    const plain: Record<string, number> = {};
    applyProjStatus(694, plain);      // 缺省 ctx → 门关
    expect(plain.oiledT).toBeUndefined();
    const worn: Record<string, number> = {};
    applyProjStatus(694, worn, { setHuntressT2: true });
    expect(worn.oiledT).toBeGreaterThanOrEqual(4);
    expect(worn.oiledT).toBeLessThanOrEqual(8.5);
  });
});
