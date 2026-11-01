// 26 机制审计遗留五项回归（对 1456 反编译源码逐项核对）
//   #1  仇恨 aggro 消费        NPC.cs:78485-78492（TryTrackingTarget 索敌距离）
//                             + :78549-78561（SetTargetTrackingValues 不转身门）
//   #19 玩家被击退             Player.cs:37908-37912（Hurt 击退段，固定 4.5/-3.5）
//   #20 减益主干表             Player.cs:18775-18904（NaturalLifeRegen DoT 顺序与数值）
//                             + Projectile.cs:11538-11553（感电授予链）
//   #14 生命果 1291            Player.cs:44671-44685（UseLifeFruit 400→500 门）
//   #6  月相 vs NPC 掉落       NPC.cs:79628+ NPCLoot 全段零 moonPhase 读点（结论测试）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Enemy } from '../src/entities/Enemy';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { BuffState, BuffType, BUFF_DEFS, buffTypeByVanilla } from '../src/stats/Buffs';
import { TileStore } from '../src/world/TileStore';
import { statusPlayer } from '../src/entities/projTargets';
import { fishingPowerMultiplier } from '../src/data/vanillaFishing';
import { shouldBestiaryGirlBeLycantrope } from '../src/data/townNpcProfiles';
import type { GameHooks } from '../src/entities/types';
import type { Player as PlayerT } from '../src/entities/Player';

