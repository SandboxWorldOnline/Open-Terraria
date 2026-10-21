// ★BJ704-G1（2026-10-21）召唤域登记债清算·四件（BJ703-A/B/F 新登记）——判别锁 +
// 反编译源锚。定谳链（Terarria1457/Terraria/Projectile.cs 亲读）：
//  债① IDSTATIC_BUCKETS 零 tick（BJ703-A 登记债④）：原版 perIDStaticNPCImmunity
//     （:296 static uint[,]）= 绝对到期表——命中写 GameUpdateCount+(uint)cd
//     （:14035-14037/:13822）,门读 stored≤GameUpdateCount（IsNPCIndexImmuneTo-
//     ProjectileType :606-608,Damage_PVE flag2 :12600 消费）,【无】逐 t 衰减通道。
//     旧仓 MinionHitCd 倒数桶且零驱动（BJ697 只接私有 hitCd 宿主 tick;共享桶 N 实例
//     不可「每 t 恰一减」）⇒ 每敌一次命中后永拒（存量红 minionproj-ledger-aug31
//     「758 idStatic 10」根因）。修=IdStaticBucket（gameTickCount=GameUpdateCount
//     等价钟,core/GameTime BJ330;写 count+cd/门 ≤count/惰性清扫 Arrow 先例）。
//  债② 758 扑击贴地减速误植（BJ703-A 登记债①）：flag2 块 :50931-50934
//     `velocity.Y==0 → velocity.X *= 0.8f`【每拍】;×0.1 是 flag8(猫)/flag9(泥盆)
//     首拍落地刹（:50877-50884/:50905-50907,ai[1]==num10−1 门,palGroundStep 自有
//     面在位）误植蛙域,且 frA1-- 先于读=条件早一拍。
//  债③ 虎帧/旋转通道（BJ703-A 登记债②③）：飞行帧块 :50818-50826（帧 8/834-835=10
//     + rotation += 0.6×spriteDirection）/ state4 等待帧 :50284-50288（9/11）/
//     state5=flag3&flag15 早退拦截块 :50534-50603 cos 波爬高（orbit 核 :50954-50994
//     对虎不可达——整段 return;入态滞回:入=15 行全空 :51146-51156,离=7 行内见支承
//     :50560-50565;蹭头弹跳 vy=-8 :50567-50571;爬高点=敌顶+cos(t/40·2π)负折×40,
//     Δ限长 20,MoveTowards 4 :50572-50589;帧 8/10+rot 0.6 :50590-50595）/ 步行帧机
//     :52005-52048（rot=0 逐拍复位;立 0/走带 2..num74−1,fc+=trunc|vx|+1,>10 推帧,
//     越带回 2/空中 1(834-835=9);num74=8/10）。projFrames 833=10/834=12/835=12
//     （Main.cs:8789-8791）。
//  债④ 虎 state4 坐等期特攻冷却冻结（BJ703-A 登记债③）：flag3 头 :50187-50207
//     localAI[0] 递减/尝试【全态】跑（state4 块 :50281-50297 在其后 ⇒ 坐等期照走,
//     冷却到期可自 state4 内再链发,成功同拍落 state4 块）。旧仓 state4 支先 return
//     =冻结（至多 num4≈40-160t 延迟）。
// 夹具纪律（BJ514/BJ634/BJ635/BJ696/BJ703a 判例）：真 World/真 Player/直驱
// fixedUpdate/类型手术直入态;「一咬=一拍」模型含 GTW 钟推进（债① oracle 重产）。
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { MinionProj } from '../src/entities/MinionProj';
import { pinGameTimeTicks } from '../src/core/GameTime';
import type { GameHooks } from '../src/entities/types';

const EXT_MISSING = !existsSync(new URL('../../Terarria1457', import.meta.url));
const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457', 'Terraria');

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; maxHp?: number;
  iframes?: number;
  hurt: (d: number, ...rest: unknown[]) => boolean;
  hits: number[];
}
const mkEnemy = (id: number, cx: number, cy: number, w = 60, h = 60): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy,
    hp: 100000, maxHp: 100000, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};

function makeHooks(enemies: MockEnemy[] = []) {
  const w = new World(200, 140, 7, 'bj704g1');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 140; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
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
  };
  (hooks as unknown as { entities: { projectiles: unknown[]; add: (e: unknown) => void } }).entities = {
    projectiles: added,
    add: (e: unknown) => { added.push(e); },
  };
  return { hooks, player, added, world: w };
}

