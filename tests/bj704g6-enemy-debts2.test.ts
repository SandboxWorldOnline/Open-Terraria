// ★BJ704-G6（2026-10-21）登记债清算·敌怪/镇民域第三批（G3 新登记 D12/D13 +
//   BJ704-R3 P2 两件存量）。逐件定谳（Terarria1457 亲读,源拷 /tmp/bj704g3-src 佐证）：
//  · D12 614 avoidFalling 三消费面 → 修：GetWalkPrediction（NPC.cs:56241-56312）
//    抽 npcWalkPrediction.ts 共享叶子（TownNPC 同源,防 Enemy↔TownNPC import 环）
//    后 Enemy 侧接通三站——①遇险起步门 :54136-54170（!avoidFalling 才整段起步+
//    定向,悬崖边 614 原位僵待）;②站立起走门 :54276-54322（悬崖边计时到点不起步,
//    改掉头+站计时 60+Next(120)=60-179）;③行走前视 :54534（keepwalking 同构 +
//    悬崖停走 :54556-77 支撑≤2 → 停走 50-99/lai3=40 + 前视无墙但会坠 :54710-16
//    → 掉头,危险另僵立）。TownCritter :56268 恒 false=41 型零扰动,唯 614 真值。
//  · D13 卡墙折返整机制 → 修（先证可达再落刀）：NPC.cs:54789-54804
//    `oldPosition==position && oldVelocity==velocity+(0,gravity) && !flag16 &&
//    localAI[2]++>=30` → 续走 200+Next(300)（+TownCritter Next(200,400)=三拍
//    第三处）+direction/velocity.X 双翻。可达面实证：1 格墙（前视 t3 实心/t4·t5 空,
//    小个子 2+格墙联检免）+ 顶棚断 StepUp 净空（applyStepUp flag 门 j=2 探柱被拦）
//    → 障碍三档全不触发、碰撞逐拍清 vx → 每拍两条件恒真。快照=moveAndCollide 前
//    （=原版 oldPosition :93748/oldVelocity :93681 语义）;计数粘滞（无衰减清零,
//    仅触发归零）=原版 localAI[2]。
//  · R3-P2⑤ 龟/蛙钉面与重力序 → 修：原版钉面在 AI 内（:55706-50）、重力在 AI 外
//    （:91579-83）→ 仓钉面后置重力（旧重力先行=钳界 ±0.2/tick vy 差:-4 钳支
//    原版 -3.8/旧 -4.0;线锚支原版 +0.2/旧钳值）。BJ688 注内自引锚「级联 :15631」
//    （→:15723→今 :15843 系本文件增行漂移）改按代码身份引用。
//  · R3-P2④ applyGravity 族表缺 aiStyle7&&ai[0]==25→gravity=0（:92036-38）→
//    判语销案+完备性备注：ai[0]=25 唯一 setter=GetShimmered ShimmerTownTransform
//    （:92695-99,城镇 NPC 专属）;Enemy 域 aiStyle7=critter 42 型且 townCritterWalkAI
//    头 ai0 钳 0..8 恒不达;TownNPC 独立类已移植该档（微光上升臂重力=0）。
//    补入 Enemy 表=死码,勿落。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(__dirname, '..');
const NPC_1457 = join(ROOT, '../Terarria1457/Terraria/NPC.cs');
const EXT_MISSING = !existsSync(NPC_1457);
// ★反编译源卷偶发闪断（G3 判例）——try 读失败按缺源跳锚
function readSrc(p: string): string {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}
const npc1457 = EXT_MISSING ? '' : readSrc(NPC_1457);
const enemySrc = readFileSync(join(ROOT, 'src/entities/Enemy.ts'), 'utf8');
const townSrc = readFileSync(join(ROOT, 'src/entities/TownNPC.ts'), 'utf8');
const leafSrc = readFileSync(join(ROOT, 'src/entities/npcWalkPrediction.ts'), 'utf8');

