// channel 族魔力交互修复回归（2026-08-22 武器审计 ❌ 2 项）：
//   ① channel 期魔力再生刷新（Player.cs:43143-43146）：原版 itemAnimation 持续 >0 期间
//      每帧 ItemCheck_ApplyManaRegenDelay → ApplyManaRegenerationDelay（:19517-19540
//      ManaV2 :19526-19537）把 manaRegenDelay 恒钉 4 → UpdateManaRegen 恒落 5% 滴流支
//      （flag3 :19563-19567/:19601-19604）。本仓 channel 弹（最后棱镜 633/充能爆破炮
//      460/魔法飞弹族 16·34·79/冰川之牙 1115）寿命 > useTime，manaAnimTicks 只在出手
//      拍登记（onManaItemUsed）→ useTime 耗尽即回满速回蓝 = channel 期白嫖魔力。
//      修复 = 实体侧 channelCb() 活跃期每 tick 调 Player.onChannelManaHold()（动画窗
//      钉 ≥1，下一帧 fixedUpdate 的 manaAnimTicks>0 支消费 → delay 钉 4）
//   ② 续发 payMana 接 ManaV2（CheckMana :53216-53253）：魔法飞弹族持按连发 = 循环重用
//      每拍 ItemCheck_TryStartUse(:52660-52690) → ItemCheck_ActuallyPayMana(:53277)
//      → CheckMana(pay:true)——空蓝照放（statMana=0 + DoRunOutOfManaEffect
//      :53258-53261 slowMagicUse=true）；此前蓝不足 return false 直接跳发，与主施法链
//      （Game.ts case 'magic' :9943-9961 内联同语义）不一致。修复 = Player.checkMana
//      端口（:53216-53253 直移植）+ Game 续发回调委托
// 手法：a-batch1.test.ts 的真 Player+fakeHooks 跑 fixedUpdate（再生整模型）+
//   weapon-prism-fix/missile-proj 的最小 mock GameHooks 直调实体 fixedUpdate（接线）。
import { describe, it, expect, afterEach } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { MagicMissileProj } from '../src/entities/MissileProj';
import { PrismProj, ChargedBlaster } from '../src/entities/PrismProj';
import { GlacierFangShot } from '../src/entities/proj1457';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

// ============ ① channel 期 delay 钉 4（Player.onChannelManaHold） ============

/** 地板世界：y=30 一行实心地板（x∈[12,40]），玩家落在 (20,27)（同 a-batch1） */
const mkWorld = (): World => {
  const w = new World(60, 60, 42, 'weapon-channel-mana');
  for (let x = 12; x <= 40; x++) w.store.setTileSilent(x, 30, 1 /* dirt */);
  return w;
};
const fakeHooks = (w: World, p?: Player) => ({
  world: w,
  player: p,
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
});

describe('channel 期魔力再生刷新（ItemCheck_ApplyManaRegenDelay :43143-43146）', () => {
  const mk = () => {
    const w = mkWorld();
    const p = new Player(20 * 16, 27 * 16, new Inventory());
    p.baseMaxMana = 100;
    for (let i = 0; i < 12; i++) p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);  // 落地稳定
    p.mana = 50; p.manaRegenCount = 0; p.manaRegenDelay = 0; p.manaAnimTicks = 0;
    return { w, p };
  };

  it('修复后：channel 活跃期动画窗续期 → 30t（>useTime 10）delay 恒钉 4/衰减 3，只吃 5% 滴流 2/t', () => {
    const { w, p } = mk();
    p.useTime = 10;
    p.onManaItemUsed();                       // 出手拍登记（Game case 'magic' 尾段）
    for (let t = 0; t < 30; t++) {
      p.vx = 10;                              // 移动档（不吃静止额外衰减,基线同 a-batch1）
      p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
      p.onChannelManaHold();                  // 实体侧 channelCb() 活跃期（Game.entities.update 在 player 后）
    }
    expect(p.manaRegenDelay).toBe(3);         // 钉 4（:19526-19537 statMana>0）→ 衰减 −1 = 3 ∈ (0,4)
    expect(p.manaRegenCount).toBe(60);        // 30t × 2（flag3 滴流：floor(34×0.75×0.05)=1 → 下限 2,:19600-19604）
    expect(p.mana).toBe(50);                  // 60 < 120 不结算 = channel 期不再白嫖满速回蓝
  });

  it('对照（修复前路径）：无续期 → t13 起动画窗耗尽 delay 归 0 回满速 25/t（白嫖签名）', () => {
    const { w, p } = mk();
    p.useTime = 10;
    p.onManaItemUsed();
    for (let t = 0; t < 13; t++) {
      p.vx = 10;
      p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
      // 无 onChannelManaHold —— manaAnimTicks 只够 10t
    }
    expect(p.manaRegenDelay).toBe(0);         // t11-13 衰减 3→2→1→0（flag2 满速支）
    expect(p.manaRegenCount).toBe(49);        // 10×2（滴流）+2+2（残桩）+25（t13 满速 floor(34×0.75)）
  });

  it('onChannelManaHold：空窗钉 ≥1；已有更大窗不缩（max 语义同 onManaItemUsed）', () => {
    const { p } = mk();
    p.manaAnimTicks = 0;
    p.onChannelManaHold();
    expect(p.manaAnimTicks).toBe(1);
    p.manaAnimTicks = 7;
    p.onChannelManaHold();
    expect(p.manaAnimTicks).toBe(7);
  });
});

