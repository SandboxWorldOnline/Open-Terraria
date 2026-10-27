// 潜行度语义修复批回归（近战代理登记超范围项 2026-08-23，标杆 Terarria1457）：
//   ① Player.stealth 初值 = 1（Player.cs:1545 `public float stealth = 1f;`）——
//      语义 1=无潜行(全可见)/0=满潜行，越低越隐；此前写 0 = 出生即"满潜行"
//   ② 无潜行装 else 分支 stealth = 1（Player.cs:26094-26097 `else { stealth = 1f; }`）——此前写 0
//   ③ 消费方向统一（加成全走 (1−stealth)，1457 消费式）：
//        变态刀近战伤 +3×(1−s)        :25970
//        星璇远程伤 ×(1+0.8×(1−s))    :26043
//        蘑菇矿远程同向（Remap 档）    :26015-26018
//        星璇移速 ×0.3 全程无 stealth 门 :26046-26047
//        关潜行后回升 +0.04/t 至 1     :26052-26060
//   ⑩-⑫ 收尾三微差（2026-08-23）：蘑菇矿静止阈 maxRunSpeed−0.1（:25985）/ 蘑菇矿
//      stealthTimer=30 衰减拍语义、无 ==0 门（:25991/:26019-26021）/ 星璇双击 !mount.Active（:57445-57447）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!] ?? -1;
/** 裸构造 hp=0（Spawn 初始化不在构造内）——fixedUpdate 前须回满，否则 tick2 起走死亡早退 */
const mkPlayer = () => {
  const p = new Player(60 * 16, 90 * 16, new Inventory());
  p.hp = p.maxHp;
  return p;
};