const TILE = 16;
/** 源文本行号（锚序断言用）：index 前的换行数 +1 */
function lineOf(src: string, needle: string): number {
  const i = src.indexOf(needle);
  expect(i).toBeGreaterThanOrEqual(0);
  return src.slice(0, i).split('\n').length;
}

// ---------------------------------------------------------------------------
// 夹具（G3 同款 80×140 世界,地板行 60,默认 0.3 白天）
// ---------------------------------------------------------------------------
function critterWorld() {
  const w = new World(80, 140, 42, 'open');
  w.groundLevel = 42;
  const st = w.store;
  for (let x = 10; x <= 70; x++) st.setTileSilent(x, 60, 2);      // 地板 y=60（末列 70,崖外 71+）
  const hooks = {
    world: w,
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
  } as never;
}

function withEnemies(hooks: never, src: unknown): never {
  return { ...(hooks as object), enemies: () => [src] } as never;
}

function spawnWalker(vid: number, hooks: never, x = 40): Enemy {
  const e = Enemy.fromVanilla(vid, x * TILE, 58 * TILE)!;
  for (let t = 0; t < 40; t++) e.fixedUpdate(1 / 60, hooks);
  return e;
}

/** 落稳后手工布位（避免 settle 期从崖边/墙位走脱——确定性快照法）：
 *  中心 1121px（col 70 中带,盒仍全踩 69/70 实心）→ 前视探针列（中心+15）=1136/16
 *  =col 71（崖外首列）;614 w18/617 w22 盒高均 20,y 对齐地板(960)顶 */
function placeAtEdge(e: Enemy, facing: number): void {
  e.x = 1121 - e.w / 2;
  e.y = 960 - e.h;
  e.facing = facing;
  e.vx = 0; e.vy = 0;
}

// ---------------------------------------------------------------------------
// A. 原版活体锚（1457 直读,漂移即爆红）
// ---------------------------------------------------------------------------
describe.skipIf(EXT_MISSING)('BJ704-G6 原版锚（D12/D13/R3-P2⑤/R3-P2④）', () => {
  it('D12:GetWalkPrediction 本体（:56241）+ TownCritter 恒不避豁免（:56268）', () => {
    expect(npc1457).toContain(
      'private void AI_007_TownEntities_GetWalkPrediction(int myTileX, int homeFloorX, bool canBreathUnderWater, bool currentlyDrowning, int tileX, int tileY, out bool keepwalking, out bool avoidFalling)');
    expect(npc1457).toContain(
      'if (avoidFalling && (NPCID.Sets.TownCritter[type] || (!flag && direction == Math.Sign(homeFloorX - myTileX))))');
  });
  it('D12:三消费面——遇险起步门 :54136/站立起走门 :54280/行走前视 :54534（含悬崖停走 :54556 与避坠掉头 :54710）', () => {
    expect(npc1457).toContain(
      'AI_007_TownEntities_GetWalkPrediction(num6, floorX, flag11, currentlyDrowning, tileX, tileY, out var _, out var avoidFalling);');
    expect(npc1457).toContain('out var _, out var avoidFalling2);');
    expect(npc1457).toContain('out var keepwalking3, out var avoidFalling3);');
    // 站立门 else 支 = 掉头 + 60+Next(120)
    expect(npc1457).toContain('if (flag20 && !avoidFalling2)');
    expect(npc1457).toContain('ai[1] = 60 + Main.rand.Next(120);');
    // 悬崖停走（支撑 ≤2）+ 前视避坠掉头
    expect(npc1457).toContain('if (avoidFalling3 && !flag23)');
    expect(npc1457).toContain('else if (avoidFalling3)');
  });
  it('D13:卡墙折返全条件（:54789-54804）——oldPosition/oldVelocity/重力差/!flag16/后置 ++≥30/双翻', () => {
    expect(npc1457).toContain(
      'if (oldPosition == position && oldVelocity == velocity + new Vector2(0f, gravity) && !flag16 && localAI[2]++ >= 30f)');
    expect(npc1457).toContain('ai[1] += Main.rand.Next(200, 400);');   // 三拍第三处（:54797）
  });
  it('R3-P2⑤:重力在 AI() 外（:91533 AI 调用 < :91579 velocity.Y += gravity）且钉面在 AI_007 内（:55706）', () => {
    const aiIdx = npc1457.indexOf('\t\tAI();');
    expect(aiIdx).toBeGreaterThanOrEqual(0);
    // UpdateNPC 段的重力行（全文多处 velocity.Y += gravity,取 AI() 调用之后的首处）
    const gravIdx = npc1457.indexOf('velocity.Y += gravity;', aiIdx);
    expect(gravIdx).toBeGreaterThan(aiIdx);
    expect(npc1457.slice(gravIdx, gravIdx + 200)).toContain('if (velocity.Y > maxFallSpeed)');
    expect(npc1457).toContain('if (flag12 && wet)');                    // AI_007 尾钉面块
    expect(npc1457).toContain('if (Collision.GetWaterLine(base.Center.ToTileCoordinates(), out var waterLineHeight))');
  });
  it('R3-P2④:aiStyle7&&ai[0]==25 → gravity=0 在 UpdateNPC_UpdateGravity 族表（:92036-38）', () => {
    expect(npc1457).toContain('else if (aiStyle == 7 && ai[0] == 25f)');
    const i = npc1457.indexOf('else if (aiStyle == 7 && ai[0] == 25f)');
    expect(npc1457.slice(i, i + 120)).toContain('gravity = 0f;');
  });
});

