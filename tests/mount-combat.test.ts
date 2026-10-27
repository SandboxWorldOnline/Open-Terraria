// 运输域坐骑战斗通道回归（矿车高速撞击 NPC + 史莱姆坐骑弹跳踩踏）：
// 原版锚点——矿车冲撞段 1457 Player.cs:27748-27831（1456 :27225 起）、
// GetMinecartDamage :29474-29518（1456 :28776）、JumpMovement 踩踏三循环
// :20693-20801（1456 :20254-20362）、wetSlime 液体态 :28160-28207（1456 :27653-27689）。
// 数值断言表驱动（速度→伤害/击退档位）防将来回退；几何/门禁用 World+TileStore 纯层。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import type { GameHooks } from '../src/entities/types';
import { TILE_BY_KEY } from '../src/data/tiles';
import {
  getMinecartDamage, minecartDamageBase, minecartRampageBox, minecartNpcRampage,
  mountJumpStomps, ramRuneDownDashStomp, tickSlimeWetState, consumeWetSlimeOnJumpControl,
  isConsideredASlimeMount,
} from '../src/entities/MountCombat';

const STONE = TILE_BY_KEY['stone'];
const PLATFORM = TILE_BY_KEY['platform'];

/** DamageVar 等价恒等骰：floor(rnd*31)=15 → 波动系数恰 1.0（ScaleStats.damageVar） */
const IDENTITY_RND = () => 0.5;

const MD = (speed: number, o: Record<string, unknown> = {}) =>
  getMinecartDamage(speed, {
    mountType: 6, superCart: false, hardMode: false, expertMode: false, ...o,
  }, 0, IDENTITY_RND);

// ---------------------------------------------------------------------------
// 公共桩
// ---------------------------------------------------------------------------

interface StubEnemy {
  x: number; y: number; w: number; h: number;
  dead?: boolean; iframes?: number; dontTakeDamage?: boolean; noTileCollide?: boolean;
  def?: { friendly?: boolean; knockBackResist?: number; lifeMax?: number };
  hits: Array<{ dmg: number; kbx: number; kby: number; crit: boolean; fromPlayer: boolean }>;
  hurt(dmg: number, kbx: number, kby: number, g: GameHooks, ap?: number, crit?: boolean,
    pierce?: number, fp?: boolean): boolean;
}

function mkEnemy(o: Partial<StubEnemy>): StubEnemy {
  return {
    x: 0, y: 0, w: 24, h: 24, ...o,
    hits: [],
    hurt(this: StubEnemy, dmg, kbx, kby, _g, _ap, crit, _pi, fp) {
      this.hits.push({ dmg, kbx, kby, crit: !!crit, fromPlayer: !!fp });
      return true;
    },
  } as StubEnemy;
}

function mkGame(store: unknown, enemies: unknown[],
  playerOver: Record<string, unknown> = {},
  extra: { critters?: unknown[]; achievements?: Record<string, unknown> } = {}): GameHooks {
  const player = {
    dead: false, luck: 0, maxHp: 400, maxMana: 200, cx: 0, cy: 0,
    critChance: () => 0,   // 缺省零暴击=掷骰结果确定；暴击面用专测钉
    ...playerOver,
  };
  return {
    world: { store, flags: { hardMode: false }, isExpert: false },
    player,
    enemies: () => enemies,
    critters: () => extra.critters ?? [],
    achievements: extra.achievements,
  } as unknown as GameHooks;
}

/** 序列化随机源：按池逐次吐值，耗尽即抛——把"随机流长度"也变成可断言契约 */
function scriptedRnd(draws: number[]): { rnd(): number; log: number[] } {
  let i = 0;
  return {
    rnd() {
      if (i >= draws.length) throw new Error('rnd 池耗尽：掷骰次数超出预期（流长度契约破坏）');
      const v = draws[i++];
      return v;
    },
    get log() { return Array.from({ length: i }, (_, k) => draws[k]); },
  };
}

/** 矿车桩（车盒 20×52 @(200,300) 默认 vx=12 速比 12/13） */
const CART = (over: Record<string, unknown> = {}) => ({
  x: 200, y: 300, w: 20, h: 52, vx: 12, vy: 0,
  mountId: 6, superCart: false, runSpeed: 13, ...over,
});

// ---------------------------------------------------------------------------
// ①GetMinecartDamage 数值表（速度→伤害/击退档位快照）
// ---------------------------------------------------------------------------

