// ★BJ709-A（2026-10-24,用户实报「星尘之龙（物品 3531,Stardust Dragon Staff）召唤
//  的星尘龙一直在抽搐」定谳+判别锁）。
//
// 定谳（探针 scripts/_bj709a-dragon-twitch-probe.mjs 双臂实测,标杆 1457
// Projectile.cs AI_121_StardustDragon :43612-43877）:
//  · 真凶=嫌疑②段跟随几何:旧 dragonSegment 方向向量符号反（dx=自−父 而
//    pos=父−unit(dx)·16）→ 每拍绕父段【镜像翻转】:探针实测三段 flipRate=1.000、
//    位移幅 32/64/96px 沿链放大、rot 每拍翻 π =「一直抽搐」本体。
//  · 嫌疑①插值渲染:证伪——interp 开/关双臂指标全同（Game.interp 渲染期 lerp
//    prevX↔x 是纯呈现层;抽搐源在 tick 域 AI 位写）。
//  · 嫌疑③帧动画:证伪——vanilla projFrames[625-628]=1（Main.cs :8580 全表缺省,
//    无覆盖行）无帧循环;仓内 draw=MINION_ROT_ONLY 单帧;BJ697 波只动 hitCd tick。
//  修复=AI_121 段支 1:1（:43790-43874）:velocity=Zero（:43857）+ vector4=父心−自心
//  经【父rot−自rot 差 10%】预旋转（:43859-43863 鞭链滞后）+ rotation=vector4.
//  ToRotation()+π/2（:43864）+ 位置=父心−normalize(vector4)×16×scale（:43869-43871,
//  scale=1+min(50,头localAI[0]=段总数)×0.01 :43770-43772/:43866 段沿链继承）。
//
// 登记债（本刀不动,另刀清偿;★2026-10-24 已由 BJ709-G27 全数清偿,判语+判别锁见
//  tests/bj709g27-dragon-debts.test.ts 与 memory/bj709g27-dragon-debts.md）:
//  ①段伤害档逐段各自（dragonLocalAI0 total−k）——原版乘区读 scale（:12877
//    value=(scale−1)×100 clamp 0..50 → ×(1+value·0.23)）而段 scale=继承的【头】值
//    =全链同档;基础龙 626/627/628 现各 ×1.46/1.23/1.0,vanilla 全链 ×1.69。
//  ②命中盒 24×24 静态（:6743-6744 SetDefaults）vs 原版 AI 内逐拍 30×scale
//    （:43773/:43867 width=height=(int)(30×scale)）。
//  ③draw 未吃 proj.scale（Main.cs:34213 主绘 scale 参——长龙应放大,现恒 1）。
//  ④出场淡入缺:SetDefaults alpha=255（:6750）→ AI 每拍 −42（:43775-43788/:43843-43856
//    ≈7t 渐显）;仓内 625-628 alphaFade=0 即显。
//  ⑤头 no-target 支形态偏差（:43728-43761）:原版逐轴 Sign 加速（|Δx|>20/|Δy|>10 门）
//    vs 仓内归一化向量加速;原版阻尼门 speed>2 与 |vy|<1 上浮门独立于 d>100 分支,
//    仓内并进 else 支且上浮无条件。
//  ⑥头 rotation 门 speed>0.5（仓内）vs 原版无条件 velocity.ToRotation()+π/2（:43763）。
//  （延伸链尾段间距 24.7px 观测=插段槽序伪影:尾 628 槽序先于插段 626n/627n 更新,
//   跟随其上拍位——vanilla Main.projectile 槽序同构,:43871 读父当拍位,非债。）
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MinionProj } from '../src/entities/MinionProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

