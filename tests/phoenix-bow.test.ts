// 幻影凤凰 3854（DD2 终波奖励弓）三件套回归：
//   ① use 发 705：载体首拍即发 2 箭（AI_075 type==705 :68287-68400——ai[1] 初值 0 归零
//      触发）、木箭弹型 1 就地换燃烧箭 2（:68330-68332）、跟手位置（AI 尾 :68401）
//   ② 蓄力转 706：phantomPhoneixCounter（Player.cs:1171，宿主字段持久）计到 3 的下一拍
//      改射单发 706（伤 ×2 / 速 16 / 散布 0 / ai[1]×1.5 节拍拉长 :68333-68341）；计数
//      复位后回到双箭；跨载体持续（原版无复位点）；松手/无弹 → 载体 Kill（:68394-68396）
//   ③ shot 音：706 首拍播 DD2_PhantomPhoenixShot 三变体组（SoundID.cs:1014 +
//      Projectile.cs:56748-56753 PlayTrackedSound）；湿灭（:56743-56746）；重力默认支
//      ai0≥15 后 vy+=0.1（:58554-58565）；寿命 120（NewProjectile :11077-11081）；
//      命中 OnFire3 480t→onFire3T=8s（StatusNPC :11376-11379 表驱动）+ 每击伤 ×0.95
//      截断（Damage_PVE_Inner :14275-14278）+ per-NPC 10t 免疫（localNPCHitCooldown
//      :7472）；705 节拍器 Item_5 首拍豁免（:68299-68306）
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { LIQUID_TYPE } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';
import {
  PhoenixChannel, PhoenixBolt,
  type PhoenixOwnerLike, type PhoenixVolleyResult,
} from '../src/entities/PhoenixBowProj';
import { soundTrackFiles } from '../src/data/vanillaNpcs';
import { damageVarRoll } from '../src/stats/DamageVar';   // ★G37-A：DV 域锁（bj735a 判例形）

interface FireEvent {
  tick: number;
  pid: number;
  x: number; y: number;
  vx: number; vy: number;
  dmg: number; kb: number;
}

function makeGame(w: World, list: unknown[] = []) {
  const state = {
    sfxGroups: [] as string[][],          // playSfxFiles 收录（706 出生音组）
    sfxFiles: [] as string[],             // playSfxFile 收录（705 节拍 Item_5）
    refreshed: 0,                         // refreshChannelItem 次数
  };
  const game = {
    world: w,
    player: null as unknown,
    enemies: () => list,
    entities: { add: () => {} },
    playSfxFiles: (files: string[]) => { state.sfxGroups.push([...files]); },
    playSfxFile: (f: string) => { state.sfxFiles.push(f); },
    refreshChannelItem: () => { state.refreshed++; },
    spawnParticles: () => {},
    spawnBurst: () => {},
    addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, critters: () => [], notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    addLightAt: () => {},
  } as unknown as GameHooks & typeof state;
  return Object.assign(game, { state });
}

function emptyWorld(): World {
  const w = new World(160, 220, 30, 'open');
  for (let x = 0; x < 160; x++) w.store.setTileSilent(x, 210, 1, 0, 0);
  return w;
}

function mkOwner(cx: number, cy: number): PhoenixOwnerLike {
  return { cx, cy, facing: 1, dead: false };
}

/** 构造带收集器的载体 */
function mkCarrier(
  owner: PhoenixOwnerLike,
  opts: {
    channel?: () => boolean;
    aim?: () => { x: number; y: number };
    volley: () => PhoenixVolleyResult | null;
    fires: FireEvent[];
    interval?: number;
  },
): PhoenixChannel {
  // fires[].tick = 出膛事件流水号（拍点序），主 tick 序由用例侧采样 beats 记录
  const counter = { tick: 0 };
  const c = new PhoenixChannel(
    owner, 20, 0, 32, 2, opts.interval ?? 18,
    {
      channel: opts.channel ?? (() => true),
      aim: opts.aim ?? (() => ({ x: owner.cx + 500, y: owner.cy })),
      volley: opts.volley,
      fire: (pid, x, y, vx, vy, dmg, kb) => {
        counter.tick++;
        opts.fires.push({ tick: counter.tick, pid, x, y, vx, vy, dmg, kb });
      },
    },
  );
  return c;
}

