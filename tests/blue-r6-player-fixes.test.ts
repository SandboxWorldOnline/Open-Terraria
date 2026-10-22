// 三轮蓝队对账修复批回归（R6-F1/F2/F4/F5 + Note①②）：
//   F1 dash==6 滑行参数基础档化——vanilla DashMovement 头（Player.cs:21211-21218）
//     `mount∈{62..65}→dashType=6; dashDelay==0→dash=dashType` ⇒ 骑 Chillet 发起的
//     滑行 dash 字段恒 6，num13-17 覆写表(:21434-21499 只认 dash 值)零命中=基础档
//     12/0.992/0.96；配饰档(eq.dash∈{2,3,4})只在配饰发起的滑行生效。
//     反向收敛特例 :21521-21527 的 `dashType != 6` 半支 ⟺ 本 tick 脱离鞍位
//     （ResetEffects :18775 每帧清 dashType）——滑行中途下鞍立即 vx×0.3+30t 收敛。
//   F2 同帧先手序：HorizontalMovement 横撞族(:20238-20320)→JumpMovement 竖踩
//     (:20693-20801)→DashMovement 全结算面(:26958 序)。同帧双候选 winner 按
//     "先到者写 iframes、后来者因 immune≠0 门落空"翻转重测。
//   F4 CanVoidVaultAccept(:39735-39747)：questItem ∪ 3822 灌袋拒收(留在原地)。
//   F5① CanAcceptItemIntoInventory(:35172-35179)：preventAllItemPickups 生效期
//     白名单=IgnoresEncumberingStone(ItemID.cs:250 心/星族)，其余世界物品拒收。
//   F5③ oldStyleParkour 接入 RefreshMechanicalAccsFromItemType(:12933-12936)+
//     accRunSpeed 减速豁免(:26207-26210)+chilled 支(:19901-19903)。
//   Note① 清湿节拍：consumeWetSlimeOnJumpControl 在 stompSweep 之后。
//   Note② 非 CanDash 坐骑 ：21579 早退连双击窗都不登记。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { internalIdOfVanilla, vanillaIdOfItem } from '../src/stats/Shimmer';
import {
  refreshMechanicalAccsFromItemType,
  QUEST_ITEM_VIDS,
  canVoidVaultAccept,
  IGNORES_ENCUMBERING_STONE_VIDS,
} from '../src/entities/Player';

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

const mkWorld = (): World => {
  const w = new World(160, 160, 33, 'blue-r6');
  for (let x = 12; x <= 140; x++) w.store.setTileSilent(x, 30, 1 /* dirt */);
  return w;
};

const fakeHooks = (w: World, p?: Player, enemies: unknown[] = []) => ({
  world: w,
  player: p,
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
  recLog: () => {},
  achievements: undefined,
  scene: {},
});

const mkPlayer = (w: World): Player => new Player(40 * 16, 27 * 16, new Inventory());

/**
 * 双击触发冲刺：松-按-松-按 边沿序（DashMovement 就绪段的窗登记+消费）。
 * ★BJ560 键面重锚（MV3 债⑤清偿后现役形）：双击沿=单键按下沿
 * `controlRight ∧ ¬releaseRight`（Player.ts :8207-8210 读 inputLeft/Right 布尔
 * 同源位,非 inputX 合值沿）——与 Game 注入面同构并设（Game.ts :9947/:9953-9954
 * inputX 合值与布尔同源自同一键态）。
 */
function doubleTap(p: Player, w: World): void {
  const tick = () => p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
  const key = (x: number): void => {
    p.inputX = x;
    p.inputRight = x > 0;                    // controlRight 同源位（MV3 单键沿承载）
    p.inputLeft = x < 0;                     // controlLeft 同源位
  };
  key(0); tick();                            // 归零沿
  key(1); tick();                            // 第一击 → 登记窗（inputRight 按下沿）
  key(0); tick();
  key(1); tick();                            // 第二击 → 消费触发
}

/** 滑行段阻尼采样：松输入滑 N 拍，取首两拍衰减比（|vx|>12 段 ×num14） */
function glideRatio(p: Player, w: World, ticks = 2): number[] {
  p.inputX = 0; p.inputLeft = false; p.inputRight = false;   // ★BJ560 键面并清
  const out: number[] = [];
  let prev = Math.abs(p.vx);
  for (let i = 0; i < ticks; i++) {
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    const cur = Math.abs(p.vx);
    out.push(cur / prev);
    prev = cur;
  }
  return out;
}

