// 台账清偿批（2026-08-31）MinionProj 域回归——docs/audit/approx-registry-2026-08-31.md
// 「镇民/宠物」M 项③⑬⑭ + A档①② / B档⑤⑥⑦⑧⑨ / C 档 920·3472·4179。
// 原版真值 Terarria1458/Terraria/{Projectile,Utils,Collision,Main}.cs：
//   ① AI_067 步行链两结算段（Projectile.cs:51273-52057；1457 :51296-51557 同体偏移）
//     ——虎体 833 速度窗 1/8/8 + 0.7 catch-up + 跳梯五档 -5.1..-11.1 + 高出距离表
//     -6..-16（替换手写 ±0.12/clamp3.5/5% 小跳）
//   ② 海盗 393-395 步行链正轨（AI_067 flag 支）：走行不咬/扑击窗 cd=18/800 索敌窗
//   ③ 接触冷却三态家族化：-2 全局免工件窗（:466 缺省 + :12636 immune[owner] 门 +
//      :14182 写 npc.immune[owner]=10）/ local 私表 / idStatic 同型桶（immunityIdentity
//      =type :10682）——统一 20t 私表退役
//   ⑤ getChaseResults 蘑菇蓄跃真拦截（Utils.cs:651-708 + SolveQuadratic :721）
//   ⑥ WetCollision 盒级湿判（Collision.cs:1575-1650）——中心单格近似退役
//   ⑦ IsInRangeOfMeOrMyOwner 双距盒门（Projectile.cs:52404-52422）/ CanHitWithMeleeWeapon
//      （:12415）/ ⑧ CanHitWithOwnBody 本体四试视线（:12428-12444）
//   C-920 抚摸心形气泡窗粒子形态近似（Main.cs:34799-34832 图标缺资产登记）
//   C-3472 光环电弧声 ai[0] 循环 30t/僧侣T2 25t（AI_137 :69955-69979）
//   C-4179 焰流塔底盆 d270/炮口 d6 双矩形环境尘 + AddLight ×{1|1.2|1.5}
import { describe, it, expect, vi } from 'vitest';
import {
  MinionProj,
  getChaseResults, solveQuadratic, wetCollisionProbe,
  canHitWithOwnBodyBox, canHitWithMeleeWeaponBox,
} from '../src/entities/MinionProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { canHit, canHitLine } from '../src/physics/LineOfSight';
import { pinGameTimeTicks } from '../src/core/GameTime';   // ★BJ704-G1 债①：idStatic 桶 GTW 钟驱动（vitest 钉钟面）
import { temporaryBubbleSnapshot } from '../src/render/EmoteBubble';
import type { GameHooks } from '../src/entities/types';

