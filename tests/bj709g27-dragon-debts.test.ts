// ★BJ709-G27（2026-10-24,BJ709-A 登记债①-⑥逐件清偿判别锁）
// 标杆 = Terarria1457 AI_121_StardustDragon（Projectile.cs:43612-43877）+ 伤害乘区
// （:12873-12879）+ 主绘（Main.cs:33693 支通用尾 :34212 / A 支半 α :34180-34183）。
//
// 逐件定谳（六件全 CONFIRMED,修=1:1;判语见 memory/bj709g27-dragon-debts.md）:
//  ①段伤害档:原版乘区读【scale】（:12876 value=clamp((scale−1)×100,0,50) →
//    ×(1+value·0.23)）而段 scale=逐拍继承父值（:43866 num18=clamp(父scale,0,50)）
//    =全链同档——基础龙 3 段头/626/627/628 全 ×1.69;旧仓 dragonLocalAI0(total−k)
//    逐段各自 ×1.46/1.23/1.0 = 把「value=(scale−1)×100」误读为逐段 localAI[0]
//    （头 localAI[0]=段总数,段=距头步数——状态镜像本身正确,作伤害源才错;
//    dragonLocalAI0 保留为状态镜像,weapon-summon-fix §248 锁其逐段值）。
//  ②命中盒:原版逐拍 width=height=(int)(30×scale)（头 :43773/段 :43867,num2=30
//    :43637;SetDefaults 24×24 :6741-6742 仅出生首拍前值）,中心保持 resize
//    （:43771-43774/:43865-43868 position=Center→resize→Center=position）。
//    基础龙 30×30、延伸 5 段 31×31;>2000 瞬移 Center 写位用当前盒半宽（旧 −12
//    硬编码=24 盒时代残值）。
//  ③draw 未吃 proj.scale:33693 支通用尾 EntitySpriteDraw(...,proj.scale,dir)
//    （Main.cs:34212）——长龙绘制应放大（基础龙 1.03）;同支 625-628 无条件
//    color106.A/=2（:34180-34183,半透明灵体观感;BJ709-A 未登记,定谳时邻位
//    发现,同 draw 块并入本刀）。proj.scale 镜像=drawScale（1025 先例）。
//  ④出场淡入:SetDefaults alpha=255（:6750）→ AI −42/拍（头 :43775-43788 门内/
//    段 :43843-43856 无条件=0 后 no-op,观测等价,≈7t）+ 淡入期 2×dust135/拍
//    （α=100/scale=2/noGravity/noLight）。伤害无 α 门（Damage_CanDealDamage
//    :12461-12510 亲读无 625-628 α 条件）=淡入期照常接触伤。
//  ⑤头 no-target 支:原版【逐轴 Sign】加速+轴门（|Δx|>20 加 X/|Δy|>10 加 Y,
//    :43740-43747,num11=0.2/0.12(<200)/0.06(<140)）+ 阻尼 else-if【speed>2 门】
//    （:43749-43752）+ 上浮【|vy|<1 独立门】（:43753-43756）+ 限速 15 支尾
//    【无条件】（:43757-43761）;旧仓=归一化向量加速/阻尼无条件挂近距/上浮只挂
//    近距/限速只挂 d>100。
//  ⑥头 rotation 门:原版无条件 rotation=velocity.ToRotation()+π/2（:43763）;
//    同块 direction/spriteDirection=velocity.X>0?1:−1 逐拍覆写（:43764-43765,
//    零消费者簿记——旧「有目标读目标向」一并归位）。
//
// ★变异恰红（六变异逐一验证,每变异只红对应件）:
//  M①段伤害回 dragonLocalAI0 → §1 三段 17→15/12/10 红;M②摘 resize → §2 红;
//  M③摘 drawScale 消费/A÷2 → §3 红;M④alphaFade 初始化 0 → §4 红;
//  M⑤no-target 回归一化旧式 → §5 红;M⑥rotation 回 speed>0.5 门 → §6 红。
import { describe, it, expect, vi } from 'vitest';
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

