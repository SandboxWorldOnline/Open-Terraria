// ★BJ709-G30（2026-10-24,G27 新登记债⑦⑧⑨三件清偿判别锁）
// 标杆 = Terarria1457 AI_121_StardustDragon（Projectile.cs:43612-43877）+
// AI_138_ExplosiveTrap 携行支（:70393-70407 → AI_Sentries_HeavySlingReposition
// :70257-70354）+ DrawProjDirect 陷阱塔支（Main.cs:34087-34096/:34212/:34507-34519）。
//
// 逐件定谳（判语全文见 memory/bj709g30-dragon-residuals.md）:
//  ⑦龙族环境微尘【修】:AI_121 flag 块（625-628 全族）每拍 1/30 掷 →
//    Dust.NewDust(position,width,height,135,0,0,α=0,scale=2)+noGravity+fadeIn=2;
//    尘出生格实心（InWorld fluff5 ∧ SolidTile）→ noLight。尘盒=AI 入口盒
//    （上一拍 resize/位移前值;625 首拍=构造 24×24）。与 G27④ 淡入尘（α=100）
//    同 type 135 双源并存——sw-fx6/g27 锁按 α 签名分流。
//  ⑧691-693 陷阱塔携行 drawScale 未消费【修】:vanilla B 支主绘 :34212 与辉光
//    :34519 均吃 proj.scale——携行+变身坐骑 54/55/56/61 半尺（heavySlingReposition
//    :8622/:8633/:8654/:8665 写 0.5）。draw 支补 ctx.scale（body 两路+glow 捕获
//    矩阵,1025 先例）;缺省 1 零变化无 id 门（G27 判例）。
//    ★sw-fx6 六存量红定谳=非本债面:R15-F2（2026-10-11）辉光叠画第二 translate
//    击破 2026-09-10 陈旧单笔期望——本批随刀更新为双笔（本体+辉光同锚）转绿。
//  ⑨世界边界钳【修】:AI_121 函数尾无条件 position 钳 [160, maxTiles×16−160]
//    （头/段共用）。vanilla 时序=AI 内尾先于 UpdatePosition 积分 → 头支「钳后
//    仍可越界 ≤|velocity|,次拍钳回」;段支 velocity=Zero 纯终态钳。
//  【邻位发现·新登记债】陷阱塔携行 rotation 未消费:vanilla :34212 传
//    proj.rotation（heavySlingReposition 携行写 ±π/2 :8596）,本仓 draw 支零
//    rotate 调用——携行塔恒直立渲染（应侧转 90°）。另刀清偿,本刀不扩面。
//
// ★变异恰红（三变异逐一验证,每变异只红对应件）:
//  M⑦摘环境微尘块 → §1 全红;M⑧摘 drawScale 消费（三处任一）→ §2 对应红;
//  M⑨摘 dragonClampWorld 调用（头/段任一）→ §3 对应红。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MinionProj } from '../src/entities/MinionProj';
import { setProjSpriteOverride } from '../src/entities/Arrow';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

const src = readFileSync(fileURLToPath(new URL('../src/entities/MinionProj.ts', import.meta.url)), 'utf8');
const SRC_SEG = src.slice(src.indexOf('private dragonSegment('), src.indexOf('private abigailCounterOriginalDamage('));
const SRC_HEAD = src.slice(src.indexOf('private dragonHead('), src.indexOf('lockAfterFoxChannel('));
const SRC_DISPATCH = src.slice(src.indexOf('---- 旗舰家族分发'), src.indexOf('if (this.projId === 831 || this.projId === 970)'));
const SRC_TRAP = src.slice(src.indexOf('if (this.sentry && TRAP_TOWER.has(this.projId) && img)'),
  src.indexOf('if ((this.projId === 308 || this.projId === 377))'));

const priv = (o: object): Record<string, any> => o as unknown as Record<string, any>;