describe('①GetMinecartDamage 数值表（1457 :29474-29518 / 1456 :28776）', () => {
  it('默认矿车型 25+55×速比', () => {
    expect(MD(0).damage).toBe(25);
    expect(MD(0.25).damage).toBe(39);   // 25+13.75=38.75 → round
    expect(MD(0.5).damage).toBe(52);    // 25+27.5=52.5 → ★F9 蓝队三批 damageVar 迁入 stats/DamageVar.ts
                                        // 后改 C# ToEven 银行家形（52），与全仓单源一致
    expect(MD(0.75).damage).toBe(66);
    expect(MD(1).damage).toBe(80);
    expect(MD(1.5).damage).toBe(108);   // 107.5
  });

  it('mount 13 木质矿车低配档 15+30×速比', () => {
    expect(MD(0, { mountType: 13 }).damage).toBe(15);
    expect(MD(0.5, { mountType: 13 }).damage).toBe(30);
    expect(MD(1, { mountType: 13 }).damage).toBe(45);
    expect(MD(2, { mountType: 13 }).damage).toBe(75);
  });

  it('UsingSuperCart 整体覆写 50+100×速比（覆写优先于车型分派）', () => {
    expect(MD(0, { superCart: true }).damage).toBe(50);
    expect(MD(0.5, { superCart: true }).damage).toBe(100);
    expect(MD(1, { superCart: true }).damage).toBe(150);
    expect(MD(1, { superCart: true, mountType: 13 }).damage).toBe(150);
  });

  it('hardMode ×1.5 再 expertMode ×1.5，各一步 (int) 截断（合并乘区≠逐级截断）', () => {
    expect(MD(1, { hardMode: true }).damage).toBe(120);
    // 逐级截断链：80→120→180；33→49(49.5 截)→73(73.5 截)，若一次 ×2.25 会得 74
    expect(getMinecartDamage(1, { mountType: 6, superCart: false, hardMode: true, expertMode: true },
      0, IDENTITY_RND).damage).toBe(180);
    expect(getMinecartDamage(0.14545454545, { mountType: 6, superCart: false, hardMode: true, expertMode: true },
      0, IDENTITY_RND).damage).toBe(73);
  });

  it('击退 = 10+40×速比，不吃波动不吃难度乘区；基础面与全链口径一致', () => {
    expect(MD(0).knockback).toBe(10);
    expect(MD(0.5).knockback).toBe(30);
    expect(MD(1).knockback).toBe(50);
    expect(getMinecartDamage(1, { mountType: 6, superCart: false, hardMode: true, expertMode: true },
      0, IDENTITY_RND).knockback).toBe(50);
    expect(minecartDamageBase(1, { mountType: 6, superCart: false, hardMode: false, expertMode: false }))
      .toEqual({ base: 80, knockback: 50 });
  });
});

describe('①矿车冲撞盒扩张（1457 :27751-27768 / 1456 :27228-27245）', () => {
  it('横向双段扩张：|vx|>1 → ±15，|vx|>10 叠加 ±10（x 侧只移左边界不加宽）', () => {
    // 正向：w=20+15+10=45（x 不动）；负向：x=200-15-10=175、w 保持 20
    expect(minecartRampageBox(200, 300, 20, 52, 14, 0)).toEqual({ x: 200, y: 300, w: 45, h: 52 });
    expect(minecartRampageBox(200, 300, 20, 52, -14, 0)).toEqual({ x: 175, y: 300, w: 20, h: 52 });
    expect(minecartRampageBox(200, 300, 20, 52, 5, 0)).toEqual({ x: 200, y: 300, w: 35, h: 52 });
    expect(minecartRampageBox(200.7, 300, 20, 52, 0.5, 0)).toEqual({ x: 200, y: 300, w: 20, h: 52 });   // (int)position + 低速不扩
  });
  it('纵向单段：vy<-1 y-=10 / vy>1 h+=10——原版纵向无 |v|>10 二段（X 独有非对称）', () => {
    expect(minecartRampageBox(200, 300, 20, 52, 0, 12)).toEqual({ x: 200, y: 300, w: 20, h: 62 });
    expect(minecartRampageBox(200, 300, 20, 52, 0, -12)).toEqual({ x: 200, y: 290, w: 20, h: 52 });
  });
});