describe('幻影凤凰 ①：use 发 705 载体', () => {
  it('首拍即发 2 箭 + 木箭 1 换燃烧箭 2 + 跟手位置', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const owner = mkOwner(80 * TILE, 100 * TILE);
    const fires: FireEvent[] = [];
    const c = mkCarrier(owner, {
      volley: () => ({ pid: 1, dmg: 50, kb: 3, speed: 12 }),   // 木箭弹药
      fires,
    });
    c.fixedUpdate(1, game);                          // 首拍（ai[1] 初值 0 归零即发）
    expect(c.dead).toBe(false);
    expect(fires.length).toBe(2);                    // num73=2（:68321）
    expect(fires.every((f) => f.pid === 2)).toBe(true);   // projToShoot4==1 → 2（:68330）
    expect(fires.every((f) => f.dmg === 50)).toBe(true);  // 未逢凤凰拍不翻倍
    // 跟手：position = RotatedRelativePoint(MountedCenter) − Size/2 ≈ 玩家中心 −11
    expect(c.x).toBeCloseTo(owner.cx - 11);
    expect(c.y).toBeCloseTo(owner.cy - 11);
    // 出膛点 = 载体中心（vector34 :68380）
    expect(fires[0].x).toBeCloseTo(owner.cx);
    expect(fires[0].y).toBeCloseTo(owner.cy);
    // channel 动画续期钩子被调（SetDummyItemTime(2) :68404-68406）
    expect((game as unknown as { state: { refreshed: number } }).state.refreshed).toBeGreaterThan(0);
  });

  it('非木箭弹药弹型透传（燃烧箭 2 不再二次换体）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const owner = mkOwner(80 * TILE, 100 * TILE);
    const fires: FireEvent[] = [];
    const c = mkCarrier(owner, { volley: () => ({ pid: 41, dmg: 60, kb: 3, speed: 15 }), fires });
    c.fixedUpdate(1, game);
    expect(fires.length).toBe(2);
    expect(fires.every((f) => f.pid === 41)).toBe(true);
  });

  it('节拍器：interval 18 拍一轮，Item_5 首拍豁免（ai[0]!=1 :68303）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const owner = mkOwner(80 * TILE, 100 * TILE);
    const fires: FireEvent[] = [];
    const c = mkCarrier(owner, { volley: () => ({ pid: 2, dmg: 50, kb: 3, speed: 12 }), fires });
    for (let t = 1; t <= 19 && !c.dead; t++) c.fixedUpdate(1, game);
    const st = (game as unknown as { state: { sfxFiles: string[] } }).state;
    // 首拍（t=1）豁免；第二拍在 t=19（soundDelay=interval）响一声
    expect(st.sfxFiles.filter((f) => f === 'Item_5').length).toBe(1);
  });
});