// ---------------------------------------------------------------------------
// B. D12 行为面（614 真值 / 617 TownCritter 恒 false 对照）
// ---------------------------------------------------------------------------
describe('BJ704-G6 D12①:遇险起步门（前视岩浆列 614 不冲,原位僵待）', () => {
  it('★岩浆前视 614 遇险：ai0 不转走、facing 不写（旧=无条件起步逃离→同拍避坠掉头）', () => {
    const { hooks } = critterWorld();
    const st = (hooks as unknown as { world: World }).world.store;
    st.liquid[st.idx(40, 59)] = 255;
    st.liquidType[st.idx(40, 59)] = 2;
    const e = spawnWalker(614, hooks);
    e.x = 616; e.y = 960 - e.h;                  // 中心 626=col 39,前视列 40=岩浆
    e.facing = 1; e.vx = 0; e.vy = 0;
    e.ai0 = 0; e.ai1 = 99999; e.ai2 = 0; e.lai3 = -1;
    // 险情在岩浆列外右侧（dx>0,614 互换支 → 起步应 facing=-dangerDir=+1 追向）
    const h = withEnemies(hooks, fakeEnemy(46 * TILE, 55 * TILE));
    e.fixedUpdate(1 / 60, h);
    expect(e.ai0).toBe(0);                       // avoidFalling=true（岩浆恒避）→ 整段不起步
    expect(e.facing).toBe(1);                    // 方向也不写（原版整段包在 if 内）
    expect(e.ai1).toBe(99998);                   // 站计时照常只走 1 步递减
  });
  it('对照:实心地 614 遇险照常起步（facing=+1 追向,ai1=120-239）', () => {
    const { hooks } = critterWorld();
    const e = spawnWalker(614, hooks);
    e.ai0 = 0; e.ai1 = 99999; e.ai2 = 0; e.lai3 = -1; e.facing = 1; e.vx = 0;
    const h = withEnemies(hooks, fakeEnemy(45 * TILE, 58 * TILE));
    e.fixedUpdate(1 / 60, h);
    expect(e.ai0).toBe(1);                       // avoidFalling=false（前视实心）
    expect(e.facing).toBe(1);
    expect(e.ai1).toBeGreaterThanOrEqual(120);
    expect(e.ai1).toBeLessThan(240);
  });
  it('对照:岩浆前视普通兔 46（TownCritter :56268 恒 false）照常起步逃离', () => {
    const { hooks } = critterWorld();
    const st = (hooks as unknown as { world: World }).world.store;
    st.liquid[st.idx(40, 59)] = 255;
    st.liquidType[st.idx(40, 59)] = 2;
    const e = spawnWalker(46, hooks);
    e.x = 616; e.y = 960 - e.h;
    e.facing = 1; e.vx = 0; e.vy = 0;
    e.ai0 = 0; e.ai1 = 99999; e.ai2 = 0; e.lai3 = -1;
    const h = withEnemies(hooks, fakeEnemy(46 * TILE, 55 * TILE));
    e.fixedUpdate(1 / 60, h);
    expect(e.ai0).toBe(1);                       // TownCritter 不受 avoidFalling 门辖
    expect(e.facing).toBe(-1);                   // 非 614 无互换 → 背向险情逃离
  });
});

