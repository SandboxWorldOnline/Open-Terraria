// ★C5（2026-10-06）红蓝 R5 玩家批 findings B1-B8 清偿判别套件（先定谳后动刀，
//  全锚亲读 1457 反编译逐条钉死；变异证红在本文件,回归面=maj 域既有套件全绿）。
//
//   B1（中）湿态自动下坐：原版 Player.cs:28177-28207 `if (mount.Active)`
//     { :28181-28185 `dripping && mount.Type==56` → TryDismount（wet 外门——Wet(103)
//     buff 位,上岸残湿期照判）; :28188-28205 `if (wet) switch (mount.Type)`：
//     case 5/7/56（蜜蜂/飞碟/可爱飞鱼）→ TryDismount; case 3/50（史莱姆族）→
//     wetSlime=30+浮力档 }——仓内旧版只落 3/50 浮力臂,5/7/56 下坐整缺。
//     修：MountCombat.tickSlimeWetState 补 dripping×56 早门 + 5/7/56 臂（返回下坐
//     请求）,Player.ts 湿流程承接 tryDismount+伴生 buff 清偿（:5389 冻结下坐惯例）。
//   B2（中低）抓钩/舌缚挂住期 dash 照跑：原版 DashMovement 只在绳索支（:26691）与
//     正常移动支（:26695 `else if (grappling[0] == -1 && !tongued)`）调用,挂钩/舌缚
//     支（:27598 else）只调 UpdateControlHolds=整支不可达（就绪不发起/滑行不阻尼/
//     冷却不倒数/eoc 扫敌全停）。仓内挂钩期照跑=就绪可发起+eocDash=15 恒冻逐帧扫敌
//     =原版不可能路径。修：dashMovement 头 grappling[0]||tongued 早退（冻结≠清零）。
//   B3（低）结网不清 dash：原版 :11965-11966（UpdateBuffs 结网支）`dash = 0;
//     dashType = 0;` → :21221 `dash==0 → dashTime=0; dashDelay=0` = 滑行/冷却拍内
//     清零即时就绪。仓内伪注自称"dash 归零"从未落码 → 滑行中结网落 20/30t 虚假
//     冷却,且 MV1④ 旧期望把偏离行为钉成金标（伪锚,已翻正）。
//   B4（低）克盾回弹 ×0.95 臂整缺：原版 :21225-21289
//     `if (dash==2 && eocDash>0) { if (eocHit<0) {扫敌} else if (无同向输入)
//     { velocity.X *= 0.95f } }`——仓内把 eocHitId<0 折入外门 → 回弹臂不可达,
//     反弹全程 -9 无衰减。修：外门改 dashLatched（C5-B5 闩锁位）,内门劈两支。
//   B5（低）滑行参数读活值：原版 :21217 `if (dashDelay==0) dash = dashType`
//     闩锁 → 滑行/冷却期 num13-17（:21434-21499）只认 dash 字段冻结值。仓内滑行
//     读活 eq.dash → 中途换装阻尼档漂移（卸盾即回落基础档 0.992/20,原版不可能）。
//     修：dashLatched 字段镜像（derive 仅 dashDelay==0 拍）。
//   B6（低）双击窗不清：原版 :21221-21223 无 dash 能力（dash==0）每拍 dashTime=0。
//     仓内就绪支门不进则 dashT 窗冻结 → 摘装备窗冻结重装后单击即冲。修：
//     dashLatched===0 → dashT=0（+dashDelay=0 承载写,B3 结网净效链同位）。
//   B7（低,测试债）BJ533 湿表镜像零判别：湿/干两支各持字面 hMult 镜像表,
//     湿表 Blizzard 1.5→1.4 变异全绿（干表镜像红）= 静默错高类债。修：
//     BOTTLE_JUMP_HMULT 模块单源（jumpHMultOf）+ 本文件湿表乘数断言。
//   B8（nit）bj531 标注勘误：vid 51 = Jester's Arrow 小丑之箭（ItemID.cs:1648;
//     WoodenArrow=40 :1626,ammo=40=AmmoID.Arrow 弹种域数值巧合）非"木箭"。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Player } from '../src/entities/Player';
import { Enemy } from '../src/entities/Enemy';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { BuffType } from '../src/stats/Buffs';
import { tickSlimeWetState } from '../src/entities/MountCombat';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

// ★世界尺寸纪律：80×80 格 = bordersMovement 边框钳豁免域（≤2B 门）
const W = 80, H = 80;
const GROUND_ROW = 30;