const W = 80, H = 80;
function makeHooks() {
  const store = new TileStore(W, H);
  const player = new Player(40 * 16, 40 * 16, new Inventory());
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

/** 索敌公式单元桩：effectiveTargetDist/canTargetPlayerAt/seekDirX 只读
 *  cx/cy/w/h/aggro/useTime/itemAnimTicks（均为公开字段/getter） */
interface TargetStub {
  cx: number; cy: number; aggro: number; w: number; h: number;
  useTime: number; itemAnimTicks: number;
}
const targetStub = (over: Partial<TargetStub> = {}): TargetStub => ({
  cx: 600, cy: 300, aggro: 0, w: 20, h: 42, useTime: 0, itemAnimTicks: 0, ...over,
});
const asPlayer = (s: TargetStub) => s as unknown as PlayerT;

const SRC = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

// ==================== #1 仇恨（aggro）消费 ====================
describe('#1 aggro 索敌（NPC.cs:78485-78492 TryTrackingTarget）', () => {
  it('索敌有效距离 = 曼哈顿距离 - player.aggro（:78485-78491）', () => {
    // 敌 (100,50) 中心 → 玩家 (300,110)：|Δx|+|Δy| = 200+60 = 260
    const e = new Enemy('zombie', 100, 50);
    const p = targetStub({ cx: 300, cy: 110 });
    expect(e.effectiveTargetDist(asPlayer(p))).toBe(260);
    // 潜行 -750（蘑菇矿/变态刀档，Player.cs:25518/:25491）→ 260+750 = 1010
    expect(e.effectiveTargetDist(asPlayer(targetStub({ cx: 300, cy: 110, aggro: -750 })))).toBe(1010);
  });

  it('canTargetPlayerAt 索敌门按减 aggro 后的距离判定（潜行拉远索敌）', () => {
    const e = new Enemy('zombie', 100, 300);
    const range = 18 * 16;   // flyAI 18 格门
    // 200px < 288px → 索敌命中
    expect(e.canTargetPlayerAt(asPlayer(targetStub({ cx: 300, cy: 300 })), range)).toBe(true);
    // 同距离 + 星璇潜行 -1200（Player.cs:25557）→ 有效 1400 > 288 → 不索敌
    expect(e.canTargetPlayerAt(asPlayer(targetStub({ cx: 300, cy: 300, aggro: -1200 })), range)).toBe(false);
  });

  it('不转身门（NPC.cs:78549-78561）：潜行 + 未挥击 + 曾索敌 + 非Boss → 保留旧朝向', () => {
    const e = new Enemy('zombie', 100, 300);
    e.facing = 1;                 // 旧朝向朝右
    e.hadTarget = true;           // oldTarget 有效（:78553）
    const stealth = targetStub({ cx: 40, cy: 300, aggro: -750 });  // 玩家在左侧（raw=-1）
    expect(e.seekDirX(asPlayer(stealth))).toBe(1);   // 门生效：不转身
    // 无潜行（aggro>=0）→ 正常面向玩家
    expect(e.seekDirX(asPlayer(targetStub({ cx: 40, cy: 300 })))).toBe(-1);
  });

  it('首帧 oldTarget=-1（NPC.cs:6374）+ 挥击窗 itemAnimation!=0 均穿透不转身门', () => {
    // 首次索敌：oldTarget 无效 → 即使潜行也转身（:78553 flag=false）
    const fresh = new Enemy('zombie', 100, 300);
    fresh.facing = 1;
    expect(fresh.hadTarget).toBe(false);
    expect(fresh.seekDirX(asPlayer(targetStub({ cx: 40, cy: 300, aggro: -750 })))).toBe(-1);
    expect(fresh.hadTarget).toBe(true);
    // 挥击中（itemAnimation != 0，代理 useTime>0，:78552 num=false）→ 转身
    const swinging = new Enemy('zombie', 100, 300);
    swinging.facing = 1;
    swinging.hadTarget = true;
    expect(swinging.seekDirX(asPlayer(targetStub({ cx: 40, cy: 300, aggro: -750, useTime: 5 })))).toBe(-1);
    // Boss 恒穿透（:78554 flag2=!boss）
    const boss = new Enemy('eye_of_cthulhu', 100, 300);
    boss.facing = 1;
    boss.hadTarget = true;
    expect(boss.seekDirX(asPlayer(targetStub({ cx: 40, cy: 300, aggro: -750 })))).toBe(-1);
  });

  it('flyAI 主索敌门消费 aggro（Enemy.flyAI 18 格门 → canTargetPlayerAt）', () => {
    const { hooks } = makeHooks();
    // 玩家在敌 200px 内：正常进入追击（state=1）
    const near = new Enemy('demon_eye', 40 * 16, 40 * 16);
    near.iframes = 0;
    const rp = hooks.player as Player;
    rp.x = 40 * 16 + 200; rp.y = 40 * 16;
    near.fixedUpdate(1, hooks as never);
    expect(near.state).toBe(1);
    // 潜行（星璇 -1200）后同距离不再索敌：退回游荡（state=0）。
    // aggro 是 Player 只读 getter（依赖装备聚合），测试以鸭型桩注入（flyAI 仅读
    // dead/cx/cy/w/h/aggro，接触伤害走 hooks.damagePlayer 桩）
    const stub = {
      ...targetStub({ cx: 40 * 16 + 200, cy: 40 * 16, aggro: -1200 }),
      x: 40 * 16 + 200, y: 40 * 16, dead: false,
      buffs: new BuffState(),
      damage: () => 0,
    };
    (hooks as { player: unknown }).player = stub;
    const stealth = new Enemy('demon_eye', 40 * 16, 40 * 16);
    stealth.iframes = 0;
    stealth.fixedUpdate(1, hooks as never);
    expect(stealth.state).toBe(0);
  });
});

// ==================== #19 玩家被击退（Player.cs:37908-37912）====================
describe('#19 玩家击退（Player.Hurt :37908-37912 固定 4.5/-3.5）', () => {
  it('受击击退 = 4.5×hitDirection / -3.5（不按武器 kb 缩放）', () => {
    const p = new Player(40 * 16, 40 * 16, new Inventory());
    p.iframes = 0; p.hp = 100; p.vx = 0; p.vy = 0;
    const srcX = p.cx + 100;   // 伤害源在右 → 弹向左
    p.damage(10, srcX, p.cy);
    expect(p.vx).toBe(-4.5);   // :37910 velocity.X = 4.5 * hitDirection
    expect(p.vy).toBe(-3.5);   // :37911 velocity.Y = -3.5
  });

  it('击退同段 fallStart = position.Y/16（:37912）——从受击高度重计摔伤', () => {
    const p = new Player(40 * 16, 40 * 16, new Inventory());
    p.iframes = 0; p.hp = 100; p.vx = 0; p.vy = 0;
    p.fallStartY = p.y - 30 * 16;   // 已下落 30 格的累计
    p.damage(10, p.cx + 100, p.cy);
    expect(p.fallStartY).toBe(p.y);  // 摔伤起点重置为受击高度
  });

  it('knockback=false（hitDirection=0 语义）整段跳过', () => {
    const p = new Player(40 * 16, 40 * 16, new Inventory());
    p.iframes = 0; p.hp = 100; p.vx = 1.2; p.vy = 0.4;
    p.damage(10, p.cx + 100, p.cy, false);
    expect(p.vx).toBe(1.2);
    expect(p.vy).toBe(0.4);
  });
});

// ==================== #20 减益主干表（Player.cs:18775-18904）====================
describe('#20 减益主干 DoT 表（NaturalLifeRegen :18775-18904）', () => {
  it('主干数值：中毒 2 / 毒液 15 / 诅咒焰 12 HP/s（:18782/:18791/:18862）', () => {
    // apply 2 秒留余量：tick 先扣时长再结算（剩余 0 的帧 buff 已移除不结算）
    const b = new BuffState();
    b.apply(BuffType.Poisoned, 2);
    expect(b.tick(1)).toBe(-2);
    const b2 = new BuffState();
    b2.apply(BuffType.Venom, 2);
    expect(b2.tick(1)).toBe(-15);
    const b3 = new BuffState();
    b3.apply(BuffType.CursedInferno, 2);
    expect(b3.tick(1)).toBe(-12);
  });

  it('灵液(69) 防御 -15（ResetEffects statDefense -= 15）+ 破甲减半同档可叠算', () => {
    const b = new BuffState();
    expect(b.defenseBonus).toBe(0);
    b.apply(BuffType.Ichor, 1);
    expect(b.defenseBonus).toBe(-15);
  });

  it('感电(144) 基础 4 HP/s（:18899）；按住左右移动再 +16 HP/s（:18900-18903）', () => {
    const still = new BuffState();
    still.apply(BuffType.Electrified, 2);
    expect(still.tick(1)).toBe(-4);
    const moving = new BuffState();
    moving.electrifiedMoving = true;
    moving.apply(BuffType.Electrified, 2);
    expect(moving.tick(1)).toBe(-20);
  });

  it('感电登记：BuffID=144（任务面 146 为误记）、护士可清（Main.debuff[144] :8847）', () => {
    expect(BUFF_DEFS[BuffType.Electrified].vanillaBuff).toBe(144);
    expect(BuffState.DEBUFFS.has(BuffType.Electrified)).toBe(true);
    const b = new BuffState();
    b.apply(BuffType.Electrified, 5);
    expect(b.debuffCount()).toBe(1);
    b.clearDebuffs();
    expect(b.has(BuffType.Electrified)).toBe(false);
  });

  it('vanilla id 反查表必须是数值枚举键（Object.keys 字符串陷阱）', () => {
    const t = buffTypeByVanilla(144);
    expect(typeof t).toBe('number');
    expect(t).toBe(BuffType.Electrified);
    // 读档恢复链（BuffState.applySaved 同表）也必须落数值键——用可落盘的 26 WellFed
    // （感电 144 在 Main.buffNoSave 名单 Main.cs:8896-8990，applySaved 按原版过滤;
    //   ★BJ742-A R21-④ 起 156 Stoned 亦入名单（Main.cs:9124）——旧夹具 156 随刀换 26）
    const b = new BuffState();
    b.applySaved([[26, 3]]);
    expect(b.has(BuffType.WellFed)).toBe(true);
    expect(b.active.get(BuffType.WellFed)).toBe(3);
  });

  it('石化(156) 在 Main.debuff 表（Main.cs:8842）→ 护士可清', () => {
    expect(BuffState.DEBUFFS.has(BuffType.Stoned)).toBe(true);
    expect(BUFF_DEFS[BuffType.Stoned].vanillaBuff).toBe(156);
  });

  it('感电授予链（Projectile.cs:11542-11545/:11550-11553）：435 概率 300t、437 恒 240-480t', () => {
    const { hooks, player } = makeHooks();
    // 437 千兆电枪矛：恒授予，60×Next(4,9) tick = 4-8 秒
    statusPlayer(hooks as never, 437);
    const got = player.buffs.active.get(BuffType.Electrified) ?? 0;
    expect(got).toBeGreaterThanOrEqual(4);
    expect(got).toBeLessThanOrEqual(8);
    expect(player.buffs.has(BuffType.Electrified)).toBe(true);
    // 435 火星炮塔弹：Next(3)!=0 = 2/3 概率，命中档恒 5 秒
    let hits = 0, miss = 0;
    for (let i = 0; i < 300; i++) {
      (player as Player).buffs.remove(BuffType.Electrified);
      statusPlayer(hooks as never, 435);
      if (player.buffs.has(BuffType.Electrified)) {
        hits++;
        expect(player.buffs.active.get(BuffType.Electrified)).toBe(5);
      } else miss++;
    }
    expect(hits).toBeGreaterThan(0);   // 统计门：两支都应出现
    expect(miss).toBeGreaterThan(0);
  });
});

// ==================== #14 生命果 1291（Player.cs:44671-44685）====================
describe('#14 生命果 UseLifeFruit（Player.cs:44671-44685）', () => {
  it('使用链门与数值：≥400 且 <500 → +5，越界 toast 不消耗（Game.updateUse :5304+）', () => {
    const src = SRC(join('core', 'Game.ts'));
    const block = src.slice(src.indexOf('vi_1291_life_fruit'));
    // :44672 type==1291 门 + :44673 statLifeMax>=400 && <500 门
    expect(block).toContain('baseMaxHp < 400');
    expect(block).toContain('baseMaxHp >= 500');
    // :44676-44678 statLifeMax/2/Life 各 +5
    expect(block).toContain('baseMaxHp += 5');
    expect(block).toMatch(/hp = Math\.min\(this\.player\.maxHp, this\.player\.hp \+ 5\)/);
    // 消耗（ApplyItemTime 后 stack--）+ 成就 HandleSpecialEvent(2)（:44683）
    expect(block).toContain("removeHeld(1)");   // SW-AZ1：手持消耗统一入口（镜像槽 58 消费改道）
    expect(block).toContain('handleSpecialEvent(2');
  });
});

// ==================== #6 月相 vs NPC 掉落（结论锁定）====================
describe('#6 月相影响面（NPC.cs:79628+ NPCLoot 零 moonPhase 读点）', () => {
  it('掉落链与月相零耦合：NpcDrops/Enemy 源码无 moonPhase 读点', () => {
    expect(SRC(join('drops', 'NpcDrops.ts'))).not.toContain('moonPhase');
    expect(SRC(join('entities', 'Enemy.ts'))).not.toContain('moonPhase');
  });

  it('月相实际消费①：钓鱼力（Player.cs:41583-41598 满月×1.1 / 新月×0.9）', () => {
    const base = { raining: false, cloudBGAlpha: 0, dayTime: false, time: 0, bloodMoon: false };
    expect(fishingPowerMultiplier({ ...base, moonPhase: 0 })).toBeCloseTo(1.1, 6);   // 满月
    expect(fishingPowerMultiplier({ ...base, moonPhase: 1 })).toBeCloseTo(1.05, 6);  // 亏凸
    expect(fishingPowerMultiplier({ ...base, moonPhase: 7 })).toBeCloseTo(1.05, 6);  // 盈凸
    expect(fishingPowerMultiplier({ ...base, moonPhase: 3 })).toBeCloseTo(0.95, 6);  // 残月
    expect(fishingPowerMultiplier({ ...base, moonPhase: 5 })).toBeCloseTo(0.95, 6);  // 娥眉
    expect(fishingPowerMultiplier({ ...base, moonPhase: 4 })).toBeCloseTo(0.9, 6);   // 新月
    expect(fishingPowerMultiplier({ ...base, moonPhase: 2 })).toBeCloseTo(1, 6);     // 下弦无档
  });

  it('月相实际消费②：动物学家狼人变身（NPC.cs:94962-94972 满月夜）', () => {
    expect(shouldBestiaryGirlBeLycantrope(0, false, false)).toBe(true);   // 满月夜
    expect(shouldBestiaryGirlBeLycantrope(0, false, true)).toBe(false);   // 满月昼
    expect(shouldBestiaryGirlBeLycantrope(4, false, false)).toBe(false);  // 新月夜
    expect(shouldBestiaryGirlBeLycantrope(4, true, false)).toBe(true);    // 血月夜恒狼人
  });
});