describe('①minecartNpcRampage 全链（1457 :27748-27831 / 1456 :27225）', () => {
  function setup(o: { cart?: Record<string, unknown>; enemy?: Partial<StubEnemy>; playerOver?: Record<string, unknown> } = {}) {
    const world = new World(64, 140, 42, '测试');
    const e = mkEnemy({
      x: 240, y: 320, w: 24, h: 24, ...(o.enemy ?? {}),
    });
    return { game: mkGame(world.store, [e], o.playerOver ?? {}), e };
  }

  it('全速碾压命中：伤害 25+55×速比、击退带方向、iframes=30、fromPlayer 计 DPS', () => {
    // vx=12/RunSpeed13 → 速比 12/13=0.923077 → 伤害 round(75.769)=76、击退 46.923
    const { game, e } = setup();
    expect(minecartNpcRampage(CART(), game, IDENTITY_RND)).toBe(1);
    expect(e.hits.length).toBe(1);
    expect(e.hits[0].dmg).toBe(76);
    expect(e.hits[0].kbx).toBeCloseTo((10 + 40 * (12 / 13)) * 1, 3);
    expect(e.hits[0].crit).toBe(false);          // 缺省零暴击+掷骰确定性
    expect(e.hits[0].fromPlayer).toBe(true);
    expect(e.iframes).toBe(30);
  });

  it('暴击 crit 直传 hurt（×2=Enemy.hurt 防后,S02;critChance 钉满）', () => {
    const { game, e } = setup({ playerOver: { critChance: () => 100 } });
    minecartNpcRampage(CART(), game, IDENTITY_RND);
    expect(e.hits[0].crit).toBe(true);
    expect(e.hits[0].dmg).toBe(76);    // ★S02(BJ723-B)改判:未翻倍基伤(旧 152=预倍形)
  });

  it('三择大口径：melee/ranged/magic 取最大者参与掷骰', () => {
    // 仅 magic 满 100：若实现误取单一系（如只看 melee=0）则必不暴击——此断言钉住 max 链
    const { game, e } = setup({ playerOver: {
      critChance: (k: string) => ({ melee: 0, ranged: 0, magic: 100 })[k] ?? 0,
    } });
    minecartNpcRampage(CART(), game, IDENTITY_RND);
    expect(e.hits[0].crit).toBe(true);   // (floor(rand*100)+1)<=100 恒真
    const g2 = setup({});
    minecartNpcRampage(CART(), g2.game, IDENTITY_RND);
    expect(g2.e.hits[0].crit).toBe(false);
  });

  it('反向行驶击退为负向（num81=-1 链；负速只向左扩盒 → 目标摆左侧）', () => {
    // vx=-12：盒 x=200-15-10=175、w=20 → [175,195]；敌怪放左缘 [160,184] 相交
    const { game, e } = setup({ enemy: { x: 160, y: 320, w: 24, h: 24 } });
    minecartNpcRampage(CART({ vx: -12 }), game, IDENTITY_RND);
    expect(e.hits.length).toBe(1);
    expect(e.hits[0].kbx).toBeLessThan(0);
    expect(e.hits[0].dmg).toBe(76);
  });

  it('门禁串：dead/dontTakeDamage/friendly/immune!=0/不相交均不结算', () => {
    const cases: Array<[string, Partial<StubEnemy>]> = [
      ['dead', { dead: true }],
      ['dontTakeDamage', { dontTakeDamage: true }],
      ['friendly', { def: { friendly: true } }],
      ['iframes', { iframes: 9 }],
      ['不相交', { x: 900 }],
    ];
    for (const [name, over] of cases) {
      const { game, e } = setup({ enemy: over });
      expect(minecartNpcRampage(CART(), game, IDENTITY_RND), name).toBe(0);
      expect(e.hits.length, name).toBe(0);
    }
    // 速度门：velocity.Length()>4f 才进循环
    const slow = setup();
    expect(minecartNpcRampage(CART({ vx: 3 }), slow.game, IDENTITY_RND)).toBe(0);
    expect(slow.e.hits.length).toBe(0);
  });

  it('0<knockBackResist<1 预除抗性（净击退不衰减）；resist≥1/0 不动', () => {
    const rHalf = setup({ enemy: { def: { friendly: false, knockBackResist: 0.5 } } });
    minecartNpcRampage(CART(), rHalf.game, IDENTITY_RND);
    expect(rHalf.e.hits[0].kbx).toBeCloseTo((10 + 40 * (12 / 13)) / 0.5, 3);

    const rFull = setup({ enemy: { def: { friendly: false, knockBackResist: 1 } } });
    minecartNpcRampage(CART(), rFull.game, IDENTITY_RND);
    expect(rFull.e.hits[0].kbx).toBeCloseTo(10 + 40 * (12 / 13), 3);

    const rImmuneKb = setup({ enemy: { def: { friendly: false, knockBackResist: 0 } } });
    minecartNpcRampage(CART(), rImmuneKb.game, IDENTITY_RND);
    expect(rImmuneKb.e.hits[0].kbx).toBeCloseTo(10 + 40 * (12 / 13), 3);
  });

  it('木质/SuperCart 数值走对应档位表', () => {
    const wood = setup();
    minecartNpcRampage(CART({ mountId: 13 }), wood.game, IDENTITY_RND);
    expect(wood.e.hits[0].dmg).toBe(Math.round(15 + 30 * (12 / 13)));

    const sc = setup();
    minecartNpcRampage(CART({ superCart: true, runSpeed: 20, vx: 14 }), sc.game, IDENTITY_RND);
    expect(sc.e.hits[0].dmg).toBe(Math.round(50 + 100 * (14 / 20)));
  });

  it('★无 LOS 门是原版设计：隔实心石壁照样碾过（勿回补 LOS）', () => {
    const world = new World(64, 140, 42, '测试');
    // 在车位与敌怪中心之间立实心墙格
    world.store.setTile(Math.trunc((240 + 12) / 16), Math.trunc((320 + 12) / 16), STONE);
    const e = mkEnemy({ x: 240, y: 320, w: 24, h: 24 });
    const game = mkGame(world.store, [e]);
    expect(minecartNpcRampage(CART(), game, IDENTITY_RND)).toBe(1);
    expect(e.hits.length).toBe(1);
  });

  it('困难模式乘区随世界 flags 进入结算', () => {
    const world = new World(64, 140, 42, '测试');
    const e = mkEnemy({ x: 240, y: 320, w: 24, h: 24 });
    const game = mkGame(world.store, [e]) as unknown as { world: { flags: Record<string, boolean> } };
    (game.world.flags as unknown as Record<string, boolean>).hardMode = true;
    minecartNpcRampage(CART(), game as unknown as GameHooks, IDENTITY_RND);
    expect(e.hits[0].dmg).toBe(Math.trunc(Math.round(25 + 55 * (12 / 13)) * 1.5));
  });
});