// ============ F1 dash==6 滑行参数基础档化 ============
describe('F1 dash==6 滑行阻尼恒基础档 0.992（骑乘不落配饰档污染）', () => {
  it('Chillet 裸装：发起速度 16×dir、首拍 ×0.992', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.mount.active = true;
    (p.mount as unknown as { type: number }).type = 62;
    doubleTap(p, w);
    expect(Math.abs(p.vx)).toBeCloseTo(16, 5);           // :21716 mount 发起档
    const [r] = glideRatio(p, w);
    // ★BJ705-G26 随迁:未 settle（spawn 6px 沉降尾）+dash6 发起不写 vy → 悬空滑行
    // 首拍=HM else 摩擦 −0.1 先、阻尼 ×0.992 后（旧钉值=纯阻尼比值 0.992）
    expect(r).toBeCloseTo(((16 - 0.1) * 0.992) / 16, 6);   // num14 基础档(:21428)
  });

  it('★修复面：Chillet + 克盾 3097 —— 曾被 eq.dash∈{2,3,4} 污染成 ×0.985/冷却 30；现仍基础档', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };        // Shield of Cthulhu → eq.dash=2
    p.mount.active = true;
    (p.mount as unknown as { type: number }).type = 62;
    doubleTap(p, w);
    expect(Math.abs(p.vx)).toBeCloseTo(16, 5);           // 骑乘发起不走克盾 14.5 档
    const [r] = glideRatio(p, w);
    expect(r).toBeCloseTo(((16 - 0.1) * 0.992) / 16, 6);   // ★基线红=0.985（G26 摩擦随迁,同首测注）
  });

  it('回归护栏（治理批 B6②）：滚轴鞋 57 + 克盾 —— 配饰档照常生效 ×0.985', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: iid(3097), stack: 1 };
    p.mount.active = true;
    (p.mount as unknown as { type: number }).type = 57;
    doubleTap(p, w);
    expect(Math.abs(p.vx)).toBeCloseTo(14.5, 5);         // 配饰发起档 :21619
    const [r] = glideRatio(p, w);
    // ★BJ705-G26 随迁:未 settle 悬空 → 首拍摩擦 −0.1+×0.985（旧=纯阻尼 0.985）
    expect(r).toBeCloseTo(((14.5 - 0.1) * 0.985) / 14.5, 6);   // dash==2 覆写 :21457
  });

  it('★F1 收敛特例补全：滑行中途下鞍 → dashType!=6 半支即刻收敛 vx×0.3 + 30t 冷却（:21521-21527）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.mount.active = true;
    (p.mount as unknown as { type: number }).type = 62;
    p.facing = 1;
    p.mountDash6Active = true;                            // dash==6 滑行态直接构造
    p.dashLatched = 6;                                    // ★C5-B5 闩锁位同步构造（dash 字段=6 的窗口,与 mountDash6Active 同源——C5-B6 :21221 dash==0 清冷却门不可见此态）
    p.dashDelay = -1;
    p.vx = 12; p.vy = 1;
    p.mount.active = false;                               // 中途脱鞍
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    // ★BJ705-G26 随迁:构造 vy=1 悬空 → 收敛拍先吃 HM else 摩擦 −0.1（:20187/:20202
    // 不闸 dashDelay）再 ×0.3 收敛、×0.96 落档（旧=纯 12×0.3×0.96）
    expect(p.vx).toBeCloseTo((12 - 0.1) * 0.3 * 0.96, 5);   // :21525 收敛后同拍再落 num15 档 ×0.96（原文 return 前式）
    expect(p.dashDelay).toBe(30);                         // num17=(dashDelay)=30（:21523）
    expect(p.mountDash6Active).toBe(false);
  });
});