// ---- 夹具（weapon-summon-fix 判例:MockEnemy 走通 contact→resolveWhipTagHit 全链）----
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number;
  hurtFx?: (d: number) => void;
  hurt: (d: number, kx: number, ky: number, g: GameHooks, pen?: number) => boolean;
}
function mkEnemy(id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy, hp: 100000,
    hurt: (d: number) => { e.hp -= d; return true; },
  };
  return e;
}
interface DustRec { type: number; alpha: number; scale: number; noGravity: boolean; noLight: boolean }
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
    _x: number, _y: number, _w: number, _h: number, type: number,
    _sx?: number, _sy?: number, alpha?: number, _color?: unknown, scale?: number, noGravity?: boolean,
  ) => {
    const d: DustRec = { type, alpha: alpha ?? 0, scale: scale ?? 1, noGravity: !!noGravity, noLight: false };
    dusts.push(d);
    return d;   // 调用侧后置写 noLight（NewDust 后置覆写判例）
  };
  (hooks as unknown as { entities: { add: (e: unknown, b?: string) => void; projectiles: unknown[] } }).entities = {
    add: (e: unknown) => { projectiles.push(e); },
    projectiles,
  };
  return { hooks, player, projectiles, enemies, dusts };
}
/** 心定位（bj709a 判例） */
function place(m: MinionProj, cx: number, cy: number): void {
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;
}
function placeEnemy(e: MockEnemy, cx: number, cy: number): void {
  e.cx = cx; e.cy = cy; e.x = cx - e.w / 2; e.y = cy - e.h / 2;
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
/** 记录型 draw 桩（bj582 判例:document 垫片 + 记录 ctx;切片 ctx 不入记录） */
function makeDrawRig() {
  const scaleCalls: number[][] = [];
  const alphas: number[] = [];
  const draws: Array<{ img: unknown; d: unknown[] }> = [];
  const mkCtx = (record: boolean) => ({
    save: () => {}, restore: () => {},
    translate: () => {}, rotate: () => {},
    scale: (x: number, y: number) => { if (record) scaleCalls.push([x, y]); },
    imageSmoothingEnabled: false,
    globalAlpha: 1,
    drawImage: (...a: unknown[]) => { if (record) draws.push({ img: a[0], d: a }); },
  }) as unknown as CanvasRenderingContext2D;
  const mainCtx = mkCtx(true);
  Object.defineProperty(mainCtx, 'globalAlpha', {
    set(v: number) { (this as { _a?: number })._a = v; alphas.push(v); },
    get() { return (this as { _a?: number })._a ?? 1; },
  });
  (globalThis as unknown as { document?: unknown }).document = {
    createElement: () => {
      const c: { width: number; height: number; getContext: () => CanvasRenderingContext2D } = {
        width: 0, height: 0, getContext: () => mkCtx(false),
      };
      return c;
    },
  };
  return {
    scaleCalls, alphas, draws,
    r: { ctx: mainCtx, atlas: { ensureVImage: () => null } } as never,
  };
}

describe('BJ709-G27 §1 段伤害档:全链同档（:12873-12879 读 scale=继承头值）', () => {
  it('基础龙 3 段:头/626/627/628 各对独立靶均 Math.round(10×1.69)=17（旧 17/15/12/10 逐段各自）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（contact 面首掷 ×1.0）
    const eH = mkEnemy(11, 0, 0), eA = mkEnemy(12, 0, 0), eB = mkEnemy(13, 0, 0), eC = mkEnemy(14, 0, 0);
    const fx = makeChain([eH, eA, eB, eC]);
    // 链摆到玩家 1000+ 外（wild 索敌 num5=距玩家<1000 门拒 → 头 no-target 零追逐,确定性）
    const X0 = fx.player.cx + 1050, Y0 = fx.player.cy;
    place(fx.head, X0, Y0); fx.head.rot = Math.PI / 2;
    place(fx.s626, X0 - 16.48, Y0); fx.s626.rot = Math.PI / 2;
    place(fx.s627, X0 - 32.96, Y0); fx.s627.rot = Math.PI / 2;
    place(fx.s628, X0 - 49.44, Y0); fx.s628.rot = Math.PI / 2;
    placeEnemy(eH, fx.head.cx, fx.head.cy);
    placeEnemy(eA, fx.s626.cx, fx.s626.cy);
    placeEnemy(eB, fx.s627.cx, fx.s627.cy);
    placeEnemy(eC, fx.s628.cx, fx.s628.cy);
    for (const m of [fx.head, fx.s626, fx.s627, fx.s628]) m.fixedUpdate(1, fx.hooks);
    expect(eH.hp).toBe(100000 - 17);            // 1+0.23×3=1.69 → round(16.9)
    expect(eA.hp).toBe(100000 - 17);            // 旧 dragonLocalAI0(626)=2 → 15
    expect(eB.hp).toBe(100000 - 17);            // 旧 1 → 12
    expect(eC.hp).toBe(100000 - 17);            // 旧 0 → 10
  });
  it('延伸龙 5 段全链 ×(1+0.23×5)=2.15（tier=5 同档,旧尾段 628 仍 ×1.0）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    const e = mkEnemy(21, 0, 0);
    const fx = makeChain([e]);
    expect(fx.head.extendDragon(fx.hooks)).toBe(true);
    // 链序 head←s626←s627←a(626n)←b(627n)←s628;全链对齐摆到玩家 1000+ 外（no-target）
    const b = fx.s628.parentRef!() as MinionProj;
    const a = b.parentRef!() as MinionProj;
    const X0 = fx.player.cx + 1050, Y0 = fx.player.cy;
    place(fx.head, X0, Y0); fx.head.rot = Math.PI / 2;
    place(fx.s626, X0 - 16.8, Y0); fx.s626.rot = Math.PI / 2;
    place(fx.s627, X0 - 33.6, Y0); fx.s627.rot = Math.PI / 2;
    place(a, X0 - 50.4, Y0); a.rot = Math.PI / 2;
    place(b, X0 - 67.2, Y0); b.rot = Math.PI / 2;
    place(fx.s628, X0 - 84, Y0); fx.s628.rot = Math.PI / 2;
    placeEnemy(e, fx.s628.cx, fx.s628.cy);
    fx.head.fixedUpdate(1, fx.hooks);
    fx.s628.fixedUpdate(1, fx.hooks);           // 尾段就位（对齐态零位移）→ 接触
    expect(e.hp).toBe(100000 - Math.round(10 * 2.15));   // 22（旧 628 段 total−k=0 → 10）
  });
  it('结构锁:段伤害源=tier（dragonLocalAI0 不再作伤害源）', () => {
    expect(SRC_SEG).toContain('this.contact(game, dmg0 * (1 + 0.23 * tier), 7);');
    expect(SRC_SEG).not.toContain('dragonLocalAI0(game)), 7');
  });
});

