// ★BJ709-G32 新登记债清偿·三件（G30 ⑩ / G31 ① ②——锚 memory/bj709g30-dragon-
// residuals.md 与 memory/bj707g31-mount-dye-emitters.md,先读两档+campaign-playbook
// 每刀 Checklist;1457 亲读逐件定谳后才动刀）。判语:
//
// 件1 [G30⑩] 陷阱塔携行 rotation 未消费 →【修·写面补行+draw 三处】
//   定谳:vanilla 主绘 Main.cs:34212 与辉光 :34519 均【第五参】传 proj.rotation——
//   携行态 AI_138（flag5=aiStyle 138,Projectile.cs:70230-70252）写 ±π/2（:70245,
//   pdir=1 → 4.712389=3π/2/pdir=−1 → π/2）、变身坐骑 flag 支覆写 0（:70249）、
//   尾行 rotation += player.fullRotation（:70251）,mount 61 Pixie 再 +dir·π/2
//   （:70303）/mount 56 Bat 再 +π（:70332）。仓内写面 :8615-8616 原在（±π/2/flag 0/
//   61/56 四写位）但【缺 :70251 fullRotation 尾行】（旧注「其余型只 1025 支读
//   fullRotation」系漏读 flag5 尾行——本刀勘正）且 draw 支三处（非携行 body/携行
//   body/glow）零 rotate 调用 → 携行塔恒直立。放置态 rot 恒 0=零变化（无 id 门,
//   G27 判例）;1025 支 :11282 `if (rot!==0) ctx.rotate` 先例。
//
// 件2 [G31①] veloHead 头盔缺 CanDrawOnVelociraptorMount 门 →【修·白名单门+眼睑出块】
//   定谳:vanilla DrawPlayer_21_Head（PlayerDrawLayers.cs:2102-2117）:骑 54 ∧
//   head≥0 ∧ !ArmorIDs.Head.Sets.CanDrawOnVelociraptorMount[head]（ArmorIDs.cs:30,
//   136 头白名单）→ flag4=false 整头层链跳过（fullHair 盔+发/hatHair/270/282/alt/
//   259/13/265/通用盔全链）;head=0（无盔）∉表 → 骑迅猛龙无盔同隐。仓 veloHead 块
//   任意头盔照画——注释声称有门而码无=注释-行为不一致（:21369-21370 旧锚 :2103-
//   2108 同勘正为 :2106-2111）。眼睑【不受 flag4 门】（TheFace :2097 先于 flag4
//   计算,eyelid :2583 mountDrawsEyelid 支恒画）→ 随刀移出 if(headDoll):无盔/门拒
//   两态同画（旧位无盔时眼睑漏画=邻位偏差同刀归位）。
//
// 件3 [G31②] cMinecart 七面尘+minecartDyeVid →【修·七发射面 1:1+染料单源】
//   定谳（G31 census 任务书执行）:vanilla UpdateEffects（Mount.cs:4848）尘支=
//   DoGem（:4742,case 25-30 尘 86-91/case 31 尘 262）/DoSteam（:4759,case 36 尘
//   303）/DoExhaust（:4778,case 32 Beetle 尘 31）/DoConfetti（:4814,case 34 纸屑
//   139+Next(4)）/case 11 Mech 轨迹尘 182（:5072-5135 尘面）/case 22 Hell 尘 65
//   （:5136-5178 尘面）——七面 d.shader=GetSecondaryShader(cMinecart)（Player.cs:
//   9688 cMinecart=miscDyes[2].dye）。仓内零发射方=接线无从落（G31 判语）。落地=
//   Minecart.updateEffectsDust 派发+四委派+两 case 直发（spawnDust perfect 通道+
//   后置覆写族序,wheelSparkDust 同模式）;Player.minecartDyeVid()（miscDyes[2] 单源
//   零掷）。★新登记债:G32-D1 case 11 五点光 :5084-5094 未接;G32-D2 case 22
//   lavaMax+=420（:5138）装备面未接;G32-D3 shadowPos 采样 gfxOffY 域差（骑矿车
//   gfxOffY 存 cart 侧,p.spY 采样少含轨面项,坡面轨迹起点 Y 偏 ≤gfxOffY 差）。
//   SparksMeow 固定 shader vid 2870（DelegateMethods.cs:401）另案勿混（既有登记）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MinionProj } from '../src/entities/MinionProj';
import { setProjSpriteOverride } from '../src/entities/Arrow';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Minecart } from '../src/entities/Minecart';
import { HEAD_CAN_DRAW_ON_RAPTOR } from '../src/data/vanillaAccDrawslots';
import { ITEM_DEFS, ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TileStore } from '../src/world/TileStore';
import { TILE_BY_KEY } from '../src/data/tiles';
import { placeTrack, frameTrackArea, getOnTrack } from '../src/world/MinecartTrack';
import type { VDust } from '../src/fx/VanillaDust';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = {
  minion: readFileSync(join(ROOT, 'src/entities/MinionProj.ts'), 'utf8'),
  renderer: readFileSync(join(ROOT, 'src/render/Renderer.ts'), 'utf8'),
  cart: readFileSync(join(ROOT, 'src/entities/Minecart.ts'), 'utf8'),
  player: readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8'),
};
const SRC_TRAP = SRC.minion.slice(
  SRC.minion.indexOf('if (this.sentry && TRAP_TOWER.has(this.projId) && img)'),
  SRC.minion.indexOf('if ((this.projId === 308 || this.projId === 377))'));
