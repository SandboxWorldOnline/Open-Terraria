// ★BJ740-A（issue #30）：配饰一致性审计 19 项——装备聚合面行为锁（ACC01-07/10/14/19
// + ACC02 族单计 + ACC15-18 资格）+ 变异恰红。
// 权威锚（Terarria1457 亲读,台账 /tmp/recon/bj740a-ledger.md）：
//   ACC01 case 3991 :14511-14516（表承载单计）;ACC02 消费 :13068-13083 post-loop
//   单计/置位 :14616-14629+:14690-14715;ACC03 :14766-14772→:13084-13087;ACC04
//   :15166/:15170 直赋;ACC05 :15122/:15494 直赋;ACC06 :15137/:15507 直赋;
//   ACC07 :15531-15537（899=裸 dayTime 含日食）;ACC10 :13222-13225 shieldSlot>0
//   + :13175-13178 4760 持有支;ACC14 :15633-15637（904 无 22）;ACC19 :14483-14493
//   !hide 门 + ApplyEquipVanity :14335-14340 无门直赋。
import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { SUMMON_GEAR } from '../src/data/vanillaSummonStats';
import { withMutation, readFileSyncGuarded } from './mutation-guard';

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};
const mkPlayer = (): Player => new Player(0, 0, new Inventory());
/** 装备 vids 到配饰槽 3 起（顺序=槽序,后槽覆盖语义的测试基座） */
const equip = (p: Player, ...vids: number[]): void => {
  vids.forEach((v, i) => { p.inv.armor[3 + i] = { id: iid(v), stack: 1 }; });
};