let seq = 0;
const minion = (player: Player, hooks: GameHooks, cx: number, cy: number,
  projId: number, damage = 20): MinionProj => {
  const m = new MinionProj(cx, cy, projId, damage, 2, false, 0, false, () => player);
  m.id = ++seq;
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;
  (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(m);
  return m;
};
const overlap = (m: { x: number; y: number; w: number; h: number }, e: MockEnemy): void => {
  m.x = e.cx - m.w / 2; m.y = e.cy - m.h / 2;
};
const S = (m: unknown) => m as unknown as Record<string, number | boolean>;
/** 一咬=一拍（敌窗衰减 + GTW 钟推进——债① oracle 重产后的完整「一拍」模型） */
const biteAt = (m: MinionProj, g: GameHooks, tick: number, d = 10,
  cdIn?: unknown): boolean => {
  pinGameTimeTicks(tick);
  for (const en of g.enemies() as MockEnemy[]) {
    if (typeof en.iframes === 'number' && en.iframes > 0) en.iframes--;
  }
  return (m as unknown as {
    contact(g: GameHooks, dmg: number, cdIn?: unknown): boolean;
  }).contact(g, d, cdIn);
};

// ============================================================
// §0 反编译源锚（读错/漂移即红——四件定谳链）
// ============================================================
describe.skipIf(EXT_MISSING)('§0 原版锚：绝对到期表/每拍0.8/帧机/头部门', () => {
  const van = readFileSync(join(VAN, 'Projectile.cs'), 'utf8');
  const main = readFileSync(join(VAN, 'Main.cs'), 'utf8');

  it('债①：perIDStaticNPCImmunity=绝对到期（写 count+cd :14036 / 门 ≤count :608,零衰减）', () => {
    expect(van).toContain('perIDStaticNPCImmunity[immunityIdentity, victimIndex] = Main.GameUpdateCount + (uint)idStaticNPCHitCooldown;');
    expect(van).toContain('return perIDStaticNPCImmunity[projectileType, npcIndex] <= Main.GameUpdateCount;');
    const fn = van.slice(van.indexOf('private void AI_067_FreakingPirates()'));
    expect(fn).not.toContain('perIDStaticNPCImmunity');   // AI_067 体内零衰减写位
  });
  it('债②：flag2 扑击每拍 ×0.8（:50931-50934）;×0.1 系 flag8/9 首拍刹（ai[1]==num10-1 门）', () => {
    const fn = van.slice(van.indexOf('private void AI_067_FreakingPirates()'));
    expect(fn).toContain('if (velocity.Y == 0f)\n\t\t\t\t{\n\t\t\t\t\tvelocity.X *= 0.8f;');
    expect(fn.match(/if \(ai\[1\] == \(float\)\(num10 - 1\) && velocity\.Y == 0f\)/g))
      .toHaveLength(2);                                   // flag8 :50877 + flag9 :50905（非蛙）
  });
  it('债③：飞行帧 8/10+rot 0.6（:50818-50826）/state4 帧 9/11（:50284-50288）', () => {
    const fn = van.slice(van.indexOf('private void AI_067_FreakingPirates()'));
    expect(fn).toContain('if (flag3)\n\t\t\t{\n\t\t\t\tframe = 8;');
    expect(fn.match(/rotation \+= 0\.6f \* \(float\)spriteDirection;/g)).toHaveLength(2);
    expect(fn).toContain('frame = 9;');
    expect(fn).toContain('if (flag4)\n\t\t\t{\n\t\t\t\tframe = 11;');
  });
  it('债③：state5=cos 波爬高块（:50534-50603,orbit 核对虎不可达）', () => {
    const fn = van.slice(van.indexOf('private void AI_067_FreakingPirates()'));
    expect(fn).toContain('if (flag3 & flag15)');
    expect(fn).toContain('float num17 = (float)Math.Cos(Main.timeForVisualEffects / (double)num15 * 6.2831854820251465);');
    expect(fn).toContain('velocity = velocity.MoveTowards(vector5, maxAmountAllowedToMove);');
    // flag3&flag15 块内两 return（出域/支承滞回）+ 块尾 return ⇒ :50954 orbit 核虎不可达
    const climb = fn.slice(fn.indexOf('if (flag3 & flag15)'), fn.indexOf('if (flag6)\n\t\t{\n\t\t\tif (ai[2] > 0f'));
    expect(climb.match(/\breturn;/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it('债③：步行帧机 :52005-52048（rot=0 复位/立 0/走带回 2/空中 1|9）+ projFrames', () => {
    const fn = van.slice(van.indexOf('private void AI_067_FreakingPirates()'));
    expect(fn).toContain('int num74 = 8;');
    expect(fn).toContain('if (frame >= num74 || frame < 2)');
    expect(fn).toContain('if (flag4)\n\t\t\t\t\t{\n\t\t\t\t\t\tframe = 9;');
    expect(main).toContain('projFrames[833] = 10;');
    expect(main).toContain('projFrames[834] = 12;');
    expect(main).toContain('projFrames[835] = 12;');
  });
  it('债④：flag3 头 localAI[0] 全态递减（:50187-50207）先于 state4 块（:50281）', () => {
    const fn = van.slice(van.indexOf('private void AI_067_FreakingPirates()'));
    const iHead = fn.indexOf('bool flag11 = AI_067_TigerSpecialAttack();');
    const iState4 = fn.indexOf('if (flag3 && ai[0] == 4f)');
    expect(iHead).toBeGreaterThan(-1);
    expect(iState4).toBeGreaterThan(iHead);              // 头部门在前=坐等期照跑
  });
});

// ============================================================
// §1 债① idStatic 桶绝对到期（行为锁：精确 tick 解封/分桶/−1 回绕）
// ============================================================
describe('§1 债① idStatic 绝对到期桶（:606-608/:14035-14037）', () => {
  it('758 同型共享：首咬写 count+10,第 10 拍（count=10）恰解封、第 9 拍仍拒', () => {
    const en = mkEnemy(1, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const f1 = minion(player, hooks, en.cx, en.cy, 758);
    const f2 = minion(player, hooks, en.cx, en.cy, 758);
    expect(biteAt(f1, hooks, 0)).toBe(true);             // 写 bucket[758][id]=0+10
    expect(biteAt(f2, hooks, 0)).toBe(false);            // 同型共享一致拒（10>0）
    expect(biteAt(f2, hooks, 9)).toBe(false);            // 10>9 仍拒（旧零驱动桶永不解封 → 必红）
    expect(biteAt(f2, hooks, 10)).toBe(true);            // 10≤10 恰解封（stored≤count 原文）
    expect(en.hits).toHaveLength(2);
  });
  it('387/388 分型互不串桶（immunityIdentity=type）', () => {
    const en = mkEnemy(2, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const a = minion(player, hooks, en.cx, en.cy, 387);
    const b = minion(player, hooks, en.cx, en.cy, 388);
    expect(biteAt(a, hooks, 0)).toBe(true);
    expect(biteAt(b, hooks, 0)).toBe(true);              // 分桶 16/12 互不相扰
  });
  it('cd=−1 uint 回绕：now−1 ≤ now 恒过（644 彩虹爆碎面,C16a-F3①）', () => {
    const en = mkEnemy(3, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const b = minion(player, hooks, en.cx, en.cy, 644);
    const spec = { kind: 'idStatic', cd: -1 } as const;
    expect(biteAt(b, hooks, 0, 10, spec)).toBe(true);
    expect(biteAt(b, hooks, 0, 10, spec)).toBe(true);    // 同拍再咬照过（值门回潮 → 必红）
    expect(en.hits).toHaveLength(2);
  });
});

// ============================================================
// §2 债② 758 扑击贴地每拍 ×0.8（:50931-50934）
// ============================================================
describe('§2 债② 蛙扑击贴地减速（每拍 ×0.8,读相=重力前）', () => {
  it('贴地扑击 2 拍：vx 10→8→6.4（旧首拍一次 ×0.1=1 → 必红）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, 60 * 16, 99 * 16 - 16 + 16, 758);   // 贴地（底=100 行顶）
    m.y = 100 * 16 - m.h;                                // 盒底贴地面行 100 顶
    S(m).frA0 = 2; S(m).frA1 = 20;                       // 扑击态直入（首拍）
    m.vx = 10; m.vy = 0;
    m.fixedUpdate(1, hooks);
    expect(m.vx).toBeCloseTo(8, 6);                      // 第 1 拍 ×0.8（旧 ×0.1=1）
    m.fixedUpdate(1, hooks);
    expect(m.vx).toBeCloseTo(6.4, 6);                    // 第 2 拍再 ×0.8（旧恒 1）
    expect(S(m).frA1).toBe(18);                          // ai[1]-- 序=重力/位移后（:50941）
  });
  it('腾空拍不衰减（velocity.Y==0 门=贴地语义）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, 60 * 16, 90 * 16, 758);
    S(m).frA0 = 2; S(m).frA1 = 20;
    m.vx = 10; m.vy = -5;                                // 空中上升拍
    m.fixedUpdate(1, hooks);
    expect(m.vx).toBeCloseTo(10, 6);                     // vy≠0 → 不触阻尼
  });
});

// ============================================================
// §3 债③ 虎帧/旋转通道（飞行/坐等/爬高/步行四态帧机）
// ============================================================
describe('§3 债③ 虎帧/旋转通道（:50818-50826/:50284-50288/:50534-50603/:52005-52048）', () => {
  it('飞行（ai0==1）：帧 8/10 + rotation += 0.6×dir 逐拍累计（左行 dir=−1 → 负累计）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, player.cx + 600, player.cy, 833);
    S(m).pounceCd = 1000;
    S(m).tigerA0 = 1;
    m.fixedUpdate(1, hooks);
    expect(S(m).tigerFrame).toBe(8);                     // 旧 age/8 兜底（age1→帧0）→ 必红
    expect(m.rot).toBeCloseTo(-0.6, 6);                  // 左行 spriteDirection=−1（:50753）
    m.fixedUpdate(1, hooks);
    expect(S(m).tigerFrame).toBe(8);
    expect(m.rot).toBeCloseTo(-1.2, 6);                  // 逐拍累计
    const m2 = minion(player, hooks, player.cx + 600, player.cy, 834);
    S(m2).pounceCd = 1000; S(m2).tigerA0 = 1;
    m2.fixedUpdate(1, hooks);
    expect(S(m2).tigerFrame).toBe(10);                   // 834/835=10
  });
  it('坐等（ai0==4）：帧 9/11（:50284-50288）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, player.cx, player.cy, 833);
    S(m).tigerA0 = 4; S(m).tigerA1 = 50;
    m.fixedUpdate(1, hooks);
    expect(S(m).tigerFrame).toBe(9);                     // 旧帧通道缺 → 必红
    const m2 = minion(player, hooks, player.cx, player.cy, 835);
    S(m2).tigerA0 = 4; S(m2).tigerA1 = 50;
    m2.fixedUpdate(1, hooks);
    expect(S(m2).tigerFrame).toBe(11);                   // 834/835=11
  });
  it('爬高（ai0==5）：Δ限长 20 + MoveTowards 4 —— 敌顶同列 90px 下 → vy=-4', () => {
    // 悬空敌（下方 15 行无支承,且在主视窗 1920×1200 内=findTargetInRangeDual viewRect 门
    // :49898）,虎直入 state5,置敌顶同列 90px 下（不叠盒=弹跳支隔离）
    const en = mkEnemy(4, 60 * 16 + 200, 90 * 16 - 60);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.y + 80 + m0h(), 833);
    S(m).pounceCd = 1000;
    S(m).tigerA0 = 5;
    m.fixedUpdate(1, hooks);
    expect(S(m).tigerA0).toBe(5);
    expect(S(m).tigerFrame).toBe(8);
    // v5=(0,敌顶±40波−(敌顶+90))→|v5|∈[90,130]>20 钳 (0,−20) → MoveTowards((0,0)→(0,−20),4)=(0,−4)
    expect(m.vx).toBeCloseTo(0, 6);
    expect(m.vy).toBeCloseTo(-4, 6);
  });
  it('爬高蹭头弹跳（:50567-50571）：盒交∧vy≥0 → vy=-8/vx=dir×10 后 MoveTowards 合成;orbit 入扑转移退役', () => {
    const en = mkEnemy(5, 60 * 16 + 200, 90 * 16 - 60);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 833);
    S(m).pounceCd = 1000;
    S(m).tigerA0 = 5;
    m.fixedUpdate(1, hooks);
    expect(S(m).tigerA0).toBe(5);                        // ★旧 orbit 核 dl<32 → ai0=2+瞬移 → 必红
    expect(S(m).tigerFrame).toBe(8);
    // 弹跳 (facing·10,−8) → MoveTowards((0,−20),4)：Δ=(−10,−12) |Δ|=15.62 → 净 (7.438,−11.072)
    expect(m.vx).toBeCloseTo(10 - 40 / Math.hypot(10, 12), 5);
    expect(m.vy).toBeCloseTo(-8 - 48 / Math.hypot(10, 12), 5);
  });
  it('爬高滞回（:50560-50565 num13=7）：7 行内见支承 → 回 walk;8 行仍留 state5', () => {
    const enNear = mkEnemy(6, 60 * 16 + 200, 90 * 16 - 60);
    const hN = makeHooks([enNear]);
    hN.world.store.setTile(Math.floor(enNear.cx / 16), Math.floor(enNear.y / 16) + 3, 1);   // 支承@+3 行
    const mN = minion(hN.player, hN.hooks, enNear.cx, enNear.cy, 833);
    S(mN).pounceCd = 1000; S(mN).tigerA0 = 5;
    mN.fixedUpdate(1, hN.hooks);
    expect(S(mN).tigerA0).toBe(0);                       // 离态回 walk（旧 orbit 无支承门 → 必红）
    const enFar = mkEnemy(7, 60 * 16 + 200, 90 * 16 - 60);
    const hF = makeHooks([enFar]);
    hF.world.store.setTile(Math.floor(enFar.cx / 16), Math.floor(enFar.y / 16) + 8, 1);    // 支承@+8 行
    const mF = minion(hF.player, hF.hooks, enFar.cx, enFar.cy, 835);
    S(mF).pounceCd = 1000; S(mF).tigerA0 = 5;
    mF.fixedUpdate(1, hF.hooks);
    expect(S(mF).tigerA0).toBe(5);                       // 8≥7 仍留（离态门=7,防矫枉过正）
  });
  it('步行帧机（:52005-52048）：走带 2-7（88 拍仍行进,旧 age/8=1 → 必红）+ rot 逐拍复位 0', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, player.cx + 300, player.cy, 833);
    S(m).pounceCd = 1000;
    m.rot = 2.5;                                         // 注入残留旋转
    for (let t = 0; t < 88; t++) m.fixedUpdate(1, hooks);
    // 跟随锚死区刹车→越区再加速=极限环,88 拍确定性行进中（|vx|=1.416,模拟实测）;
    // 旧 age/8 兜底：88/8%10=1 → 0|1 ∉ 走带 → 必红;rot 注入 2.5 残留=旧无复位通道必红
    expect(Math.abs(m.vx)).toBeGreaterThanOrEqual(0.5);  // 行进中（走带读相成立）
    expect(S(m).tigerFrame).toBeGreaterThanOrEqual(2);
    expect(S(m).tigerFrame).toBeLessThanOrEqual(7);      // 833 走带 2..7
    expect(m.rot).toBe(0);                               // :52012 逐拍复位
  });
  it('步行帧机直驱：走带回 2/空中 1|9（tigerFrameTick 单元锁）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, player.cx, player.cy, 833);
    const tk = (vx: number, preGravVy: number): void => {
      m.vx = vx;
      S(m).lastWalkPreGravVy = preGravVy;
      (m as unknown as { tigerFrameTick(): void }).tigerFrameTick();
    };
    S(m).tigerFrame = 20;                                // 越带值
    tk(5, 0);
    expect(S(m).tigerFrame).toBe(2);                     // ≥num74||<2 → 回 2（:52029-52032）
    tk(0, -0.4);
    expect(S(m).tigerFrame).toBe(1);                     // 空中（833）
    const m2 = minion(player, hooks, player.cx, player.cy, 834);
    (m2 as unknown as { tigerFrameTick(): void }).tigerFrameTick.call(
      Object.assign(m2, { vx: 0, lastWalkPreGravVy: -0.4 }));
    expect(S(m2).tigerFrame).toBe(9);                    // 空中（834/835=9）
  });
});