describe('BJ709-G27 §2 命中盒:逐拍 (int)(30×scale) 中心保持（:43773/:43865-43868）', () => {
  it('基础龙 tier3 → 头/段 30×30（SetDefaults 24 仅出生值）;延伸 tier5 → 31', () => {
    const fx = makeChain();
    expect(fx.head.w).toBe(30);                 // (int)(30×1.03)=30（旧恒 24）
    expect(fx.head.h).toBe(30);
    place(fx.head, 0, 0); fx.head.rot = Math.PI / 2;
    place(fx.s626, -20, 0); fx.s626.rot = Math.PI / 2;
    fx.s626.fixedUpdate(1, fx.hooks);
    expect(fx.s626.w).toBe(30);
    expect(fx.s626.h).toBe(30);
    fx.head.extendDragon(fx.hooks);
    fx.head.fixedUpdate(1, fx.hooks);
    expect(fx.head.w).toBe(31);                 // (int)(30×1.05)=31
  });
  it('中心保持:d4=0 支（与父心重合）resize 不动心（:43865-43868 position=Center→Center=position）', () => {
    const fx = makeChain();
    place(fx.head, 500, 500); fx.head.rot = Math.PI / 2;
    place(fx.s626, 500, 500); fx.s626.rot = Math.PI / 2;   // 与父心重合 → vector4=Zero
    const cx0 = fx.s626.cx, cy0 = fx.s626.cy;
    fx.s626.fixedUpdate(1, fx.hooks);
    expect(fx.s626.w).toBe(30);
    expect(fx.s626.cx).toBeCloseTo(cx0, 9);     // 心不动（旧:无 resize;错式 resize 会 +3 偏）
    expect(fx.s626.cy).toBeCloseTo(cy0, 9);
  });
  it('>2000 瞬移 Center 写位用当前盒半宽（:43658;旧 −12 硬编码=24 盒残值）', () => {
    const fx = makeChain();
    fx.head.fixedUpdate(1, fx.hooks);           // 首拍后 w=30
    place(fx.head, fx.player.cx + 2500, fx.player.cy);
    fx.head.vx = 0; fx.head.vy = 0;
    fx.head.fixedUpdate(1, fx.hooks);
    expect(fx.head.cx).toBeCloseTo(fx.player.cx, 9);   // x=pcx−w/2=pcx−15（旧 pcx−12 → cx=pcx+3）
  });
  it('结构锁:两处 resize 在位（头 :43773/段 :43867）+ 瞬移动态半宽', () => {
    expect(SRC_HEAD).toContain('this.w = this.h = Math.trunc(30 * (1 + tier * 0.01));');
    expect(SRC_SEG).toContain('this.w = this.h = Math.trunc(30 * (1 + tier * 0.01));');
    expect(SRC_HEAD).toContain('this.x = p.cx - this.w / 2; this.y = p.cy - this.h / 2;');
    expect(SRC_HEAD).not.toContain('p.cx - 12');
  });
});