const W = 220, H = 140;
function makeStore(): TileStore {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 110; y < H; y++) store.setTile(x, y, 1);
  return store;
}
/** α1 agent Enemy 用例：hurt 模拟 Enemy.hurt 写梯语义（★Z1 2026-10-02 oracle 重产——
 *  旧 mock 恒写 iframes=10 系 pierce=0 世界模型,BJ436 落刀后 local/idStatic 族走
 *  pierce=-3【清窗档】（:14175-14179 immune[owner]=0）,-2 缺省族/无局部旗才开 10t 窗
 *  （:14182）;flag3 单发弹（pierce=1）无写面）。若再退回恒写 10,本批③三发的
 *  「跨实例一致拒/≥cd 解封」判别位会被 :12636 共门整段拦截=私表永不解封（金标陈旧
 *  须 oracle 重产判例,禁在途金标强冻） */
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; vx?: number; vy?: number;
  iframes?: number;
  hits: number[];
  hurt: (d: number, kx: number, ky: number, g: unknown, pen: number, crit: boolean,
    pierce: number, fromPlayer: boolean) => boolean;
}
function mkEnemy(id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy, hp: 100000,
    hits: [],
    hurt: (d: number, _kx: number, _ky: number, _g: unknown, _pen: number, _crit: boolean,
      pierce: number, _fromPlayer: boolean) => {
      if ((e.iframes ?? 0) > 0) return false;               // Enemy.hurt 头门（:13972 同面）
      e.hp -= d; e.hits.push(d);
      if (pierce === -3) e.iframes = 0;                     // local/idStatic 清窗档（:14175-14179）
      else if (pierce !== 1) e.iframes = 10;                // -2 缺省族开窗（:14182）;flag3 无写面
      return true;
    },
  };
  return e;
}
function makeHooks(enemies: MockEnemy[] = []) {
  const store = makeStore();
  const player = new Player(60 * 16, 100 * 16 - 42, new Inventory());
  const projectiles: unknown[] = [];
  const sfx: string[] = [];
  const dusts: Array<{ id: number }> = [];
  const lights: number[] = [];
  const parts: string[] = [];
  const hooks = {
    world: { store, flags: { hardMode: false }, groundLevel: 120 },
    player,
    enemies: () => enemies as never[],
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: ((x: number, _y: number, color: string) => {
      void x; parts.push(color);
    }) as never,
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: ((_t: unknown, _v?: number) => {}) as never,
    showPickupLabel: () => {},
    spawnDust: ((_x: number, _y: number, _w: number, _h: number, id: number) => {
      const d = { id, vx: 1, vy: 1, fadeIn: 0, noGravity: false, noLight: false };
      dusts.push(d);
      return d;
    }) as never,
    addLightAt: (() => { lights.push(1); return undefined; }) as never,
  };
  hooks.playSfxFiles = ((t: unknown) => {
    sfx.push(Array.isArray(t) ? String(t[0]) : String(t));
  }) as never;
  const game = hooks as unknown as GameHooks;
  Object.assign(game, { entities: { add: (e: unknown) => { projectiles.push(e); }, projectiles } });
  return { hooks: game, store, player, projectiles, sfx, dusts, lights, parts, enemies };
}
const mk = (projId: number, owner: Player, x?: number, y?: number, sentry = false): MinionProj =>
  new MinionProj(x ?? owner.cx, y ?? owner.cy - 40, projId, 10, 2, sentry, 0, false, () => owner);
const priv = (m: MinionProj): Record<string, unknown> => m as unknown as Record<string, unknown>;
/** 一咬=一拍：敌怪免工件窗逐拍衰减（NPC.Update immune-- 等价,mock 无 Update 面——
 *  ★Z1 oracle 重产:窗衰减与 :12636 共门前置/私表受理写共同构成 BJ436 后世界模型） */
const bite = (m: MinionProj, g: GameHooks, d = 10): boolean => {
  for (const en of g.enemies() as MockEnemy[]) {
    if (typeof en.iframes === 'number' && en.iframes > 0) en.iframes--;
  }
  return (m as unknown as { contact(g: GameHooks, dmg: number): boolean }).contact(g, d);
};

