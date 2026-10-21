// ★BJ704-G3（2026-10-21）登记债清算·龟族/敌怪域第二批（BJ703-C 新登记 D7-D11 五件）
// 判别锁。逐件定谳（Terarria1457 亲读,本批源拷 /tmp/bj704g3-src 佐证）：
//  · D7 614 爆炸兔不在 TownCritter 集（NPCID.cs:4827）——走/站计时器三闸
//    （startWalk +Next(200,400) 门 :54289/:54308;走→站 −Next(100) vs +Next(900)
//    :54382-54389）+ 夜间即停支（站定臂 :54202-54244 / 行走臂 :54352-54358）此前
//    套 TownCritter 形 → 修：TOWN_CRITTER_IDS 单源集判据（data/critters.ts 抽表,
//    TownNPC 侧 VANILLA_TOWN_CRITTER_SHEETS 同源别名）。avoidFalling 面
//    （GetWalkPrediction :56241,TownCritter 恒 false :56268/614 真值）敌怪侧未
//    移植=新登记债 BJ704-G3 D12——★已随 BJ704-G6 落地（npcWalkPrediction.ts
//    共享叶子三消费位接通,判别锁 tests/bj704g6-enemy-debts2.test.ts）。
//  · D8 玩家载具态 walkDownSlopeOff 保守关 → 判语销案+边界声明：原版豁免面=
//    mount48 DarkMageBook（Player.cs:23607）+shimmering（:28256）两支,矿车/贴轨/
//    flag28 飞行坐骑照跑 SlopeDownMovement;SW 骑矿车臂结构性死位（Player
//    fixedUpdate :6166 ridingCart 早退先于 :8152 walkDownSlopeOff 写位——本批
//    锁死该序）,贴轨/flag28 放开须同步换 vy==gravity 字面门（stepDownGate 'never'
//    →wasGround 回退门≠原版 Collision.cs:1695）+坐骑 vy 链审计=负收益窄域,保守
//    关维持（可观测窗=轨/悬坐骑恰以 vy==gravity 掠地面坡=超窄）。
//  · D9 TownNPC 侧 :91588 小 vx 清零 → 修：三臂（微光上升 :2378/被缚 :2420/主
//    物理段 :2954）重力后、moveAndCollide 前各补一行（原版 UpdateNPC 全局段
//    无条件;行为面=防御纵深——TownNPC 各 AI 现行路径自清,残尾不可达,原版同为
//    冗余双清结构）。
//  · D10 释放后 90t friendly 免疫窗 → 修（★极性勘误：BJ703-C 登记时读反）——
//    原版 90t 窗属【自然出生】npcCatchable 型（SetDefaults :17883-17887 计数 90+
//    friendly=true;SubAI :91649-91670 releaseOwner!=255‖SpawnedFromStatue → 计数
//    清零——释放/雕像出生首拍即 false=可打;自然出生首 90t 玩家打不中+互殴通道开
//    +AI_007 逃逸档生效）。修=NPC_CATCHABLE 集（Main.cs:9469+,≠catchItem 表）+
//    Enemy.catchImmunityT/catchFriendly 承载+fixedUpdate 尾 SubAI 拍+三消费面
//    （playerCanHitEnemy/逃逸档/互殴通道）。
//  · D11 critter 干侧重力平 0.3 → 判语销案+边界声明：原版高空衰减带
//    （:92046-92053 num=(w/4200)²、num2=(y/16−(60+10num))/(worldSurface/6) 钳
//    [0.25,1] → ×0.3）真世界只在空域（≈行 70-190 以上）生效,地表 num2=1 恒等;
//    敌怪全域通用档 applyGravity 已含该带,唯 townCritterWalkAI 干侧平 0.3——
//    唯一入带通道=小动物滞留空岛/太空（释放于空岛）;修复须动 critter 夹具地板
//    行 60（恰在带内 60+10n 起点,World(80,140,42) 夹具 num≈0 → 0.075 伪影,
//    BJ703-C D2 判例）=负收益夹具翻搅,平 0.3 维持。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { playerCanHitEnemy } from '../src/entities/projTargets';
import { TOWN_CRITTER_IDS, NPC_CATCHABLE } from '../src/data/critters';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(__dirname, '..');
const NPC_1457 = join(ROOT, '../Terarria1457/Terraria/NPC.cs');
const NPCID_1457 = join(ROOT, '../Terarria1457/Terraria.ID/NPCID.cs');
const MAIN_1457 = join(ROOT, '../Terarria1457/Terraria/Main.cs');
const PLAYER_1457 = join(ROOT, '../Terarria1457/Terraria/Player.cs');
const EXT_MISSING = !existsSync(NPC_1457) || !existsSync(MAIN_1457);
// ★反编译源卷偶发闪断（本批实录:existsSync 过而 open 断/空读）——try 读失败按缺源
// 跳过对应锚（bj703c EXT_MISSING 先例）;源拷 /tmp/bj704g3-src 留有本批佐证副本
function readSrc(p: string): string {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}
const npc1457 = EXT_MISSING ? '' : readSrc(NPC_1457);
const npcId1457 = EXT_MISSING ? '' : readSrc(NPCID_1457);
const main1457 = EXT_MISSING ? '' : readSrc(MAIN_1457);
const player1457 = readSrc(PLAYER_1457);
const enemySrc = readFileSync(join(ROOT, 'src/entities/Enemy.ts'), 'utf8');
const townSrc = readFileSync(join(ROOT, 'src/entities/TownNPC.ts'), 'utf8');
const playerSrc = readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8');
const projTargetsSrc = readFileSync(join(ROOT, 'src/entities/projTargets.ts'), 'utf8');