const SRC_VELO = SRC.renderer.slice(
  SRC.renderer.indexOf('const veloHead = mntHidden && p.mount.type === 54;'),
  SRC.renderer.indexOf('if (!mntHidden) {\n      // 装备与帧行已在上方配饰身后族段复算'));

const priv = (o: object): Record<string, any> => o as unknown as Record<string, any>;

// document 垫片（bj582 判例:draw 链帧切片走 document.createElement）
class FakeCanvas {
  width = 0; height = 0;
  getContext() { return { drawImage() {}, imageSmoothingEnabled: false }; }
}
(globalThis as unknown as { document?: unknown }).document = {
  createElement: (): FakeCanvas => new FakeCanvas(),
};

/** 红染料 vid 1007（G29 同款——dyeApplyOf 可解析的 ArmorColored 首键） */
const RED_DYE_VID = 1007;
const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

const mkDust = (type: number, over: Partial<VDust> = {}): VDust => ({
  active: true, x: 0, y: 0, vx: 0, vy: 0, type, scale: 1, alpha: 0, fadeIn: 0,
  noGravity: false, noLight: false, noLightEmittance: false, color: null, rotation: 0,
  fx: 0, fy: 0, followPlayer: false, followOnce: false, dyeVid: -1, followEnt: null, attractTo: null,
  ...over,
}) as VDust;

/** 收集型 spawnDust 桩:记录全 13 实参 + 返回可变尘（后置覆写面） */
function mkDustHooks(p: Player, st?: TileStore): {
  hooks: GameHooks; recs: Array<Record<string, unknown>>; dusts: VDust[];
} {
  const recs: Array<Record<string, unknown>> = [];
  const dusts: VDust[] = [];
  const hooks: GameHooks = {
    world: { store: st ?? new TileStore(40, 40) } as never,
    player: p as never,
    enemies: () => [], critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    showPickupLabel: () => {},
  } as unknown as GameHooks;
  (hooks as unknown as { spawnDust: unknown }).spawnDust = (
    x: number, y: number, w: number, h: number, type: number,
    speedX = 0, speedY = 0, alpha = 0, color: unknown = null, scale = 1,
    noGravity = false, perfect = false,
  ) => {
    recs.push({ x, y, w, h, type, speedX, speedY, alpha, color, scale, noGravity, perfect });
    const d = mkDust(type, { x, y, vx: speedX, vy: speedY, alpha, scale });
    dusts.push(d);
    return d;
  };
  return { hooks, recs, dusts };
}

/** Math.random 定序桩（队列耗尽后回落 base）——G31 判例:Once 队列从首个起算 */
function randQueue(vals: number[], base = 0.99): ReturnType<typeof vi.spyOn> {
  const q = [...vals];
  return vi.spyOn(Math, 'random').mockImplementation(() => (q.length ? q.shift()! : base));
}

/** 直驱矿车夹具（面方法 priv 直调:速度/倾角手置=零物理干扰） */
function mkCart(mountId: number, x = 1000, y = 500): Minecart {
  const c = new Minecart();
  c.mountId = mountId;
  c.applyMountStats();
  c.mounted = true;
  c.x = x; c.y = y;
  return c;
}