describe('BJ704-G6 D12②:站立起走门（悬崖边计时到点 → 掉头 60-179）', () => {
  it('★悬崖边 614 站计时尽:不起步,facing 翻背,ai1=60-179（旧=直接 startWalk）', () => {
    const { hooks } = critterWorld();
    const e = spawnWalker(614, hooks);
    placeAtEdge(e, 1);
    e.ai0 = 0; e.ai1 = 0; e.ai2 = 0; e.lai3 = -1;
    e.fixedUpdate(1 / 60, hooks);
    expect(e.ai0).toBe(0);
    expect(e.facing).toBe(-1);                   // 掉头朝崖背侧
    expect(e.ai1).toBeGreaterThanOrEqual(60);
    expect(e.ai1).toBeLessThan(180);
  });
  it('对照:悬崖边 617 站计时尽照常起走;实心地 614 也照常起走（D7 面不回退）', () => {
    const { hooks } = critterWorld();
    const t = spawnWalker(617, hooks);
    placeAtEdge(t, 1);
    t.ai0 = 0; t.ai1 = 0; t.ai2 = 0; t.lai3 = -1;
    t.fixedUpdate(1 / 60, hooks);
    expect(t.ai0).toBe(1);
    const b = spawnWalker(614, hooks);
    b.ai0 = 0; b.ai1 = 0; b.ai2 = 0; b.lai3 = -1; b.facing = 1; b.vx = 0;
    b.fixedUpdate(1 / 60, hooks);
    expect(b.ai0).toBe(1);                       // 实心地 avoidFalling=false
    expect(b.ai1).toBeGreaterThanOrEqual(200);
    expect(b.ai1).toBeLessThanOrEqual(499);
  });
});

describe('BJ704-G6 D12③a:行走悬崖停走（支撑 ≤2 → 停走 50-99/lai3=40）', () => {
  it('★崖缘行走 614:ai0→0/ai1=50-99/lai3=40;617 对照照走', () => {
    const { hooks } = critterWorld();
    const e = spawnWalker(614, hooks);
    placeAtEdge(e, 1);
    e.ai0 = 1; e.ai1 = 99999; e.ai2 = 0; e.lai3 = -1; e.vx = 0.5;
    e.fixedUpdate(1 / 60, hooks);
    expect(e.ai0).toBe(0);                       // 支撑=2（69/70 实,71 崖）≤2 → 停走
    expect(e.ai1).toBeGreaterThanOrEqual(50);
    expect(e.ai1).toBeLessThan(100);
    // lai3=40 写入是瞬态:同拍稍后 `else localAI[3]=-1`（:54599-601,非溺水支）
    // 即覆写——原版同构,末端可观测值 = -1
    expect(e.lai3).toBe(-1);
    const t = spawnWalker(617, hooks);
    placeAtEdge(t, 1);
    t.ai0 = 1; t.ai1 = 99999; t.ai2 = 0; t.lai3 = -1; t.vx = 0.5;
    t.fixedUpdate(1 / 60, hooks);
    expect(t.ai0).toBe(1);                       // TownCritter 不避坠=走出崖外（原版语义）
  });
});