function mkRunway(): World {
  const w = new World(W, H, 11, 'c5-runway');
  for (let x = 4; x < 76; x++) w.store.setTile(x, GROUND_ROW, 1);
  return w;
}

/** 深水池（bj533 同式）：地板 120,水 [60,120) 全幅 */
function mkPool(): World {
  const w = new World(80, 300, 11, 'c5-pool');
  for (let x = 0; x < 80; x++) {
    w.store.setTile(x, 120, 1);
    for (let y = 60; y < 120; y++) w.store.setLiquid(x, y, 255, 1);   // 水
  }
  return w;
}

function fakeHooks(w: World, p: Player, enemies: unknown[] = []): GameHooks {
  return {
    world: w, player: p, enemies: () => enemies, critters: () => [], npcs: () => [],
    damagePlayer: (): number => 0, spawnDrop: () => null, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    showPickupLabel: () => {}, recLog: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
  } as unknown as GameHooks;
}

function mkPlayer(w: World, tx: number): Player {
  const p = new Player(tx * TILE, GROUND_ROW * TILE - 48, new Inventory());
  p.hp = 500;
  return p;
}

const tick = (p: Player, w: World): void => { p.fixedUpdate(1 / 60, fakeHooks(w, p) as never); };
/** 带敌表 tick（B2/B4 扫敌判别用） */
const tickE = (p: Player, w: World, enemies: unknown[]): void => { p.fixedUpdate(1 / 60, fakeHooks(w, p, enemies) as never); };

/** 双击右发起冲刺（MV1 同式;发起自证内联） */
function dashRight(p: Player, w: World): void {
  p.facing = 1;
  p.inputX = 1; p.inputLeft = false; p.inputRight = true;
  tick(p, w);
  p.inputX = 0; p.inputLeft = false; p.inputRight = false;
  for (let i = 0; i < 4; i++) tick(p, w);
  p.inputX = 1; p.inputLeft = false; p.inputRight = true;
  tick(p, w);
  p.inputX = 0; p.inputLeft = false; p.inputRight = false;
  expect(p.dashDelay).toBe(-1);           // 发起自证
}

/** 单击右（登记双击窗,不触发） */
function tapRight(p: Player, w: World): void {
  p.inputX = 1; p.inputLeft = false; p.inputRight = true;
  tick(p, w);
  p.inputX = 0; p.inputLeft = false; p.inputRight = false;
}

/** 伪钩（sw-fx40 同式 latched 形） */
function fakeHook(p: Player): void {
  (p as unknown as { grappling: (object | null)[] }).grappling[0] = {
    ai0: 2, projType: 446, x: p.x, y: p.y - 100, cx: p.cx, cy: p.cy - 100, rot: 0,
  };
  (p as unknown as { grapCount: number }).grapCount = 1;
}