// ---------------------------------------------------------------------------
// ②史莱姆坐骑弹跳踩踏（JumpMovement 三循环）
// ---------------------------------------------------------------------------

/** 几何场景：玩家 20×42 @(484,380)，敌怪置于脚底横带内（band=[472..516]×[415..429]）。
 *  世界高 140 格——canHit 的 y 钳制上限是 h-40=100，本场景 ty≤28 远在钳制内。 */
function makeStompScene(enemy: Partial<StubEnemy>, tiles?: (st: World['store']) => void) {
  const world = new World(64, 140, 42, '测试');
  tiles?.(world.store);
  const p = {
    x: 484, y: 380, w: 20, h: 42, vx: 0, vy: 5, facing: 1,
    wetSlime: 0, iframes: 0,
    summonDamageMult: 1.3,
    mount: { active: true, type: 3 },
  };
  const e = mkEnemy({ x: 476, y: 420, w: 18, h: 40, ...enemy });
  const game = mkGame(world.store, [e]);
  return { p, e, game, store: world.store };
}

describe('②史莱姆坐骑弹跳踩踏 A 支（1457 :20693-20726 / 1456 :20254-20287）', () => {
  it('下落中踩中：dmg=(int)(40×minionDamage)、kb±5、npc immune 10、velocity.Y=-10 回弹', () => {
    const s = makeStompScene({});
    expect(mountJumpStomps(s.p, s.game)).toBe(1);
    expect(s.e.hits.length).toBe(1);
    expect(s.e.hits[0].dmg).toBe(Math.trunc(40 * 1.3));   // 52
    expect(s.e.hits[0].crit).toBe(false);                  // ★原文 ApplyDamageToNPC(crit:false) 字面
    expect(s.e.hits[0].fromPlayer).toBe(true);
    expect(s.p.vy).toBe(-10);                              // 弹跳位移仅 A 支
    expect(s.e.iframes).toBe(10);
    expect(s.p.iframes).toBeGreaterThanOrEqual(6);         // GiveImmuneTimeForCollisionAttack(6)
  });

  it('水平速度改写方向：vx<0→kb 负向 / vx>0→正向（静止时取 facing）', () => {
    const a = makeStompScene({}); a.p.vx = -2;
    mountJumpStomps(a.p, a.game);
    expect(a.e.hits[0].kbx).toBe(-5);
    const b = makeStompScene({}); b.p.vx = 3;
    mountJumpStomps(b.p, b.game);
    expect(b.e.hits[0].kbx).toBe(5);
  });

  it('LOS 直判短式：脚底与目标之间实心石壁挡住踩踏；平台不挡；noTileCollide 绕行', () => {
    // 石壁：玩家中心格(30,25)→敌怪中心格(30,27) 的竖路上填 29..31 列整墙
    //（CanHit 主轴步进的左右邻格夹挤规则命中）
    const walled = makeStompScene({}, (st) => {
      for (let tx = 29; tx <= 31; tx++) st.setTile(tx, 26, STONE);
    });
    expect(mountJumpStomps(walled.p, walled.game)).toBe(0);
    expect(walled.p.vy).toBe(5);      // 无命中无弹跳

    const plat = makeStompScene({}, (st) => {
      for (let tx = 29; tx <= 31; tx++) st.setTile(tx, 26, PLATFORM);
    });
    expect(mountJumpStomps(plat.p, plat.game)).toBe(1);

    const ghost = makeStompScene({ noTileCollide: true }, (st) => {
      for (let tx = 29; tx <= 31; tx++) st.setTile(tx, 26, STONE);
    });
    expect(mountJumpStomps(ghost.p, ghost.game)).toBe(1);
  });

  it('wetSlime>0 压制 A 支（浸液后的湿态抑制弹跳）；清湿后恢复', () => {
    const s = makeStompScene({});
    s.p.wetSlime = 5;
    expect(mountJumpStomps(s.p, s.game)).toBe(0);
    expect(s.p.vy).toBe(5);
    s.p.wetSlime = 0;
    expect(mountJumpStomps(s.p, s.game)).toBe(1);
  });

  it('不骑乘/落地态（vy<=0）不触发；皇后坐骑 50 同属 slime 族', () => {
    const g = makeStompScene({});
    g.p.mount.active = false;
    expect(mountJumpStomps(g.p, g.game)).toBe(0);
    const l = makeStompScene({});
    l.p.vy = 0;
    expect(mountJumpStomps(l.p, l.game)).toBe(0);
    const q = makeStompScene({});
    q.p.mount.type = 50;
    q.p.summonDamageMult = 2;
    expect(isConsideredASlimeMount(50)).toBe(true);
    expect(mountJumpStomps(q.p, q.game)).toBe(1);
    expect(q.e.hits[0].dmg).toBe(80);
  });

  it(' immune 门链：敌方 iframes 未归零/不可伤/friendly 不结算', () => {
    for (const over of [{ iframes: 3 }, { dontTakeDamage: true }, { dead: true }, { def: { friendly: true } }] as Array<Partial<StubEnemy>>) {
      const s = makeStompScene(over);
      expect(mountJumpStomps(s.p, s.game), JSON.stringify(over)).toBe(0);
    }
  });
});