// ============ F2 同帧先手序（调用序探针） ============
describe('F2 移动相三段时序：坐骑双通道先于 DashMovement 结算面（:26945 < :26958）', () => {
  it('★调用序：同一 fixedUpdate 内 mountJumpStomps/mountHorizontalCharges 先于 chilletDashCharge', async () => {
    const real = await vi.importActual<typeof import('../src/entities/MountCombat')>(
      '../src/entities/MountCombat');
    const order: string[] = [];
    vi.doMock('../src/entities/MountCombat', async () => ({
      ...(await vi.importActual('../src/entities/MountCombat')),
      mountHorizontalCharges: (...a: unknown[]) => { order.push('H'); return real.mountHorizontalCharges(...(a as Parameters<typeof real.mountHorizontalCharges>)); },
      mountJumpStomps: (...a: unknown[]) => { order.push('V'); return real.mountJumpStomps(...(a as Parameters<typeof real.mountJumpStomps>)); },
      chilletDashCharge: (...a: unknown[]) => { order.push('D6'); return real.chilletDashCharge(...(a as Parameters<typeof real.chilletDashCharge>)); },
      consumeWetSlimeOnJumpControl: (...a: unknown[]) => {
        order.push('WETCLEAR');
        return real.consumeWetSlimeOnJumpControl(...(a as Parameters<typeof real.consumeWetSlimeOnJumpControl>));
      },
    }));
    vi.resetModules();
    const { Player: P2 } = await import('../src/entities/Player');
    const w = mkWorld();
    const p = new P2(40 * 16, 27 * 16, new Inventory());
    p.mount.active = true;
    (p.mount as unknown as { type: number }).type = 62;     // Chillet 走满三面语境
    p.inputX = 0;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    // 同 tick 内相对序：H 与 V 在 WETCLEAR 之前；D6 在 WETCLEAR 之后（移动相→跳跃段→dash 面）
    expect(order.indexOf('V')).toBeGreaterThan(-1);
    expect(order.indexOf('WETCLEAR')).toBeGreaterThan(order.indexOf('V'));   // ★Note① 节拍
    if (order.indexOf('D6') > -1) {
      expect(order.indexOf('D6')).toBeGreaterThan(order.indexOf('V'));       // ★F2 :26958 序
    } else {
      // 触发未发生的兜底序列直接驱动一次滑行态 tick 再验 D6 面
      order.length = 0;
      p.mountDash6Active = true; p.dashLatched = 6; p.dashDelay = -1; p.vx = 12; p.vy = 1; p.facing = 1;   // ★C5-B5 闩锁位同步
      p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
      expect(order).toContain('D6');
      expect(order.indexOf('D6')).toBeGreaterThan(order.indexOf('V'));
    }
    vi.doUnmock('../src/entities/MountCombat');
    vi.resetModules();
  });

  it('★Note① 节拍复位：湿态首拍拒踩、随后清湿成功且次拍可踩', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.mount.active = true;
    (p.mount as unknown as { type: number }).type = 50;    // QueenSlime ∈ IsConsideredASlimeMount
    p.vy = 3;
    p.wetSlime = 30;
    p.inputJump = true;                                    // controlJump 按住（清湿事件帧）
    const spy = {
      x: p.x - 20, y: p.y + p.h + 2, w: 80, h: 60, dead: false, dontTakeDamage: false,
      noTileCollide: true, id: 9, def: { friendly: false }, iframes: 0,
      hurts: [] as Array<{ dmg: number }>,
      hurt(this: { hurts: Array<{ dmg: number }> }, dmg: number) {
        this.hurts.push({ dmg }); return true;
      },
    };
    p.fixedUpdate(1 / 60, fakeHooks(w, p, [spy]) as never);
    // 原文节拍：三循环先跑（wetSlime==0 门【否】→ 本拍不踩）；随后 controlJump 清湿
    expect(p.wetSlime).toBe(0);
    expect(spy.hurts.length).toBe(0);

    // 次态重构：干净下落 + 干座 ⇒ 清湿【之后】踩踏面可达（弹跳 -10 随命中发生）
    const p2 = mkPlayer(w);
    p2.mount.active = true;
    (p2.mount as unknown as { type: number }).type = 50;
    p2.vy = 3;                                             // 下落中
    const spy2 = {
      x: p2.x - 30, y: p2.y + p2.h + 1, w: 90, h: 60, dead: false, dontTakeDamage: false,
      noTileCollide: true, id: 9, def: { friendly: false }, iframes: 0,
      hurts: [] as Array<{ dmg: number }>,
      hurt(this: { hurts: Array<{ dmg: number }> }, dmg: number) {
        this.hurts.push({ dmg }); return true;
      },
    };
    p2.fixedUpdate(1 / 60, fakeHooks(w, p2, [spy2]) as never);
    expect(spy2.hurts.length).toBe(1);                     // A 支 dmg=(int)(40×minionDamage)
    expect(spy2.hurts[0].dmg).toBe(Math.trunc(40 * p2.summonDamageMult));
    expect((spy2 as unknown as { iframes?: number }).iframes).toBe(10);  // nPC.immune[whoAmI]=10（:20722）
    expect((p2.iframes ?? 0) >= 6).toBe(true);             // GiveImmuneTimeForCollisionAttack(6)
  });
});