describe('BJ704-G6 D12③b:前视避坠掉头（岩浆列 → 掉头,危险另僵立）', () => {
  it('★岩浆前视:614 掉头（facing 翻/ai0 保持走）;617 对照不转', () => {
    const { hooks } = critterWorld();
    const w = (hooks as unknown as { world: World }).world;
    const st = w.store;
    // 岩浆池:(40,59) 液 255/型 2——前视列断在岩浆（:56236-40 先于实心）→ 恒避;
    // 支撑三列 (38-40,60) 全实 =3 → 不落 ③a 停走,落 :54710 掉头支
    st.liquid[st.idx(40, 59)] = 255;
    st.liquidType[st.idx(40, 59)] = 2;
    const e = spawnWalker(614, hooks);
    e.x = 616; e.y = 960 - e.h;                  // 中心 626=col 39,前视列 40
    e.facing = 1; e.vx = 0.5; e.vy = 0;
    e.ai0 = 1; e.ai1 = 99999; e.ai2 = 0; e.lai3 = -1;
    e.fixedUpdate(1 / 60, hooks);
    expect(e.facing).toBe(-1);                   // 掉头（旧=径直走进岩浆）
    expect(e.ai0).toBe(1);                       // 掉头≠停走
    const t = spawnWalker(617, hooks);
    t.x = 616; t.y = 960 - t.h; t.facing = 1; t.vx = 0.5; t.vy = 0;
    t.ai0 = 1; t.ai1 = 99999; t.ai2 = 0; t.lai3 = -1;
    t.fixedUpdate(1 / 60, hooks);
    expect(t.facing).toBe(1);                    // 龟不避（TownCritter 豁免）
  });
});

// ---------------------------------------------------------------------------
// C. D13 卡墙折返（1 格墙 + 顶棚断 StepUp 净空 = 可达面实证）
// ---------------------------------------------------------------------------
/** 1 格墙夹具:(30,59) 墙 + (30,57) 顶棚(断 applyStepUp flag 门 j=2 探柱)。
 *  小个子（614/617 h=20 → h/16<3）:t5 实心但 t4 空 → 2+格墙联检免;t4 空 →
 *  1 格墙支不进;沉入 16≤20 → 半砖档不进 → 障碍三档全空 → 逐拍撞墙卡死态 */
function wallWorld() {
  const { w, hooks } = critterWorld();
  const st = w.store;
  st.setTileSilent(30, 59, 2);   // 1 格墙（贴地,身上 1 格净空 (30,58)）
  st.setTileSilent(30, 57, 2);   // 顶棚（StepUp 探柱 j=2 行）
  return { w, hooks };
}

function flushAtWall(e: Enemy): void {
  e.x = 30 * TILE - e.w;                        // 右缘恰贴墙左缘（flush=每拍 landed 0）
  e.y = 960 - e.h;
  e.facing = 1; e.vx = 0; e.vy = 0;
  e.ai0 = 1; e.ai1 = 999999; e.ai2 = 0; e.lai3 = -1;
  e.lai2 = 0;
}