// ============================================================
// §4 债④ state4 坐等期冷却照跑（:50187-50207 全态递减）
// ============================================================
describe('§4 债④ 虎 state4 特攻冷却（头部门全态递减 + 到期再链发）', () => {
  it('坐等 3 拍冷却 300→297（旧 state4 冻结恒 300 → 必红）', () => {
    const { hooks, player } = makeHooks([]);
    const m = minion(player, hooks, player.cx, player.cy, 833);
    S(m).tigerA0 = 4; S(m).tigerA1 = 60; S(m).pounceCd = 300;
    for (let t = 0; t < 3; t++) m.fixedUpdate(1, hooks);
    expect(S(m).tigerA0).toBe(4);                        // 坐等窗口未走完
    expect(S(m).pounceCd).toBe(297);                     // ★旧冻结=300 → 必红
    expect(S(m).tigerA1).toBe(57);
  });
  it('坐等期冷却到期 → 自 state4 内再链发（同拍落 state4 块,原版 :50199→:50281 同拍序）', () => {
    const en = mkEnemy(8, 60 * 16 + 200, 90 * 16 - 60);
    const { hooks, player, added } = makeHooks([en]);
    const m = minion(player, hooks, player.cx, player.cy, 833);
    S(m).tigerA0 = 4; S(m).tigerA1 = 100; S(m).pounceCd = 1;
    m.fixedUpdate(1, hooks);
    expect(added).toHaveLength(1);                       // 第 1 拍：冷却 1→0,未触发（唯本体在桶）
    expect(S(m).pounceCd).toBe(0);
    m.fixedUpdate(1, hooks);                             // 第 2 拍：门尝试 → 818 链再发
    expect(added.length).toBeGreaterThan(1);             // ★旧冻结=永不触发 → 必红
    expect(S(m).pounceCd).toBe(360);                     // 833 成功档（:50191-50196）
    expect(S(m).tigerA0).toBe(4);                        // 同拍落 state4 块
    expect(S(m).tigerFrame).toBe(9);
  });
});