describe('BJ709-G27 §3 draw 吃 proj.scale + A/=2（Main.cs:34212/:34180-34183）', () => {
  it('龙链 draw:ctx.scale(1.03)（基础龙）/1.05（延伸）;稳态 globalAlpha=0.5（A/=2）', () => {
    setProjSpriteOverride(625, { width: 32, height: 66 } as unknown as HTMLImageElement);
    const fx = makeChain();
    for (let t = 0; t < 6; t++) fx.head.fixedUpdate(1, fx.hooks);   // 连首拍共 7 拍 → 淡入尽
    expect(fx.head.alphaFade).toBe(0);
    expect(fx.head.drawScale).toBeCloseTo(1.03, 10);
    const rig = makeDrawRig();
    fx.head.draw(rig.r);
    expect(rig.scaleCalls).toEqual([[1.03, 1.03]]);        // 旧:零 scale 调用
    expect(rig.alphas).toEqual([0.5]);                     // 旧:无 ×0.5 → 不设 globalAlpha
    expect(rig.draws.length).toBe(1);
    fx.head.extendDragon(fx.hooks);
    fx.head.fixedUpdate(1, fx.hooks);
    expect(fx.head.drawScale).toBeCloseTo(1.05, 10);       // 延伸龙绘制更大
    const rig2 = makeDrawRig();
    fx.head.draw(rig2.r);
    expect(rig2.scaleCalls).toEqual([[1.05, 1.05]]);
  });
  it('段 draw 同 1.03;淡入期 draw alpha=fade×0.5 折算（首拍 213 → 42/255×0.5）', () => {
    setProjSpriteOverride(626, { width: 32, height: 66 } as unknown as HTMLImageElement);
    const fx = makeChain();
    place(fx.head, 0, 0); fx.head.rot = Math.PI / 2;
    place(fx.s626, -20, 0); fx.s626.rot = Math.PI / 2;
    fx.s626.fixedUpdate(1, fx.hooks);                      // 段首拍:alphaFade 255→213
    expect(fx.s626.alphaFade).toBe(213);
    expect(fx.s626.drawScale).toBeCloseTo(1.03, 10);
    const rig = makeDrawRig();
    fx.s626.draw(rig.r);
    expect(rig.scaleCalls).toEqual([[1.03, 1.03]]);
    expect(rig.alphas).toEqual([(42 / 255) * 0.5]);        // (255−213)/255 × A/2
  });
  it('邻员零扰动:613 星尘细胞（同 33703 支,scale 恒 1）无 scale 调用/无 α 设定', () => {
    setProjSpriteOverride(613, { width: 24, height: 104 } as unknown as HTMLImageElement);
    const fx = makeHooks();
    const cell = new MinionProj(fx.player.cx, fx.player.cy - 40, 613, 10, 2, false, 0, false, () => fx.player);
    const rig = makeDrawRig();
    cell.draw(rig.r);                                      // 不跑 AI（drawScale=1/alphaFade=0 缺省面）
    expect(rig.scaleCalls).toEqual([]);                    // drawScale=1 缺省 → 不进 scale
    expect(rig.alphas).toEqual([]);                        // 无 A/=2（613 不在 625-628 支）
    expect(rig.draws.length).toBe(1);
  });
  it('结构锁:drawScale 消费 + 625-628 A/=2 在位', () => {
    const i0 = src.indexOf('if (CENTER_ANCHOR_33703.has(this.projId) && img)');
    const drawBlock = src.slice(i0, i0 + 4000);
    expect(drawBlock).toContain('if (this.projId >= 625 && this.projId <= 628) bodyAlpha *= 0.5;');
    expect(drawBlock).toContain('if (this.drawScale !== 1) ctx.scale(this.drawScale, this.drawScale);');
    // 消费位在 rotate/flip 之后（XNA T·R·S 合成序）
    const iRot = drawBlock.indexOf('ctx.rotate(this.rot);');
    const iScale = drawBlock.indexOf('if (this.drawScale !== 1)');
    expect(iScale).toBeGreaterThan(iRot);
  });
});