describe('台账批① AI_067 步行链两结算段（1458 :51273-52057）', () => {
  // ★终零波 M1 清偿注记：ai[0]=5 追离态触发源之「目标脚下 15 格虚空扫描」
  //   （:51146-51156）已按原文接通——脚踩 15 行内无任何 active() 瓦片的悬空目标
  //   会让虎转追离态而不再走步行链。以下 fixture 的敌人从原悬空位改为贴地面/
  //   加支承砖，以贴合「站地可跳」的真实构图（悬空无支承本来就该进 state5）。
  it('flag3 有目标档 1/8/8：首拍 accel=1、终值钳 [6..8]（速度窗）', () => {
    const e = mkEnemy(1, 60 * 16 + 300, 105 * 16);        // 贴地面高（地面行 110 在脚下窗内）
    const { hooks, player } = makeHooks([e]);
    const t = mk(833, player, player.cx, 106 * 16);
    priv(t).pounceCd = 1000;                              // 关闭 818 链门,聚焦步行链
    t.fixedUpdate(1, hooks);
    expect(t.vx).toBeCloseTo(1, 9);                       // num50=1（flag3 档 :51322-51325）
    for (let k = 0; k < 30; k++) t.fixedUpdate(1, hooks);
    expect(Math.abs(t.vx)).toBeLessThanOrEqual(8);        // num52=8 钳
    expect(Math.abs(t.vx)).toBeGreaterThanOrEqual(6);
    expect(t.facing).toBe(1);
  });
  it('0.7 catch-up：|主速|=10>num52=8 → num52=10、accel=0.7（:51342-51345）', () => {
    const e = mkEnemy(2, 60 * 16 + 300, 105 * 16);
    const { hooks, player } = makeHooks([e]);
    player.vx = 10;
    const t = mk(833, player, player.cx, 106 * 16);
    priv(t).pounceCd = 1000;
    t.fixedUpdate(1, hooks);
    expect(t.vx).toBeCloseTo(0.7, 9);
    t.fixedUpdate(1, hooks);
    expect(t.vx).toBeCloseTo(1.4, 9);
    for (let k = 0; k < 40; k++) t.fixedUpdate(1, hooks);
    expect(Math.abs(t.vx)).toBeLessThanOrEqual(10);
  });
  it('无目标跟随缺省档 0.5/4/4 与主速 catch-up（:51274-51277）', () => {
    const { hooks, player } = makeHooks();
    player.x = 70 * 16;                                   // 主右侧 160px → 锚右行
    const t = mk(833, player, 60 * 16, 106 * 16);
    priv(t).pounceCd = 1000;
    t.fixedUpdate(1, hooks);
    expect(t.vx).toBeCloseTo(0.5, 9);
    player.vx = 6;                                        // 主速 6>4 → 0.7/6
    const t2 = mk(833, player, 60 * 16, 106 * 16);
    priv(t2).pounceCd = 1000;
    t2.fixedUpdate(1, hooks);
    expect(t2.vx).toBeCloseTo(0.7, 9);
  });
  it('跳梯意图两面合流（终清波批订正）：flag20 关闭仅灭 (a)，(b) 前墙列扫家族无关仍起跳', () => {
    const selfCx = 60 * 16 + 40 + 8;
    const en = mkEnemy(3, selfCx + 320, 110 * 16 - 10);     // 前方同高目标（贴地）
    const { hooks, store, player } = makeHooks([en]);
    const t = mk(833, player, 60 * 16 + 40, 110 * 16 - 16); // 盒贴地（底行=110 实心）
    const wallCol = Math.floor((t.x + t.w / 2) / 16) + 1;   // 中柱+intent(+1)
    for (let yy = 104; yy <= 109; yy++) store.setTile(wallCol, yy, 1);
    priv(t).pounceCd = 1000;
    let sawJump = false;
    for (let k = 0; k < 12; k++) {
      t.fixedUpdate(1, hooks);
      if (t.vy < -4) sawJump = true;                        // 任一拍出现梯档负速
    }
    // ★1458 原文 :51424-51457：(b) 列扫 num55≠0∧flag21 家族无关 → 同高遇墙亦跳
    // （旧断言"不跳"把虎的 (a) 条件 v15Y<-80 误并入列扫门,终清波批改判）
    expect(sawJump).toBe(true);
  });
  it('跳梯五档直驱（:51476-51524 中腰探测列净空映射）', () => {
    const { store, player } = makeHooks();
    const m = mk(833, player, 70 * 16, 110 * 16 - 16);    // 立于地面行 110 → 三柱承立
    const midRow = Math.floor((m.y + m.h / 2) / 16);      // 底行-1 行带
    const probe = Math.floor((m.x + m.w / 2) / 16) + 1;
    const ladder = (): void => {
      priv(m).vy = 0;
      (m as unknown as { ai67JumpLadder(s: TileStore, i: number): void })
        .ai67JumpLadder(store, 1);
    };
    ladder(); expect(m.vy).toBe(-5.1);                    // 顶双格净空
    store.setTile(probe, midRow - 1, 1);                  // 仅顶 1 格挡 → -7.1
    ladder(); expect(m.vy).toBe(-7.1);
    store.setTile(probe, midRow - 2, 1);                  // -1..-2 实心,-4/-5 空 → -9.1
    ladder(); expect(m.vy).toBe(-9.1);
    store.setTile(probe, midRow - 4, 1);                  // -4 实心 → -10.1
    ladder(); expect(m.vy).toBe(-10.1);
    store.setTile(probe, midRow - 5, 1);                  // -5 实心 → -11.1
    ladder(); expect(m.vy).toBe(-11.1);
  });
  it('TryJumpingToTarget 共享尾（:52154-52164,2026-09-08 续单补接）：高差 250/330 → 跃速 −√(h×0.8)（含同拍重力 +0.4 尾数）', () => {
    // ★原「高出距离表」钉（250→-14/330→-16）随共享尾补接改写：原版共享尾
    //   （:51024 调用位,阈值 30px）先于步行结算段（:51363,表阈值 48px）——
    //   双距域内有目标且贴地时共享尾必先跃起（vy≠0）→ 结算段/距离表整段让位
    //   =有目标场景下表位 vanilla 不可达（表仅跟随锚场景可达,由蛙 758 钉与
    //   跳梯五档直驱钉承钉）。跃速无 +1 尾数,与 :51084 flag8 干态专支相区别。
    const { hooks, player } = makeHooks();
    const selfCy = 110 * 16 - 8;                          // 贴地 16 盒中心
    const mkCase = (diff: number): { m: MinionProj; g: GameHooks } => {
      const en = mkEnemy(4, 60 * 16 + 400, selfCy - diff);
      const env = makeHooks([en]);
      // ★终零波 M1：目标【中心列】（Entity.Top=CenterX,:86-90 → 扫描列取中心）
      //   脚下垫一格实心——Top 向下扫描在窗内即命中 active,不再误入 ai[0]=5 追离；
      //   支承砖置于 Top+12 行远离盒底,与本体的 CanHit 试验线不相交
      env.store.setTile(Math.floor(en.cx / 16), Math.floor(en.y / 16) + 12, 1);
      const t = mk(833, env.player, 60 * 16, 110 * 16 - 16);
      priv(t).pounceCd = 1000;
      return { m: t, g: env.hooks };
    };
    const a = mkCase(250);                                 // 共享尾 h=252（真盒 26×20 → cy=y+10=1754）
    a.m.fixedUpdate(1, a.g);
    expect(a.m.vy).toBeCloseTo(-Math.sqrt(252 * 2 * 0.4) + 0.4, 9);   // 结算让位后即加重力（原版同拍序）
    const b = mkCase(330);                                 // h=332（<26 帽）
    b.m.fixedUpdate(1, b.g);
    expect(b.m.vy).toBeCloseTo(-Math.sqrt(332 * 2 * 0.4) + 0.4, 9);
  });
});