// ============ ② CheckMana ManaV2 端口（Player.checkMana :53216-53253） ============

describe('CheckMana ManaV2（空蓝照放 + slowMagicUse,Player.cs:53216-53253）', () => {
  it('蓝够：扣魔返 true；入口清 slowMagicUse（:53217,上次过载残留每次重估）', () => {
    const p = new Player(0, 0, new Inventory());
    p.mana = 100;
    p.slowMagicUse = true;                    // 上一次空蓝过载残留
    expect(p.checkMana(20)).toBe(true);
    expect(p.mana).toBe(80);                  // if (pay) statMana -= num（:53220-53223）
    expect(p.slowMagicUse).toBe(false);       // :53217 入口清标记
  });

  it('蓝不足：恒返 true 照放（ManaV2）+ statMana=0（:53243/:53251）+ slowMagicUse=true（:53258-53261）', () => {
    const p = new Player(0, 0, new Inventory());
    p.mana = 5;
    p.slowMagicUse = false;
    expect(p.checkMana(20)).toBe(true);       // 不再 return false 跳发（审计 ❌ 修复点）
    // ★R24 翻案（2026-10-31 红蓝定谳,三轮连环错判终结）：不足支 statMana=0
    //  （原版全 Player.cs 仅 :53243/:53251 两处,ManaV2=true 默认下永不负值）。
    //  五百五十五刀（f2f38e02）曾改扣量直落可负（错锚 :5878=QuickBuff 有卫门扣减）
    //  → G38-A 首判沿 BJ738 D6「陈旧断言」改 toBe(-15)（错）→ R24 定谳真回归,
    //  src 已回原版语义。负 mana 实害=无下界下潜+回魔逐点爬回惩罚远重原版。
    expect(p.mana).toBe(0);
    expect(p.slowMagicUse).toBe(true);        // DoRunOutOfManaEffect（攻速窗 ×2.5 消费侧）
    // ★R24 判别锁（补）：0 蓝连发不再下潜（555 刀实害面——每拍全耗负值累积）
    for (let i = 0; i < 5; i++) expect(p.checkMana(20)).toBe(true);
    expect(p.mana).toBe(0);                   // 恒钉 0,禁负域回归
  });

  it('标记随重估自愈：空蓝置标 → 蓝恢复后再 CheckMana → 标记清除（每拍续发都走入口）', () => {
    const p = new Player(0, 0, new Inventory());
    p.mana = 0;
    p.checkMana(20);
    expect(p.slowMagicUse).toBe(true);
    p.mana = 50;
    p.checkMana(20);
    expect(p.slowMagicUse).toBe(false);
    expect(p.mana).toBe(30);
  });
});

// ============ ③ channel 弹在场续期接线（实体侧 channelCb 活跃期） ============