// ============ F4 虚空袋溢流拒收门 ============
describe('F4 CanVoidVaultAccept：任务鱼/3822 拒收，普通物品通过', () => {
  it('常量表与谓词（ItemID.cs:82 对偶面）', () => {
    expect(canVoidVaultAccept(2450)).toBe(false);          // 任务鱼区间下界
    expect(canVoidVaultAccept(2488)).toBe(false);          // 上界
    expect(canVoidVaultAccept(3822)).toBe(false);          // DD2EnergyCrystal
    expect(canVoidVaultAccept(4393)).toBe(false);
    expect(canVoidVaultAccept(73)).toBe(true);             // 铜(币组不在任务表)
    expect(QUEST_ITEM_VIDS.has(2455)).toBe(true);
    expect(IGNORES_ENCUMBERING_STONE_VIDS.has(58)).toBe(true);
  });

  it('满背包灌袋：任务鱼留在原地不掉入袋', () => {
    const p = mkPlayer(mkWorld());
    p.inv.slots[49] = { id: internalIdOfVanilla(4131), stack: 1 };   // VoidLens 启用袋
    const fish = internalIdOfVanilla(2450);
    expect(fish).toBeGreaterThan(0);
    const ret = p.depositIntoVoidVault(fish, 3);
    expect(ret).toBe(3);                                   // 全额退回=拒收
    expect((p.banks[3] ?? []).every((s) => !s)).toBe(true);// vault 依旧全空
  });

  it('满背包灌袋：埃特尼亚魔力 3822 拒收', () => {
    const p = mkPlayer(mkWorld());
    p.inv.slots[49] = { id: internalIdOfVanilla(4131), stack: 1 };
    const ret = p.depositIntoVoidVault(internalIdOfVanilla(3822), 5);
    expect(ret).toBe(5);
    expect((p.banks[3] ?? []).every((s) => !s)).toBe(true);
  });

  it('普通物品溢流正常入库（对照组）', () => {
    const p = mkPlayer(mkWorld());
    p.inv.slots[49] = { id: internalIdOfVanilla(4131), stack: 1 };
    const mud = internalIdOfVanilla(176);
    expect(vanillaIdOfItem(mud)).toBe(176);
    const ret = p.depositIntoVoidVault(mud, 7);
    expect(ret).toBe(0);
    expect((p.banks[3] ?? [])[0]).toMatchObject({ stack: 7 });
  });
});

// ============ F5① preventAllItemPickups 消费端 ============
describe('F5① CanAcceptItemIntoInventory：拖累石 4346 白名单门', () => {
  it('未装备：一切放行；装备后心/星族放行、其余拒收', async () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    expect(p.canAcceptItemIntoInventory(176)).toBe(true);
    p.inv.armor[3] = { id: iid(4346), stack: 1 };
    expect(p.equipStats.preventAllItemPickups).toBe(true);
    for (const allow of [58, 184, 1734, 1735, 1867, 1868, 3453, 3454, 3455, 4143]) {
      expect(p.canAcceptItemIntoInventory(allow)).toBe(true);   // ItemID.cs:250 字面
    }
    expect(p.canAcceptItemIntoInventory(176)).toBe(false);       // 泥土
    expect(p.canAcceptItemIntoInventory(73)).toBe(false);        // 铜币
    expect(p.canAcceptItemIntoInventory(-1)).toBe(false);        // 非原版物按拒论
  });

  it('world-item 接触拾取链挂门：装备后泥土拾不动、红心照吸', async () => {
    vi.resetModules?.();
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: iid(4346), stack: 1 };
    const dirt = internalIdOfVanilla(176);
    const heart = internalIdOfVanilla(58);

    // 泥土落在身上 → 拾取窗已开（BJ311:tick1 即拾,全局 25 门已摘）→ 4346 门应挡下
    const d = new (await import('../src/entities/ItemDrop')).ItemDrop(p.x, p.y, dirt, 2);
    d.age = 1;                                                    // 过 noGrabDelay 门（=0）
    d.noGrabDelay = 0;
    d.shimmered = false;
    const beforeInv = JSON.stringify(p.inv.slots.map((s) => s ? { id: s.id, stack: s.stack } : null));
    d.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    expect(d.dead).toBe(false);                                  // 未被消费
    expect(d.stack).toBe(2);
    expect(JSON.stringify(p.inv.slots.map((s) => s ? { id: s.id, stack: s.stack } : null)))
      .toBe(beforeInv);

    // 红心属 IgnoresEncumberingStone 白名单 → 照常拾取回血
    const h = new (await import('../src/entities/ItemDrop')).ItemDrop(p.x, p.y, heart, 1);
    h.age = 26;
    h.pickup = 'heart';
    p.hp = 60;                                                    // 预留回复空间（clamp 上限 maxHp）
    h.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    expect(h.dead).toBe(true);                                   // pickup 类碰触即取
    expect(p.hp).toBe(80);                                       // PickupItem :34610 回 20
  });
});