describe('BJ740-A ACC01-07：聚合面行为锁', () => {
  it('ACC01 奥术花 3991：魔伤+5%/魔暴+5 单计（json '+"'3991'"+' 表承载,旧手写支双计已删）', () => {
    const p = mkPlayer();
    equip(p, 3991);
    expect(p.equipStats.dmgMagic).toBeCloseTo(0.05, 6);
    expect(p.equipStats.critMagic).toBe(5);
    // manaFlower 旗与 -8% 耗魔链保持（:13058-13062）
    expect(p.equipStats.manaFlower).toBe(true);
    expect(p.equipStats.manaCostOff).toBeCloseTo(0.08, 6);
  });

  it('ACC02 标签族布尔单计：6156+6163 → 时长3/上限3;6158+6162 → 上限2/鞭程0.1;6156+6158+6159 → 4/3', () => {
    const a = mkPlayer(); equip(a, 6156, 6163);
    expect(a.equipStats.tagEffectDuration).toBe(3);   // 基1+Silver2（族内两件只计一次）
    expect(a.equipStats.maxTagEffects).toBe(3);       // 基1+Silver1+Wicked1
    const b = mkPlayer(); equip(b, 6158, 6162);
    expect(b.equipStats.maxTagEffects).toBe(2);       // 基1+Mobius1（6162 同族不叠）
    expect(b.equipStats.whipRange).toBeCloseTo(0.1, 6);
    expect(b.equipStats.accSnakeBand).toBe(true);     // 6162 蛇环旗照置
    const c = mkPlayer(); equip(c, 6156, 6158, 6159);
    expect(c.equipStats.maxTagEffects).toBe(4);       // 三族各一（报告 §14 满配值不变）
    expect(c.equipStats.tagEffectDuration).toBe(3);
    // 单件族值（batch-d-tagstack 既有锁面同值回归）
    const d = mkPlayer(); equip(d, 6163);
    expect(d.equipStats.tagEffectDuration).toBe(3);
    expect(d.equipStats.maxTagEffects).toBe(3);
    // 表形锁：族布尔取代逐件 tagDur/maxTag（旧死键不得回流）
    expect(SUMMON_GEAR[6156]).toEqual({ silverBracer: true });
    expect(SUMMON_GEAR[6162]).toEqual({ mobiusStrip: true, snakeBand: true });
    expect(SUMMON_GEAR[6163]).toEqual({ silverBracer: true, wickedArmlet: true });
    expect((SUMMON_GEAR[6156] as Record<string, unknown>).tagDur).toBeUndefined();
    expect((SUMMON_GEAR[6158] as Record<string, unknown>).whipRange).toBeUndefined();
  });

  it('ACC03 浮漂族钓力 +10 单计：5139+5146 双戴 → fishingSkill=10（旧逐件 +20）', () => {
    const p = mkPlayer();
    equip(p, 5139, 5146);
    expect(p.equipStats.fishingSkill).toBe(10);
    const single = mkPlayer();
    equip(single, 5139);
    expect(single.equipStats.fishingSkill).toBe(10);
  });

  it('ACC04 冲刺槽序直赋：3097→977 = dash 1;977→3097 = dash 2（旧 max 两序恒 2）', () => {
    const a = mkPlayer(); equip(a, 3097, 977);
    expect(a.equipStats.dash).toBe(1);
    const b = mkPlayer(); equip(b, 977, 3097);
    expect(b.equipStats.dash).toBe(2);
  });

  it('ACC05 跑靴槽序直赋：898→54 = accRunSpeed 6;54→898 = 6.75（旧 max 两序恒 6.75）', () => {
    const a = mkPlayer(); equip(a, 898, 54);
    expect(a.equipStats.accRunSpeed).toBeCloseTo(6, 6);
    const b = mkPlayer(); equip(b, 54, 898);
    expect(b.equipStats.accRunSpeed).toBeCloseTo(6.75, 6);
  });

  it('ACC06 火箭靴档位槽序直赋：5000→128 = 1;128→5000 = 4（旧 max 两序恒 4）', () => {
    const a = mkPlayer(); equip(a, 5000, 128);
    expect(a.equipStats.rocketBoots).toBe(1);
    const b = mkPlayer(); equip(b, 128, 5000);
    expect(b.equipStats.rocketBoots).toBe(4);
  });

  it('ACC07 太阳石 899 日食门：dayTime+eclipse（nightPhase=true）→ 复合加成在;夜晚 → 无', () => {
    const p = mkPlayer();
    equip(p, 899);
    // 日食相：isDay=true + eclipse=true → nightPhase=true——899 走裸 dayTime 门仍生效
    (p as unknown as { dayTime: boolean }).dayTime = true;
    (p as unknown as { nightPhase: boolean }).nightPhase = true;
    expect(p.equipStats.def).toBe(4);                       // 天界石复合 def+4
    expect(p.equipStats.dmgMagic).toBeCloseTo(0.1, 6);      // 四系伤 +10%
    expect(p.equipStats.critMagic).toBe(2);
    // 夜晚：899 关（900 才开）
    const night = mkPlayer();
    equip(night, 899);
    (night as unknown as { dayTime: boolean }).dayTime = false;
    (night as unknown as { nightPhase: boolean }).nightPhase = true;
    expect(night.equipStats.def).toBe(0);
    // 月亮石 900 对照：日食相仍开（!day||eclipse）
    const moon = mkPlayer();
    equip(moon, 900);
    (moon as unknown as { dayTime: boolean }).dayTime = true;
    (moon as unknown as { nightPhase: boolean }).nightPhase = true;
    expect(moon.equipStats.def).toBe(4);
  });

  it('ACC10 举盾资格：156 钴盾 shieldSlot=1 → shieldItem true;hide 不遮效果面', () => {
    const p = mkPlayer();
    equip(p, 156);
    expect(p.equipStats.shieldItem).toBe(true);
    // hide 只遮视觉（accDraw）,GrantArmorBenefits :13222 无 hide 门
    p.hideVisibleAccessory[3] = true;
    expect(p.equipStats.shieldItem).toBe(true);
    expect(p.equipStats.accDraw.shield).toBe(0);            // 视觉面被 hide 门拦
  });

  it('ACC14 反诅咒咒语 904：免疫集 = {35 沉默, 23 诅咒}，不含 22 黑暗', () => {
    const p = mkPlayer();
    equip(p, 904);
    void p.equipStats;                                       // getter 副作用灌 immuneVanilla
    const immune = Array.from(p.buffs.immuneVanilla).sort((a, b) => a - b);
    expect(immune).toEqual([23, 35]);
  });
});