// document 垫片（bj582 判例:draw 链 projFrameImg 帧切片走 document.createElement）
class FakeCanvas {
  width = 0; height = 0;
  getContext() { return { drawImage() {}, imageSmoothingEnabled: false }; }
}
(globalThis as unknown as { document?: unknown }).document = {
  createElement: (): FakeCanvas => new FakeCanvas(),
};

// ---- 夹具（bj709g27 同款 + 环境微尘记录仪:返回尘带 x/y 供 noLight 判定）----
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number) => boolean;
}
function mkEnemy(id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy, hp: 100000,
    hurt: (d: number) => { e.hp -= d; return true; },
  };
  return e;
}
interface DustRec {
  type: number; alpha: number; scale: number; noGravity: boolean;
  noLight: boolean; fadeIn: number; x: number; y: number;
  boxArgs: [number, number, number, number];
}
function makeHooks(enemies: MockEnemy[] = []) {
  const store = new TileStore(200, 120);
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) store.setTile(x, y, 1);
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const projectiles: unknown[] = [];
  const dusts: DustRec[] = [];
  const hooks: GameHooks = {
    world: { store, flags: { hardMode: false } } as never,
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
  (hooks as unknown as { spawnDust?: unknown }).spawnDust = (
    x: number, y: number, w: number, h: number, type: number,
    _sx?: number, _sy?: number, alpha?: number, _color?: unknown, scale?: number, noGravity?: boolean,
  ) => {
    // 尘位=盒心（NewDust 盒内随机位的确定性替身——noLight 判定走真实落格）
    const d: DustRec = {
      type, alpha: alpha ?? 0, scale: scale ?? 1, noGravity: !!noGravity,
      noLight: false, fadeIn: 0, x: x + w / 2, y: y + h / 2, boxArgs: [x, y, w, h],
    };
    dusts.push(d);
    return d;
  };
  (hooks as unknown as { entities: { add: (e: unknown, b?: string) => void; projectiles: unknown[] } }).entities = {
    add: (e: unknown) => { projectiles.push(e); },
    projectiles,
  };
  return { hooks, player, projectiles, enemies, dusts };
}
function place(m: MinionProj, cx: number, cy: number): void {
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;
}
/** Math.random 桩（掷流确定性:0 → 1/30 恒中;0.999 → 恒不中） */
function withRandom(v: number, fn: () => void): void {
  const orig = Math.random;
  Math.random = () => v;
  try { fn(); } finally { Math.random = orig; }
}
/** 头 625 一拍派生基础链 */
function makeChain(enemies: MockEnemy[] = []) {
  const fx = makeHooks(enemies);
  const head = new MinionProj(fx.player.cx, fx.player.cy - 40, 625, 10, 2, false, 0, false, () => fx.player);
  fx.projectiles.push(head);
  head.fixedUpdate(1, fx.hooks);
  const seg = (id: number): MinionProj => fx.projectiles
    .filter((p): p is MinionProj => p instanceof MinionProj && p.projId === id)[0] as MinionProj;
  return { ...fx, head, s626: seg(626), s627: seg(627), s628: seg(628) };
}
/** 记录型 draw 桩（sw-fx6 同款 + getTransform 序记录:glow 矩阵捕获位） */
function makeDrawRig(withGlowSink = false) {
  const translates: number[][] = [];
  const rots: number[] = [];
  const scales: number[][] = [];
  const draws: Array<{ img: unknown; d: unknown[] }> = [];
  const seq: string[] = [];
  const ctx = {
    save() { seq.push('save'); }, restore() { seq.push('restore'); },
    translate(x: number, y: number) { seq.push('translate'); translates.push([x, y]); },
    rotate(a: number) { seq.push('rotate'); rots.push(a); },
    scale(x: number, y: number) { seq.push('scale'); scales.push([x, y]); },
    getTransform() { seq.push('getTransform'); return { __m: 1 }; },
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    drawImage(...a: unknown[]) { seq.push('drawImage'); draws.push({ img: a[0], d: a }); },
  } as unknown as CanvasRenderingContext2D;
  const glowOps: Array<Record<string, unknown>> = [];
  const r: Record<string, unknown> = { ctx };
  if (withGlowSink) r.pushGlowOps = (ops: Array<Record<string, unknown>>) => { glowOps.push(...ops); };
  return { r: r as never, translates, rots, scales, draws, seq, glowOps };
}