describe('BJ709-G27 §4 出场淡入:alpha=255 −42/拍 + 2×dust135（:43775-43788/:43843-43856）', () => {
  it('出生 255（四段）;−42/拍 7 拍归 0 后不再减', () => {
    const fx = makeChain();
    expect(fx.head.alphaFade).toBe(213);        // makeChain 首拍已减
    expect(fx.s626.alphaFade).toBe(255);        // 段未 update 过
    for (let t = 0; t < 5; t++) fx.head.fixedUpdate(1, fx.hooks);
    expect(fx.head.alphaFade).toBe(3);          // 213−42×5
    fx.head.fixedUpdate(1, fx.hooks);
    expect(fx.head.alphaFade).toBe(0);          // 3−42 → clamp 0（第 7 拍）
    fx.head.fixedUpdate(1, fx.hooks);
    expect(fx.head.alphaFade).toBe(0);          // 期满恒 0
  });
  it('淡入期 2×dust135/拍（α=100/scale=2/noGravity+noLight 后置写）;期满零新淡入尘', () => {
    // ★G30（2026-10-24）：AI_121 环境微尘（:43638-43648,α=0 fadeIn=2,1/30 掷）
    //  入域后同 type 135 双源并存——本锁改按淡入签名 α=100 过滤（判别力不变:
    //  M④ 摘 alphaFade 初始化 → 淡入尘全缺即红;环境尘面由 G30 §1 专锁）。
    const fx = makeChain();                     // 头首拍:2 尘
    const fade = () => fx.dusts.filter((d) => d.alpha === 100);
    expect(fade().length).toBe(2);
    expect(fade().every((d) => d.type === 135 && d.alpha === 100 && d.scale === 2 && d.noGravity)).toBe(true);
    expect(fade().every((d) => d.noLight)).toBe(true);   // NewDust 后置覆写（:43781）
    place(fx.head, 0, 0); fx.head.rot = Math.PI / 2;
    place(fx.s626, -20, 0); fx.s626.rot = Math.PI / 2;
    fx.s626.fixedUpdate(1, fx.hooks);           // 段首拍:2 尘（:43845-43850）
    expect(fade().length).toBe(4);
    for (let t = 0; t < 6; t++) fx.head.fixedUpdate(1, fx.hooks);   // 头 213→0 共 6 拍 12 尘
    expect(fade().filter((d) => d.type === 135).length).toBe(16);   // 头 7 拍 14 + 段 1 拍 2
    const n0 = fade().length;
    fx.head.fixedUpdate(1, fx.hooks);           // 期满拍:零新淡入尘（环境尘另计）
    expect(fade().length).toBe(n0);
  });
  it('淡入期照常接触伤（Damage_CanDealDamage :12461-12510 无 625-628 α 门）:出生拍即 17', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    const e = mkEnemy(31, 0, 0);
    const fx = makeHooks([e]);
    const head = new MinionProj(fx.player.cx - 12, fx.player.cy - 40, 625, 10, 2, false, 0, false, () => fx.player);
    fx.projectiles.push(head);
    placeEnemy(e, head.cx, head.cy);            // 出生盒心（d=0<21.6 → 零追逐位移）
    head.fixedUpdate(1, fx.hooks);              // 首拍:alphaFade 255→213 中照常 contact
    expect(e.hp).toBe(100000 - 17);
  });
});