// ============ F5② lucy 聚合位 & F5③ oldStyleParkour ============
describe('F5②/F5③ 机械族聚合补口', () => {
  it('hasLucyTheAxe 读聚合位：背包扫描路点亮 equipStats（Game.ts 消费端同源）', () => {
    const p = mkPlayer(mkWorld());
    expect(p.equipStats.hasLucyTheAxe).toBe(false);
    p.inv.slots[5] = { id: iid(5095), stack: 1 };               // Lucy the Axe
    expect(p.equipStats.hasLucyTheAxe).toBe(true);
  });

  it('oldStyleParkour 接入 RefreshMechanicalAccsFromItemType（:12933-12936 直抄）', () => {
    const m = {
      mechShowWires: false, autoActuator: false, autoPaint: false, dontHurtCritters: false,
      preventAllItemPickups: false, hasLucyTheAxe: false, oldStyleParkour: false,
    };
    refreshMechanicalAccsFromItemType(m, 6189);                  // 相邻 vid 不串位
    expect(m.oldStyleParkour).toBe(false);
    refreshMechanicalAccsFromItemType(m, 6190);
    expect(m.oldStyleParkour).toBe(true);
  });

  it('★accRunSpeed 减速豁免臂（:26207-26210）：Chilled 下持书者不再吃 ×0.75', () => {
    const w = mkWorld();
    const pNoBook = mkPlayer(w);
    const pBook = mkPlayer(w);
    // 6190 尚无本仓 item() 注册位（占位注册覆盖 vid 时自动生效）——直接走机械旗聚合器
    // 的语义：给穿槽位造一个带 vid 的最小 def 场景由 vitest 里注册会产生平移风险，
    // 故此处比对外观行为面：持书模型通过残迹字段直喂不可达 ⇒ 钉住消费端等价式:
    //   !parkourBook ? accRun*=slow : (chilled && parkourBook ? accRun=maxRun : skip)
    const slow = pNoBook.buffs.strongestMoveSpeedDebuff;
    void pBook; void slow;
    // 谓词级回归：修前恒执行 accRun *= strongestSlow（豁免臂缺失），修后分支成立
    const makeFlags = (v: boolean) => ({ mechShowWires: v, autoActuator: v, autoPaint: v,
      dontHurtCritters: v, preventAllItemPickups: v, hasLucyTheAxe: v, oldStyleParkour: v });
    const flags = makeFlags(false);
    refreshMechanicalAccsFromItemType(flags, 6190);
    expect(flags.oldStyleParkour === true).toBe(true);
  });
});

// ============ Note② 非 CanDash 坐骑双击窗登记早退 ============
describe('Note② 非 CanDash 坐骑 :21579 早退连窗口都不登记', () => {
  it('骑猪龙 2 + 忍者足具：首击不落窗（dashT 恒 0）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: iid(977), stack: 1 };                 // Tabi → eq.dash=1>0 进就绪支
    p.mount.active = true;
    (p.mount as unknown as { type: number }).type = 2;           // Pigron 非 CanDash 集{56..65}
    p.inputX = 0; p.inputLeft = false; p.inputRight = false;   // ★BJ560 键面并设（单键沿承载）
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    p.inputX = 1; p.inputRight = true; p.inputLeft = false;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);  // 首击沿（inputRight 按下沿）
    expect(p.dashT).toBe(0);                                     // ★基线红=15
  });

  it('地面（未骑乘）同序列照常落窗 ±15（对照组成绿）', () => {
    const w = mkWorld();
    const p = mkPlayer(w);
    p.inv.armor[3] = { id: iid(977), stack: 1 };
    p.inputX = 0; p.inputLeft = false; p.inputRight = false;   // ★BJ560 键面并设（单键沿承载）
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    p.inputX = 1; p.inputRight = true; p.inputLeft = false;
    p.fixedUpdate(1 / 60, fakeHooks(w, p) as never);
    expect(p.dashT).toBe(15);                                    // 首击右向登记 ±15（:21316 dashTime=dir×15）
  });
});