/** 实体直调 mock（同 weapon-prism-fix/missile-proj 先例）：player 带续期记录器 */
const mkEntityHooks = (rec: { holds: number }) => {
  const projectiles: unknown[] = [];
  const hooks = {
    world: new World(200, 200, 30, 'weapon-channel-mana-ent'),
    player: {
      x: 90 * TILE - 10, y: 90 * TILE - 21, w: 20, h: 42,
      get cx() { return this.x + this.w / 2; },
      get cy() { return this.y + this.h / 2; },
      dead: false, mana: 999,
      onChannelManaHold: () => { rec.holds++; },
    },
    enemies: () => [],
    critters: () => [],
    npcs: () => [],
    entities: { nextId: 1, add: (e: unknown) => { projectiles.push(e); } },
    playSfx: () => {},
    playSfxFiles: () => {},
    playSfxFile: () => {},
    spawnParticles: () => {},
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onProjectileDeath: () => {},
    notifyInventoryChanged: () => {},
  } as unknown as GameHooks;
  return { hooks, projectiles };
};

describe('channel 弹在场续期接线（channelCb 活跃期每 tick 调 onChannelManaHold）', () => {
  const made: MagicMissileProj[] = [];
  afterEach(() => {
    for (const m of [...made]) m.destroy();
    made.length = 0;
  });

  it('魔法飞弹族 16：操控期（mode 0）每 tick 续期；松手转索敌态即停（:40575-40593 itemAnimation 随 release 结束）', () => {
    const rec = { holds: 0 };
    const { hooks } = mkEntityHooks(rec);
    let holding = true;
    const m = new MagicMissileProj(60 * 16, 40 * 16, 6, 0, {
      projId: 16, damage: 35, knockback: 7.5, useTime: 22,
      channelCb: () => holding,
      aimCb: () => ({ x: 70 * 16, y: 40 * 16 }),
      payMana: () => true,
    });
    made.push(m);
    for (let i = 0; i < 5; i++) m.fixedUpdate(1 / 60, hooks);
    expect(rec.holds).toBe(5);
    holding = false;
    m.fixedUpdate(1 / 60, hooks);             // 松手拍：mode→1 索敌/直飞
    expect(rec.holds).toBe(5);                // 释放态不续期（原版 itemAnimation 同拍结束）
  });

  it('最后棱镜 633：channel 期每 tick 续期（充能 120t+ ≫ useTime 10）；断链即亡停续', () => {
    const rec = { holds: 0 };
    const { hooks } = mkEntityHooks(rec);
    let holding = true;
    const prism = new PrismProj(1, 0, 100, 0.25,
      () => holding, () => ({ x: 91 * TILE, y: 90 * TILE }), () => true);
    for (let i = 0; i < 10; i++) prism.fixedUpdate(1 / 60, hooks);
    expect(rec.holds).toBe(10);
    holding = false;
    prism.fixedUpdate(1 / 60, hooks);         // channel 门（:63700-63717）→ Kill
    expect(prism.dead).toBe(true);
    expect(rec.holds).toBe(10);
  });

  it('充能爆破炮 460：channel 期每 tick 续期（蓄力 180t ≫ useTime）；断链即亡停续', () => {
    const rec = { holds: 0 };
    const { hooks } = mkEntityHooks(rec);
    let holding = true;
    const bl = new ChargedBlaster(1, 0, 100, 2,
      () => holding, () => ({ x: 91 * TILE, y: 90 * TILE }), () => true);
    for (let i = 0; i < 10; i++) bl.fixedUpdate(1 / 60, hooks);
    expect(rec.holds).toBe(10);
    holding = false;
    bl.fixedUpdate(1 / 60, hooks);            // channel 门（:63562-63565）→ Kill
    expect(bl.dead).toBe(true);
    expect(rec.holds).toBe(10);
  });

  it('冰川之牙 1115：蓄力态每 tick 续期（慢施最长 150 拍 ≫ useTime 4）；释放后不续', () => {
    const rec = { holds: 0 };
    const { hooks } = mkEntityHooks(rec);
    let holding = true;
    const gf = new GlacierFangShot(800, 1440, 1, 0, 11, 2, {
      channel: () => holding,
      aim: () => ({ x: 1600, y: 1440 }),
      payMana: () => {},
      chargeRate: () => 1,
    });
    for (let i = 0; i < 20; i++) gf.fixedUpdate(1 / 60, hooks);
    expect(rec.holds).toBe(20);
    holding = false;
    gf.fixedUpdate(1 / 60, hooks);            // 释放帧（release 分支无续期）
    for (let i = 0; i < 5 && !gf.dead; i++) gf.fixedUpdate(1 / 60, hooks);
    expect(rec.holds).toBe(20);
  });
});
