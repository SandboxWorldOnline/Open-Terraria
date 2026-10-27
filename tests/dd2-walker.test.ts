// 旧日军团（DD2）walker 族验收：出生链（门 549 节拍 → SpawnMonsterFromGate 三档
// 分表）+ AI_107 ImprovedWalkers 攻击状态机（NPC.cs:63372-64919）。
//   出生链：startInvasion → updateTime 抽干 300t hold → lanePortalAI 按
//   LaneSpawnRate 节拍从门位置刷出（Game.wireDD2Hooks 的同款接线在测试内复刻）。
//   状态机：投弹手 555（681）/标枪手 561（662）/德拉肯 571（671 多连拍）/
//   哥布林 552（近战前摇）/小妖精 572（自爆冲锋）/食人魔 577（三态）/枯萎兽 569（灵气）。
import { describe, it, expect, afterEach } from 'vitest';
import { Enemy } from '../src/entities/Enemy';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import {
  DD2_EVENT_HOOKS, DD2GoblinBomb, DD2OgreSmash, lanePortalAI,
} from '../src/entities/bossAI_dd2';
import {
  newOldOnesArmyState, startInvasion, updateTime, enemiesForWave,
  spawnMonsterFromGate, type OldOnesArmyHost, type OldOnesArmyState,
} from '../src/world/OldOnesArmy';

const W = 220, H = 160, FLOOR = 120;

function makeWorld(): World {
  const w = new World(W, H, 7, 'dd2-walker-test');
  const st = w.store;
  w.groundLevel = 50;
  for (let x = 0; x < W; x++) {
    st.setTile(x, FLOOR, 1);
    st.setTile(x, FLOOR + 1, 1);
  }
  return w;
}

type Proj = { x: number; y: number; w: number; h: number };

function makeHooks(world: World, playerAt: { x: number; y: number }) {
  const enemies: Enemy[] = [];
  const projectiles: Proj[] = [];
  const sfx: Array<{ t: number; files: string[] }> = [];
  const oneShots: Array<{ t: number; files: string[]; vol: number; x: number; y: number }> = [];
  let tickN = 0;
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: 'enemies' | 'projectiles') => {
      const ent = e as { id: number };
      ent.id = em.nextId++;
      if (bucket === 'enemies') enemies.push(e as Enemy);
      else projectiles.push(e as Proj);
    },
  };
  const px = playerAt.x * TILE, py = playerAt.y * TILE;
  const player = {
    x: px, y: py, w: 20, h: 42, cx: px + 10, cy: py + 21,
    vx: 0, vy: 0, hp: 400, maxHp: 400, dead: false, useTime: 1,
    aabbOverlaps: () => false,
  };
  const hooks = {
    world, player,
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
    playSfxFiles: (files: string[]) => { sfx.push({ t: tickN, files }); },
    showPickupLabel: () => {},
    // ★BJ728-A（债1）：枯萎兽灵气脉冲一次性跟踪轨记录仪（done=true → 每拍重触发,
    // 真机节拍=音长 2.3/3.0s——本记录仪只锁调用形制,不锁节拍周期）
    startTrackedOneShot: (files: string[], vol: number, x: number, y: number) => {
      oneShots.push({ t: tickN, files, vol, x, y });
      return { done: true, stop() {}, setPos() {} };
    },
    entities: em,
  } as unknown as GameHooks;
  return { hooks, enemies, projectiles, sfx, oneShots, em, player, get tick() { return tickN; } };
}

type Harness = ReturnType<typeof makeHooks>;

function spawn(h: Harness, id: number, tx: number, ty: number): Enemy {
  const e = Enemy.fromVanilla(id, tx * TILE, ty * TILE)!;
  // 落地摆放:fromVanilla 是中心锚,高怪(食人魔 124px)中心在地面行会半埋 →
  // LOS 断链触发 AI_107 flag2 穿墙相位。统一底边贴 FLOOR(等价 dd2Host 的
  // NewNPC Bottom 锚换算)。
  e.y = FLOOR * TILE - e.h;
  e.id = h.em.nextId++;
  h.enemies.push(e);
  return e;
}

/** 逐 tick 驱动（默认全部存活敌人） */
function tick(h: Harness, n: number, only?: Enemy[]): void {
  for (let i = 0; i < n; i++) {
    (h as unknown as { tickN: number }).tickN++;
    for (const e of only ?? h.enemies) {
      if (!e.dead) e.fixedUpdate(1 / 60, h.hooks);
    }
  }
}