describe('BJ709-G27 §5 头 no-target 支 1:1（:43728-43761 逐轴 Sign/阻尼门/上浮门/限速）', () => {
  /** 无敌夹具:首拍 spawn 链后复位速度/重摆精确偏移,第二拍即受测拍 */
  function tick(offX: number, offY: number, vx = 0, vy = 0): MinionProj {
    const fx = makeHooks();                     // 无敌 → no-target 支
    const head = new MinionProj(fx.player.cx + offX - 12, fx.player.cy + offY - 12, 625, 10, 2, false, 0, false, () => fx.player);
    fx.projectiles.push(head);
    head.fixedUpdate(1, fx.hooks);              // 首=spawn 链（速度/位置会被 no-target 首拍写）
    place(head, fx.player.cx + offX, fx.player.cy + offY);   // 精确重摆（w=30 半宽）
    head.vx = vx; head.vy = vy;
    head.fixedUpdate(1, fx.hooks);
    return head;
  }
  it('逐轴 Sign 加速+轴门:纯 X (300,0) → vx=−0.2、|dy|≤10 不加 Y → 上浮 vy=−0.1（旧归一化 vy=0）', () => {
    const h = tick(300, 0);
    expect(h.vx).toBeCloseTo(-0.2, 10);         // num11=0.2 × Sign(−300)
    expect(h.vy).toBeCloseTo(-0.1, 10);         // |vy|=0<1 上浮门（旧:d>100 支无上浮 → 0）
  });
  it('轴门 Y:|Δy|=5 ≤10 → 零 Y 加速（旧归一化 +0.0033）', () => {
    const h = tick(300, 5);
    expect(h.vx).toBeCloseTo(-0.2, 10);
    expect(h.vy).toBeCloseTo(-0.1, 10);         // 仅上浮,无 Y 轴加速
  });
  it('逐轴幅值:对角 (300,300) → 两轴各 0.2（旧归一化各 0.141）+ 上浮 → vy=−0.3', () => {
    const h = tick(300, 300);
    expect(h.vx).toBeCloseTo(-0.2, 10);
    expect(h.vy).toBeCloseTo(-0.3, 10);         // −0.2 加速 −0.1 上浮
  });
  it('阻尼门 speed>2:近距 (50,0) speed=1 ≤2 → 不阻尼 vx=1（旧无条件 ×0.96 → 0.96）', () => {
    const h = tick(50, 0, 1, 0);
    expect(h.vx).toBe(1);
    expect(h.vy).toBeCloseTo(-0.1, 10);
  });
  it('阻尼生效:speed=10 >2 → ×0.96 → 9.6', () => {
    const h = tick(50, 0, 10, 0);
    expect(h.vx).toBeCloseTo(9.6, 10);
    expect(h.vy).toBeCloseTo(-0.1, 10);
  });
  it('限速 15 无条件（支尾 :43757-43761）:近距 speed≈19.2 → 收 15（旧 else 支不限 → 19.2）', () => {
    const h = tick(50, 0, 20, 0);
    const sp = Math.hypot(h.vx, h.vy);
    expect(sp).toBeLessThanOrEqual(15.000001);
    expect(sp).toBeCloseTo(15, 5);
  });
  it('结构锁:逐轴 Sign/轴门/阻尼门/上浮门在位,归一化旧式缺席', () => {
    expect(SRC_HEAD).toContain('if (Math.abs(dx) > 20) this.vx += num11 * Math.sign(dx);');
    expect(SRC_HEAD).toContain('if (Math.abs(dy) > 10) this.vy += num11 * Math.sign(dy);');
    expect(SRC_HEAD).toContain('} else if (Math.hypot(this.vx, this.vy) > 2) {');
    expect(SRC_HEAD).toContain('if (Math.abs(this.vy) < 1) this.vy -= 0.1;');
    expect(SRC_HEAD).not.toContain('(dx / d) * acc;');      // 旧归一化加速式（追击支 acc0 不撞）
  });
});