describe('②高尔夫球车下压 C 支（1457 :20768-20801 / 1456 :20329-20362）', () => {
  it('type17：dmg=40 无 minionDamage 乘区、immune 12、GiveImmune(12)、无弹跳', () => {
    const s = makeStompScene({});
    s.p.mount.type = 17;
    s.p.summonDamageMult = 9;     // 若误乘会远大于 40
    expect(mountJumpStomps(s.p, s.game)).toBe(1);
    expect(s.e.hits[0].dmg).toBe(40);
    expect(s.e.iframes).toBe(12);
    expect(s.p.iframes).toBeGreaterThanOrEqual(12);
    expect(s.p.vy).toBe(5);       // C 支不动 velocity.Y
  });
});

describe('②死亡细胞冲撞符文 B 支（显式入口，1457 :20731-20765 / 1456 :20292-20326）', () => {
  it('数值与 A 支同构但无弹跳位移；引擎尚无 DownDash 触发源故未挂进 tick', () => {
    const s = makeStompScene({});
    expect(ramRuneDownDashStomp(s.p, s.game)).toBe(1);
    expect(s.e.hits[0].dmg).toBe(Math.trunc(40 * 1.3));
    expect(s.e.iframes).toBe(10);
    expect(s.p.vy).toBe(5);
    const up = makeStompScene({});
    up.p.vy = -3;
    expect(ramRuneDownDashStomp(up.p, up.game)).toBe(0);   // vy>0 门
  });
});

// ---------------------------------------------------------------------------
// wetSlime 液体态（1457 :28160-28207 / 1456 :27653-27689）
// ---------------------------------------------------------------------------

describe('wetSlime 滴答 + 史莱姆坐骑液体浮力档', () => {
  // ★SW-RB20a F6③：探针基面 inWater/inLava/inHoney 三桶并集 → wetSticky
  //  （≙ vanilla wet 粘滞位,Player.cs:28192 `if (wet)`——夹具同名换字段,
  //  触发/非触发语义不变）
  const P = (o: Record<string, unknown>) => ({
    wetSticky: false, vy: 0, wetSlime: 0,
    mount: { active: false, type: 3 }, ...o,
  });

  it('每 tick 递减', () => {
    const p = P({ wetSlime: 10 }) as never as Parameters<typeof tickSlimeWetState>[0];
    tickSlimeWetState(p);
    expect((p as unknown as { wetSlime: number }).wetSlime).toBe(9);
  });

  it('骑史莱姆族浸液：wetSlime=30 + 浮力档（vy>2 ×0.9 缓降 / -0.5 浮升 / -4 上浮钳制）', () => {
    // vy=3>2：×0.9=2.7 → −0.5=2.2
    const a = P({ mount: { active: true, type: 3 }, wetSticky: true, vy: 3 });
    tickSlimeWetState(a as never as Parameters<typeof tickSlimeWetState>[0]);
    expect(a.wetSlime).toBe(30);
    expect(a.vy).toBeCloseTo(2.2);
    // vy=1：不过 ×0.9 门 → −0.5=0.5
    const b = P({ mount: { active: true, type: 50 }, wetSticky: true, vy: 1 });
    tickSlimeWetState(b as never as Parameters<typeof tickSlimeWetState>[0]);
    expect(b.vy).toBeCloseTo(0.5);
    // 快速上抛被钳回 −4
    const c = P({ mount: { active: true, type: 3 }, wetSticky: true, vy: -10 });
    tickSlimeWetState(c as never as Parameters<typeof tickSlimeWetState>[0]);
    expect(c.vy).toBe(-4);
  });

  it('岩浆/蜂蜜同样触发（原版 wet 不分液体种类）；非史莱姆族与非浸液不动', () => {
    const lava = P({ mount: { active: true, type: 3 }, wetSticky: true, vy: 0 });
    tickSlimeWetState(lava as never as Parameters<typeof tickSlimeWetState>[0]);
    expect(lava.wetSlime).toBe(30);
    expect(lava.vy).toBeCloseTo(-0.5);
    const honey = P({ mount: { active: true, type: 50 }, wetSticky: true, vy: 0 });
    tickSlimeWetState(honey as never as Parameters<typeof tickSlimeWetState>[0]);
    expect(honey.wetSlime).toBe(30);
    const dry = P({ mount: { active: true, type: 3 }, vy: 0 });
    tickSlimeWetState(dry as never as Parameters<typeof tickSlimeWetState>[0]);
    expect(dry.wetSlime).toBe(0);
    const turtle = P({ mount: { active: true, type: 4 }, wetSticky: true, vy: 6, wetSlime: 7 });
    tickSlimeWetState(turtle as never as Parameters<typeof tickSlimeWetState>[0]);
    expect(turtle.wetSlime).toBe(6);       // 只递减不置位
    expect(turtle.vy).toBe(6);             // 海龟不吃浮力档
  });
});