const sfxPlayed = (h: Harness, name: string): boolean =>
  h.sfx.some((s) => s.files.some((f) => f.startsWith(name)));

// ---------------------------------------------------------------------------
// 出生链：事件进行 → 门 549 按 LaneSpawnRate 节拍从门位置刷出
// ---------------------------------------------------------------------------
describe('DD2 出生链（SpawnMonsterFromGate :556 / AI_106 节拍 :43090-43108）', () => {
  const saved = { ...DD2_EVENT_HOOKS };
  afterEach(() => {
    Object.assign(DD2_EVENT_HOOKS, saved);
  });

  function makeHost(spawns: Array<{ id: number; x: number; y: number }>, randSeq: number[] = []):
    OldOnesArmyHost {
    let ri = 0;
    return {
      broadcast: () => {},
      spawnNpc: (id, x, y) => { spawns.push({ id, x, y }); },
      countNpcs: (id) => spawns.filter((s) => s.id === id).length,
      anyNpc: (id) => id === 548,
      crystalPoints: () => [],
      dropAtCrystal: () => {},
      arenaEnds: () => ({ left: { x: 0, y: 0 }, right: { x: 500, y: 0 } }),
      findGroundY: () => FLOOR,
      rand: (n) => {
        const v = ri < randSeq.length ? randSeq[ri++] : 0;
        return v % n;
      },
      activePlayersCount: () => 1,
    };
  }

  it('事件进行中：300t hold 抽干后,门按 LaneSpawnRate 节拍在门位置刷出 T1 波 1 怪 552', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 110, y: 118 });
    const st = newOldOnesArmyState();
    startInvasion(st, w);
    expect(st.ongoing).toBe(true);
    expect(st.waveNumber).toBe(1);
    expect(st.timeLeftUntilSpawningBegins).toBe(300);
    const spawns: Array<{ id: number; x: number; y: number }> = [];
    const host = makeHost(spawns);
    // Game.wireDD2Hooks 同款接线（Game.ts:8221-8248）
    DD2_EVENT_HOOKS.laneSpawnRate = () => st.laneSpawnRate;
    DD2_EVENT_HOOKS.enemySpawningOnHold = () => st.timeLeftUntilSpawningBegins !== 0;
    DD2_EVENT_HOOKS.spawnMonsterFromGate = (_g, x, y, left) => {
      if (st.ongoing) spawnMonsterFromGate(st, host, x, y, left);
    };
    // 水晶 548 在场（门驻守条件）+ 门 549（左门）
    spawn(h, 548, 110, 117);
    const portal = spawn(h, 549, 60, 118);
    portal.ai2 = 0;                       // 左门
    const gateX = portal.cx, gateBottom = portal.y + portal.h;
    for (let i = 0; i < 700; i++) {
      updateTime(st, host, null);
      tick(h, 1, [portal]);
    }
    // hold 抽干 → 波 1 公告 → laneSpawnRate 覆写 90（D1_RATE[1]）
    expect(st.timeLeftUntilSpawningBegins).toBe(0);
    expect(st.laneSpawnRate).toBe(90);
    expect(spawns.length).toBeGreaterThan(0);
    // 出生点 = 门 Bottom（SpawnMonsterFromGate(base.Bottom, leftGate),:43103）
    expect(spawns[0].x).toBe(gateX);
    expect(spawns[0].y).toBe(gateBottom);
    // T1 波 1 表只出 552（Difficulty_1 :1036-1038）
    expect(spawns.every((s) => s.id === 552)).toBe(true);
    // 节拍：700t - 300t hold = 400t 出怪窗,90t 一拍 → ≥4 拍
    expect(spawns.length).toBeGreaterThanOrEqual(4);
  });

  it('波间 hold 非零 → 门不出怪（EnemySpawningIsOnHold 门禁,:43090-43093）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 110, y: 118 });
    const st = newOldOnesArmyState();
    startInvasion(st, w);
    const spawns: Array<{ id: number; x: number; y: number }> = [];
    const host = makeHost(spawns);
    DD2_EVENT_HOOKS.laneSpawnRate = () => st.laneSpawnRate;
    DD2_EVENT_HOOKS.enemySpawningOnHold = () => st.timeLeftUntilSpawningBegins !== 0;
    DD2_EVENT_HOOKS.spawnMonsterFromGate = (_g, x, y, left) => {
      if (st.ongoing) spawnMonsterFromGate(st, host, x, y, left);
    };
    spawn(h, 548, 110, 117);
    const portal = spawn(h, 549, 60, 118);
    for (let i = 0; i < 100; i++) {       // 还在 300t hold 内
      updateTime(st, host, null);
      tick(h, 1, [portal]);
    }
    expect(spawns.length).toBe(0);        // hold 期 ai[0] 不推进 → 不出怪
  });

  it('波表抽查：D1 波 2 掷骰出 555;D3 波 1 掷骰链（:1281+/:1592-1605 同构）', () => {
    const w = makeWorld();
    const st = newOldOnesArmyState();
    startInvasion(st, w);
    expect(enemiesForWave(st, 1)).toEqual([552]);
    expect(enemiesForWave(st, 2)).toEqual([552, 555]);
    // D1 波 2:rand(7)!=0 → 552;rand(7)==0 → 555（:1047-1049 的 553+ 档为 T2,
    // T1 是 :1036-1038 单出 552）——此处直接验 D2 波 1 掷骰链（:1281-1289）
    st.ongoingDifficulty = 2;
    st.waveNumber = 1;
    const spawns: Array<{ id: number; x: number; y: number }> = [];
    const host20 = makeHost(spawns, [0]);       // rand(20)==0 → 562
    spawnMonsterFromGate(st, host20, 100, 100, true);
    expect(spawns.map((s) => s.id)).toEqual([562]);
    // D2 波 1:rand(20)!=0 → 553
    const spawns2: Array<{ id: number; x: number; y: number }> = [];
    spawnMonsterFromGate(st, makeHost(spawns2, [5]), 100, 100, true);
    expect(spawns2.map((s) => s.id)).toEqual([553]);
    // D3 波 1:rand(18)==0 → 563;else 554（+rand(7)==0 时附 557 双出,:1600-1603）
    st.ongoingDifficulty = 3;
    st.waveNumber = 1;
    const spawns3: Array<{ id: number; x: number; y: number }> = [];
    spawnMonsterFromGate(st, makeHost(spawns3, [0]), 100, 100, true);
    expect(spawns3.map((s) => s.id)).toEqual([563]);
    const spawns4: Array<{ id: number; x: number; y: number }> = [];
    spawnMonsterFromGate(st, makeHost(spawns4, [17, 0]), 100, 100, true);
    expect(spawns4.map((s) => s.id)).toEqual([557, 554]);
  });
});