describe('幻影凤凰 ②：蓄力转 706（phantomPhoneixCounter 三连）', () => {
  it('第 3 拍改射单发 706：伤 ×2 / 速 16 / 散布 0 / 节拍 ×1.5，随后复位回双箭', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const owner = mkOwner(80 * TILE, 100 * TILE);
    const fires: FireEvent[] = [];
    const c = mkCarrier(owner, { volley: () => ({ pid: 2, dmg: 50, kb: 3, speed: 12 }), fires });
    // 拍1 双箭(counter1) → 拍2 双箭(counter2) → 拍3 单发 706（counter 复位）
    for (let t = 1; t <= 40 && !c.dead; t++) c.fixedUpdate(1, game);
    const volleys = [
      fires.filter((f) => f.tick <= 2),
      fires.filter((f) => f.tick > 2 && f.tick <= 4),
      fires.filter((f) => f.tick > 4),
    ];
    expect(volleys[0].length).toBe(2);
    expect(volleys[0].every((f) => f.pid !== 706)).toBe(true);
    expect(volleys[1].length).toBe(2);
    expect(volleys[2].length).toBe(1);
    const ph = volleys[2][0];
    expect(ph.pid).toBe(706);
    expect(ph.dmg).toBe(100);                        // Damage4 *= 2（:68337）
    // 散布 0 + 速 16 → |v| 恰 16（:68338/:68340）
    const mag = Math.hypot(ph.vx, ph.vy);
    expect(Math.abs(mag - 16)).toBeLessThan(1e-9);
    // 计数复位：后续拍回到双箭非 706（:68336）
    for (let t = 41; t <= 80 && !c.dead; t++) c.fixedUpdate(1, game);
    const after = fires.filter((f) => f.tick > 5);
    expect(after.some((f) => f.pid === 706)).toBe(false);
    expect(after.length).toBeGreaterThanOrEqual(2);
  });

  it('凤凰拍后节拍 ×1.5：下次出膛间隔 27t（ai[1] *= 1.5 :68339）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const owner = mkOwner(80 * TILE, 100 * TILE);
    const fires: FireEvent[] = [];
    owner.ppPhoenixCounter = 2;                      // 下一拍即逢三连（原版计数残留语义）
    const c = mkCarrier(owner, { volley: () => ({ pid: 2, dmg: 50, kb: 3, speed: 12 }), fires });
    // 记录出膛发生的主 tick：以固定步进采样（fires 只在拍点增加）
    const beats: number[] = [];
    let prev = 0;
    for (let t = 1; t <= 90 && !c.dead; t++) {
      c.fixedUpdate(1, game);
      if (fires.length > prev) { beats.push(t); prev = fires.length; }
    }
    expect(beats[0]).toBe(1);                        // 首拍即发（counter2→3 转 706）
    expect(fires[0].pid).toBe(706);
    expect(beats.length).toBeGreaterThanOrEqual(3);
    // 凤凰拍（beats[0]）后的下一拍间隔 = ⌈18×1.5⌉ = 27
    expect(beats[1] - beats[0]).toBe(27);
    // 复位后回到 interval 18
    expect(beats[2] - beats[1]).toBe(18);
  });

  it('计数挂在宿主（跨载体持续）：换新载体后残留计数继续累加（Player.cs:1171 无复位点）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const owner = mkOwner(80 * TILE, 100 * TILE);
    const firesA: FireEvent[] = [];
    const a = mkCarrier(owner, { volley: () => ({ pid: 2, dmg: 50, kb: 3, speed: 12 }), fires: firesA });
    a.fixedUpdate(1, game);                          // counter 0→1（双箭）
    a.dead = true;                                   // 强制收场（松手等价）
    const firesB: FireEvent[] = [];
    const b = mkCarrier(owner, { volley: () => ({ pid: 2, dmg: 50, kb: 3, speed: 12 }), fires: firesB });
    b.fixedUpdate(1, game);                          // counter 1→2（仍双箭）
    expect(firesB.every((f) => f.pid !== 706)).toBe(true);
    owner.ppPhoenixCounter = 2;
    const firesC: FireEvent[] = [];
    const cc = mkCarrier(owner, { volley: () => ({ pid: 2, dmg: 50, kb: 3, speed: 12 }), fires: firesC });
    cc.fixedUpdate(1, game);                         // counter 2→3 → 本拍即 706
    expect(firesC.length).toBe(1);
    expect(firesC[0].pid).toBe(706);
  });

  it('拍点松手（channel 断）/ 无弹药 → 载体 Kill（:68394-68396）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const owner = mkOwner(80 * TILE, 100 * TILE);
    const fires: FireEvent[] = [];
    const c1 = mkCarrier(owner, {
      channel: () => false,
      volley: () => ({ pid: 2, dmg: 50, kb: 3, speed: 12 }),
      fires,
    });
    c1.fixedUpdate(1, game);
    expect(c1.dead).toBe(true);
    expect(fires.length).toBe(0);
    const c2 = mkCarrier(owner, { volley: () => null, fires });   // HasAmmo 门失败
    c2.fixedUpdate(1, game);
    expect(c2.dead).toBe(true);
  });
});