describe('BJ709-G27 §6 头 rotation/facing 无条件（:43763-43765）', () => {
  it('rotation 无 speed>0.5 门:微速 (0,0.3) → rot=atan2(0.2,0)+π/2=π（旧 speed 0.2≤0.5 → 不转,rot=0）', () => {
    const fx = makeHooks();
    const head = new MinionProj(fx.player.cx - 12, fx.player.cy - 12, 625, 10, 2, false, 0, false, () => fx.player);
    fx.projectiles.push(head);
    head.fixedUpdate(1, fx.hooks);              // spawn 链
    place(head, fx.player.cx, fx.player.cy);    // d=0 → 无加速/无阻尼
    head.vx = 0; head.vy = 0.3; head.rot = 0;
    head.fixedUpdate(1, fx.hooks);              // vy 0.3→0.2（上浮门）,speed 0.2
    expect(head.rot).toBeCloseTo(Math.PI, 10);  // atan2(0.2,0)=π/2,+π/2 → π
  });
  it('facing=velocity.X>0?1:−1 逐拍覆写:vx=0 → −1（旧 sign(0)=0 不写）', () => {
    const fx = makeHooks();
    const head = new MinionProj(fx.player.cx - 12, fx.player.cy - 12, 625, 10, 2, false, 0, false, () => fx.player);
    fx.projectiles.push(head);
    head.fixedUpdate(1, fx.hooks);
    place(head, fx.player.cx, fx.player.cy);
    head.vx = 0; head.vy = 0.3; head.facing = 1;
    head.fixedUpdate(1, fx.hooks);
    expect(head.facing).toBe(-1);
  });
  it('facing 读速度非目标向:目标在左、速度向右 (vx=+5) → facing=+1（旧读目标向 → −1）', () => {
    const e = mkEnemy(41, 0, 0);
    const fx = makeHooks([e]);
    const head = new MinionProj(fx.player.cx - 12, fx.player.cy - 12, 625, 10, 2, false, 0, false, () => fx.player);
    fx.projectiles.push(head);
    head.fixedUpdate(1, fx.hooks);              // spawn 链（敌 (0,0) 远 → 首=近玩家 no-target）
    place(head, fx.player.cx, fx.player.cy);
    head.vx = 5; head.vy = 0;
    placeEnemy(e, head.cx - 300, head.cy);      // 目标在左 300px
    head.fixedUpdate(1, fx.hooks);              // 追击向左减速:v=5→3.8→×0.8=3.04 仍 >0
    expect(head.vx).toBeGreaterThan(0);
    expect(head.facing).toBe(1);                // vanilla velocity.X>0（旧:sign(目标−自)=−1）
  });
  it('结构锁:无条件写式在位,旧门式缺席', () => {
    expect(SRC_HEAD).toContain('this.rot = Math.atan2(this.vy, this.vx) + Math.PI / 2;');
    expect(SRC_HEAD).not.toContain('> 0.5) this.rot');      // 旧 speed>0.5 门
    expect(SRC_HEAD).toContain('this.facing = this.vx > 0 ? 1 : -1;');
    expect(SRC_HEAD).not.toContain('Math.sign(tgt.cx - this.cx)');   // 旧目标向读
  });
});