// ============ B1 湿态自动下坐（:28177-28207） ============
describe('C5-B1 湿态坐骑下坐', () => {
  it('U1 判定矩阵：wet×5/7/56 → true;dry×56+dripping → true;wet×3 → false（湿史莱姆档）;dry → false', () => {
    const mk = (type: number, wetSticky: boolean, dripping = false) =>
      tickSlimeWetState({ wetSticky, vy: 0, wetSlime: 0, mount: { active: true, type } }, dripping);
    expect(mk(5, true), '蜜蜂 wet → TryDismount（:28188-28189）').toBe(true);
    expect(mk(7, true), '飞碟 wet → TryDismount').toBe(true);
    expect(mk(56, true), '可爱飞鱼 wet → TryDismount').toBe(true);
    expect(mk(56, false, true), '飞鱼 dry×dripping → TryDismount（:28181 wet 外门——上岸残湿期照判）').toBe(true);
    expect(mk(5, false, true), '蜜蜂 dry×dripping → false（dripping 臂仅 56）').toBe(false);
    expect(mk(3, true), '湿史莱姆 → false（case 3/50 落 wetSlime 档非下坐）').toBe(false);
    expect(mk(3, false), '史莱姆 dry → false').toBe(false);
    expect(mk(9, true), '非表列坐骑 wet → false').toBe(false);
  });

  it('U2 湿拍史莱姆浮力臂不回归（wetSlime=30,返回 false）', () => {
    const p = { wetSticky: true, vy: 3, wetSlime: 0, mount: { active: true, type: 3 } };
    expect(tickSlimeWetState(p)).toBe(false);
    expect(p.wetSlime).toBe(30);
  });

  it('W1 蜜蜂入水 → 拍内下坐（Player.fixedUpdate 全链）', () => {
    const w = mkPool();
    const p = new Player(40 * TILE, 50 * TILE, new Inventory());
    p.hp = 500;
    expect(p.mount.setMount(5, p), '蜜蜂上鞍自证（dry 出生位）').toBe(true);
    expect(p.mount.active).toBe(true);
    p.y = 90 * TILE;                       // 直投深水
    tick(p, w);
    expect(p.inWater, '前置自证：湿探针真').toBe(true);
    expect(p.mount.active, 'wet×5 → 本拍 TryDismount（修前整缺=恒骑）').toBe(false);
  });

  it('W2 湿史莱姆入水 → 不下坐 + wetSlime=30（对照臂）', () => {
    const w = mkPool();
    const p = new Player(40 * TILE, 50 * TILE, new Inventory());
    p.hp = 500;
    expect(p.mount.setMount(3, p)).toBe(true);
    p.y = 90 * TILE;
    tick(p, w);
    expect(p.inWater).toBe(true);
    expect(p.mount.active, 'case 3/50 落湿档非下坐').toBe(true);
    expect(p.wetSlime).toBe(30);
  });

  it('W3 可爱飞鱼上岸残湿（Wet buff×干拍）→ 下坐;蜜蜂同态对照不下坐', () => {
    const w = mkRunway();
    const pf = new Player(20 * TILE, GROUND_ROW * TILE - 48, new Inventory());
    pf.hp = 500;
    expect(pf.mount.setMount(56, pf)).toBe(true);
    pf.buffs.apply(BuffType.Wet, 30 / 60);   // dripping（:11832-11840 buff 103）
    tick(pf, w);
    expect(pf.mount.active, 'dripping×56 早门（:28181）= wet 外门,干拍照判').toBe(false);

    const pb = new Player(20 * TILE, GROUND_ROW * TILE - 48, new Inventory());
    pb.hp = 500;
    expect(pb.mount.setMount(5, pb)).toBe(true);
    pb.buffs.apply(BuffType.Wet, 30 / 60);
    tick(pb, w);
    expect(pb.mount.active, 'dripping 臂仅 56——蜜蜂干拍不落').toBe(true);
  });
});

// ============ B2 抓钩/舌缚挂住期 dash 整支冻结（:26695/:27598） ============
describe('C5-B2 挂钩期冲刺状态机不可达', () => {
  it('H1 挂钩悬空+敌体贴身：eoc 扫敌不跑（hurt 零调）,滑行/冲撞计时全冻结', () => {
    const w = mkRunway();
    const p = mkPlayer(w, 20);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    const e = Enemy.fromVanilla(4, 20 * TILE + 30, GROUND_ROW * TILE - 40)!;
    const hurtSpy = vi.fn(() => true);
    (e as unknown as { hurt: unknown }).hurt = hurtSpy;
    const enemies = [e];
    for (let i = 0; i < 10; i++) tickE(p, w, enemies);
    dashRight(p, w);                        // 滑行态（dashDelay=-1, eocDash=15）
    // ★伪钩 tick 尾被清（Player.fixedUpdate 尾 grappling[0]=null,真实重登记在
    //  GrappleProj——测试无钩体）→ 逐拍重挂保持挂钩态全程。敌体每拍钉在玩家身位
    //  ——扫敌若跑必命中（判定盒以玩家为中心外扩 8px）。
    for (let i = 0; i < 3; i++) {
      fakeHook(p);
      e.x = p.cx - e.w / 2; e.y = p.cy - e.h / 2;
      tickE(p, w, enemies);
    }
    expect(hurtSpy, '挂钩期 :26958 不调用=扫敌整支不可达（修前逐帧扫敌=原版不可能路径）')
      .not.toHaveBeenCalled();
    expect(p.dashDelay, '滑行态冻结非清零（:27598 else 支零写）').toBe(-1);
    expect(p.eocDash, 'eocDash 冻结在 15（修前同值但扫敌照跑——本断言与上条合锚）').toBe(15);
  });

  it('H2 挂钩中双击：不发起（修前就绪段可发起=dashDelay 落 -1）', () => {
    const w = mkRunway();
    const p = mkPlayer(w, 20);
    for (let i = 0; i < 10; i++) tick(p, w);
    p.facing = 1;
    fakeHook(p);
    p.inputX = 1; p.inputRight = true;
    tick(p, w);
    fakeHook(p);
    p.inputX = 0; p.inputRight = false;
    for (let i = 0; i < 4; i++) { fakeHook(p); tick(p, w); }
    fakeHook(p);
    p.inputX = 1; p.inputRight = true;
    tick(p, w);
    fakeHook(p);
    p.inputX = 0; p.inputRight = false;
    expect(p.dashDelay, '挂钩支整支不可达 → 双击无效（修前=-1）').toBe(0);
  });
});