describe('台账批② 海盗 393-395 步行链正轨（AI_067 flag 支）', () => {
  it('地面追击替代悬停近似：800 内敌 → 走行接近（vx>0 且重力积分）', () => {
    // ★2026-09-08 续单：敌位从 96*16（高于本体 145px）改同高——共享尾
    //   （:51024/:52154,补接批）对贴地+高目标先跃起（vy<0）,原 vy>0 断言与
    //   原版序相悖;同高敌不触发共享尾（阈值 30px）,走行/重力断言保持原意
    const e = mkEnemy(6, 60 * 16 + 700, 106 * 16 + 15);
    const { hooks } = makeHooks([e]);
    const p = mk(393, hooks.player, 60 * 16, 106 * 16);
    p.fixedUpdate(1, hooks);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vy).toBeGreaterThan(0);
  });
  it('800 索敌窗外不入索敌：远敌不触发接触也不改扑击态（:50513 num2=800）', () => {
    const far = mkEnemy(7, 60 * 16 + 850, 96 * 16);
    const b = makeHooks([far]);
    const p2 = mk(393, b.player, 60 * 16, 106 * 16);
    p2.fixedUpdate(1, b.hooks);
    expect(priv(p2).pirA0).toBe(0);                       // 未入扑击
    expect(far.hits.length).toBe(0);
    expect(Number.isFinite(p2.vx)).toBe(true);
  });
  it('走行不咬/friendly=false;扑击窗一咬且 cd=18 封后续拍（:50862/:4765-4770）', () => {
    const e = mkEnemy(8, 60 * 16 + 4, 100 * 16 - 12);
    const { hooks, player } = makeHooks([e]);
    const p = mk(393, player, 60 * 16, 99 * 16 + 2);      // 盒重叠走行态
    p.y = 99 * 16 + 2;
    const hp0 = e.hp;
    p.fixedUpdate(1, hooks);
    expect(e.hp).toBe(hp0);
    const pv = priv(p) as { pirA0: number; pirA1: number };
    pv.pirA0 = 2; pv.pirA1 = 15;
    p.fixedUpdate(1, hooks);
    expect(e.hits.length).toBe(1);
    pv.pirA0 = 2; pv.pirA1 = 14;                          // 保持扑击态第二拍
    p.fixedUpdate(1, hooks);
    expect(e.hits.length).toBe(1);                        // cd=18 冷却封阻
  });
});