// ---------------------------------------------------------------------------
// AI_107 攻击状态机（各族出手帧/弹型/音效）
// ---------------------------------------------------------------------------
describe('AI_107 walker 攻击状态机（NPC.cs:63372-64919）', () => {
  it('哥布林投弹手 555:280px 内起手 42t,出手帧 ai[1]==18 投 681 炸弹 + 投掷音（:64036-64039）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 114, y: 118 });
    const e = spawn(h, 555, 100, 118);
    let bombTick = -1;
    for (let i = 0; i < 240 && bombTick < 0; i++) {
      tick(h, 1, [e]);
      if (h.projectiles.some((p) => p instanceof DD2GoblinBomb)) bombTick = i;
    }
    expect(bombTick).toBeGreaterThanOrEqual(0);
    expect(e.ai1).toBe(18);                       // 出手帧（减数后 == num9）
    const bomb = h.projectiles.find((p) => p instanceof DD2GoblinBomb) as DD2GoblinBomb;
    expect(bomb.damage).toBe(20);                 // GetAttackDamage_ForProjectiles(20,15) Classic
    // 投掷音在出手帧的后一拍（case 读减数前 ai[1]==num9,:64036-64039）
    tick(h, 2, [e]);
    expect(sfxPlayed(h, 'dd2_goblin_bomber_throw')).toBe(true);
    expect(sfxPlayed(h, 'dd2_etherian_portal_spawn_enemy')).toBe(true);  // 出生 30t 音
    // 循环:收招后再次起手（ai[1] 回到 42）
    tick(h, 60, [e]);
    expect(e.ai1).toBeGreaterThan(0);
  });

  it('埃特尼亚标枪手 561:出手帧 ai[1]==82 掷 662 标枪 + 攻击音/嘲讽（:63942-63947）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 124, y: 118 });
    const e = spawn(h, 561, 100, 118);            // ~384px < 起手距 500
    let shotTick = -1;
    for (let i = 0; i < 300 && shotTick < 0; i++) {
      tick(h, 1, [e]);
      if (h.projectiles.length > 0) shotTick = i;
    }
    expect(shotTick).toBeGreaterThanOrEqual(0);
    expect(e.ai1).toBe(82);
    const arrow = h.projectiles[0] as unknown as { projId: number; damage: number; grav: number };
    expect(arrow.projId).toBe(662);
    expect(arrow.damage).toBe(15);                // (15,10) Classic
    expect(arrow.grav).toBe(0.3);                 // aiStyle 1 抛物线（SetDefaults :6843）
    tick(h, 2, [e]);                              // 攻击音在出手帧后一拍（:63942-63947）
    expect(sfxPlayed(h, 'dd2_javelin_throwers_attack')).toBe(true);
  });

  it('德拉肯 571:一轮 60t 循环 6 连拍（40/35/29/23/17/11,重映射 :63637-63640）+ 呼吸气/射击音', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 110, y: 118 });
    const e = spawn(h, 571, 100, 118);            // ★X2 重锚:~160px≤200 索敌门（NPCUtils.TargetClosestOldOnesInvasion :268 OnlyPlayersInCertainDistance=200f;旧 480px 布景=BJ356 前"全图咬玩家"误读,目标恒空）
    tick(h, 200, [e]);
    const shots = h.projectiles.length;
    expect(shots).toBeGreaterThanOrEqual(6);      // 一轮 6 发（671）
    expect(h.projectiles.every((p) =>
      (p as unknown as { projId: number }).projId === 671)).toBe(true);
    expect(sfxPlayed(h, 'dd2_drakin_breath_in')).toBe(true);
    expect(sfxPlayed(h, 'dd2_drakin_shot')).toBe(true);
  });

  it('哥布林剑士 552:40px 内近战前摇 30t 循环,无弹幕（flag5 纯接触,:63607-63628）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 103, y: 118 });
    const e = spawn(h, 552, 100, 118);            // ~48px → 走近后 <40
    let maxWindup = 0;
    let cycles = 0;
    let prev = 0;
    for (let i = 0; i < 200; i++) {
      tick(h, 1, [e]);
      if (e.ai0 > maxWindup) maxWindup = e.ai0;
      if (prev <= 0 && e.ai0 === 29) cycles++;    // 起手帧 = num5(30) 同拍减 1（:64365+64379）
      prev = e.ai0;
    }
    expect(maxWindup).toBe(29);                   // 起手 30 后同拍递减（原版同序）
    expect(cycles).toBeGreaterThanOrEqual(2);     // 循环前摇
    expect(h.projectiles.length).toBe(0);
    // dd2_goblin_scream 1/1000/tick 的概率断言不设否定（200t 窗内 ~18% 必然偶发）——
    // 改测确定性面：scream 参数在表（walker107Params 已断言）且本测试全程未注册非 scream 音
    expect(h.sfx.every((c) => !c.files.some((f) => f.startsWith('dd2_ogre')
      || f.startsWith('dd2_betsy') || f.startsWith('dd2_kobold')))).toBe(true);
  });

  it('小妖精 572:700px 点火 → 64px 起爆（192² 盒、伤 80、爆音,不走掉落管线）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 120, y: 118 });
    const e = spawn(h, 572, 100, 118);            // 320px < 700
    tick(h, 600, [e]);
    expect(sfxPlayed(h, 'dd2_kobold_ignite')).toBe(true);
    expect(sfxPlayed(h, 'dd2_kobold_explosion')).toBe(true);
    expect(e.dead).toBe(true);
    expect(e.w).toBe(192);
    expect(e.def.damage).toBe(80);
    expect(h.projectiles.length).toBe(0);         // 自爆非弹幕
  });

  it('食人魔 577 远距(>430px)选招吐息:ai[1]=1,前摇倒数 ai[0]==35 涎 676 + 吐息音（:63587-63600）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 150, y: 118 });
    const e = spawn(h, 577, 100, 118);
    // ★X2 重锚（2026-10-01）:BJ356 勘误后玩家 >200px 不再恒成目标——远距吐息臂的
    //  合法目标=以太水晶 548（TargetClosestOldOnesInvasion :268=200px 内玩家 ∪ 水晶,
    //  水晶无距离限）。800px 水晶:dist>430 → ai[1]=1 吐息（:63538-63540 num35>num4+30）
    spawn(h, 548, 150, 118);                      // 水晶=远距靶（800px）
    let sawSpit = false;
    for (let i = 0; i < 300 && !sawSpit; i++) {
      tick(h, 1, [e]);
      if (h.projectiles.some((p) =>
        (p as unknown as { projId: number }).projId === 676)) sawSpit = true;
    }
    expect(sawSpit).toBe(true);
    const spit = h.projectiles.find((p) =>
      (p as unknown as { projId: number }).projId === 676)!;
    expect((spit as unknown as { damage: number }).damage).toBe(40);   // (40,30) Classic
    expect(sfxPlayed(h, 'dd2_ogre_spit')).toBe(true);
    // 注:DD2_OgreRoar 是 1/700 每拍随机嘶叫（:63516 num22=700）,不作确定性断言
  });

  it('食人魔 577 贴身:先跺地(≤430px 冷却完),冷却窗内转近挥 ai[1]=0 + 挥击音（:63528-63600）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 106, y: 118 });
    const e = spawn(h, 577, 100, 118);            // ~96px ≤ 430 → 冷却完先跺地
    let sawPound = false, sawMelee = false;
    for (let i = 0; i < 500 && !(sawPound && sawMelee); i++) {
      tick(h, 1, [e]);
      if (e.ai1 === 2) sawPound = true;
      // 跺地后 localAI[0]=300 冷却（:63556-63559）:窗内贴身 → ai[1]=0 近挥
      if (sawPound && e.ai1 === 0) sawMelee = true;
    }
    expect(sawPound).toBe(true);
    expect(sawMelee).toBe(true);
    expect(sfxPlayed(h, 'dd2_ogre_attack')).toBe(true);                // 近挥 ai[0]==40（:63566）
    expect(sfxPlayed(h, 'dd2_ogre_ground_pound')).toBe(true);
  });

  it('食人魔 577 中距(≤430px 且跺地冷却完)选招跺地:ai[1]=2,ai[0]==36 放 683 波 + 跺地音/起跳（:63569-63586）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 118, y: 118 });
    const e = spawn(h, 577, 100, 118);            // ~288px ≤ 430 → 跺地
    let jumped = false, sawPound = false, smashed = false;
    for (let i = 0; i < 400; i++) {
      tick(h, 1, [e]);
      if (e.ai1 === 2) sawPound = true;
      if (e.vy < 0) jumped = true;
      if (h.projectiles.some((p) => p instanceof DD2OgreSmash)) { smashed = true; break; }
    }
    expect(sawPound).toBe(true);
    expect(smashed).toBe(true);
    expect(sfxPlayed(h, 'dd2_ogre_ground_pound')).toBe(true);
    expect(jumped).toBe(true);                    // flag4:ai[0]==56 → vy=-13
  });

  it('枯萎兽 569:600px 内进入灵气态（ai[0] 1↔2 驻留）,60t 自疗 lifeMax/20 + 脉冲音（:64050-64138;BJ728-A 债1 一次性跟踪轨 :64084-64094）', () => {
    const w = makeWorld();
    const h = makeHooks(w, { x: 118, y: 118 });
    const e = spawn(h, 569, 100, 118);            // 288px < 600
    e.hp = Math.floor(e.maxHp / 2);
    const hpBefore = e.hp;
    tick(h, 240, [e]);
    expect(e.hp).toBeGreaterThan(hpBefore);       // 自疗生效
    const pulse = h.oneShots.filter((s) => s.files.some((f) => f.startsWith('dd2_wither_beast_aura_pulse')));
    expect(pulse.length, '灵气脉冲起振（startTrackedOneShot,旧 playSfxFiles 0.5 单闩形制随 BJ728-A 退役）').toBeGreaterThan(0);
    expect(pulse.every((s) => s.vol === 1), '音量=CreateTrackable 缺省 1').toBe(true);
    expect(pulse.length, '重触发链（done 门;记录仪 done=true 每拍,真机=音长 2.3/3.0s 节拍）').toBeGreaterThan(1);
    expect(h.projectiles.length).toBe(0);
  });
});