// ============ B3 结网 dash 归零（:11965-11966 → :21221） ============
describe('C5-B3 结网拍 dash 即时清零', () => {
  it('冷却中结网：dashDelay/dashT/dashLatched 拍内清零即时就绪（修前落虚假冷却）', () => {
    const w = mkRunway();
    const p = mkPlayer(w, 20);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    dashRight(p, w);
    p.dashDelay = 25; p.dashT = 9;          // 注入冷却中态（冷却进入方式不在本刀判别域）
    p.buffs.apply(BuffType.Webbed, 50 / 60);
    tick(p, w);
    expect(p.dashDelay, ':11965 dash=0 → :21223 dashDelay=0（修前=24 虚假冷却续走）').toBe(0);
    expect(p.dashT, ':21222 dashTime=0').toBe(0);
    expect(p.dashLatched, 'dash 字段位=0（derive 因 dashDelay≠0 跳过=原版相）').toBe(0);
  });
});

// ============ B4 克盾回弹 ×0.95 臂（:21287-21289） ============
describe('C5-B4 克盾冲撞回弹臂', () => {
  it('R1 命中后无同向输入：vx ×0.95 拍内衰减（修前恒 -9 只吃 Run 摩擦）', () => {
    const w = mkRunway();
    const p = mkPlayer(w, 20);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    const e = Enemy.fromVanilla(4, 20 * TILE + 30, GROUND_ROW * TILE - 40)!;
    const hurtSpy = vi.fn(() => true);
    (e as unknown as { hurt: unknown }).hurt = hurtSpy;
    const enemies = [e];
    for (let i = 0; i < 10; i++) tickE(p, w, enemies);
    dashRight(p, w);
    tickE(p, w, enemies);                   // 扫敌拍 → 命中
    expect(hurtSpy).toHaveBeenCalledTimes(1);
    expect(p.eocHitId).not.toBe(-1);        // 命中登记（eocHit>=0）
    expect(p.dashDelay, '反弹进冷却（:20834 置 30,同拍冷却支首减 → 29）').toBe(29);
    expect(p.vx).toBe(-9);                  // post-loop 臂（:21286）
    tickE(p, w, enemies);                   // 无输入：Run 空中摩擦 0.1 → ×0.95
    const v1 = Math.abs(p.vx);
    expect(v1, '×0.95 臂：|vx|=（9-0.1）×0.95≈8.455（修前≈8.9 无臂）').toBeGreaterThan(8.2);
    expect(v1).toBeLessThan(8.6);
  });

  it('R2 持同向键「接住」反弹：×0.95 臂不落（输入门面,原版 De Morgan 直译）', () => {
    const w = mkRunway();
    const p = mkPlayer(w, 20);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    const e = Enemy.fromVanilla(4, 20 * TILE + 30, GROUND_ROW * TILE - 40)!;
    const hurtSpy = vi.fn(() => true);
    (e as unknown as { hurt: unknown }).hurt = hurtSpy;
    const enemies = [e];
    for (let i = 0; i < 10; i++) tickE(p, w, enemies);
    dashRight(p, w);
    tickE(p, w, enemies);
    expect(p.vx).toBe(-9);
    p.inputLeft = true; p.inputX = -1;      // 持反弹同向键（controlLeft && vx<0）
    tickE(p, w, enemies);
    // 臂不落：vx 只吃 Run 超帽摩擦（:5789 持键越帽同摩擦,空中 0.1）→ ≈-8.9;
    // 若臂误落（变异=摘输入门）则 ×0.95 → ≈-8.455,区间必红
    expect(Math.abs(p.vx), '(!controlLeft || !(vx<0)) 假 → 臂不落（仅 Run 超帽摩擦 0.1）')
      .toBeGreaterThan(8.8);
    expect(Math.abs(p.vx)).toBeLessThanOrEqual(9);
  });
});

// ============ B5 滑行参数闩锁（:21217/:21434-21499） ============
describe('C5-B5 滑行阻尼档发起拍快照', () => {
  it('G1 滑行中途卸盾：阻尼档保持 dash2（0.985/出口冷却 30）不回落基础档（修前活值读=20）', () => {
    const w = mkRunway();
    const p = mkPlayer(w, 20);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    dashRight(p, w);
    expect(p.dashLatched, '发起拍闩锁自证').toBe(2);
    p.inv.armor[3] = null;                  // 中途卸盾（eq.dash 活值归 0）
    let guard = 0;
    while (p.dashDelay === -1 && guard++ < 200) tick(p, w);
    expect(guard).toBeLessThan(200);
    expect(p.dashDelay, '出口冷却 = dash2 档 num17=30（:21459 闩锁;修前读活值 0 → 20）').toBe(30);
  });
});