describe('台账批③ 接触冷却三态（P.cs:466/-2 全局窗;local;idStatic）★Z1 oracle 重产（mock 按 BJ436 写梯语义建模:pierce=-3 清窗/私表受理写/窗逐拍衰减）', () => {
  it('191 俾格米=-2 全局窗：窗清即透（私表族此刻仍受 cd 封）;窗置 10t 即拒', () => {
    const e = mkEnemy(10, 60 * 16, 96 * 16);
    const { hooks } = makeHooks([e]);
    const m = mk(191, hooks.player, e.cx, e.cy);
    e.iframes = 0;
    expect(bite(m, hooks)).toBe(true);                    // 首击（mock hurt 置 iframes=10）
    e.iframes = 0;                                        // 模拟敌窗走完——-2 族不受私表续封
    expect(bite(m, hooks)).toBe(true);
    e.iframes = 10;
    expect(bite(m, hooks)).toBe(false);                   // 窗内拒
  });
  it('758 吸血蛙 idStatic 10 同型共享桶（:7825）;跨实例一致拒、≥10t 解封', () => {
    const e = mkEnemy(11, 60 * 16, 96 * 16);
    const { hooks, player } = makeHooks([e]);
    const f1 = mk(758, player, e.cx, e.cy);
    const f2 = mk(758, player, e.cx, e.cy);
    // ★BJ704-G1 债①：idStatic 桶=gameTickCount 绝对到期（原版 perIDStaticNPCImmunity
    //   按 GameUpdateCount 到期——写 count+cd（:14035-14037）/门 stored≤count
    //   （:606-608）,【无】倒数衰减通道）。夹具「一咬=一拍」模型随之扩到 GTW 钟
    //   （原 mock 只衰减敌 iframes=倒数桶时代旧世界模型;旧 MinionHitCd 倒数桶零
    //   tick 驱动=本红根因,oracle 重产判例 Z1 同式）。钉钟 0 起步=文件内序无关。
    pinGameTimeTicks(0);
    expect(bite(f1, hooks)).toBe(true);
    expect(bite(f2, hooks)).toBe(false);                  // 同型桶共享 perIDStaticNPCImmunity
    let unlocked = false;
    let tick = 0;
    for (let k = 0; k < 12 && !unlocked; k++) {
      pinGameTimeTicks(++tick);                           // 一咬=一拍（GTW 钟=GameUpdateCount 等价）
      unlocked = bite(f2, hooks);
    }
    expect(unlocked).toBe(true);                          // 首咬写 0+10 → 第 10 拍（count=10）解封
  });
  it('533 致命球 local 12 各弹独立（:6008）', () => {
    const e = mkEnemy(12, 60 * 16, 96 * 16);
    const { hooks, player } = makeHooks([e]);
    const a = mk(533, player, e.cx, e.cy);
    const b = mk(533, player, e.cx, e.cy);
    expect(bite(a, hooks)).toBe(true);
    expect(bite(b, hooks)).toBe(true);                    // 另一实例不受阻
    expect(bite(a, hooks)).toBe(false);                   // 本弹私表封阻
  });
  it('387/388 双子 idStatic 16/12 分型互不串桶（:4714/:4730）', () => {
    const e = mkEnemy(13, 60 * 16, 96 * 16);
    const { hooks, player } = makeHooks([e]);
    const twinA = mk(387, player, e.cx, e.cy);
    const twinB = mk(388, player, e.cx, e.cy);
    expect(bite(twinA, hooks)).toBe(true);
    expect(bite(twinB, hooks)).toBe(true);
  });
});