const W = 200, H = 120;
function makeHooks() {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const projectiles: unknown[] = [];
  const hooks: GameHooks = {
    world: { store, flags: { hardMode: false } } as never,
    player: player as never,
    enemies: () => [],
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
  (hooks as unknown as { entities: { add: (e: unknown, b?: string) => void; projectiles: unknown[] } }).entities = {
    add: (e: unknown) => { projectiles.push(e); },
    projectiles,
  };
  return { hooks, store, player, projectiles };
}
/** 头 625 一拍派生基础链（626→627→628,parentRef 链头到尾） */
function makeChain() {
  const fx = makeHooks();
  const head = new MinionProj(fx.player.cx, fx.player.cy - 40, 625, 10, 2, false, 0, false, () => fx.player);
  head.noSlot = false;
  fx.projectiles.push(head);
  head.fixedUpdate(1, fx.hooks);
  const seg = (id: number, nth = 0): MinionProj => fx.projectiles
    .filter((p): p is MinionProj => p instanceof MinionProj && p.projId === id)[nth] as MinionProj;
  return { ...fx, head, s626: seg(626), s627: seg(627), s628: seg(628) };
}
/** 心定位（cx/cy 直写——段几何测试的确定性夹具） */
function place(m: MinionProj, cx: number, cy: number): void {
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;
}
const wrapPi = (a: number): number => {
  let x = a; while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x;
};

describe('BJ709-A 星尘龙段跟随（AI_121 段支 1457 :43790-43874 1:1）', () => {
  // ★G30（2026-10-24）：AI_121 尾世界边界钳（:43875-43876,position 钳 [160,
  //  maxTiles×16−160]）入域后,夹具基点自 (0,0) 迁 (1000,500)（界内,W=200×H=120
  //  → x∈[160,3040]/y∈[160,1760]）——段几何锁全部相对量断言,判别力不变;
  //  旧 (0,0)/负坐标基点=恒出界,钳后位置被拉回 160 即红（夹具自造,非行为回归）。
  const BX = 1000, BY = 500;
  it('镜像锁:对齐态段保持父段后方同侧 16.48px（旧符号反=每拍镜像翻转→抽搐根因）', () => {
    const fx = makeChain();
    // 头心 (BX,BY) 朝右（rot=π/2）;段 626 心 (BX−20,BY)（后方）,rot 对齐 → 无预旋转支
    place(fx.head, BX, BY); fx.head.rot = Math.PI / 2;
    place(fx.s626, BX - 20, BY); fx.s626.rot = Math.PI / 2;
    fx.s626.fixedUpdate(1, fx.hooks);
    // :43871 心 = 父心 − normalize(父−自)×16×scale;基础龙 3 段 → scale=1.03 → 16.48
    expect(fx.s626.cx).toBeCloseTo(BX - 16.48, 6);
    expect(fx.s626.cy).toBeCloseTo(BY, 6);
    expect(fx.s626.cx).toBeLessThan(fx.head.cx);     // 同侧（后方）——旧镜像代码翻到 +16
    expect(wrapPi(fx.s626.rot - Math.PI / 2)).toBeCloseTo(0, 6);   // :43864 朝向=指向父段+π/2
    expect(fx.s626.facing).toBe(1);                  // :43873 spriteDirection = vector4.X>0
  });

  it('旋转平滑 10%:父rot−自rot 差经 WrapAngle×0.1 预旋方向向量（:43859-43863 鞭链滞后）', () => {
    const fx = makeChain();
    place(fx.head, BX, BY); fx.head.rot = Math.PI / 2;
    place(fx.s626, BX - 20, BY); fx.s626.rot = Math.PI / 2 + 1;   // 偏 +1rad
    fx.s626.fixedUpdate(1, fx.hooks);
    // a = WrapAngle(π/2−(π/2+1))×0.1 = −0.1;v4=(20,0) 旋转 −0.1 → (19.90008,−1.99667)
    // （旋转保长 d4=20）→ 新心 = −unit(v4)×16.48 = (−16.39767, +1.64525)（+基点）
    expect(fx.s626.cx).toBeCloseTo(BX - 16.397668, 5);
    expect(fx.s626.cy).toBeCloseTo(BY + 1.645254, 5);
    expect(wrapPi(fx.s626.rot - (Math.PI / 2 - 0.1))).toBeCloseTo(0, 6);  // rot=向量角+π/2
  });

  it('velocity=Zero（:43857）:段残余速度每拍清零（位移全由链位写）', () => {
    const fx = makeChain();
    place(fx.head, BX, BY); fx.head.rot = Math.PI / 2;
    place(fx.s626, BX - 20, BY); fx.s626.rot = Math.PI / 2;
    fx.s626.vx = 5; fx.s626.vy = -3;
    fx.s626.fixedUpdate(1, fx.hooks);
    expect(fx.s626.vx).toBe(0);
    expect(fx.s626.vy).toBe(0);
  });

  it('链泵送:头匀速右移 40 拍——三段零轴承翻转/间距恒 16.48/段位随头速（无 32/64/96px 振荡）', () => {
    const fx = makeChain();
    place(fx.head, BX, BY); fx.head.rot = Math.PI / 2;
    const segs = [fx.s626, fx.s627, fx.s628];
    // 初始精确对齐（等差 −16.48:消夹具自造的首拍收拢瞬态,只测稳态跟随）
    segs.forEach((s, i) => { place(s, BX - 16.48 * (i + 1), BY); s.rot = Math.PI / 2; });
    let flips = 0, maxJump = 0;
    const prev = new Map<MinionProj, [number, number]>();
    for (const s of segs) prev.set(s, [s.cx, s.cy]);
    for (let t = 0; t < 40; t++) {
      fx.head.x += 5;                                // 头右移 5px/拍（探针 S2 头速同量级）
      for (const s of segs) s.fixedUpdate(1, fx.hooks);
      for (const s of segs) {
        const par = s.parentRef!() as MinionProj;
        expect(Math.hypot(s.cx - par.cx, s.cy - par.cy)).toBeCloseTo(16.48, 5);
        expect(s.cx).toBeLessThan(fx.head.cx);       // 段恒在头后方（拖尾）
        const [px, py] = prev.get(s)!;
        const jump = Math.hypot(s.cx - px, s.cy - py);
        maxJump = Math.max(maxJump, jump);
        const [rx0, ry0] = [px - par.cx, py - par.cy];   // 上拍轴承（近似:父亦动,同拍差分）
        if (rx0 * (s.cx - par.cx) + ry0 * (s.cy - par.cy) < 0) flips++;
        prev.set(s, [s.cx, s.cy]);
      }
    }
    expect(flips).toBe(0);                           // 零翻转（旧代码=每拍翻转,40 拍 40 次）
    expect(maxJump).toBeLessThan(6);                 // 段跳变≤头速+回弹（旧代码 32-96px）
  });

  it('延伸龙间距:再召唤插 2 段（tier 3→5）→ 对齐态间距 16×1.05=16.8（:43866/:43871 ×scale）', () => {
    const fx = makeChain();
    expect(fx.head.extendDragon(fx.hooks)).toBe(true);
    const tail = fx.projectiles.find((p): p is MinionProj => p instanceof MinionProj && p.projId === 628) as MinionProj;
    const par = tail.parentRef!() as MinionProj;     // 延伸段 b（新 627）
    place(fx.head, BX, BY); fx.head.rot = Math.PI / 2;
    place(par, BX - 20, BY); par.rot = Math.PI / 2;
    place(tail, BX - 40, BY); tail.rot = Math.PI / 2;
    tail.fixedUpdate(1, fx.hooks);
    expect(Math.hypot(tail.cx - par.cx, tail.cy - par.cy)).toBeCloseTo(16.8, 6);   // 16×(1+5×0.01)
  });

  it('结构锁:dragonSegment 判据表达式在位（防静默回退到镜像式）', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/entities/MinionProj.ts', import.meta.url)), 'utf8');
    // 修复式:父心 − normalize(vector4)×16×(1+tier×0.01)（:43871 ×scale 间距）
    expect(src).toContain('this.x = par.cx - (v4x / d4) * 16 * (1 + tier * 0.01) - this.w / 2;');
    expect(src).toContain('this.y = par.cy - (v4y / d4) * 16 * (1 + tier * 0.01) - this.h / 2;');
    // 旋转平滑 10% 因子在位（:43861 num20*0.1）
    expect(src).toContain('wrapAngle(par.rot - this.rot) * 0.1');
    // 旧镜像式（dx=自−父 + 父−unit(dx)）不得回潮
    expect(src).not.toContain('par.cx - (dx / d) * 16');
  });
});