// =====================================================================
// §A 件1 陷阱塔携行 rotation（G30 登记债⑩:写面补 :70251+draw 三处消费）
// =====================================================================
describe('BJ709-G32 §A 陷阱塔携行 rotation:写面（±π/2/flag 0/61·56 加成/fullRotation 尾行）+ draw 三处', () => {
  /** 携行 691 + 指定坐骑——heavySlingReposition 写面直调（G30 §2 同式） */
  function mkCarriedTrap(mountType: number, facing = 1) {
    const p = new Player(60 * 16, 90 * 16, new Inventory());
    priv(p)._equipStatsCache = { ...p.equipStats, accSentryBackpack: true } as never;
    p.mount.active = true;
    p.mount.type = mountType;
    p.mount.frame = 0;
    p.facing = facing;
    const m = new MinionProj(40 * 16, 90 * 16, 691, 30, 0, true, 0, false, () => p);
    m.carriedByBackpack = true;
    priv(m).heavySlingReposition(p);
    return { m, p };
  }

  it('A1 写面基础:携行+非变身坐骑（bunny 1）→ rot=pdir==1?4.712389:π/2（:70245,flag=false 支）', () => {
    const { m } = mkCarriedTrap(1, 1);
    expect(m.rot).toBe(Math.fround(4.712389));               // 3π/2（pdir=1）
    expect(m.drawScale).toBe(1);                              // 非变身 54-61 族:无 0.5 写
    const { m: m2 } = mkCarriedTrap(1, -1);
    expect(m2.rot).toBeCloseTo(Math.PI / 2, 9);               // pdir=−1 → π/2
  });

  it('A2 写面变身族:Rat 55 → flag 支 rot=0（:70249）;Pixie 61 → +dir·π/2（:70303）;Bat 56 → +π（:70332）', () => {
    expect(mkCarriedTrap(55).m.rot).toBe(0);
    expect(mkCarriedTrap(61, 1).m.rot).toBeCloseTo(Math.PI / 2, 9);
    expect(mkCarriedTrap(61, -1).m.rot).toBeCloseTo(-Math.PI / 2, 9);
    expect(mkCarriedTrap(56).m.rot).toBeCloseTo(Math.PI, 9);
  });

  it('A3 fullRotation 尾行（本刀补 :70251）:ridingCart+轨倾 0.3 → rot=base+0.3', () => {
    const p = new Player(60 * 16, 90 * 16, new Inventory());
    priv(p)._equipStatsCache = { ...p.equipStats, accSentryBackpack: true } as never;
    p.mount.active = true; p.mount.type = 1; p.mount.frame = 0;
    p.ridingCart = true;
    p.cart = { rotation: 0.3, h: 52 } as never;
    const m = new MinionProj(40 * 16, 90 * 16, 691, 30, 0, true, 0, false, () => p);
    m.carriedByBackpack = true;
    priv(m).heavySlingReposition(p);
    expect(m.rot).toBeCloseTo(Math.fround(4.712389) + 0.3, 9);   // :70245+:70251
  });

  it('A4 消费面:携行+非变身（rot=3π/2）→ body 两路+glow 三笔 rotate,glow rotate 先于 getTransform 捕获', () => {
    setProjSpriteOverride(691, { width: 26, height: 56 } as unknown as HTMLImageElement);
    setProjSpriteOverride(692, { width: 26, height: 56 } as unknown as HTMLImageElement);
    const { m } = mkCarriedTrap(1, 1);                       // rot=4.712389,drawScale=1
    const rig = makeDrawRig(true);
    m.draw(rig.r);
    expect(rig.rots).toEqual([m.rot, m.rot]);                // 携行 body+glow（非携行支 rot≡0 不触发）
    expect(rig.seq.lastIndexOf('rotate')).toBeGreaterThan(rig.seq.indexOf('translate'));
    expect(rig.seq.lastIndexOf('rotate')).toBeLessThan(rig.seq.indexOf('getTransform'));
    // 非携行 Bottom 锚支:手置 rot=π/2（放置态恒 0,本支只验消费结构）
    const fx = { player: new Player(60 * 16, 90 * 16, new Inventory()) };
    const m2 = new MinionProj(40 * 16, 90 * 16, 692, 30, 0, true, 0, false, () => fx.player);
    priv(m2).rot = Math.PI / 2;
    const rig2 = makeDrawRig(true);
    m2.draw(rig2.r);
    expect(rig2.rots).toEqual([Math.PI / 2, Math.PI / 2]);   // 非携行 body+glow 双消费（:34212/:34519）
  });

  it('A5 缺省零变化:放置态 rot=0 → 零 rotate 调用（无 id 门,G27 判例）', () => {
    setProjSpriteOverride(691, { width: 26, height: 56 } as unknown as HTMLImageElement);
    const p = new Player(60 * 16, 90 * 16, new Inventory());
    const m = new MinionProj(40 * 16, 90 * 16, 691, 30, 0, true, 0, false, () => p);
    const rig = makeDrawRig(true);
    m.draw(rig.r);
    expect(rig.rots).toEqual([]);
    expect(rig.scales).toEqual([]);
  });

  it('A6 结构锁:draw 支三处 rotate + 写面 fullRotation 尾行在位（:70251/勘正注）', () => {
    const rotSites = SRC_TRAP.split('if (this.rot !== 0) ctx.rotate(this.rot);').length - 1;
    expect(rotSites).toBe(3);                                // 非携行 body/携行 body/glow
    const iGlowTranslate = SRC_TRAP.lastIndexOf('ctx.translate(this.cx, this.carriedByBackpack ? this.cy : this.y + this.h);');
    const iGlowRotate = SRC_TRAP.lastIndexOf('if (this.rot !== 0)');
    expect(iGlowRotate).toBeGreaterThan(iGlowTranslate);
    expect(SRC.minion).toContain('this.rot += fullRotBJ518;                            // :70251 rotation += player.fullRotation');
    expect(SRC.minion).toContain('亦有 :70251 读位');         // 头注勘正（旧「只 1025 支读」废止）
  });
});

// 记录型 draw 桩（G30 同款:rotate/scale/getTransform 序记录）
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
    fillRect() {}, strokeRect() {},
    drawImage(...a: unknown[]) { seq.push('drawImage'); draws.push({ img: a[0], d: a }); },
  } as unknown as CanvasRenderingContext2D;
  const glowOps: Array<Record<string, unknown>> = [];
  const r: Record<string, unknown> = { ctx };
  if (withGlowSink) r.pushGlowOps = (ops: Array<Record<string, unknown>>) => { glowOps.push(...ops); };
  return { r: r as never, translates, rots, scales, draws, seq, glowOps };
}