describe('BJ740-A ACC19：浮漂弹型覆写（可见性/槽序/时装）', () => {
  it('功能槽槽序直赋：5146(槽3)+5139(槽4) → overrideFishingBobber=986（低档后槽可达）', () => {
    const p = mkPlayer();
    equip(p, 5146, 5139);
    expect(p.equipStats.overrideFishingBobber).toBe(986);    // 5139 → 986 直赋覆盖
  });
  it('hide 门：前槽隐藏 → 后槽可见者胜;全隐藏 → -1（:14483-14493 !hide 门内）', () => {
    const p = mkPlayer();
    equip(p, 5139, 5146);
    p.hideVisibleAccessory[4] = true;                        // 5146 隐藏 → 5139 的 986 生效
    expect(p.equipStats.overrideFishingBobber).toBe(986);
    p.hideVisibleAccessory[3] = true;                        // 双隐藏 → 无覆写
    expect(p.equipStats.overrideFishingBobber).toBe(-1);
    // 钓力独立于可见性（accFishingBobber 旗不受 hide 门 :14766）
    expect(p.equipStats.fishingSkill).toBe(10);
  });
  it('时装槽覆盖（ApplyEquipVanity :14335-14340 无 hide 门）：armor[13]=5146 覆盖功能槽 5139', () => {
    const p = mkPlayer();
    equip(p, 5139);
    p.inv.armor[13] = { id: iid(5146), stack: 1 };
    expect(p.equipStats.overrideFishingBobber).toBe(993);    // 5146 → 993
    expect(p.equipStats.fishingSkill).toBe(10);              // 钓力旗只出自功能轮
  });
});

describe('BJ740-A ACC15-18：装备资格数据面', () => {
  it('ACC15 手机 5 件误资格摘除：3124/5358-5361 功能/时装槽均拒（原版 case 块无 accessory）', () => {
    for (const vid of [3124, 5358, 5359, 5360, 5361]) {
      const inv = new Inventory();
      expect(inv.armorAccepts(3, iid(vid)), `vid ${vid} 功能槽`).toBe(false);
      expect(inv.armorAccepts(13, iid(vid)), `vid ${vid} 时装槽`).toBe(false);
    }
  });
  it('ACC16-18 音乐盒/变声/巨柱补资格：样本 562/215/5113/5598 功能+时装槽均收（120 件）', () => {
    for (const vid of [562, 563, 1965, 6146, 215, 5484, 5509, 5534, 5113, 5598, 5599, 5655]) {
      const inv = new Inventory();
      expect(inv.armorAccepts(3, iid(vid)), `vid ${vid} 功能槽`).toBe(true);
      expect(inv.armorAccepts(13, iid(vid)), `vid ${vid} 时装槽`).toBe(true);
    }
  });
  it('数据面基数锁：音乐盒 101 + 变声 15 + 巨柱 4 = 120 件 {acc:0,van:1}', async () => {
    const { statOfInternal } = await import('../src/data/vanillaItemStats');
    const { MUSIC_BOX_ITEM_BY_STYLE } = await import('../src/data/musicBoxStyles');
    const voice = [215, 5484, 5485, 5499, 5500, 5501, 5502, 5503, 5504, 5505, 5506, 5507, 5508, 5509, 5534];
    const monolith = [5113, 5598, 5599, 5655];
    const all = [...MUSIC_BOX_ITEM_BY_STYLE, ...voice, ...monolith];
    expect(all.length).toBe(120);
    for (const v of all) {
      expect(statOfInternal(iid(v)), `vid ${v} 条目`).toEqual({ acc: 0, van: 1 });
    }
  });
});