// ============ B6 双击窗清（:21221-21223） ============
describe('C5-B6 无 dash 能力每拍清双击窗', () => {
  it('D1 窗登记后摘装备：下一拍 dashT=0（修前冻结 13）;重装后单击不冲、双击照常', () => {
    const w = mkRunway();
    const p = mkPlayer(w, 20);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    for (let i = 0; i < 10; i++) tick(p, w);
    tapRight(p, w);
    expect(p.dashT, '窗登记自证（:21761）').toBe(15);
    tick(p, w);                              // 衰减 15→14
    expect(p.dashT).toBe(14);
    p.inv.armor[3] = null;                   // 摘装备 → dashLatched=0 → :21222
    tick(p, w);
    expect(p.dashT, 'dash==0 每拍 dashTime=0（修前=13 冻结）').toBe(0);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };   // 重装
    tick(p, w);
    tapRight(p, w);
    expect(p.dashDelay, '单击仅再登记窗不发起（修前冻结窗+单击=误发 dash）').toBe(0);
    expect(p.dashT).toBe(15);
    for (let i = 0; i < 4; i++) tick(p, w);  // 窗衰减 15→11
    p.inputX = 1; p.inputRight = true;
    tick(p, w);                              // 双击沿
    p.inputX = 0; p.inputRight = false;
    expect(p.dashDelay, '双击照常发起（清窗不得误伤双击面）').toBe(-1);
  });
});

// ============ B7 湿表乘数判别（BJ533 镜像单源） ============
describe('C5-B7 湿支暴雪瓶 ×1.5 乘数', () => {
  it('S1 水下悬空暴雪瓶二段跳：jumpHold=round(30×1.5)-1=44（★BJ717-A F6 −2→−1 迁移;1.4 变异→41 必红）', () => {
    const w = mkPool();
    const p = new Player(40 * TILE, 61 * TILE, new Inventory());
    p.hp = 500;
    p.inv.armor[3] = { id: iid(987), stack: 1 };   // 暴雪瓶（jumpOpts ['Blizzard']）
    // 沉底落稳（bj533 settleToFloor 同式）
    for (let t = 0; t < 500 && !(p.onGround && p.vy === 0); t++) tick(p, w);
    expect(p.onGround).toBe(true);
    expect(p.inWater).toBe(true);
    expect(p.jumpSpeedField).toBe(6.01);           // 湿档覆写自证（:24624）
    expect(p.extraJumps).toEqual(['Blizzard']);
    // 地面跳 → 等回水下悬空下沉段（bj533 waitAirborneSinking 同式）
    p.inputJump = true;
    tick(p, w);
    expect(p.jumpHold).toBe(30);                   // 湿档 lJT=30
    p.inputJump = false;
    tick(p, w);
    let guard = 0;
    while ((p.jumpHold !== 0 || p.vy <= 0) && guard++ < 500) tick(p, w);
    expect(guard).toBeLessThan(500);
    // 主判据：暴雪支消费 + 湿表 ×1.5（单源 BOTTLE_JUMP_HMULT）
    p.inputJump = true;
    tick(p, w);
    expect(p.performingJump).toBe('Blizzard');
    tick(p, w);   // ★BJ705-G23:持跳 1 拍（fire 拍 sustain 已 −1）
    expect(p.jumpHold, '湿表 Blizzard ×1.5：round(30×1.5)-2（旧镜像表 1.5→1.4 变异零判别=本组根断）')
      .toBe(Math.round(30 * 1.5) - 1);   // ★BJ717-A F6 −2→−1 迁移（fire 拍 sustain 不再同拍跑）
    p.inputJump = false;
    tick(p, w);
    expect(p.jumpHold).toBe(0);   // ★BJ705-G23:松键即清（:21201-08;旧耗尽制=43 续跑）
  });
});

// ============ B8 vid 51 标注勘误（ItemID.cs:1648 JestersArrow） ============
describe('C5-B8 vid51 身份钉面', () => {
  it('N1 vid 51 = jester_s_arrow（防标注再漂移;ammo=40=AmmoID.Arrow 弹种域非木箭物品 id）', () => {
    expect(vanillaItemKey(51)).toBe('vi_51_jester_s_arrow');
  });
});