describe('台账批⑤ getChaseResults 真拦截（Utils.cs:651-708）', () => {
  it('静止目标：time=dist/speed、拦截点=目标心、ChaserVelocity=speed 方向向量', () => {
    const r = getChaseResults(0, 0, 32, 64, 0, 0, 0);
    expect(r.intercepts).toBe(true);
    expect(r.time).toBeCloseTo(2, 9);
    expect(r.positionX).toBeCloseTo(64, 9);
    expect(r.vx).toBeCloseTo(32, 9);
    expect(r.vy).toBeCloseTo(0, 9);
  });
  it('横移目标：chaser(0,0)/sp32 runner(100,0)/(0,-16) → t=√(10000/768)', () => {
    const t = Math.sqrt(10000 / 768);
    const r = getChaseResults(0, 0, 32, 100, 0, 0, -16);
    expect(r.intercepts).toBe(true);
    expect(r.time).toBeCloseTo(t, 6);
    expect(r.positionX).toBeCloseTo(100, 6);
    expect(r.positionY).toBeCloseTo(-16 * t, 6);
    expect(r.vy).toBeCloseTo(-16, 6);
  });
  it('零距即中（time=0/v=0）与 solveQuadratic 无实根路径（Utils.cs:721-737）', () => {
    const r = getChaseResults(5, 5, 32, 5, 5, 99, 0);
    expect(r.intercepts).toBe(true);
    expect(r.time).toBe(0);
    expect(solveQuadratic(1, 0, 1)).toBeNull();
    expect(solveQuadratic(1, 0, -4)).toEqual([2, -2]);
  });
});

describe('台账批⑥ WetCollision 盒级湿判（Collision.cs:1575-1650）', () => {
  it('满水格：盒下半浸入即湿;离开液面全干', () => {
    const st = new TileStore(4, 4);
    st.setLiquid(2, 2, 255, 0);
    expect(wetCollisionProbe(st, 26, 34, 16, 16)).toBe(true);
    expect(wetCollisionProbe(st, 26, 0, 16, 16)).toBe(false);
  });
  it('浅水面下沉 (256−液量)/32×2：液量128 → 顶降 8px,浮于线上不湿（旧中心单格恒湿）', () => {
    const st = new TileStore(4, 4);
    st.setLiquid(2, 2, 128, 0);
    const surface = 2 * 16 + 8;
    expect(wetCollisionProbe(st, 26, surface - 18, 16, 16)).toBe(false);
    expect(wetCollisionProbe(st, 26, surface - 8, 16, 16)).toBe(true);
  });
  it('★V1 坡面支 active() 在场门（Collision.cs:1632）：斜坡格在场+上格带液才湿;幽灵斜坡不判湿', () => {
    const st = new TileStore(4, 6);
    st.setTile(1, 3, 1);                        // 泥土格（在场）
    st.setSlope(1, 3, 2);                       // 斜坡（右下坡）
    st.setLiquid(1, 2, 255, 0);                 // 上格满水
    // 探针盒与格 (1,3) 整格相交（Center 24..,probe x∈[21,31]）
    expect(wetCollisionProbe(st, 26, 54, 16, 16)).toBe(true);    // 在场斜坡 + 上格液 → 湿
    st.setTileSilent(1, 3, 0);                  // 幽灵斜坡（type=0 非 active()）
    st.slope[st.idx(1, 3)] = 2;                 // setTileSilent 清坡——手摆回裸 slope 位
    expect(wetCollisionProbe(st, 26, 54, 16, 16)).toBe(false);   // !active() → continue（:1632）
  });
});

describe('台账批⑦⑧ CanHit 四试视线门（Projectile.cs:12415/:12428）', () => {
  it('开阔场全通;封闭腔全堵（canHitWithOwnBodyBox / canHitWithMeleeWeaponBox 性质对）', () => {
    // 行域须在 clampYTile 的 maxTilesY−41 内（Collision.cs:414-416 字面）→ 高 80 库
    const stOpen = new TileStore(64, 80);
    expect(canHit(stOpen, 128, 320, 16, 16, 800, 320, 16, 16)).toBe(true);
    expect(canHitLine(stOpen, 144, 328, 0, 0, 816, 336, 0, 0)).toBe(true);
    expect(canHitWithOwnBodyBox(stOpen, 128, 320, 16, 16, 1, 800, 320, 16, 16)).toBe(true);
    expect(canHitWithMeleeWeaponBox(stOpen, 128, 320, 16, 16, 1, 800, 320, 16, 16)).toBe(true);
    // 封闭腔：目标被四向厚墙包裹（含顶底盖）——盒式与四试三组端点对全败
    const stSeal = new TileStore(64, 80);
    for (let i = 44; i <= 52; i++) for (let j = 30; j <= 38; j++) {
      if (i === 44 || i === 52 || j === 30 || j === 38) stSeal.setTile(i, j, 1);
    }
    const ex = 46 * 16 + 2, ey = 32 * 16 + 2;
    expect(canHit(stSeal, 128, 520, 16, 16, ex, ey, 12, 12)).toBe(false);
    expect(canHitWithOwnBodyBox(stSeal, 128, 520, 16, 16, 1, ex, ey, 12, 12)).toBe(false);
    expect(canHitWithMeleeWeaponBox(stSeal, 128, 520, 16, 16, 1, ex, ey, 12, 12)).toBe(false);
  });
});