// =====================================================================
// §B 件2 veloHead 头盔 CanDrawOnVelociraptorMount 门（G31 登记债①）
// =====================================================================
describe('BJ709-G32 §B veloHead 头盔门:ArmorIDs.cs:30 白名单 136 头（1457 反编译对拍）+ 门接线 + 眼睑出块', () => {
  /** 反编译 ArmorIDs.cs:30 直解 = SetFactory.CreateBoolSet(false, ids) 白名单 */
  const vanillaSet = (() => {
    const line = readFileSync(join(ROOT, '..', 'Terarria1457', 'Terraria.ID', 'ArmorIDs.cs'), 'utf8')
      .split('\n')[29];
    expect(line).toContain('CanDrawOnVelociraptorMount = Factory.CreateBoolSet(false,');
    const tail = line.slice(line.indexOf('CreateBoolSet(false,') + 'CreateBoolSet(false,'.length);
    return new Set((tail.match(/\d+/g) ?? []).map(Number));
  })();

  it('B1 表锁:HEAD_CAN_DRAW_ON_RAPTOR 与 1457 ArmorIDs.cs:30 逐位全等（136 头,无缺无多）', () => {
    expect(vanillaSet.size).toBe(136);
    expect(HEAD_CAN_DRAW_ON_RAPTOR.size).toBe(136);
    expect([...vanillaSet].filter((x) => !HEAD_CAN_DRAW_ON_RAPTOR.has(x))).toEqual([]);
    expect([...HEAD_CAN_DRAW_ON_RAPTOR].filter((x) => !vanillaSet.has(x))).toEqual([]);
  });

  it('B2 抽检面:5/12/288/290/212/1 在表;0（无盔）/38 狼人/39 人鱼/3/6/7/9/11/17/20/22/23/27/28/31/32/37 不在（head=0 ∉表=骑迅猛龙无盔同隐）', () => {
    for (const id of [5, 12, 288, 289, 290, 212, 1, 2, 4, 274, 277]) expect(HEAD_CAN_DRAW_ON_RAPTOR.has(id), `head ${id}`).toBe(true);
    for (const id of [0, 3, 6, 7, 9, 11, 17, 20, 22, 23, 27, 28, 31, 32, 37, 38, 39, 43, 45, 47, 48, 49, 50]) {
      expect(HEAD_CAN_DRAW_ON_RAPTOR.has(id), `head ${id}`).toBe(false);
    }
  });

  it('B3 结构锁:veloHead 块门接线（raptorHeadOk → headDoll 三元首项）+ 锚勘正注在案', () => {
    expect(SRC_VELO).toContain('const raptorHeadOk = vh.head == null || HEAD_CAN_DRAW_ON_RAPTOR.has(vh.head);');
    expect(SRC_VELO).toContain('const headDoll = raptorHeadOk && vh.head');
    expect(SRC_VELO).toContain('PlayerDrawLayers.cs:2106-2111');       // 勘正锚（旧 :2103-2108 废止）
    expect(SRC_VELO).not.toContain(':2103-2108');
  });

  it('B4 眼睑出块:drawEyelid 调用在 if (headDoll) 块外（TheFace :2097 先于 flag4=眼睑不受门;无盔/门拒两态同画）', () => {
    const iHeadDoll = SRC_VELO.indexOf('if (headDoll) {');
    const iLid = SRC_VELO.indexOf('this.drawEyelid(ctx, p, vr.body, 4, HIDES_HEAD.has(vh.head ?? 0)');
    expect(iHeadDoll).toBeGreaterThan(-1);
    expect(iLid).toBeGreaterThan(iHeadDoll);
    // 块外签名:8 空格缩进（块内语句为 10 空格）——`}\n        this.drawEyelid` 直邻 headDoll 块闭
    expect(SRC_VELO).toContain('        }\n        this.drawEyelid(ctx, p, vr.body, 4,');
  });
});