// =====================================================================
// §1 ⑦ 龙族环境微尘（Projectile.cs:43638-43648,flag 块 625-628 全族）
// =====================================================================
describe('BJ709-G30 §1 环境微尘:1/30 掷 dust135（α=0/scale=2/noGravity/fadeIn=2/实心格 noLight）', () => {
  it('掷中:尘参数逐位（type135/α=0/scale=2/noGravity=true——G27④ 淡入尘 α=100 双源分流）+ fadeIn=2 后置写', () => {
    const fx = makeHooks();
    const head = new MinionProj(948, 1400, 625, 10, 2, false, 0, false, () => fx.player);
    fx.projectiles.push(head);
    withRandom(0, () => head.fixedUpdate(1, fx.hooks));   // Next(30)==0 恒中
    const amb = fx.dusts.filter((d) => d.alpha === 0);
    expect(amb.length).toBe(1);
    expect(amb[0].type).toBe(135);
    expect(amb[0].scale).toBe(2);
    expect(amb[0].noGravity).toBe(true);
    expect(amb[0].fadeIn).toBe(2);                        // :43642 后置写
    expect(amb[0].boxArgs).toEqual([948, 1400, 24, 24]);  // 尘盒=AI 入口盒（首拍=构造 24×24,非 resize 30）
    expect(amb[0].noLight).toBe(false);                   // 出生格（60,88）= 空气（实心行 100+）
  });

  it('实心格 → noLight=true（InWorld fluff5 ∧ SolidTile :43644-43646）', () => {
    const fx = makeHooks();
    const head = new MinionProj(948, 1600, 625, 10, 2, false, 0, false, () => fx.player);
    fx.projectiles.push(head);
    withRandom(0, () => head.fixedUpdate(1, fx.hooks));
    const amb = fx.dusts.filter((d) => d.alpha === 0);
    expect(amb.length).toBe(1);
    expect(amb[0].noLight).toBe(true);                    // 尘位（960,1612）→ 格（60,100）实心
  });

  it('fluff 5 边际:出生格 tx=1 <5 → InWorld 拒 → 实心格也不 noLight', () => {
    const fx = makeHooks();
    const head = new MinionProj(16, 1600, 625, 10, 2, false, 0, false, () => fx.player);
    fx.projectiles.push(head);
    withRandom(0, () => head.fixedUpdate(1, fx.hooks));
    const amb = fx.dusts.filter((d) => d.alpha === 0);
    expect(amb.length).toBe(1);
    expect(amb[0].x).toBeLessThan(5 * 16);                // 尘位确实在 fluff 圈内
    expect(amb[0].noLight).toBe(false);                   // InWorld(1,100,5)=false 短路（SolidTile 不达）
  });

  it('掷空:Next(30)!=0 → 零环境尘（淡入尘另源不受扰）', () => {
    const fx = makeHooks();
    const head = new MinionProj(948, 1400, 625, 10, 2, false, 0, false, () => fx.player);
    fx.projectiles.push(head);
    withRandom(0.999, () => head.fixedUpdate(1, fx.hooks));
    expect(fx.dusts.filter((d) => d.alpha === 0).length).toBe(0);
    expect(fx.dusts.filter((d) => d.alpha === 100).length).toBe(2);   // G27④ 淡入尘照常
  });

  it('全族四段每拍掷:头+三段各一拍 → 环境尘 4 笔（flag 块=625-628 全族,:43625）', () => {
    const fx = makeChain();
    withRandom(0, () => {
      for (const m of [fx.head, fx.s626, fx.s627, fx.s628]) m.fixedUpdate(1, fx.hooks);
    });
    expect(fx.dusts.filter((d) => d.alpha === 0).length).toBe(4);
  });

  it('结构锁:分发位掷式/fadeIn/noLight 判定式在位', () => {
    expect(SRC_DISPATCH).toContain('if (this.projId >= 625 && this.projId <= 628 && Math.floor(Math.random() * 30) === 0) {');
    expect(SRC_DISPATCH).toContain('dA.fadeIn = 2;');
    expect(SRC_DISPATCH).toContain('txA >= 5 && txA < stA.w - 5 && tyA >= 5 && tyA < stA.h - 5');
    expect(SRC_DISPATCH).toContain('solidTileAt(stA, txA, tyA)) dA.noLight = true');
  });
});