// ============================================================
// §5 源码结构锁（防静默回退——四刀各自的判别表达式在位）
// ============================================================
describe('§5 源码结构锁', () => {
  const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');

  it('债①：IdStaticBucket 绝对到期在位（gameTickCount 写 count+cd/门 >now）', () => {
    expect(src).toContain('class IdStaticBucket');
    expect(src).toContain('if ((this.m.get(id) ?? 0) > now) return false;');
    expect(src).toContain('this.m.set(id, now + cd);');
    expect(src).toContain('const IDSTATIC_BUCKETS = new Map<number, IdStaticBucket>();');
  });
  it('债②：frogStep 每拍 ×0.8 在位、×0.1 误植退役（palGroundStep 面不动）', () => {
    const i = src.indexOf('private frogStep(');
    const block = src.slice(i, src.indexOf('private frogFrameTick('));
    expect(block).toContain('if (this.vy === 0) this.vx *= 0.8;');
    expect(block).not.toContain('*= 0.1');               // 蛙域零 ×0.1（pal 域在另块）
  });
  it('债③：tigerBody 帧/旋转通道 + state5 爬高块在位;orbit 调用退役', () => {
    const i = src.indexOf('private tigerBody(');
    const block = src.slice(i, src.indexOf('private tigerFrameTick('));
    expect(block).toContain('this.tigerFrame = this.projId === 833 ? 8 : 10;');   // 飞行/爬高
    expect(block).toContain('this.tigerFrame = this.projId === 833 ? 9 : 11;');   // 坐等
    expect(block).toContain('this.rot += 0.6 * this.facing;');
    expect(block).toContain('visEffectFrames() / 40 * 6.2831854820251465');       // cos 波
    expect(block).toContain('if (rows5 < 7)');                                    // 滞回离态门
    expect(block).not.toContain('ai067StateFive(');                               // orbit 核退役
    // 债④：门在 state4 支之前（原版头部位序）
    expect(block.indexOf('if (this.pounceCd > 0)')).toBeLessThan(block.indexOf('if (this.tigerA0 === 4)'));
  });
  it('债③：draw 帧选支 tigerFrame 直写在位', () => {
    expect(src).toContain('} else if (this.projId >= 833 && this.projId <= 835) {');
    expect(src).toContain('frame = Math.min(this.tigerFrame, Math.max(0, frames - 1));');
  });
});

/** 833 盒高（MinionHit box 26×20,见 collisionBoxFor）——cy=y+h/2 折算用 */
function m0h(): number { return 20 / 2; }