describe('台账批 C-3472 光环电弧声循环（AI_137 :69955-69979）', () => {
  it('30t 一轮、场内有敌才一声：61 tick 恰 2 声（旧每直伤 tick 一声密度 ×30）', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const env = makeHooks([]);
    const tower = mk(688, env.player, 61 * 16, 107 * 16 - 27, true);
    tower.fixedUpdate(1, env.hooks);                      // sInit 净空测量出 auraSide/auraCy
    const auraCy = (tower as unknown as { auraCy: number }).auraCy;
    const eIn = mkEnemy(20, tower.cx, auraCy);            // 场心盒重叠 → 声扫描面命中
    env.enemies.push(eIn);
    for (let k = 0; k < 61; k++) tower.fixedUpdate(1, env.hooks);
    const zaps = env.sfx.filter((t) => t.includes('aura_zap')).length;
    expect(zaps).toBe(2);
    rnd.mockRestore();
  });
});

describe('台账批 C-4179 焰流塔环境尘双矩形（AI_130 case 663/665/667 段）', () => {
  it('种子 0.99 全门外零尘;种子 0.1 底盆 270+炮口 6 具现;AddLight 每 tick 双点', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const quiet = makeHooks([]);
    const tQ = mk(663, quiet.player, 61 * 16, 103 * 16, true);
    tQ.fixedUpdate(1, quiet.hooks);
    tQ.fixedUpdate(1, quiet.hooks);
    expect(quiet.dusts.filter((d) => d.id === 270 || d.id === 6).length).toBe(0);
    rnd.mockReturnValue(0.1);
    const flame = makeHooks([]);
    const tF = mk(667, flame.player, 61 * 16, 103 * 16, true);
    tF.fixedUpdate(1, flame.hooks);
    const ids = flame.dusts.map((d) => d.id);
    expect(ids).toContain(270);
    expect(ids).toContain(6);
    expect(flame.lights.length).toBeGreaterThanOrEqual(2);
    vi.restoreAllMocks();
  });
});

describe('台账批 C-920 抚摸心形气泡窗（Main.cs:34799-34832;★IIIII233 忠实化=EmoteBubble 直绘非粒子）', () => {
  it('palJoyCd∈(1,60) 窗内临时爱心情气泡(EmoteBubble.DrawTemporaryBubble(0,60,·));停摸清槽', () => {
    const { hooks, player } = makeHooks([]);
    const cat = mk(1093, player, player.cx, player.cy - 4);
    priv(cat).beingPetted = true;
    (player.petting as unknown as { isPetting: boolean }).isPetting = true;
    cat.fixedUpdate(1, hooks);                            // Joy 触发 → palJoyCd=60
    for (let k = 0; k < 62; k++) cat.fixedUpdate(1, hooks);
    // 原版 Main.cs:34799-34832 = EmoteBubble.DrawTemporaryBubble(0,60,localAI)
    // （emote 0=爱心）——旧 C-920 粒子近似（'#FF7FB2'）已按原版退役
    const snaps = temporaryBubbleSnapshot();
    expect(snaps.length).toBe(1);
    expect(snaps[0].emote).toBe(0);                       // 爱心
    (player.petting as unknown as { isPetting: boolean }).isPetting = false;
    for (let k = 0; k < 10; k++) cat.fixedUpdate(1, hooks);
    expect(temporaryBubbleSnapshot().length).toBe(0);     // 停摸清槽
  });
});