// =====================================================================
// §C 件3 cMinecart 七尘面+minecartDyeVid（G31 登记债②任务书落地）
// =====================================================================
describe('BJ709-G32 §C cMinecart 七尘面 1:1 + minecartDyeVid 单源', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('C0 minecartDyeVid():miscDyes[2] 直读零掷——红染料=1007/空槽=-1/cMount 槽[3]不串（Player.cs:9688）', () => {
    const p = new Player(400, 400, new Inventory());
    expect(p.minecartDyeVid()).toBe(-1);
    p.inv.miscDyes[2] = { id: iid(RED_DYE_VID), stack: 1 };
    expect(p.minecartDyeVid()).toBe(RED_DYE_VID);
    p.inv.miscDyes[2] = null;
    p.inv.miscDyes[3] = { id: iid(RED_DYE_VID), stack: 1 };   // cMount 槽
    expect(p.minecartDyeVid()).toBe(-1);                      // 槽 2/3 分立
    expect(p.mountDyeVid()).toBe(RED_DYE_VID);                // G29 通道不回归
  });

  it('C1 DoGem（case 25 尘 86）:1/10 掷+NextVector2Square(-1,1)×(22,10)+RRP;perfect 尾字段逐位（:4742-4756）;case 31 → 262', () => {
    const p = new Player(400, 400, new Inventory());
    p.inv.miscDyes[2] = { id: iid(RED_DYE_VID), stack: 1 };
    const c = mkCart(25, 1000, 500);                          // h=52,w=20
    const { hooks, recs, dusts } = mkDustHooks(p);
    const spy = randQueue([0.05, 0.2, 0.3]);                  // 门中/sqx/sqy
    priv(c).doGemMinecartEffect(p, hooks, 86);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
    expect(dusts.length).toBe(1);
    const sqx = -1 + 2 * 0.2, sqy = -1 + 2 * 0.3;
    const expX = c.cx + sqx * 22, expY = c.cy + 10 + sqy * 10;   // RRP 平轨恒等（rot=0/gfxOffY=0）
    expect(recs[0]).toMatchObject({ x: expX, y: expY, w: 0, h: 0, type: 86, perfect: true });
    const d = dusts[0];
    expect(d.noGravity).toBe(true);                           // :4750
    expect(d.fadeIn).toBe(0.6);                               // :4751
    expect(d.scale).toBe(0.4);                                // :4752
    expect(d.vx).toBe(0); expect(d.vy).toBe(0);               // :4753 初速 0×0.25
    expect(d.dyeVid).toBe(RED_DYE_VID);                       // :4754 shader=cMinecart
    // 掷空面
    const spy2 = randQueue([0.5]);
    priv(c).doGemMinecartEffect(p, hooks, 86);
    spy2.mockRestore();
    expect(dusts.length).toBe(1);                             // 0.5 ≥0.1 → 弃
    // case 31 → 尘 262
    const spy3 = randQueue([0.05, 0.5, 0.5]);
    priv(c).doGemMinecartEffect(p, hooks, 262);
    spy3.mockRestore();
    expect(recs[recs.length - 1].type).toBe(262);
  });

  it('C1b DoGem 斜坡 RRP:rot=0.4 → 锚过 rotatedRelativePoint（PlayerOffset 8 同式）非恒等', () => {
    const p = new Player(400, 400, new Inventory());
    const c = mkCart(25, 1000, 500);
    c.rotation = 0.4;                                         // 轨面倾角（fullRotation）
    const { hooks, recs } = mkDustHooks(p);
    const spy = randQueue([0.05, 0.5, 0.5]);                  // sqx=sqy=0
    priv(c).doGemMinecartEffect(p, hooks, 86);
    spy.mockRestore();
    const cos = Math.cos(0.4), sin = Math.sin(0.4);
    const px = c.cx, py = c.cy + 10;                          // 偏移 0（r=0.5 → sq=0）
    const pivX = c.x + c.w / 2, pivY = c.y + c.h;
    const vx0 = px - pivX, vy0 = py - pivY;
    expect(recs[0].x).toBeCloseTo(pivX + vx0 * cos - vy0 * sin - 8 * sin, 9);
    expect(recs[0].y).toBeCloseTo(pivY + vx0 * sin + vy0 * cos - 8 + 8 * cos, 9);
  });

  it('C2 DoSteam（case 36 尘 303）:|vx|≥6 直入（零门掷）;1≤|vx|<6 需 animFrame==0;尾字段 vy=−2/scale 1.8（:4759-4776）', () => {
    const p = new Player(400, 400, new Inventory());
    const c = mkCart(36, 1000, 500);
    const { hooks, recs, dusts } = mkDustHooks(p);
    c.vx = 8;                                                  // num=8 ≥6:无 _frame 门
    const spy = randQueue([0.25, 0.75]);                       // sqx/sqy
    priv(c).doSteamMinecartEffect(p, hooks, 303);
    expect(spy).toHaveBeenCalledTimes(2);                       // 零门掷（num≥6 短路）
    spy.mockRestore();
    const sqx = -1 + 2 * 0.25, sqy = -1 + 2 * 0.75;
    expect(recs[0]).toMatchObject({ type: 303, perfect: true, x: c.cx - 10 + sqx * 3, y: c.cy - 4 + sqy * 3 });
    expect(dusts[0].scale).toBe(1.8);                          // :4769
    expect(dusts[0].vy).toBe(-2);                              // :4770-4771（0×0.25−2）
    // 1≤num<6 档:animFrame≠0 → 拒;animFrame==0 → 过
    c.vx = 3; priv(c).animTick = 12;                           // animFrame=1
    let spy2 = randQueue([]);
    priv(c).doSteamMinecartEffect(p, hooks, 303);
    expect(spy2).toHaveBeenCalledTimes(0);                      // 门不过=零掷零尘
    spy2.mockRestore();
    expect(dusts.length).toBe(1);
    priv(c).animTick = 0;                                      // animFrame=0
    spy2 = randQueue([0.5, 0.5]);
    priv(c).doSteamMinecartEffect(p, hooks, 303);
    spy2.mockRestore();
    expect(dusts.length).toBe(2);                              // :4763 _frame==0 门过
    // |vx|<1 → 恒拒
    c.vx = 0.5;
    spy2 = randQueue([]);
    priv(c).doSteamMinecartEffect(p, hooks, 303);
    spy2.mockRestore();
    expect(dusts.length).toBe(2);
  });

  it('C3 DoExhaust（case 32 尘 31）:慢速 1/4 门;粒数 1+(int)|v|/6;|v|>6 → X+4·dir;堆叠 velocity×trunc(num2/3);低速 vx−0.5·dir（:4778-4812）', () => {
    const p = new Player(400, 400, new Inventory());
    p.facing = 1;
    const c = mkCart(32, 1000, 500);
    const { hooks, recs, dusts } = mkDustHooks(p);
    // 慢速:|v|=0.5 → Next(4) 门(1 掷)+1 粒(2 掷)
    c.vx = 0.5; c.vy = 0;
    let spy = randQueue([0.1, 0.5, 0.5]);                      // 门(floor(0.4)=0 过)/sqx/sqy
    priv(c).doExhaustMinecartEffect(p, hooks, 31);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
    expect(dusts.length).toBe(1);
    const sqx = -1 + 2 * 0.5, sqy = -1 + 2 * 0.5;
    expect(recs[0]).toMatchObject({ type: 31, x: c.cx - 18 + sqx * 3, y: c.cy + 20 + sqy * 3 });
    expect(dusts[0].vx).toBe(-0.5);                            // :4801-4804 低速 vx−0.5·dir
    expect(dusts[0].scale).toBe(1.2);                          // :4799
    // 慢速门弃:Next(4)!=0
    spy = randQueue([0.5]);
    priv(c).doExhaustMinecartEffect(p, hooks, 31);
    spy.mockRestore();
    expect(dusts.length).toBe(1);
    // 快速 |v|=7.5:v>6 → X+4·dir;无门掷;2 粒
    c.vx = 7.5; c.vy = 0;
    spy = randQueue([0.5, 0.5, 0.5, 0.5]);
    priv(c).doExhaustMinecartEffect(p, hooks, 31);
    spy.mockRestore();
    expect(dusts.length).toBe(3);                              // 1+floor(7.5/6)=2 粒
    expect(recs[2]).toMatchObject({ x: c.cx - 18 + 4 + sqx * 3, y: c.cy + 20 + sqy * 3 });  // +4·dir
    // 堆叠:|v|=18 → 4 粒,体见 num2=3..0;num2=3 → k=trunc(3/3)=1 → +velocity×1
    const cSt = mkCart(32, 1000, 500);
    const fxSt = mkDustHooks(p);
    cSt.vx = 18;
    spy = randQueue([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    priv(cSt).doExhaustMinecartEffect(p, fxSt.hooks, 31);
    spy.mockRestore();
    expect(fxSt.recs.length).toBe(4);                          // 1+floor(18/6)=4 粒
    expect(fxSt.recs[0].x).toBeCloseTo(cSt.cx - 18 + 4 + sqx * 3 + 18, 9);   // 首粒 num2=3:堆叠 vx×1
    expect(fxSt.recs[3].x).toBeCloseTo(cSt.cx - 18 + 4 + sqx * 3, 9);        // 末粒 num2=0:无堆叠
  });

  it('C4 DoConfetti（case 34）:双掷门短路序（num=2 → 恰 1 掷弃/num=0.5 → Next(6) 1 掷弃）;尘型 139+Next(4)/scale 0.5+num3/2/X 堆叠（:4814-4852）', () => {
    const p = new Player(400, 400, new Inventory());
    p.facing = 1;
    const c = mkCart(34, 1000, 500);
    const { hooks, recs, dusts } = mkDustHooks(p);
    // num=2（1≤num<3）:首子句短路零掷,次子句 Next(3) 1 掷 → !=0 弃
    c.vx = 2; c.vy = 0;
    let spy = randQueue([0.5]);                                // floor(0.5*3)=1 ≠0 → 弃
    priv(c).doConfettiMinecartEffect(p, hooks);
    expect(spy).toHaveBeenCalledTimes(1);                       // ★短路序:num≥1 → Next(6) 不掷
    spy.mockRestore();
    expect(dusts.length).toBe(0);
    // num=0.5（num<1）:Next(6) 1 掷过(0.1)→次子句 Next(3) 1 掷弃
    c.vx = 0.5;
    spy = randQueue([0.1, 0.5]);
    priv(c).doConfettiMinecartEffect(p, hooks);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
    expect(dusts.length).toBe(0);
    // num=4（≥3）:零门掷直入,1 粒:4 掷（num3/sqx/sqy/型）
    c.vx = 4;
    spy = randQueue([0.5, 0.25, 0.75, 0.3]);                   // num3=1.0/sq/sq/型=139+1
    priv(c).doConfettiMinecartEffect(p, hooks);
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
    expect(dusts.length).toBe(1);                              // 1+floor(4/6)=1
    const num3 = 0.5 * 2, sqx = -1 + 2 * 0.25, sqy = -1 + 2 * 0.75;
    expect(recs[0]).toMatchObject({ type: 139 + Math.floor(0.3 * 4), perfect: true });
    expect(recs[0].x).toBeCloseTo(c.cx - 18 + 4 * 1 * 0.5 + sqx * 3, 9);   // :4827（num2=0 无堆叠）
    expect(recs[0].y).toBeCloseTo(c.cy + 4 + sqy * 8, 9);
    expect(dusts[0].scale).toBeCloseTo(0.5 + num3 / 2, 9);     // :4836
  });

  it('C5 Mech 轨迹尘 182（case 11）:num10 三档几何+dist>3 Lerp 1 粒/3px（余数进位）/dist≤3 单粒钉位/followPlayer 一次性（:5072-5135）', () => {
    const p = new Player(400, 400, new Inventory());
    p.inv.miscDyes[2] = { id: iid(RED_DYE_VID), stack: 1 };
    p.facing = 1;
    const c = mkCart(11, 1000, 500);                           // heightBoost 12 → h=54
    const { hooks, recs, dusts } = mkDustHooks(p);
    // 平轨 facing=num9=1:num10=−24 → v6=(−24,−19);位移 Δx=9 → dist=9 → 3 粒 Lerp
    c.vx = 9; c.oldX = 1000 - 9; c.oldY = 500;                 // oldPosition=上拍末位
    priv(c).mechTrailDust(p, hooks);
    expect(dusts.length).toBe(3);                              // (int)9/3=3,9%3=0 无进位
    expect(recs[0]).toMatchObject({ x: c.cx, y: c.cy, type: 182, perfect: false });   // NewDust(Center,0,0,182) 锚
    const v8x = c.cx - 24, v8y = c.y + c.h - 19;               // Bottom+(−24,−19)
    const v9x = 1000 - 9 + c.w / 2 - 24, v9y = 500 + c.h - 19; // oldPosition+Size(0.5,1)+…
    expect(dusts[0].x).toBe(v9x + (v8x - v9x) * (1 / 3));      // Lerp 1/3（position 覆写面）
    expect(dusts[1].x).toBe(v9x + (v8x - v9x) * (2 / 3));
    expect(dusts[2].x).toBe(v8x);
    for (const d of dusts) {
      expect(d.type).toBe(182);
      expect(d.noGravity).toBe(true);                          // :5114
      expect(d.vx).toBe(0); expect(d.vy).toBe(0);              // :5115 零速
      expect(d.followPlayer).toBe(true);                       // :5116 customData=Player
      expect(d.followOnce).toBe(true);                         // :705-706 一次性后清
      expect(d.dyeVid).toBe(RED_DYE_VID);                      // :5117
    }
    // 余数进位:dist=10 → (int)10/3=3+1=4 粒
    const c2 = mkCart(11, 1000, 500);
    const fx2 = mkDustHooks(p);
    c2.vx = 10; c2.oldX = 1000 - 10; c2.oldY = 500;
    priv(c2).mechTrailDust(p, fx2.hooks);
    expect(fx2.dusts.length).toBe(4);
    // dist≤3 → 单粒钉位 v8
    const c3 = mkCart(11, 1000, 500);
    const fx3 = mkDustHooks(p);
    c3.vx = 2; c3.oldX = 1000 - 2; c3.oldY = 500;
    priv(c3).mechTrailDust(p, fx3.hooks);
    expect(fx3.dusts.length).toBe(1);
    expect(fx3.dusts[0].x).toBe(c3.cx - 24);                   // NewDust 后 position 覆写钉位
    // num10 档:facing=−1 ∧ num9=−1 → −24+1=−23 → v6.x=23;facing≠num9（vx>0,facing=−1）→ −22
    const c4 = mkCart(11, 1000, 500);
    const fx4 = mkDustHooks(p);
    const p4 = new Player(400, 400, new Inventory());
    p4.facing = -1;
    c4.vx = -5; c4.oldX = 1000; c4.oldY = 500;
    priv(c4).mechTrailDust(p4, fx4.hooks);
    expect(fx4.dusts.length).toBeGreaterThan(0);
    expect(fx4.dusts[0].x).toBe(c4.cx + 23);                   // num10·num9=(−23)·(−1)=23
    const c5 = mkCart(11, 1000, 500);
    const fx5 = mkDustHooks(p4);
    c5.vx = 5; c5.oldX = 1000; c5.oldY = 500;                  // num9=1,facing=−1
    priv(c5).mechTrailDust(p4, fx5.hooks);
    expect(fx5.dusts[0].x).toBe(c5.cx - 22);                   // num10=−22,·num9=−22
  });

  it('C6 Hell 尘 65（case 22）:静止 num6=0 反门恒发 11 粒;轨迹起点=shadowPos[2]−pos+锚+前探;velocity=−circular×num6−vector4;1/10 → fadeIn 1.3;无 followPlayer（65 型 customData 惰性）', () => {
    const p = new Player(400, 400, new Inventory());
    p.x = 1000; p.y = 2000;
    for (let i = 0; i < 7; i++) p.updateSocialShadow();        // 3 拍轮转稳态:[2]=(1000,2000)
    expect(p.socialShadowPos2()).toEqual({ x: 1000, y: 2000 });
    const c = mkCart(22, 1200, 2050);                          // 相对残影位移 (200,50)
    const { hooks, recs, dusts } = mkDustHooks(p);
    c.vx = 0; c.vy = 0;                                        // num6=0 → !(r<0) 恒真
    let spy = randQueue([0.5, 0.25, 0.75, 0.99], 0.5);         // 首粒:门/圆a/圆r/Next(10)=9 弃
    priv(c).hellMinecartDust(p, hooks);
    spy.mockRestore();
    expect(dusts.length).toBe(11);                             // 11 点（0..1 step 0.1）
    const ax = c.cx + 20, ay = c.cy + 10;                      // 锚 Center+(20,10)·Directions
    const valuex = 1000 - 1200 + ax, valuey = 2000 - 2050 + ay; // value=shadowPos[2]−pos+锚（v3=0 静止）
    expect(recs[0]).toMatchObject({ type: 65, perfect: true, x: valuex, y: valuey });   // t=0 起点
    expect(recs[10].x).toBeCloseTo(ax, 6);                     // 末点 ≈ 锚（t≈1）
    const d0 = dusts[0];
    expect(d0.scale).toBe(0.6);                                // :5155
    expect(d0.fadeIn).toBe(0);                                 // :5156
    expect(d0.noGravity).toBe(true);                           // :5159
    expect(d0.followPlayer).toBe(false);                       // 65 型 customData 惰性（Dust.cs 无 65 位）
    // velocity:初速 circular(0.5,0.5)×num6=0 → ×−1=0 − vector4;vector4=RRP(锚)−RRP(锚+(−f,−0.5))=(f,0.5)
    expect(d0.vx).toBeCloseTo(-1, 9);                          // 0−(1)=−1（facing=1）
    expect(d0.vy).toBeCloseTo(-0.5, 9);
    // 1/10 支:Next(10)==0 → fadeIn 1.3 + 速度重掷 circular(3,3)×num6（num6=0 → 0）
    const c2 = mkCart(22, 1200, 2050);
    const fx2 = mkDustHooks(p);
    spy = randQueue([0.5, 0.25, 0.75, 0.05, 0.5, 0.5], 0.99);  // 门/圆a/圆r/Next(10)中/c3a/c3r
    priv(c2).hellMinecartDust(p, fx2.hooks);
    spy.mockRestore();
    expect(fx2.dusts[0].fadeIn).toBe(1.3);                     // :5163
    expect(Math.abs(fx2.dusts[0].vx)).toBe(0);                 // circular(3,3)×num6(=0)=±0
    // 极速 num6=1:!(r<1) 恒假 → 零尘（越慢越密的反门本相）
    const c3 = mkCart(22, 1200, 2050);
    const fx3 = mkDustHooks(p);
    c3.vx = 5;
    spy = randQueue([0.5], 0.5);
    priv(c3).hellMinecartDust(p, fx3.hooks);
    spy.mockRestore();
    expect(fx3.dusts.length).toBe(0);
  });

  it('C7 派发面+oldX 快照:fixedUpdate 全链 mountId 25 平轨 → 尘 86 入池（1/10 掷全中）;mount 6/13 零发射;oldX=本拍位移前位', () => {
    const TRACK = TILE_BY_KEY['v_314_minecart_track'] ?? -1;
    expect(TRACK).toBeGreaterThanOrEqual(0);
    const st = new TileStore(60, 40);
    for (let k = 8; k < 38; k++) { placeTrack(st, k, 12, 0); frameTrackArea(st, k, 12); }
    const p = new Player(0, 0, new Inventory());
    p.x = 9 * 16; p.y = 12 * 16 - 42;
    p.inputX = 1;                                              // 持右加速（minecart-track 同式）
    const { hooks, recs } = mkDustHooks(p, st);
    const c = new Minecart();
    c.mountId = 25; c.applyMountStats();
    const snap = getOnTrack(st, 9, 12, 9 * 16, 12 * 16 - 40, c.w, c.h);
    c.x = snap ? snap.x : 9 * 16;
    c.y = snap ? snap.y : 12 * 16 + 6 - c.h;
    c.mounted = true;
    const x0 = c.x;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);   // 门全中/square=−1
    for (let t = 0; t < 20; t++) c.fixedUpdate(1 / 60, hooks);
    spy.mockRestore();
    expect(c.onTrackNow).toBe(true);
    expect(c.x).toBeGreaterThan(x0);                           // 贴轨滑行
    expect(c.oldX).toBe(c.x - c.vx);                           // 快照=本拍位移前位（Player.cs:28281）
    expect(recs.length).toBe(20);                              // 每拍 1 尘
    expect(recs.every((r) => r.type === 86)).toBe(true);       // case 25 → DoGem 尘 86
    expect(recs[0]).toMatchObject({ perfect: true, w: 0, h: 0 });
    // 默认木质车 13/普通车 6:零尘面
    const recs0: Array<Record<string, unknown>> = [];
    const hooks0 = { ...hooks } as unknown as { spawnDust?: unknown };
    hooks0.spawnDust = () => { recs0.push({}); return mkDust(0); };
    for (const mid of [6, 13]) {
      const c0 = new Minecart();
      c0.mountId = mid; c0.applyMountStats();
      c0.x = c.x; c0.y = c.y; c0.mounted = true; c0.vx = 5;
      const snap0 = getOnTrack(st, Math.floor(c0.x / 16) + 1, 12, c0.x, c0.y, c0.w, c0.h);
      if (snap0) { c0.x = snap0.x; c0.y = snap0.y; }
      for (let t = 0; t < 5; t++) c0.fixedUpdate(1 / 60, hooks0 as never);
    }
    expect(recs0.length).toBe(0);                              // 非七面车零发射
  });

  it('C8 染料接线贯穿:Hell 面 miscDyes[2] 有染 → dyeVid=1007;空槽 → −1 穿透', () => {
    const p = new Player(400, 400, new Inventory());
    p.x = 400; p.y = 400;
    for (let i = 0; i < 7; i++) p.updateSocialShadow();
    p.inv.miscDyes[2] = { id: iid(RED_DYE_VID), stack: 1 };
    const c = mkCart(22, 400, 400);
    const fx = mkDustHooks(p);
    const spy = randQueue([0.5, 0.25, 0.75, 0.99], 0.5);
    priv(c).hellMinecartDust(p, fx.hooks);
    spy.mockRestore();
    expect(fx.dusts.length).toBe(11);
    expect(fx.dusts.every((d) => d.dyeVid === RED_DYE_VID)).toBe(true);
    const p2 = new Player(400, 400, new Inventory());
    p2.x = 400; p2.y = 400;
    for (let i = 0; i < 7; i++) p2.updateSocialShadow();
    const c2 = mkCart(22, 400, 400);
    const fx2 = mkDustHooks(p2);
    const spy2 = randQueue([0.5, 0.25, 0.75, 0.99], 0.5);
    priv(c2).hellMinecartDust(p2, fx2.hooks);
    spy2.mockRestore();
    expect(fx2.dusts.every((d) => d.dyeVid === -1)).toBe(true);
  });

  it('C9 结构锁:七面方法+派发 switch+census 转实现锚+新登记债注在案', () => {
    for (const m of ['updateEffectsDust', 'doGemMinecartEffect', 'doSteamMinecartEffect',
      'doExhaustMinecartEffect', 'doConfettiMinecartEffect', 'mechTrailDust', 'hellMinecartDust']) {
      expect(SRC.cart).toContain(`private ${m === 'updateEffectsDust' ? 'updateEffectsDust' : m}(`);
    }
    for (const kase of ['case 25:', 'case 31:', 'case 36:', 'case 32:', 'case 34:', 'case 11:', 'case 22:']) {
      expect(SRC.cart).toContain(kase);
    }
    expect(SRC.cart).toContain('G32-D1');                     // case 11 五点光登记
    expect(SRC.cart).toContain('G32-D2');                     // case 22 lavaMax+=420 登记
    expect(SRC.player).toContain('minecartDyeVid(): number');
    expect(SRC.player).toContain('socialShadowPos2()');
  });
});