describe('BJ704-G6 D13:卡墙折返（31 拍触发/三拍第三掷/危险抑制）', () => {
  it('★614 贴墙连走:~31-34 拍 facing 翻背 + ai1 续走 200-499（旧=无限顶墙到走程尽）', () => {
    const { hooks } = wallWorld();
    const e = spawnWalker(614, hooks);
    flushAtWall(e);
    let firedTick = -1, firedAi1 = -1;
    for (let t = 1; t <= 45; t++) {
      e.fixedUpdate(1 / 60, hooks);
      if (e.facing === -1 && firedTick < 0) { firedTick = t; firedAi1 = e.ai1; }
    }
    expect(firedTick).toBeGreaterThanOrEqual(28);   // 首拍快照残值不计,31 计数拍起可触发
    expect(firedTick).toBeLessThanOrEqual(40);
    expect(firedAi1).toBeGreaterThanOrEqual(200);
    expect(firedAi1).toBeLessThanOrEqual(499);
    expect(e.ai0).toBe(1);
  });
  it('★617 三拍第三掷:同夹具触发时 ai1=400-898（+Next(200,400) 门,G3 D7 已注的第三处）', () => {
    const { hooks } = wallWorld();
    const e = spawnWalker(617, hooks);
    flushAtWall(e);
    let firedAi1 = -1;
    for (let t = 1; t <= 45; t++) {
      e.fixedUpdate(1 / 60, hooks);
      if (e.facing === -1 && firedAi1 < 0) firedAi1 = e.ai1;
    }
    expect(firedAi1).toBeGreaterThanOrEqual(400);
    expect(firedAi1).toBeLessThanOrEqual(898);
  });
  it('★计数语义:20 拍后 lai2≈18-20（后置 ++ 短路累加,非触发不清零）', () => {
    const { hooks } = wallWorld();
    const e = spawnWalker(614, hooks);
    flushAtWall(e);
    for (let t = 0; t < 20; t++) e.fixedUpdate(1 / 60, hooks);
    expect(e.lai2).toBeGreaterThanOrEqual(16);
    expect(e.lai2).toBeLessThanOrEqual(20);
    expect(e.facing).toBe(1);                    // 20 拍 < 30 未触发
  });
  it('★危险抑制:险情在场（!flag16 短路）45 拍不折返、lai2 恒 0', () => {
    const { hooks } = wallWorld();
    const e = spawnWalker(614, hooks);
    flushAtWall(e);
    // 险情在墙外右上（dx>0 → 614 追向 +1 保持顶墙;LOS 从 (471,950) 向上过墙顶）
    const h = withEnemies(hooks, fakeEnemy(520, 53 * TILE));
    for (let t = 0; t < 45; t++) e.fixedUpdate(1 / 60, h);
    expect(e.facing).toBe(1);
    expect(e.lai2).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D. R3-P2⑤ 钉面/重力序（深水 -4 钳支:原版 -3.8 / 旧序 -4.0）
// ---------------------------------------------------------------------------
describe('BJ704-G6 R3-P2⑤:钉面先行、重力后置（AI 内/AI 外同序）', () => {
  it('★水下上浮钳:湿龟 vy=-4 入拍 → -3.8（钉面 -0.8 钳 -4 后 +重力 0.2;旧序=-4.0）', () => {
    const { hooks } = critterWorld();
    const st = (hooks as unknown as { world: World }).world.store;
    // 水体:行 55-59 满水（液面行 55 → getWaterLine 线 =56*16−15=881;中心行 56
    // 的 ty-2=54 无液 → found ✓ 走线下上浮支）
    for (let x = 20; x <= 60; x++) {
      for (let y = 55; y <= 59; y++) st.liquid[st.idx(x, y)] = 255;
    }
    const e = spawnWalker(617, hooks);
    e.fixedUpdate(1 / 60, hooks);                // 沾水拍（尾段 updateNpcLiquid 置 wet）
    expect(e.wet).toBe(true);
    // 深摆到液面下 1 行（中心 896=行 56;anchor 897 > 线 881 → 线下支;
    // 897−4=893 > 881 → 不触线锚钳 → 只剩 −4 钳的序差）
    e.x = 40 * TILE; e.y = 886; e.vx = 0; e.vy = -4;
    e.ai0 = 0; e.ai1 = 99999; e.ai2 = 0; e.lai3 = -1;
    e.fixedUpdate(1 / 60, hooks);
    expect(e.vy).toBeCloseTo(-3.8, 10);          // (−4−0.8)→钳−4 → +0.2;旧序=(−4+0.2)−0.8→钳−4
  });
});

// ---------------------------------------------------------------------------
// E. 结构锁（单源/门式/快照/序/销案备注/锚随迁）
// ---------------------------------------------------------------------------
describe('BJ704-G6 结构锁', () => {
  it('D12:共享叶子单源——Enemy import + TownNPC re-export + 本体在 npcWalkPrediction.ts', () => {
    expect(enemySrc).toMatch(/import \{ walkPrediction \} from '\.\/npcWalkPrediction';/);
    expect(townSrc).toMatch(/export \{ walkPrediction \} from '\.\/npcWalkPrediction';/);
    expect(leafSrc).toContain('export function walkPrediction(');
    expect(leafSrc).toContain('export const HOME_DRIFT_RANGE = 35;');
    // TownNPC 不再有本体（防双副本）
    expect(townSrc).not.toMatch(/export function walkPrediction\(/);
  });
  it('D12:三消费位门式（①if(!avoidFalling1) ②else 掉头 60+r120 ③停走 50+r50/lai3=40 + else-if 掉头）', () => {
    expect(enemySrc).toMatch(/if \(!avoidFalling1\) \{/);
    expect(enemySrc).toMatch(/this\.facing \*= -1;\s+\/\/ :54315 掉头（悬崖背侧）\s+this\.ai1 = 60 \+ Math\.floor\(Math\.random\(\) \* 120\);/);
    expect(enemySrc).toMatch(/this\.ai1 = 50 \+ Math\.floor\(Math\.random\(\) \* 50\);/);
    expect(enemySrc).toMatch(/this\.lai3 = 40;/);
    expect(enemySrc).toMatch(/\} else if \(avoidFalling3\) \{/);
  });
  it('D13:快照四字段 + moveAndCollide 前采样 + 检查块（后置 ++/三拍/双翻）', () => {
    for (const f of ['critterPreMoveX', 'critterPreMoveY', 'critterOldVX', 'critterOldVY']) {
      expect(enemySrc).toContain(`${f} = 0;`);
    }
    const snap = enemySrc.indexOf('this.critterPreMoveX = this.x;');
    const mac = enemySrc.indexOf('moveAndCollide(this, game.world, this.vx, this.vy);', snap);
    expect(snap).toBeGreaterThanOrEqual(0);
    expect(mac).toBeGreaterThan(snap);                        // 采样在移动前
    expect(enemySrc).toMatch(/&& !danger && this\.lai2\+\+ >= 30\) \{/);   // 后置 ++（31 拍）
    expect(enemySrc).toMatch(
      /\+ \(townCritter \? 200 \+ Math\.floor\(Math\.random\(\) \* 200\) : 0\);\s+\/\/ :54795-98 三拍第三处/);
  });
  it('R3-P2⑤:重力行在钉面块【后】（源序 indexOf）', () => {
    const pin = enemySrc.indexOf('const pinSurface = (turtle || frog) && wet;');
    const grav = enemySrc.indexOf('this.vy = wet', pin);
    const pinBlock = enemySrc.indexOf('getWaterLine(st, ctx,', pin);
    expect(pin).toBeGreaterThanOrEqual(0);
    expect(pinBlock).toBeGreaterThan(pin);
    expect(grav).toBeGreaterThan(pinBlock);                   // 钉面先行,重力后置
  });
  it('R3-P2④:applyGravity 完备性备注在位 + 不落死码（无 aiStyle7&&ai0==25 档）', () => {
    expect(enemySrc).toContain('BJ704-G6 R3-P2④');
    expect(enemySrc).not.toMatch(/aiStyle === 7 && this\.ai0 === 25/);
  });
  it('BJ688:自引锚「级联 :15631」已随迁（改代码身份引用,不再嵌行号）', () => {
    expect(enemySrc).not.toContain('级联 :15631');
    expect(enemySrc).toContain('旧自引行号 :15631→:15723 系本文件增行漂移,改按');
  });
});