// =====================================================================
// §2 ⑧ 陷阱塔携行 drawScale（Main.cs:34212/:34519 吃 proj.scale）
// =====================================================================
describe('BJ709-G30 §2 陷阱塔携行半尺:AI_138 写 0.5 → draw 消费（body+glow）', () => {
  /** 携行 691 + 变身坐骑 55（Rat）——heavySlingReposition 写面直调（bj518⑥ 同式） */
  function mkCarriedTrap(mountType: number) {
    const fx = makeHooks();
    priv(fx.player)._equipStatsCache = { ...fx.player.equipStats, accSentryBackpack: true } as never;
    fx.player.mount.active = true;
    fx.player.mount.type = mountType;
    fx.player.mount.frame = 0;
    const m = new MinionProj(40 * 16, 90 * 16, 691, 30, 0, true, 0, false, () => fx.player);
    m.carriedByBackpack = true;
    priv(m).heavySlingReposition(fx.player);
    return { m, fx };
  }

  it('写面:携行+Rat 55 → drawScale=0.5（:70278-70281 flag5 支,写侧原在案本锁补 691 面）', () => {
    const { m } = mkCarriedTrap(55);
    expect(m.drawScale).toBe(0.5);
    expect(m.rot).toBe(0);                                // flag 支 rot=0（:70241-70244）
  });

  it('消费面:drawScale=0.5 → body scale(0.5,0.5) + glow 捕获矩阵含 scale（两笔同参）', () => {
    setProjSpriteOverride(691, { width: 26, height: 56 } as unknown as HTMLImageElement);
    const { m } = mkCarriedTrap(55);
    const rig = makeDrawRig(true);
    m.draw(rig.r);
    // 携行=B 支缺省盒心锚 ×2（本体+辉光捕获,R15-F2 辉光同锚）
    expect(rig.translates).toEqual([[m.cx, m.cy], [m.cx, m.cy]]);
    expect(rig.scales, 'body+glow 两笔 0.5（:34212/:34519 双消费）').toEqual([[0.5, 0.5], [0.5, 0.5]]);
    expect(rig.draws.length).toBe(1);                     // 本体一笔直绘
    expect(rig.glowOps.length).toBe(1);                   // 辉光 op（Glow_235）
    // 辉光 scale 先于矩阵捕获（getTransform 后于 translate+scale = 矩阵含缩放）
    expect(rig.seq.lastIndexOf('scale')).toBeGreaterThan(rig.seq.indexOf('translate'));
    expect(rig.seq.lastIndexOf('scale')).toBeLessThan(rig.seq.indexOf('getTransform'));
  });

  it('非携行半尺同消费:drawScale=0.5 手置 → Bottom 锚支 scale 在 translate 后（:34212 无 ai[2] 门）', () => {
    setProjSpriteOverride(691, { width: 26, height: 56 } as unknown as HTMLImageElement);
    const fx = makeHooks();
    const m = new MinionProj(40 * 16, 90 * 16, 691, 30, 0, true, 0, false, () => fx.player);
    priv(m).drawScale = 0.5;
    const rig = makeDrawRig();
    m.draw(rig.r);
    expect(rig.translates).toEqual([[m.cx, m.y + m.h], [m.cx, m.y + m.h]]);
    expect(rig.scales).toEqual([[0.5, 0.5], [0.5, 0.5]]); // Bottom 支 body+glow
    expect(rig.draws[0].d.slice(1, 3)).toEqual([-13, -10]);   // origin=(26/2,14−4)
  });

  it('缺省零变化:drawScale=1（放置态/非变身坐骑携行）→ 零 scale 调用（无 id 门,G27 判例）', () => {
    setProjSpriteOverride(691, { width: 26, height: 56 } as unknown as HTMLImageElement);
    const fx = makeHooks();
    const m = new MinionProj(40 * 16, 90 * 16, 691, 30, 0, true, 0, false, () => fx.player);
    const rig = makeDrawRig();
    m.draw(rig.r);                                        // 放置态:drawScale=1
    expect(rig.scales).toEqual([]);
    const rig2 = makeDrawRig();
    m.draw(rig2.r);
    expect(rig2.scales).toEqual([]);
  });

  it('结构锁:陷阱塔支三处 drawScale 消费在位（body 两路+glow 矩阵捕获前）', () => {
    expect(SRC_TRAP).toContain('if (!this.carriedByBackpack) {');
    const bodyPaths = SRC_TRAP.split('if (this.drawScale !== 1) ctx.scale(this.drawScale, this.drawScale);').length - 1;
    expect(bodyPaths).toBe(3);                            // 非携行 body/携行 body/glow
    const iGlowTranslate = SRC_TRAP.lastIndexOf('ctx.translate(this.cx, this.carriedByBackpack ? this.cy : this.y + this.h);');
    const iGlowScale = SRC_TRAP.lastIndexOf('if (this.drawScale !== 1)');
    expect(iGlowScale).toBeGreaterThan(iGlowTranslate);   // scale 后于锚 translate
  });
});