const TILE = 16;

// ---------------------------------------------------------------------------
// 夹具（bj703c 同款 80×140 世界,地板行 60;默认 0.3 白天,夜测切 timeOfDay）
// ---------------------------------------------------------------------------
function critterWorld() {
  const w = new World(80, 140, 42, 'open');
  w.groundLevel = 42;
  const st = w.store;
  for (let x = 10; x <= 70; x++) st.setTileSilent(x, 60, 2);      // 地板 y=60
  const hooks = {
    world: w,
    // ★活玩家近桩：hurt 链读 player.luck 需对象;且死/远玩家会让 CheckActive 在
    // settle 期 despawn 小动物（late 半空转绿=夹具幻影,本批实录）——活+近=全程
    // 存活;projScanEq 读 stub.equipStats=undefined 零扰动
    player: { x: 40 * TILE, y: 55 * TILE, cx: 40 * TILE + 10, cy: 55 * TILE + 20, w: 20, h: 42, dead: false, luck: 0 },
    playSfx: () => {}, playSfxFiles: () => {}, addDamageNumber: () => {}, spawnParticles: () => {},
    onEnemyKilled: () => {},
    spawnDrop: () => null, damagePlayer: (): number => 0,
    entities: { add: () => {} },
    enemies: () => [] as unknown[],
  } as never;
  return { w, hooks };
}

function fakeEnemy(x: number, y: number): unknown {
  return {
    dead: false, x, y, w: 20, h: 20, cx: x + 10, cy: y + 10,
    vanillaId: 3, vanilla: { aiStyle: 3, noGravity: false },
    def: { damage: 5, friendly: false },
    noTileCollide: false,
  };
}

function withEnemies(hooks: never, src: unknown): never {
  return { ...(hooks as Record<string, unknown>), enemies: () => (Array.isArray(src) ? src : [src]) } as never;
}

function spawnWalker(vid: number, hooks: never, x = 40): Enemy {
  const e = Enemy.fromVanilla(vid, x * TILE, 58 * TILE)!;
  for (let t = 0; t < 40; t++) e.fixedUpdate(1 / 60, hooks);
  return e;
}