// ---- fixedUpdate 桩环境（a-batch2 summon-r6 同款） ----
// H=200：bordersMovement 底边出界即死线 = hPx−640px（Player.ts:5629 ByOther 21），
// 120 格世界死线 1280px < 出生 1440px 会秒杀玩家——世界须高出生点 +640px 以上
const W = 200, H = 200;
function makeHooks(player: Player): GameHooks {
  // ★SW-FX44：夹具换真 World（wing-flight 同法）。曾喂 {store,h,lavaLine,…} 半成品——
  // SW-FX20 NaN 防灌带（Player.ts 深度重力 num6 NaN→0.25 档）把夹具世界重力打成
  // 0.4×0.25=0.1：40 拍 settle 落不到地（160px 需 ~24 拍@0.4,0.1 档只走 ~82px）→
  // ④ 静止衰减分支（|vy|<0.1 门）不达 / ⑩⑪ vy=0.1 混入 |v| 轴（3.0→3.1）。
  // 非 1457 语义债,生产面 game.world 恒为完整对象（FX40 定谳=夹具债）。
  const w = new World(W, H, 7, 'stealth-fixture');
  for (let x = 0; x < W; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;                     // ★SW-FX20 worldgen 必设位（num6 分母面）
  w.lavaLine = 90;                         // 旧夹具语义保留
  const hooks: GameHooks = {
    world: w as never,
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

// ---------------------------------------------------------------------------
// ① 初值 1（Player.cs:1545）
// ---------------------------------------------------------------------------
describe('① stealth 初值 = 1（:1545 stealth=1f）', () => {
  it('出生即无潜行态（旧值 0 = 出生满潜行：变态刀/潜行装首帧吃满加成、渲染近全隐）', () => {
    const p = mkPlayer();
    expect(p.stealth).toBe(1);
    expect(p.vortexStealthActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ② 无潜行装 else 分支 = 1（:26094-26097）
// ---------------------------------------------------------------------------
describe('② 无潜行装 else 分支写 1（:26094-26097）', () => {
  it('空装 fixedUpdate 一 tick → stealth=1（旧值 0）', () => {
    const p = mkPlayer();
    p.fixedUpdate(1, makeHooks(p));
    expect(p.stealth).toBe(1);
    expect(p.vortexStealthActive).toBe(false);
  });

  it('残值归一：手置 0（满潜行残态）后一 tick 被 else 分支拉回 1（:26096 无条件直写）', () => {
    const p = mkPlayer();
    p.stealth = 0;
    p.fixedUpdate(1, makeHooks(p));
    expect(p.stealth).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ③ 消费方向（加成全走 1−stealth：越隐越强）
// ---------------------------------------------------------------------------
describe('③ 消费方向 = (1−stealth)（:25970/:26043/:26015-26018）', () => {
  it('变态刀 3106 近战伤：满潜行(0) 比无潜行(1) 恰 +3（:25970 meleeDamage += 3f×(1−s)）', () => {
    const p = mkPlayer();
    p.inv.slots[0] = { id: iid(3106), stack: 1 };
    p.stealth = 1;
    const visible = p.damageMult('melee');
    p.stealth = 0;
    const cloaked = p.damageMult('melee');
    expect(cloaked - visible).toBeCloseTo(3, 6);
  });

  it('星璇套远程伤：满潜行(0) 池加算恰 +0.8（:26043 rangedDamage += 0.8f×(1−s)——★BJ723-A R01 乘数改回池加算）', () => {
    const p = mkPlayer();
    p.inv.armor[0] = { id: iid(2757), stack: 1 };
    p.inv.armor[1] = { id: iid(2758), stack: 1 };
    p.inv.armor[2] = { id: iid(2759), stack: 1 };
    expect(p.equipStats.vortexSet).toBe(true);
    p.vortexStealthActive = true;   // BJ725-A D2 改判史注：三消费位补开关门后,潜行加成断言须先开开关（原版 :26027-26052 全在块内）
    p.stealth = 1;
    const visible = p.rangedDamageMult('arrow');
    p.stealth = 0;
    const cloaked = p.rangedDamageMult('arrow');
    // 套件本体 fx 0.16+0.12+0.08 = 0.36 入池（:14004/:14010/:14015）→ 池 1.36→2.16，
    // 加算 Δ 恰 +0.8（旧乘数码 = 1.36×1.8 = 2.448，Δ +1.088 越多基伤越放大）
    expect(visible).toBeCloseTo(1.36, 6);
    expect(cloaked).toBeCloseTo(2.16, 6);
    expect(cloaked - visible).toBeCloseTo(0.8, 6);
  });

  it('蘑菇矿套远程伤同向：满潜行(0) > 无潜行(1)（:26015-26018 Remap(1→0.75) 档，方向回归）', () => {
    const p = mkPlayer();
    p.inv.armor[0] = { id: iid(1546), stack: 1 };
    p.inv.armor[1] = { id: iid(1549), stack: 1 };
    p.inv.armor[2] = { id: iid(1550), stack: 1 };
    expect(p.equipStats.shroomiteSet).toBe(true);
    p.stealth = 1;
    const visible = p.rangedDamageMult('arrow');
    p.stealth = 0;
    expect(p.rangedDamageMult('arrow')).toBeGreaterThan(visible);
  });

  it('星璇移速 ×0.3 全程生效、无 stealth 门（:26046-26047 accRunSpeed/maxRunSpeed ×= 0.3f 在', () => {
    //    vortexStealthActive 块内无条件执行——旧 `&& stealth>0` 门在满潜行后反而解除减速）
    const src = readFileSync(new URL('../src/entities/Player.ts', import.meta.url), 'utf8')
      .replace(/\/\/.*$/gm, '');
    expect(src).toMatch(/this\.vortexStealthActive \? 0\.3 : 1/);
    expect(src).not.toMatch(/stealth > 0 \? 0\.3/);
  });

  it('星璇关潜行后回升 +0.04/t 至 1（:26052-26060 else stealth += 0.04f 钳 1——缺段则恒 0 永久隐身）', () => {
    const p = mkPlayer();
    p.inv.armor[0] = { id: iid(2757), stack: 1 };
    p.inv.armor[1] = { id: iid(2758), stack: 1 };
    p.inv.armor[2] = { id: iid(2759), stack: 1 };
    p.stealth = 0;                       // 满潜行残态（双击关后）
    p.vortexStealthActive = false;
    p.fixedUpdate(1, makeHooks(p));
    expect(p.stealth).toBeCloseTo(0.04, 6);
    for (let i = 0; i < 30; i++) p.fixedUpdate(1, makeHooks(p));
    expect(p.stealth).toBe(1);           // 25t 回满后钳 1（:26057-26060）
  });
});

// ---------------------------------------------------------------------------
// ④-⑨ 潜行系统六项补债（2026-08-23 审计批，标杆 Terarria1457）
// ---------------------------------------------------------------------------
const mkShroomite = () => {
  const p = mkPlayer();
  p.inv.armor[0] = { id: iid(1546), stack: 1 };
  p.inv.armor[1] = { id: iid(1549), stack: 1 };
  p.inv.armor[2] = { id: iid(1550), stack: 1 };
  return p;
};
const mkVortex = () => {
  const p = mkPlayer();
  p.inv.armor[0] = { id: iid(2757), stack: 1 };
  p.inv.armor[1] = { id: iid(2758), stack: 1 };
  p.inv.armor[2] = { id: iid(2759), stack: 1 };
  return p;
};

// ---------------------------------------------------------------------------
// ④ 变态刀静止衰减系数 0.02（:25944 `stealth -= 0.02f`——曾误 0.015=蘑菇矿档）
// ---------------------------------------------------------------------------
describe('④ 变态刀静止衰减 0.02/t（:25944）', () => {
  it('落地静止每 t 恰 −0.02', () => {
    const p = mkPlayer();
    p.inv.slots[0] = { id: iid(3106), stack: 1 };
    const hooks = makeHooks(p);
    for (let i = 0; i < 40; i++) p.fixedUpdate(1, hooks);   // 落地站稳（vx=vy=0）
    p.stealth = 1;
    p.fixedUpdate(1, hooks);
    expect(p.stealth).toBeCloseTo(0.98, 6);
    p.fixedUpdate(1, hooks);
    expect(p.stealth).toBeCloseTo(0.96, 6);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 移动回升 +0.1/t 与骑坐骑归 1（变态刀 :25957-25964 / 蘑菇矿 :26010-26013）
// ---------------------------------------------------------------------------
describe('⑤ 移动/坐骑回升（:25957-25960/:25961-25964/:26010-26013）', () => {
  it('变态刀移动中回升 +0.1/t（else 段曾整缺=移动后潜行度冻结）', () => {
    const p = mkPlayer();
    p.inv.slots[0] = { id: iid(3106), stack: 1 };
    const hooks = makeHooks(p);
    for (let i = 0; i < 40; i++) p.fixedUpdate(1, hooks);
    p.stealth = 0.5;
    p.vx = 1;                              // 非静止 → else 回升段
    p.fixedUpdate(1, hooks);
    expect(p.stealth).toBeCloseTo(0.6, 6);
  });

  it('变态刀骑坐骑 stealth 直归 1（:25961-25964 mount.Active → stealth=1f）', () => {
    const p = mkPlayer();
    p.inv.slots[0] = { id: iid(3106), stack: 1 };
    const hooks = makeHooks(p);
    p.mount.active = true;
    p.stealth = 0.5;
    p.fixedUpdate(1, hooks);
    expect(p.stealth).toBe(1);
  });

  it('蘑菇矿骑坐骑 stealth 直归 1（:26010-26013,曾缺=骑乘仍保持隐身加成）', () => {
    const p = mkShroomite();
    const hooks = makeHooks(p);
    p.mount.active = true;
    p.stealth = 0.5;
    p.fixedUpdate(1, hooks);
    expect(p.stealth).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ⑥ 蘑菇矿伤/暴/仇恨 Remap 轴（:26015-26018 num26=Remap(stealth,1,0.75,1,0)）
//    解析式 clamp(4s−3,0,1)：s=1→因子 0、s=0.875→0.5、s≤0.75→恒 1（钳 0 段）
// ---------------------------------------------------------------------------
describe('⑥ 蘑菇矿 Remap(1,0.75→1,0) 三态（:26015-26018）', () => {
  it('伤：s=1 → +0、s=0.875 → +0.25、s≤0.75 → +0.5（:26016 rangedDamage += (1−Remap)×0.5f 池加算,曾误平铺 ×0.6;★BJ723-A R01 乘数改回池加算）', () => {
    const p = mkShroomite();
    expect(p.equipStats.shroomiteSet).toBe(true);
    p.stealth = 1;
    const base = p.rangedDamageMult('bullet');
    expect(base).toBeCloseTo(1.13, 6);     // 1 + 1549 胸 fx dmgRanged 0.13（:13814）
    p.stealth = 0.875;
    expect(p.rangedDamageMult('bullet') - base).toBeCloseTo(0.25, 6);
    p.stealth = 0.75;                      // 钳制起点：Remap=0 → 因子已满
    expect(p.rangedDamageMult('bullet') - base).toBeCloseTo(0.5, 6);
    p.stealth = 0;                         // 满潜行仍 +0.5（非 (1−s) 全程线性）
    expect(p.rangedDamageMult('bullet') - base).toBeCloseTo(0.5, 6);
  });

  it('暴：s=1 → +0、s=0.875 → +5、s≤0.75 → +10（:26017 (1−Remap)×10）', () => {
    const p = mkShroomite();
    p.stealth = 1;
    const c1 = p.critChance('ranged');
    p.stealth = 0.875;
    expect(p.critChance('ranged') - c1).toBe(5);
    p.stealth = 0;
    expect(p.critChance('ranged') - c1).toBe(10);
  });

  it('仇恨：s=1 → 0、s=0.875 → −375、s≤0.75 → −750（:26018 (1−Remap)×750）', () => {
    const p = mkShroomite();
    p.stealth = 1;
    expect(p.aggro).toBe(0);
    p.stealth = 0.875;
    expect(p.aggro).toBe(-375);
    p.stealth = 0;
    expect(p.aggro).toBe(-750);
  });

  it('星璇仍走平铺轴不受 Remap 影响（:26043-26045 (1−s)×0.8/×20/−1200——★BJ723-A R01 乘数改回池加算）', () => {
    const p = mkVortex();
    expect(p.equipStats.vortexSet).toBe(true);
    p.vortexStealthActive = true;   // BJ725-A D2 改判史注：三消费位补开关门后,潜行加成断言须先开开关（原版 :26027-26052 全在块内）
    p.stealth = 1;
    const base = p.rangedDamageMult('bullet');
    const c1 = p.critChance('ranged');
    expect(base).toBeCloseTo(1.36, 6);     // 1 + 2757/2758/2759 fx 0.36（:14004/:14010/:14015）
    p.stealth = 0.875;                     // 平铺轴：因子 = 1−s = 0.125
    expect(p.rangedDamageMult('bullet') - base).toBeCloseTo(0.1, 6);   // 0.8×0.125 池加算
    expect(p.critChance('ranged') - c1).toBe(Math.round(0.125 * 20));
    expect(p.aggro).toBe(-Math.round(1200 * 0.125));
  });
});

// ---------------------------------------------------------------------------
// ⑦ 受伤破潜行（Player.Hurt :38530 `stealth = 1f;`——闪避早退后伤害落地即复位）
// ---------------------------------------------------------------------------
describe('⑦ 受击破潜行（:38530）', () => {
  it('伤害落地的 hit 无条件复位 stealth=1（曾缺=潜行态挨打不破隐）', () => {
    const p = mkPlayer();
    p.stealth = 0;
    expect(p.damage(10, p.cx + 10, p.cy)).toBeGreaterThan(0);
    expect(p.stealth).toBe(1);
  });

  it('无敌帧吞掉的 hit 不复位（:37769 immune 早退在 :38530 之前,同原版序）', () => {
    const p = mkPlayer();
    p.stealth = 0;
    p.iframes = 30;
    expect(p.damage(10, p.cx + 10, p.cy)).toBe(0);
    expect(p.stealth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑧ 星璇双击开潜行不复位（:57444-57448 双击只翻 vortexStealthActive 开关）
// ---------------------------------------------------------------------------
describe('⑧ 星璇双击开不复位 stealth（:57444-57448）', () => {
  it('半潜行(0.5)双击开 → 衰减段接管 −0.04（强置 1 则错为 0.96）', () => {
    const p = mkVortex();
    const hooks = makeHooks(p);
    p.inputDown = true; p.fixedUpdate(1, hooks);    // 首按：登记双击窗 15t
    p.inputDown = false; p.fixedUpdate(1, hooks);   // 松开
    p.stealth = 0.5;
    p.inputDown = true; p.fixedUpdate(1, hooks);    // 窗内再按 → 开潜行
    expect(p.vortexStealthActive).toBe(true);
    expect(p.stealth).toBeCloseTo(0.46, 6);         // 0.5 − 0.04,非 1 − 0.04
  });
});

// ---------------------------------------------------------------------------
// ⑨ 施法/射击族对满潜行玩家停火（NPC.cs:60233 stealth==0 && itemAnimation==0
//    → CanHit=false；施法族集合 = NPC.cs:59603 表 = Enemy.RANGED_FIGHTERS）
// ---------------------------------------------------------------------------
describe('⑨ 施法族满潜行停火门（NPC.cs:60233）', () => {
  const enemySrc = () =>
    readFileSync(new URL('../src/entities/Enemy.ts', import.meta.url), 'utf8')
      .replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');

  it('开瞄 CanHit 门 = 满潜行且未挥击 → flag21=false（黄蜂 :51312 同款动画窗代理）', () => {
    // ★2026-09-02 随 6aed1236 变量改名随迁(player → rawPlayer)
    expect(enemySrc()).toContain(
      'if (!(rawPlayer.stealth > 0) && !(rawPlayer.itemAnimTicks > 0 || rawPlayer.useTime > 0)) { flag21 = false; }',
    );
  });

  it('旧反向 idle 门已移除（useTime<=0 即停火 = 对未潜行玩家也哑火,非原版语义）', () => {
    expect(enemySrc()).not.toContain('if (player.useTime <= 0) flag21 = false;');
  });
});

// ---------------------------------------------------------------------------
// ⑩ 蘑菇矿静止阈 = maxRunSpeed−0.1（:25984-25986 `num24 = maxRunSpeed - 0.1f`）
//    原版此执行点 maxRunSpeed 恒 = originalRunSpeed = 3f（Update 内序:reset :24562 →
//    UpdateBuffs :25763 → 潜行块 :25982 → moveSpeed 乘区 :26206 → 装备链 :26707+），
//    即阈 2.9/轴——曾写死 0.1 = 慢速漂移被误判"移动"走回升档
// ---------------------------------------------------------------------------
describe('⑩ 蘑菇矿静止阈 maxRunSpeed−0.1=2.9（:25985）', () => {
  it('慢速漂移 vx=1（>旧阈 0.1、<2.9）仍判静止衰减 −0.015/t', () => {
    const p = mkShroomite();
    const hooks = makeHooks(p);
    for (let i = 0; i < 40; i++) p.fixedUpdate(1, hooks);   // 落地站稳
    p.stealth = 1;
    p.vx = 1; p.vy = 0;                                     // 地面摩擦 −0.2 → 0.8,仍 <2.9
    p.fixedUpdate(1, hooks);
    expect(p.stealth).toBeCloseTo(0.985, 6);                // 旧码回升档 = min(1, 1+0.8×0.0075)=1
  });

  it('阈界 |vx|≥2.9 走回升档（+|v|×0.0075）——阈确取 2.9 非 0.1', () => {
    const p = mkShroomite();
    const hooks = makeHooks(p);
    for (let i = 0; i < 40; i++) p.fixedUpdate(1, hooks);
    p.stealth = 0.5;
    p.vx = 3.2; p.vy = 0;                                   // 摩擦 −0.2 → 3.0 ≥ 2.9 → 回升
    p.fixedUpdate(1, hooks);
    expect(p.stealth).toBeCloseTo(0.5 + 3.0 * 0.0075, 6);   // 0.5225（衰减档则 0.485）
  });
});

// ---------------------------------------------------------------------------
// ⑪ 蘑菇矿 stealthTimer 语义（:25991 衰减拍置 30 / :26019-26021 拍末递减）
//    原版无 `stealthTimer == 0` 门、也无 useTime→5（timer 纯"衰减中"标记）
// ---------------------------------------------------------------------------
describe('⑪ 蘑菇矿 stealthTimer=30 衰减拍语义（:25991/:26019-26021）', () => {
  const timerOf = (p: Player): number =>
    (p as unknown as { stealthTimer: number }).stealthTimer;

  it('静止衰减拍置 30、拍末递减 → 一拍后 timer=29（非旧 useTime→5→4）', () => {
    const p = mkShroomite();
    const hooks = makeHooks(p);
    for (let i = 0; i < 40; i++) p.fixedUpdate(1, hooks);
    p.stealth = 1; p.vx = 0; p.vy = 0;
    p.fixedUpdate(1, hooks);
    expect(p.stealth).toBeCloseTo(0.985, 6);
    expect(timerOf(p)).toBe(29);
  });

  it('无 stealthTimer==0 门：timer 残值 >0 时静止照衰减（旧码被门挡住不散）', () => {
    const p = mkShroomite();
    const hooks = makeHooks(p);
    for (let i = 0; i < 40; i++) p.fixedUpdate(1, hooks);
    p.stealth = 0.5;
    (p as unknown as { stealthTimer: number }).stealthTimer = 10;
    p.vx = 0; p.vy = 0;
    p.fixedUpdate(1, hooks);
    expect(p.stealth).toBeCloseTo(0.485, 6);   // 旧码 0.5（门挡衰减）
    expect(timerOf(p)).toBe(29);               // :25991 置 30 → :26019-26021 减 1
  });

  it('无 useTime→5 置值：攻击冷却中走回升档 timer 保持 0（旧码误置 5→4）', () => {
    const p = mkShroomite();
    const hooks = makeHooks(p);
    for (let i = 0; i < 40; i++) p.fixedUpdate(1, hooks);
    (p as unknown as { stealthTimer: number }).stealthTimer = 0;   // 清落定衰减期残值（回升档 :26019-26021 仍会递减）
    p.useTime = 10;                            // 攻击冷却中（原版蘑菇矿段不读 itemAnimation/useTime）
    p.stealth = 0.5;
    p.vx = 3.2; p.vy = 0;                      // 摩擦 → 3.0 ≥2.9 → 回升档
    p.fixedUpdate(1, hooks);
    expect(p.stealth).toBeCloseTo(0.5225, 6);
    expect(timerOf(p)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ⑫ 星璇双击开潜行 !mount.Active 门（:57445-57447 `if (setVortex && !mount.Active)`)
// ---------------------------------------------------------------------------
describe('⑫ 星璇双击 !mount.Active 门（:57445-57447）', () => {
  const doubleTap = (p: Player, hooks: GameHooks): void => {
    p.inputDown = true; p.fixedUpdate(1, hooks);    // 首按：登记双击窗 15t
    p.inputDown = false; p.fixedUpdate(1, hooks);   // 松开
    p.inputDown = true; p.fixedUpdate(1, hooks);    // 窗内再按 → 双击
  };

  it('骑乘中双击↓不切潜行（原版骑乘即断;曾缺门=骑乘可开潜行）', () => {
    const p = mkVortex();
    const hooks = makeHooks(p);
    p.mount.active = true;
    doubleTap(p, hooks);
    expect(p.vortexStealthActive).toBe(false);
  });

  it('对照：未骑乘同序列照常翻转（门只挂坐骑,不破 ⑧ 开关语义）', () => {
    const p = mkVortex();
    const hooks = makeHooks(p);
    doubleTap(p, hooks);
    expect(p.vortexStealthActive).toBe(true);
  });
});