// =====================================================================
// §3 ⑨ 世界边界钳（Projectile.cs:43875-43876,AI 尾头/段共用）
// =====================================================================
describe('BJ709-G30 §3 世界边界钳:position 钳 [160, maxTiles×16−160]（头=钳后积分/段=终态钳）', () => {
  // 夹具世界 200×120 → x∈[160,3040]/y∈[160,1760];玩家 (960,1440)
  it('头左界:越界 x=100 → 钳 160 后积分 +0.2 → 160.2（钳先于运动=vanilla AI 尾先于 UpdatePosition;钳后运动则恒 160）', () => {
    const fx = makeChain();
    place(fx.head, 115, 500);                     // x=100 <160
    fx.head.vx = 0; fx.head.vy = 0;
    fx.head.fixedUpdate(1, fx.hooks);             // no-target:dx=+845 → vx=+0.2（朝玩家）
    expect(fx.head.x).toBeCloseTo(160.2, 9);      // 钳 160 → += 0.2
    expect(fx.head.x).toBeGreaterThan(160);       // ★相序判别:钳在运动前
  });

  it('头右界:x=3085 >3040 → 钳 3040 后积分 −0.2 → 3039.8（玩家右移近界防 >2000 瞬移门抢跑）', () => {
    const fx = makeChain();
    fx.player.x = 2800 - fx.player.w / 2;         // 玩家心 (2800,1440):dist(3100,500)≈987 <2000
    fx.player.y = 1440 - fx.player.h / 2;
    place(fx.head, 3100, 500);                    // x=3085 >3040
    fx.head.vx = 0; fx.head.vy = 0;
    fx.head.fixedUpdate(1, fx.hooks);             // dx=−300 → vx=−0.2
    expect(fx.head.x).toBeCloseTo(3039.8, 9);
    expect(fx.head.x).toBeLessThanOrEqual(3040);
  });

  it('头上界:y=85 <160 → 钳 160 后积分 +0.1 → 160.1;下界 y=1785 → 钳 1760 → 1759.7', () => {
    const fx = makeChain();
    place(fx.head, 960, 100);                     // y=85 <160（|dx|=0 ≤20 → 无 X 加速）
    fx.head.vx = 0; fx.head.vy = 0;
    fx.head.fixedUpdate(1, fx.hooks);             // dy=+1340 → vy=+0.2−0.1（上浮门）=+0.1
    expect(fx.head.y).toBeCloseTo(160.1, 9);
    const fx2 = makeChain();
    place(fx2.head, 960, 1800);                   // y=1785 >1760
    fx2.head.vx = 0; fx2.head.vy = 0;
    fx2.head.fixedUpdate(1, fx2.hooks);           // dy=−360 → vy=−0.2−0.1=−0.3
    expect(fx2.head.y).toBeCloseTo(1759.7, 9);
    expect(fx2.head.y).toBeLessThanOrEqual(1760);
  });

  it('段支:写位越界 → 终态钳恰 160/3040/1760（velocity=Zero 无积分,精确边界值）', () => {
    const fx = makeChain();
    place(fx.head, 115, 500); fx.head.rot = Math.PI / 2;
    place(fx.s626, 65, 500); fx.s626.rot = Math.PI / 2;
    fx.s626.fixedUpdate(1, fx.hooks);             // 写位 x=115−16.48−15=83.52 → 钳 160
    expect(fx.s626.x).toBe(160);
    const fx2 = makeChain();
    place(fx2.head, 3065, 500); fx2.head.rot = Math.PI / 2;
    place(fx2.s626, 3115, 500); fx2.s626.rot = Math.PI / 2;
    fx2.s626.fixedUpdate(1, fx2.hooks);           // 写位 x=3065+16.48−15=3066.48 → 钳 3040
    expect(fx2.s626.x).toBe(3040);
    const fx3 = makeChain();
    place(fx3.head, 960, 1790); fx3.head.rot = Math.PI / 2;
    place(fx3.s626, 960, 1840); fx3.s626.rot = Math.PI / 2;
    fx3.s626.fixedUpdate(1, fx3.hooks);           // 写位 y=1790+16.48−15=1791.48 → 钳 1760
    expect(fx3.s626.y).toBe(1760);
  });

  it('界内零扰动:中位头钳同值透传（cx=2000−0.2=1999.8,无钳拉）', () => {
    const fx = makeChain();
    place(fx.head, 2000, 700);
    fx.head.vx = 0; fx.head.vy = 0;
    fx.head.fixedUpdate(1, fx.hooks);             // dx=−1040 → vx=−0.2（朝玩家）,界内无钳
    expect(fx.head.cx).toBeCloseTo(1999.8, 9);    // 仅运动位移,钳零贡献
  });

  it('结构锁:dragonClampWorld 在位;头=淡入块后/运动前,段=写位后/contact 前（:43875 两支汇流尾）', () => {
    expect(src).toContain('private dragonClampWorld(game: GameHooks): void');
    expect(src).toContain('const mx = st.w * 16 - 160, my = st.h * 16 - 160;');
    const iFade = SRC_HEAD.indexOf('this.alphaFade = Math.max(0, this.alphaFade - 42);');
    const iClampH = SRC_HEAD.indexOf('this.dragonClampWorld(game);');
    const iMove = SRC_HEAD.indexOf('this.x += this.vx;');
    expect(iClampH).toBeGreaterThan(iFade);
    expect(iMove).toBeGreaterThan(iClampH);
    const iWrite = SRC_SEG.indexOf('this.x = par.cx - (v4x / d4) * 16 * (1 + tier * 0.01) - this.w / 2;');
    const iClampS = SRC_SEG.indexOf('this.dragonClampWorld(game);');
    const iContact = SRC_SEG.indexOf('this.contact(game, dmg0 * (1 + 0.23 * tier), 7);');
    expect(iClampS).toBeGreaterThan(iWrite);
    expect(iContact).toBeGreaterThan(iClampS);
  });
});