describe('控跳清湿（1457 :20813-20817 / 1456 :20375-20377）', () => {
  it('骑史莱姆族按住跳键清除 wetSlime 并放行；其余组合不动', () => {
    expect(consumeWetSlimeOnJumpControl({ inputJump: true, wetSlime: 5, mount: { active: true, type: 3 } })).toBe(true);
    expect(consumeWetSlimeOnJumpControl({ inputJump: false, wetSlime: 5, mount: { active: true, type: 3 } })).toBe(false);
    expect(consumeWetSlimeOnJumpControl({ inputJump: true, wetSlime: 5, mount: { active: true, type: 4 } })).toBe(false);
    expect(consumeWetSlimeOnJumpControl({ inputJump: true, wetSlime: 0, mount: { active: true, type: 3 } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 蓝队复核批（2026-08-30）回归
// ---------------------------------------------------------------------------

describe('R1 回归：GetMinecartDamage 在命中循环体内逐 NPC 重抽（1457 :27785-27792）', () => {
  /** 标准碾压场景：扩盒 [200,245)×[300,352)，两敌怪都相交且互不重叠 */
  function dualScene(o: Record<string, unknown> = {}) {
    const world = new World(64, 140, 42, '测试');
    const eA = mkEnemy({ x: 220, y: 320, w: 20, h: 24 });
    const eB = mkEnemy({ x: 238, y: 320, w: 6, h: 24 });
    return { game: mkGame(world.store, [eA, eB], o), eA, eB };
  }

  it('同 tick 双目标各自掷 DamageVar：A +15% 档 / B −15% 档（旧版共享一次掷骰）', () => {
    const { game, eA, eB } = dualScene();
    // 流设计：暴击抽(0.99→100>0 不暴)、伤害抽(0.99→+15% / 0.0→−15%)
    const s = scriptedRnd([0.99, 0.99, 0.99, 0.0]);
    expect(minecartNpcRampage(CART(), game, s.rnd)).toBe(2);
    const base = 25 + 55 * (12 / 13);              // vx=12 / runSpeed=13
    expect(eA.hits[0].dmg).toBe(Math.round(base * 1.15));
    expect(eB.hits[0].dmg).toBe(Math.round(base * 0.85));
    expect(eA.hits[0].dmg).not.toBe(eB.hits[0].dmg);
  });

  it('单目标掷序 = 原文位次：暴击掷(:27785) → GetMinecartDamage(:27791)；无循环外偷掷', () => {
    const world = new World(64, 140, 42, '测试');
    const e = mkEnemy({ x: 240, y: 320 });
    const game = mkGame(world.store, [e]);
    const s = scriptedRnd([0.5, 0.5]);             // 恰好两次：crit + damage
    minecartNpcRampage(CART(), game, s.rnd);
    expect(s.log).toEqual([0.5, 0.5]);             // 长度/顺序即契约（越界会抛）
  });

  it('SuperCart 生效期消耗两次 DamageVar（switch 先掷 :29479 + 覆写再掷 :29512），终值取第二掷', () => {
    const ratio = 14 / 20;
    const a = getMinecartDamage(ratio, { mountType: 6, superCart: true, hardMode: false, expertMode: false },
      0, scriptedRnd([0.99, 0.99]).rnd);           // [base掷 +15%, 覆写掷 +15%]
    expect(a.damage).toBe(Math.round((50 + 100 * ratio) * 1.15));
    // 第二掷定值：覆写抽 0.0 → −15%（第一掷抽什么都无关——终值只看覆写掷）
    const b = getMinecartDamage(ratio, { mountType: 6, superCart: true, hardMode: false, expertMode: false },
      0, scriptedRnd([0.99, 0.0]).rnd);
    expect(b.damage).toBe(Math.round((50 + 100 * ratio) * 0.85));
  });

  it('R2 回归：恒等注入下 crit 完全由注入 rnd 决定（裸 Math.random 泄漏即两跑分叉）', () => {
    const run = (globalVals: number[]) => {
      const spy = vi.spyOn(Math, 'random');
      for (const v of globalVals) spy.mockReturnValueOnce(v);
      const world = new World(64, 140, 42, '测试');
      const e = mkEnemy({ x: 240, y: 320 });
      const game = mkGame(world.store, [e], { critChance: () => 50 });
      const s = scriptedRnd([0.10, 0.5]);          // crit 抽 0.10→11≤50 暴；伤害抽 0.5 恒等
      const hits = minecartNpcRampage(CART(), game, s.rnd);
      spy.mockRestore();
      return JSON.stringify(hits ? [{ crit: e.hits[0]?.crit, dmg: e.hits[0]?.dmg }] : []);
    };
    // 全局 Math.random 两跑给出极端异值：若 crit 掷漏走注入源，两跑 crit 必分叉
    expect(run([0.9999])).toBe(run([0.0001]));
    const world = new World(64, 140, 42, '测试');
    const e = mkEnemy({ x: 240, y: 320 });
    const game = mkGame(world.store, [e], { critChance: () => 50 });
    minecartNpcRampage(CART(), game, scriptedRnd([0.10, 0.5]).rnd);
    expect(e.hits[0].crit).toBe(true);
  });
});

describe('R4 回归：GiveImmuneTimeForCollisionAttack 按【剩余】immuneTime 比较（1457 :20660 门）', () => {
  it('先授长档(12)衰减至剩余≤6 后，短档(6)授予可刷新（旧 lastGrant 口径误拒场景）', () => {
    const s = makeStompScene({});
    s.p.mount.type = 17;                            // C 支 GiveImmune(12)
    expect(mountJumpStomps(s.p, s.game)).toBe(1);
    expect(s.p.iframes).toBeGreaterThanOrEqual(12);
    s.p.iframes = 4;                                // 模拟 UpdateImmunity 逐帧递减（原版 :18976）
    s.e.iframes = 0;                                // NPC 侧冷却复位允许二次命中
    s.p.mount.type = 3;                             // A 支 GiveImmune(6)
    mountJumpStomps(s.p, s.game);
    expect(s.p.iframes).toBe(6);                    // 4<=6 → 刷新到 6（max 等价 time 直写）
  });

  it('剩余高于新授时长拒发降级（immuneTime>time 与原文一致不缩水）', () => {
    const s = makeStompScene({});
    s.p.mount.type = 17;
    mountJumpStomps(s.p, s.game);                   // 授 12
    s.e.iframes = 0;
    s.p.mount.type = 3;
    mountJumpStomps(s.p, s.game);                   // 尝试授 6
    expect(s.p.iframes).toBe(12);                   // 12>6 拒发，保持原池
  });

  it('_immuneStrikes>=3 三连击豁免仍生效；>20t 后连击窗口归位', () => {
    const s = makeStompScene({});
    for (let k = 0; k < 3; k++) {                   // 连续三踩（strikes 1→2→3）
      s.e.iframes = 0;
      s.p.vy = 5;                                   // A 支命中后 vy=-10，重置回下落态
      s.p.iframes = 0;                              // 只考察连击门
      mountJumpStomps(s.p, s.game);
    }
    expect(s.p.iframes).toBe(0);                    // 第三次拒发
    const far = makeStompScene({});
    far.e.iframes = 0;
    far.p.iframes = 0;
    for (let t = 0; t < 21; t++) {
      far.p.vy = -1;                                // vy<=0 踩踏跳过但时钟照推进
      mountJumpStomps(far.p, far.game);
    }
    far.p.vy = 5;
    mountJumpStomps(far.p, far.game);
    expect(far.p.iframes).toBe(6);                  // _timeSinceLastImmuneGet 归 0 重计 strikes=1
  });
});

describe('R6 回归：矿车/坐骑扫掠集并小动物桶（原版 Main.npc 全槽遍历；flag=dontHurtCritters 且仓内无该面）', () => {
  it('矿车碾压 critters 桶小动物：hurt 单点管线 + iframes=30 + 击杀触发 VEHICULAR_MANSLAUGHTER', () => {
    const world = new World(64, 140, 42, '测试');
    const events: number[] = [];
    const bunny = mkEnemy({ x: 238, y: 320, w: 16, h: 16, def: { friendly: false } });
    bunny.hurt = function hurt(dmg, kbx, kby, _g, _ap, crit, _pi, fp) {   // 击杀即死语义
      this.dead = true;                             // ApplyDamageToNPC 后 active=false ⇔ dead
      this.hits.push({ dmg, kbx, kby, crit: !!crit, fromPlayer: !!fp });
      return true;
    };
    const game = mkGame(world.store, [], {}, {
      critters: [bunny],
      achievements: { handleSpecialEvent: (ev: number) => { events.push(ev); } },
    });
    expect(minecartNpcRampage(CART(), game)).toBe(1);
    expect(bunny.hits.length).toBe(1);
    expect(bunny.iframes).toBe(30);
    expect(events).toEqual([9]);                    // :27821 小动物击杀同样计入成就面
  });

  it('史莱姆踩踏吃小动物桶且保持 break 语义：敌怪优先命中时不波及同带小动物', () => {
    const world = new World(64, 140, 42, '测试');
    const enemy = mkEnemy({ x: 476, y: 420, w: 18, h: 40 });
    const critter = mkEnemy({ x: 476, y: 420, w: 18, h: 40 });   // 同带
    const game = mkGame(world.store, [enemy], {}, { critters: [critter] });
    const p = {
      x: 484, y: 380, w: 20, h: 42, vx: 0, vy: 5, facing: 1,
      wetSlime: 0, iframes: 0, summonDamageMult: 1,
      mount: { active: true, type: 3 },
    };
    expect(mountJumpStomps(p as never, game)).toBe(1);
    expect(enemy.hits.length).toBe(1);
    expect(critter.hits.length).toBe(0);            // vanilla 命中即 break

    const world2 = new World(64, 140, 42, '测试');
    const only = mkEnemy({ x: 476, y: 420, w: 18, h: 40 });
    const game2 = mkGame(world2.store, [], {}, { critters: [only] });
    const p2 = {
      x: 484, y: 380, w: 20, h: 42, vx: 0, vy: 5, facing: 1,
      wetSlime: 0, iframes: 0, summonDamageMult: 1,
      mount: { active: true, type: 3 },
    };
    expect(mountJumpStomps(p2 as never, game2)).toBe(1);
    expect(only.hits.length).toBe(1);
    expect(p2.vy).toBe(-10);                        // A 支弹跳在小动物目标上同样成立
  });
});

describe('R3 回归：控跳清湿无液体位置要求——出水上岸按跳即刻清湿（Player.fixedUpdate 全链）', () => {
  /** 真实 Player 最小钩桩（形态照 tests/player-run-parity.makeGame；批任务书只开放
   *  mount-combat.test.ts，故在本文件落地集成位） */
  function makeLandHooks(w: World): GameHooks {
    return {
      world: w, player: null as unknown,
      enemies: () => [], critters: () => [],
      entities: { nextId: 1, add: () => {} },
      playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
      spawnParticles: () => {}, spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
      addDamageNumber: () => {}, spawnDrop: () => null, damagePlayer: (): number => 0,
      notifyInventoryChanged: () => {}, onEnemyKilled: () => {},
      spawnEnemy: () => {}, cutTile: () => {},
    } as unknown as GameHooks;
  }

  async function makePlayer(): Promise<import('../src/entities/Player').Player> {
    const { Player } = await import('../src/entities/Player');
    const { Inventory } = await import('../src/items/Inventory');
    return new Player(60 * 16, 60 * 16 - 60, new Inventory());
  }

  // ★清零批·受击域（2026-08-31）：480×80 大世界 22×fixedUpdate 全链在既有费度下已贴
  //   5s 边界（同逻辑独立克隆 ~291ms,本文件上下文实测 8.1s——并行会话 CPU 抢占放大）。
  //   场景语义零改动,仅把脆弱的缺省 testTimeout 拉到 30s 防环境抖动假红。
  it('陆上湿残余：不按跳逐帧递减；按住跳单帧清零（水中分支被短路也无法受阻）',
    { timeout: 30000 }, async () => {
    const w = new World(480, 80, 30, '陆地');
    for (let x = 0; x < 480; x++) {
      w.store.setTileSilent(x, 70, 1, 0, 0);
      w.store.setTileSilent(x, 71, 1, 0, 0);
    }
    const game = makeLandHooks(w);
    const p = await makePlayer();
    p.x = 200 * 16;
    p.y = 70 * 16 - 60;                             // 贴地出生：距地面 ~18px，数 tick 内落地
    for (let i = 0; i < 20; i++) p.fixedUpdate(1 / 60, game);   // 落地沉降
    expect(p.onGround).toBe(true);

    // 骑史莱姆坐骑出水（原版浸液置 wetSlime=30 后离水）——站陆地
    p.mount.active = true;
    p.mount.type = 3;
    p.wetSlime = 30;

    p.inputJump = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.wetSlime).toBe(29);                    // 未按键：仅液体段递减链在跑

    p.inputJump = true;                             // 陆上按跳 → 原版 controlJump 头部即清
    p.fixedUpdate(1 / 60, game);
    expect(p.wetSlime).toBe(0);                     // ★旧实现此值=28（消费点嵌水中分支）
  });

  it('非史莱姆族/无骑乘不清湿（gate 面不变，防外提后过度清除）', async () => {
    const w = new World(480, 80, 30, '陆地');
    for (let x = 0; x < 480; x++) {
      w.store.setTileSilent(x, 70, 1, 0, 0);
      w.store.setTileSilent(x, 71, 1, 0, 0);
    }
    const game = makeLandHooks(w);
    const p = await makePlayer();
    p.x = 200 * 16;
    p.y = 70 * 16 - 60;                             // 同贴地出生位
    for (let i = 0; i < 20; i++) p.fixedUpdate(1 / 60, game);

    p.mount.active = true;
    p.mount.type = 4;                               // 海龟族：不在 IsConsideredASlimeMount
    p.wetSlime = 30;
    p.inputJump = true;
    p.fixedUpdate(1 / 60, game);
    expect(p.wetSlime).toBeGreaterThanOrEqual(29);  // 只递减不触发清

    p.mount.type = 50;                              // 史莱姆皇后 → gate 放行
    p.fixedUpdate(1 / 60, game);
    expect(p.wetSlime).toBe(0);
  });
});