// ============ 变异恰红（Player.ts/Arrow.ts 本刀域;Game.ts 并行热文件禁变异窗） ============
describe('BJ740-A 变异恰红', () => {
  const PLAYER = join(process.cwd(), 'src', 'entities', 'Player.ts');
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj740a-accessory-consistency.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
      // ★BJ743-A（R24 SEV-5 衍生）：补 *_MUT 家族旗——变异子 vitest 免三 vite 钩子
      //   审计（BJ728-A skipAuditsForMutChildren 判据 = env *_MUT$|*_MUT_SKIP$）。
      env: { ...process.env, SW_BJ740A_MUT: '1' },
    });
  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, { label: `BJ740-A ${filter}` });
  };

  it('M1 ACC01 双计回潮（critMagic 表消费 ×2）→ 奥术花单计锁红', () => {
    mutate(PLAYER,
      'if (fx.critMagic) critMagic += fx.critMagic;',
      'if (fx.critMagic) { critMagic += fx.critMagic; critMagic += fx.critMagic; } /* BJ740A-M1 */',
      'ACC01 奥术花');
  });
  it('M2 ACC02 族单计回潮（Silver maxTag +1→+2）→ 6156+6163 上限锁红', () => {
    mutate(PLAYER,
      'if (accSilverBracer) { tagEffectDuration += 2; maxTagEffects += 1; }',
      'if (accSilverBracer) { tagEffectDuration += 2; maxTagEffects += 2; } /* BJ740A-M2 */',
      'ACC02 标签族');
  });
  it('M3 ACC03 族单计回潮（fish += 10→+= 10/件双计面）→ 双浮漂钓力锁红', () => {
    mutate(PLAYER,
      'if (accFishingBobber) fish += 10;',
      'if (accFishingBobber) fish += 20; /* BJ740A-M3 */',
      'ACC03 浮漂族');
  });
  it('M4 ACC04 直赋回潮（dash=fx.dashType→Math.max）→ 槽序锁红', () => {
    mutate(PLAYER,
      'if (fx.dashType) dash = fx.dashType;',
      'if (fx.dashType) dash = Math.max(dash, fx.dashType); /* BJ740A-M4 */',
      'ACC04 冲刺槽序');
  });
  it('M5 ACC05 直赋回潮（runSpeed 直赋→Math.max）→ 槽序锁红', () => {
    mutate(PLAYER,
      'runSpeed = fx.runSpeed;',
      'runSpeed = Math.max(runSpeed, fx.runSpeed); /* BJ740A-M5 */',
      'ACC05 跑靴槽序');
  });
  it('M6 ACC07 日食门回潮（899 裸 dayTime→!nightPhase）→ 日食相锁红', () => {
    mutate(PLAYER,
      'if (accVid === 899 && this.dayTime) skyStone = true;',
      'if (accVid === 899 && !this.nightPhase) skyStone = true; /* BJ740A-M6 */',
      'ACC07 太阳石');
  });
  it('M7 ACC10 资格门窄化（shield>0→shield>1）→ 钴盾资格锁红', () => {
    mutate(PLAYER,
      'if (grantArmorBenefits && (accDrawSlotsOf(accVid)?.shield ?? 0) > 0) shieldItem = true;',
      'if (grantArmorBenefits && (accDrawSlotsOf(accVid)?.shield ?? 0) > 1) shieldItem = true; /* BJ740A-M7 */',
      'ACC10 举盾资格');
  });
  it('M8 ACC19 hide 门摘除 → 隐藏浮漂覆写锁红', () => {
    mutate(PLAYER,
      'if (!this.hideVisibleAccessory[i]) bobberOverride = 986 + (accVid - 5139);',
      'bobberOverride = 986 + (accVid - 5139); /* BJ740A-M8 */',
      'hide 门：前槽隐藏');
  });
});

// ============ ACC09 结构锁（Game.ts 并行热文件——只读锁,禁变异窗） ============
describe('BJ740-A ACC09：锐刺箭 +1 结构锁（Game.ts 只读）', () => {
  it('ammoBonus 链含 accSharpBarb && isArrowKind ? +1 门（Player.cs:54186-54189）', () => {
    const src = readFileSyncGuarded(join(process.cwd(), 'src', 'core', 'Game.ts'), 'utf8') as string;
    expect(src).toContain('+ (eq.accSharpBarb && isArrowKind ? 1 : 0)');
    expect(src).toContain('const ammoBonus = bowRes.ammoBonus + (sandSwap?.bonus ?? 0)');
  });
});