// ---------------------------------------------------------------------------
// A. 原版活体锚（1457 直读,漂移即爆红）
// ---------------------------------------------------------------------------
describe.skipIf(EXT_MISSING)('BJ704-G3 原版锚（D7/D8/D10/D11）', () => {
  it('D7:TownCritter 集（NPCID.cs:4827）含 616/617/46、不含 614', () => {
    const i = npcId1457.indexOf('public static bool[] TownCritter = Factory.CreateBoolSet(');
    expect(i).toBeGreaterThanOrEqual(0);
    const line = npcId1457.slice(i, npcId1457.indexOf(';', i));
    for (const id of [46, 616, 617, 625, 687]) {
      expect(line).toMatch(new RegExp(`\\b${id}\\b`));
    }
    expect(line).not.toMatch(/\b614\b/);
  });
  it('D7:+Next(200,400) 三拍门（溺逃 :54289/计时 :54308/卡墙折返 :54797——★末者已随 BJ704-G6 D13 移植落地）', () => {
    const head = npc1457.indexOf('private void AI_007_TownEntities()');
    const tail = npc1457.indexOf('private void AI_007_TownEntities_Shimmer_TeleportToLandingSpot()');
    const seg = npc1457.slice(head, tail > head ? tail : head + 200000);
    const gate = /if \(NPCID\.Sets\.TownCritter\[type\]\)\s*\{\s*ai\[1\] \+= Main\.rand\.Next\(200, 400\);/g;
    expect(seg.match(gate)?.length ?? 0).toBe(3);
  });
  it('D7:夜间即停支双臂（站定 :54202 / 行走 :54352——!TownCritter 门）', () => {
    const head = npc1457.indexOf('private void AI_007_TownEntities()');
    const seg = npc1457.slice(head, head + 90000);
    expect(seg).toMatch(/else if \(flag && !flag5 && !NPCID\.Sets\.TownCritter\[type\]\)/);
    expect(seg).toMatch(/flag\) && AI_007_TownEntities_IsInAGoodRestingSpot\(num6, num7, floorX, floorY\) && !NPCID\.Sets\.TownCritter\[type\]\)/);
  });
  it('D7:走→站 TownCritter −Next(100) vs +Next(900)（:54382-54389）', () => {
    const head = npc1457.indexOf('private void AI_007_TownEntities()');
    const seg = npc1457.slice(head, head + 90000);
    expect(seg).toMatch(/if \(NPCID\.Sets\.TownCritter\[type\]\)\s*\{\s*ai\[1\] -= Main\.rand\.Next\(100\);\s*\}\s*else\s*\{\s*ai\[1\] \+= Main\.rand\.Next\(900\);/);
  });
  it.skipIf(!player1457.includes('SlopeDownMovement'))('D8:玩家 SlopeDownMovement 仅 mount48 豁免（:23607）+ :28256 !shimmering 门', () => {
    const i = player1457.indexOf('public void SlopeDownMovement()');
    const body = player1457.slice(i, i + 500);
    expect(body).toMatch(/if \(!mount\.Active \|\| mount\.Type != 48\)/);
    expect(body).toMatch(/Collision\.WalkDownSlope\(position, velocity, width, height, gravity \* gravDir\)/);
    expect(player1457).toMatch(/if \(!shimmering\)\s*\{\s*SlopeDownMovement\(\);/);
  });
  it('D10:SetDefaults 尾 catchable 计数 90+friendly=true（:17883-17887）', () => {
    expect(npc1457).toMatch(/Main\.npcCatchable\[type\]\)\s*\{\s*catchableNPCTempImmunityCounter = 90;\s*friendly = true;/);
  });
  it('D10:SubAI 释放/雕像清零 + 窗内 true（:91649-91670）——释放属无窗面', () => {
    const i = npc1457.indexOf('private void SubAI_HandleTemporaryCatchableNPCPlayerInvulnerability()');
    const body = npc1457.slice(i, i + 700);
    expect(body).toMatch(/if \(releaseOwner != 255 \|\| SpawnedFromStatue\)\s*\{\s*catchableNPCTempImmunityCounter = 0;/);
    expect(body).toMatch(/if \(catchableNPCTempImmunityCounter > 0\)\s*\{\s*catchableNPCTempImmunityCounter--;\s*friendly = true;/);
  });
  it('D10:UpdateNPC 序 = AI() → SubAI（AI 吃上拍投影值）', () => {
    expect(npc1457).toMatch(/AI\(\);\s*SubAI_HandleTemporaryCatchableNPCPlayerInvulnerability\(\);/);
  });
  it('D10:ReleaseNPC 614 置 releaseOwner（释放出生=计数清零面）', () => {
    const i = npc1457.indexOf('public static int ReleaseNPC(int x, int y, int Type, int Style, int who)');
    const body = npc1457.slice(i, i + 1400);
    expect(body).toMatch(/case 614:/);
    expect(body).toMatch(/Main\.npc\[num\]\.releaseOwner = \(short\)who;/);
  });
  it('D10:Main.npcCatchable 含 614/46/616,不含 230/303/337/375/540/687（≠catchItem 表）', () => {
    const i = main1457.indexOf('npcCatchable[46] = true;');
    expect(i).toBeGreaterThanOrEqual(0);
    const seg = main1457.slice(i - 200, i + 4200);
    for (const id of [46, 55, 614, 616, 377, 688]) {   // 442-448 走循环臂,无显式行
      expect(seg).toMatch(new RegExp(`npcCatchable\\[${id}\\] = true;`));
    }
    for (const id of [230, 303, 337, 375, 540, 687]) {
      expect(seg).not.toMatch(new RegExp(`npcCatchable\\[${id}\\] = true;`));
    }
    // 442-448 循环臂
    expect(seg).toMatch(/for \(int n = 442; n <= 448; n\+\+\)[\s\S]{0,30}npcCatchable\[n\] = true;/);
  });
  it('D11:高空衰减带（:92046-92053 num2 钳 [0.25,1] → gravity×num2）', () => {
    const i = npc1457.indexOf('private void UpdateNPC_UpdateGravity');
    const body = npc1457.slice(i, i + 2600);
    expect(body).toMatch(/float num2 = \(float\)\(\(double\)\(position\.Y \/ 16f - \(60f \+ 10f \* num\)\) \/ \(Main\.worldSurface \/ 6\.0\)\)/);
    expect(body).toMatch(/if \(\(double\)num2 < 0\.25\)\s*\{\s*num2 = 0\.25f;/);
    expect(body).toMatch(/gravity \*= num2;/);
  });
});

// ---------------------------------------------------------------------------
// B. 集金标（数据表 = 1457 提取逐值对账,漂移即爆红）
// ---------------------------------------------------------------------------
describe.skipIf(EXT_MISSING)('BJ704-G3 集金标（TOWN_CRITTER_IDS/NPC_CATCHABLE）', () => {
  it('TOWN_CRITTER_IDS = NPCID.cs:4827 行全量（49 型,含 616/617 不含 614）', () => {
    const i = npcId1457.indexOf('public static bool[] TownCritter = Factory.CreateBoolSet(');
    const line = npcId1457.slice(i, npcId1457.indexOf(';', i));
    const ids = new Set<number>(
      (line.match(/\d+/g) ?? []).map(Number).filter((n) => n > 0));
    expect(ids.size).toBe(49);
    expect([...ids].sort((a, b) => a - b)).toEqual([...TOWN_CRITTER_IDS].sort((a, b) => a - b));
  });
  it('NPC_CATCHABLE = Main.cs:9469+ 全量（85 显式+442-448 循环=92 型）', () => {
    const i = main1457.indexOf('npcCatchable[46] = true;');
    const seg = main1457.slice(i - 200, i + 3200);
    const ids = new Set<number>(
      (seg.match(/npcCatchable\[(\d+)\] = true;/g) ?? [])
        .map((m) => Number(m.match(/\d+/)![0])));
    for (let n = 442; n <= 448; n++) ids.add(n);
    expect(ids.size).toBe(92);
    expect(NPC_CATCHABLE.size).toBe(92);
    expect([...ids].sort((a, b) => a - b)).toEqual([...NPC_CATCHABLE].sort((a, b) => a - b));
  });
});

// ---------------------------------------------------------------------------
// C. D7:614 非 TownCritter 三闸 + 夜间即停（行为面）
// ---------------------------------------------------------------------------
describe('BJ704-G3 D7:614 计时器三闸 + 夜间即停支', () => {
  it('★走→站:614=300+Next(300)+Next(900)（12 采 max≥600）,617=−Next(100)（全 201-599）', () => {
    const { hooks } = critterWorld();
    for (const [vid, lo, hi, needMax] of [[614, 300, 1498, 600], [617, 201, 599, 0]] as const) {
      const e = spawnWalker(vid, hooks);
      const draws: number[] = [];
      for (let k = 0; k < 12; k++) {
        e.ai0 = 1; e.ai1 = 0; e.ai2 = 0; e.lai3 = -1;
        e.fixedUpdate(1 / 60, hooks);
        expect(e.ai0).toBe(0);                       // 走→站已触发
        draws.push(e.ai1);
      }
      for (const d of draws) {
        expect(d).toBeGreaterThanOrEqual(lo);
        expect(d).toBeLessThanOrEqual(hi);
      }
      if (needMax > 0) {
        // 旧 TownCritter 形（−Next(100),上限 599）12 采全 <600 的概率 ≈0.25^12
        expect(Math.max(...draws)).toBeGreaterThanOrEqual(needMax);
      }
    }
  });
  it('★站→走:614 裸 200+Next(300)≤499,617 +Next(200,400)≥400（确定性界）', () => {
    const { hooks } = critterWorld();
    for (const [vid, lo, hi] of [[614, 200, 499], [617, 400, 898]] as const) {
      const e = spawnWalker(vid, hooks);
      for (let k = 0; k < 6; k++) {
        e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.lai3 = 0;
        e.fixedUpdate(1 / 60, hooks);
        expect(e.ai0).toBe(1);                       // startWalk 已触发
        expect(e.ai1).toBeGreaterThanOrEqual(lo);
        expect(e.ai1).toBeLessThanOrEqual(hi);
      }
    }
  });
  it('★夜间即停·行走臂:614 夜间踩家位即停（ai0→0/200-399/lai3=60）;617 照走', () => {
    const { w, hooks } = critterWorld();
    w.clock.timeOfDay = 0.9;                         // 夜（DUSK=0.8125）
    const e614 = spawnWalker(614, hooks);            // 落稳家位（spawn 列=home,地板行 60）
    e614.ai0 = 1; e614.ai1 = 999999; e614.ai2 = 0; e614.lai3 = -1;
    e614.fixedUpdate(1 / 60, hooks);
    expect(e614.ai0).toBe(0);                        // 夜间到家即停（旧=照走）
    expect(e614.ai1).toBeGreaterThanOrEqual(200);
    expect(e614.ai1).toBeLessThanOrEqual(399);
    expect(e614.lai3).toBe(60);

    const e617 = spawnWalker(617, hooks);
    e617.ai0 = 1; e617.ai1 = 999999; e617.ai2 = 0; e617.lai3 = -1;
    e617.fixedUpdate(1 / 60, hooks);
    expect(e617.ai0).toBe(1);                        // TownCritter 无此臂=夜行照旧
    expect(e617.ai1).toBeLessThan(999999);
  });
  it('★夜间即停·站定臂:614 夜间不在家→朝家走 200-399;在家→挂机不游荡;617 照常起走', () => {
    const { w, hooks } = critterWorld();
    w.clock.timeOfDay = 0.9;
    // 不在家（home 改 30,身位列 40 → 朝家 facing=-1）
    const away = spawnWalker(614, hooks);
    away.critterHomeX = 30;
    away.ai0 = 0; away.ai1 = 0; away.ai2 = 0; away.lai3 = 0;
    away.fixedUpdate(1 / 60, hooks);
    expect(away.ai0).toBe(1);                        // 归家起走
    expect(away.facing).toBe(-1);                    // 家在左
    expect(away.ai1).toBeGreaterThanOrEqual(200);
    expect(away.ai1).toBeLessThanOrEqual(399);
    // 在家（home=身位列）→ 夜间臂取代 startWalk:站计时不再递减触发起走
    const home614 = spawnWalker(614, hooks);
    home614.ai0 = 0; home614.ai1 = 0; home614.ai2 = 0; home614.lai3 = 0;
    home614.fixedUpdate(1 / 60, hooks);
    expect(home614.ai0).toBe(0);                     // 挂机（旧=游荡起走）
    expect(home614.ai1).toBe(0);                     // 站计时不动
    // TownCritter 对照:同夜同位照常起走
    const home617 = spawnWalker(617, hooks);
    home617.ai0 = 0; home617.ai1 = 0; home617.ai2 = 0; home617.lai3 = 0;
    home617.fixedUpdate(1 / 60, hooks);
    expect(home617.ai0).toBe(1);
  });
  it('结构锁:三闸+夜间即停支集判据（TOWN_CRITTER_IDS 单源）', () => {
    expect(enemySrc).toMatch(/const townCritter = TOWN_CRITTER_IDS\.has\(vid\);/);
    expect(enemySrc).toMatch(
      /\+ \(townCritter \? 200 \+ Math\.floor\(Math\.random\(\) \* 200\) : 0\);/);
    expect(enemySrc).toMatch(
      /\+ \(townCritter \? -Math\.floor\(Math\.random\(\) \* 100\) : Math\.floor\(Math\.random\(\) \* 900\)\);/);
    // 行走臂分支头（夜态取非入条件）+ 专用臂
    expect(enemySrc).toMatch(/else if \(this\.ai0 === 1 && !\(notCalm && !townCritter && restSpot\)\) \{/);
    expect(enemySrc).toMatch(/this\.ai1 = 200 \+ Math\.floor\(Math\.random\(\) \* 200\);\s*this\.ai2 = 0;\s*this\.lai3 = 60;/);
    // 站定臂
    expect(enemySrc).toMatch(/\} else if \(notCalm && !townCritter\) \{/);
    // 集单源:TownNPC 别名同源
    expect(townSrc).toMatch(/export const VANILLA_TOWN_CRITTER_SHEETS: ReadonlySet<number> = TOWN_CRITTER_IDS;/);
  });
});

// ---------------------------------------------------------------------------
// D. D9:TownNPC 三臂小 vx 清零（结构锁——行为面为防御纵深,见头注）
// ---------------------------------------------------------------------------
describe('BJ704-G3 D9:TownNPC :91588 小 vx 清零（三臂）', () => {
  it('结构锁:微光/被缚/主物理段三臂 = 重力后、moveAndCollide 前', () => {
    // 主物理段
    const mainI = townSrc.indexOf('this.vy = Math.min(this.vy + grav, MAX_FALL_SPEED);');
    expect(mainI).toBeGreaterThanOrEqual(0);
    const mainSeg = townSrc.slice(mainI, mainI + 900);
    expect(mainSeg).toMatch(/if \(this\.vx < 0\.005 && this\.vx > -0\.005\) this\.vx = 0;\s*moveAndCollide\(this, world, this\.vx, this\.vy\);/);
    // 被缚臂（ENEMY_GRAVITY 重力行后紧跟）
    const boundI = townSrc.indexOf('this.vy = Math.min(this.vy + ENEMY_GRAVITY, MAX_FALL_SPEED);');
    expect(boundI).toBeGreaterThanOrEqual(0);
    const boundSeg = townSrc.slice(boundI, boundI + 400);
    expect(boundSeg).toMatch(/if \(this\.vx < 0\.005 && this\.vx > -0\.005\) this\.vx = 0;\s*moveAndCollide/);
    // 微光上升臂（仅落速帽,无重力行——清零紧邻 moveAndCollide）
    const shimI = townSrc.indexOf('this.vy = Math.min(this.vy, MAX_FALL_SPEED);');
    expect(shimI).toBeGreaterThanOrEqual(0);
    const shimSeg = townSrc.slice(shimI, shimI + 400);
    expect(shimSeg).toMatch(/if \(this\.vx < 0\.005 && this\.vx > -0\.005\) this\.vx = 0;\s*moveAndCollide/);
    // 三臂计数恰为 3（防第四处漂移/漏删）
    expect(townSrc.match(/if \(this\.vx < 0\.005 && this\.vx > -0\.005\) this\.vx = 0;/g)?.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// E. D10:自然出生 90t 玩家免伤窗（极性勘误后）
// ---------------------------------------------------------------------------
describe('BJ704-G3 D10:90t 玩家免伤窗（自然出生/释放/雕像三态）', () => {
  it('★自然出生:614/46 首 90t playerCanHitEnemy=false,窗尽（~91t）转 true', () => {
    const { hooks } = critterWorld();
    for (const vid of [614, 46]) {
      const e = Enemy.fromVanilla(vid, 40 * TILE, 58 * TILE)!;
      expect(e.catchImmunityT).toBe(90);                    // SetDefaults 尾计数
      expect(e.catchFriendly).toBe(true);
      expect(playerCanHitEnemy(e, hooks)).toBe(false);      // 窗内玩家打不中
      let turned = -1;
      for (let t = 0; t < 110; t++) {
        e.fixedUpdate(1 / 60, hooks);
        if (turned < 0 && playerCanHitEnemy(e, hooks)) turned = t;
      }
      expect(turned).toBeGreaterThanOrEqual(88);            // 窗 ~91t（AI 读上拍值）
      expect(turned).toBeLessThanOrEqual(95);
      expect(e.catchImmunityT).toBe(0);
      expect(e.hp).toBe(e.maxHp);                           // 全程无伤（免伤门守恒自证）
    }
  });
  it('★释放/雕像出生:首拍即清零=可打（无 90t 窗）', () => {
    const { hooks } = critterWorld();
    const rel = Enemy.fromVanilla(614, 40 * TILE, 58 * TILE)!;
    rel.releasedFromItem = true;                            // releaseOwner!=255
    rel.fixedUpdate(1 / 60, hooks);
    expect(rel.catchFriendly).toBe(false);
    expect(playerCanHitEnemy(rel, hooks)).toBe(true);

    const st = Enemy.fromVanilla(46, 40 * TILE, 58 * TILE)!;
    st.spawnedFromStatue = true;                            // SpawnedFromStatue
    st.fixedUpdate(1 / 60, hooks);
    expect(st.catchFriendly).toBe(false);
    expect(playerCanHitEnemy(st, hooks)).toBe(true);
  });
  it('★互殴通道:窗内鼠 300 被僵尸接触伤;窗尽通道关（hp 守恒）', () => {
    const { hooks } = critterWorld();
    // ★判别型=300 鼠:npcCatchable ∧ ¬TakesDamageFromHostilesWithoutBeingFriendly
    //  （NPCID.cs:4783 不含 300——通道开关只随窗位翻转;614 在 T-set=通道恒开,
    //   窗读不可见=夹具喂幻影,勿用）
    // 窗内:重叠僵尸 → 首拍掉血（friendly 通道 :91592）
    const fresh = Enemy.fromVanilla(300, 40 * TILE, 58 * TILE)!;
    const z1 = Enemy.fromVanilla(3, 40 * TILE, 58 * TILE)!; // 真僵尸（instanceof Enemy）
    const h1 = withEnemies(hooks, z1);
    fresh.fixedUpdate(1 / 60, h1);
    expect(fresh.hp).toBeLessThan(fresh.maxHp);             // 接触伤落地
    // 窗尽:重摆重叠僵尸 → 通道关,hp 守恒
    const late = spawnWalker(300, hooks);                   // 40t + 下述 70t > 91t
    for (let t = 0; t < 70; t++) late.fixedUpdate(1 / 60, hooks);
    expect(late.catchFriendly).toBe(false);
    const z2 = Enemy.fromVanilla(3, late.x, late.y)!;
    const hpBefore = late.hp;
    late.fixedUpdate(1 / 60, withEnemies(hooks, z2));
    expect(late.hp).toBe(hpBefore);                          // 互殴通道关（蜂通道不认僵尸）
  });
  it('★逃逸档窗内面:自然出生 46 首 90t+险+残血 → 1.5+残血×0.9 加成（窗外族速 1.0 见 bj703c）', () => {
    const { hooks } = critterWorld();
    const danger = fakeEnemy(46 * TILE, 58 * TILE);
    const h = withEnemies(hooks, danger);
    const e = spawnWalker(46, h, 38);                       // 40t 沉降（窗内余 ~51t）
    e.hp = 1;                                               // 残血 → 帽 1.5+0.9×0.8≈2.22
    let peak = 0;
    for (let t = 0; t < 55; t++) { e.fixedUpdate(1 / 60, h); peak = Math.max(peak, Math.abs(e.vx)); }
    expect(peak).toBeGreaterThan(1.6);                      // 窗内逃逸加成在跑
    expect(peak).toBeLessThanOrEqual(2.22 + 1e-9);
  });
  it('结构锁:计数初始化/SubAI 拍/三消费面', () => {
    expect(enemySrc).toMatch(/e\.catchImmunityT = NPC_CATCHABLE\.has\(id\) \? 90 : 0;/);
    expect(enemySrc).toMatch(/this\.catchImmunityT = NPC_CATCHABLE\.has\(id\) \? 90 : 0;/);   // Transform 链
    expect(enemySrc).toMatch(/if \(this\.releasedFromItem \|\| this\.spawnedFromStatue\) this\.catchImmunityT = 0;/);
    expect(enemySrc).toMatch(/this\.catchFriendly = this\.catchImmunityT > 0;/);
    // ★BJ704-R9 P1-2 改判迁移（2026-10-21 二轮审查）：原版 SubAI :91649-70 对全部
    //  npcCatchable 型每拍强写 friendly=(窗>0)（else 显式 false）⇒ 真投影 =
    //  catchable ? 窗 : 静态——旧「静态 ∪ 窗」对静态 true 捕获型（蚯蚓 357/448/
    //  484/485/486/487/606 等）恒免伤=玩家永不可打。锁随刀迁至 friendlyEff 分档形。
    expect(projTargetsSrc).toMatch(/const friendlyEff = vid !== undefined && vid !== null && NPC_CATCHABLE\.has\(vid\)/);
    expect(projTargetsSrc).toMatch(/\? t\?\.catchFriendly === true\s*\n\s*: !!t\?\.def\?\.friendly;/);
    expect(projTargetsSrc).toMatch(/if \(!friendlyEff\) return true;/);
    expect(enemySrc).toMatch(/\|\| this\.catchFriendly \|\| Enemy\.TAKES_DAMAGE_FROM_HOSTILES\.has\(id\)/);
    expect(enemySrc).toMatch(/\|\| this\.catchFriendly\) && \(danger \|\| drowning\)/);
  });
});

// ---------------------------------------------------------------------------
// F. D8/D11:销案判语的守卫锁（保守关维持/平 0.3 维持——重开须重审）
// ---------------------------------------------------------------------------
describe('BJ704-G3 D8/D11:销案守卫（载具态保守关 / 干侧平 0.3）', () => {
  // ★BJ704-G5：复合式补 shimmering 腿（原版 :28255 真豁免员归位——上文边界声明
  //   的原版豁免面两支之一;保守关（矿车/贴轨/flag28）维持不动）
  it('D8:walkDownSlopeOff 载具态保守复合不动（+shimmering 原版豁免腿）+ ridingCart 早退先于写位', () => {
    expect(playerSrc).toMatch(
      /this\.walkDownSlopeOff = this\.onTrack \|\| this\.ridingCart \|\| flag28Fx \|\| flag29Fx \|\| this.shimmering;/);
    // 早退块（ridingCart 整段 return）必须先于 walkDownSlopeOff 写位——若有人重构
    // 移除早退,本锁爆红=强制重审 D8（骑矿车臂将由死转活,保守关不再恒等）
    const earlyReturn = playerSrc.indexOf('if (this.ridingCart) {');
    const writeSite = playerSrc.indexOf('this.walkDownSlopeOff =');
    expect(earlyReturn).toBeGreaterThanOrEqual(0);
    expect(writeSite).toBeGreaterThan(earlyReturn);
    // 早退块内含 return（结构性证据）
    const blk = playerSrc.slice(earlyReturn, earlyReturn + 2000);
    expect(blk).toMatch(/return;/);
  });
  it('D11:townCritterWalkAI 干侧平 0.3 维持（不引高空带）+ 全域 applyGravity 带在位', () => {
    // 干侧平档（销案判语:地表 num2=1 恒等,空岛通道窄域备案）
    expect(enemySrc).toMatch(
      /: Math\.min\(this\.vy \+ ENEMY_GRAVITY, MAX_FALL_SPEED\);/);
    // 全域通用档已含高空带（敌怪大众面不缺）
    expect(enemySrc).toMatch(/let alt = \(this\.y \/ TILE - \(60 \+ 10 \* num\)\) \/ \(surf \/ 6\);/);
    expect(enemySrc).toMatch(/if \(alt < 0\.25\) alt = 0\.25;/);
  });
});