describe('幻影凤凰 ③：706 凤凰弹', () => {
  it('shot 音：首拍播 dd2_phantom_phoenix_shot 三变体组且仅一次（SoundID.cs:1014）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const bolt = new PhoenixBolt(80 * TILE, 100 * TILE, 16, 0, 100, 2);
    bolt.fixedUpdate(1, game);
    bolt.fixedUpdate(1, game);
    const groups = (game as unknown as { state: { sfxGroups: string[][] } }).state.sfxGroups;
    expect(groups.length).toBe(1);
    expect(groups[0]).toEqual(soundTrackFiles('dd2_phantom_phoenix_shot'));
    expect(groups[0].length).toBe(3);
    expect(groups[0].every((f) => f.startsWith('dd2_phantom_phoenix_shot'))).toBe(true);
  });

  it('湿灭：出生预置湿旗 → 首拍 Kill（:10886-10892 预置 + :56743-56746 wet 旗驱动;2026-09-06 湿段批——wet=盒级 WetCollision 中心带,旧弹心单格近似退役;满格液面=格顶）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const bolt = new PhoenixBolt(80 * TILE, 100 * TILE, 16, 0, 100, 2);
    const tx = Math.floor(bolt.cx / TILE), ty = Math.floor(bolt.cy / TILE);
    w.store.liquid[w.store.idx(tx, ty)] = 255;   // 满格（255）：液面=格顶——10×10 盒中心带浸入
    w.store.liquidType[w.store.idx(tx, ty)] = LIQUID_TYPE.WATER;
    bolt.fixedUpdate(1, game);
    expect(bolt.dead).toBe(true);
  });

  it('重力默认支：ai0≥15 后 vy+=0.1/tick（:58554-58565），寿命 120t（:11077-11081）', () => {
    const w = emptyWorld();
    const game = makeGame(w);
    const bolt = new PhoenixBolt(80 * TILE, 100 * TILE, 0.001, 0, 100, 2);
    for (let t = 1; t <= 24; t++) bolt.fixedUpdate(1, game);
    // t=15 起 +0.1：24t → 0.1×(24−14)=1.0（浮点容差）
    expect(Math.abs((bolt as unknown as { vy: number }).vy - 1.0)).toBeLessThan(1e-6);
    expect(bolt.dead).toBe(false);
    const b2 = new PhoenixBolt(40 * TILE, 60 * TILE, 0.001, 0, 100, 2);
    for (let t = 1; t <= 119 && !b2.dead; t++) b2.fixedUpdate(1, game);
    expect(b2.dead).toBe(false);                     // 119t 仍在飞
    b2.fixedUpdate(1, game);                         // 第 120t 寿命终
    expect(b2.dead).toBe(true);
  });

  it('命中：OnFire3 480t→onFire3T=8s + 伤 ×0.95 截断衰减 + per-NPC 10t 免疫', () => {
    const w = emptyWorld();
    const list: unknown[] = [];
    const game = makeGame(w, list);
    const bolt = new PhoenixBolt(80 * TILE, 100 * TILE, 16, 0, 100, 2);
    bolt.critChance = 0;
    const hurts: Array<{ dmg: number }> = [];
    const enemy = {
      id: 1, x: 80 * TILE + 4, y: 100 * TILE - 40, w: 500, h: 90, dead: false,
      hurt: (dmg: number) => { hurts.push({ dmg }); return true; },
    };
    list.push(enemy);
    bolt.fixedUpdate(1, game);                       // 第 1 tick 即入盒命中
    expect(hurts.length).toBe(1);
    // ★G37-A（D6,2026-10-31）改判史：706 敌臂补 DV :12970 逐靶掷（BJ729-A 登记债
    //  清偿）→ 旧平值钉 100/95 改 31 档 DV 域锁（bj735a 判例形,damageVarRoll 枚举
    //  自证;luck=0 单掷域）。衰减链照旧：首击 DV(100)、次击 DV(95)（×0.95 截断
    //  作用在 damage 字段=掷基,:14275-278 原序）。
    const dvDomain100 = new Set<number>();
    for (let i = 0; i < 31; i++) dvDomain100.add(damageVarRoll(100, 0, () => i / 31));
    expect(dvDomain100.has(hurts[0].dmg)).toBe(true);
    expect((enemy as unknown as { onFire3T?: number }).onFire3T).toBe(8);   // 480t/60
    // 冷却窗内不再结算（localNPCHitCooldown=10 :7472）
    for (let t = 0; t < 9 && !bolt.dead; t++) bolt.fixedUpdate(1, game);
    expect(hurts.length).toBe(1);
    // 第 10t 冷却完再中：伤害已按上一击终值截断衰减 100→95（×0.95 :14275-14278）
    if (!bolt.dead) bolt.fixedUpdate(1, game);
    expect(hurts.length).toBe(2);
    const dvDomain95 = new Set<number>();
    for (let i = 0; i < 31; i++) dvDomain95.add(damageVarRoll(95, 0, () => i / 31));
    expect(dvDomain95.has(hurts[1].dmg)).toBe(true);
  });
});
