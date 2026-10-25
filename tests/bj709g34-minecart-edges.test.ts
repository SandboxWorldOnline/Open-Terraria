// ★BJ709-G34 新登记债清偿·矿车域三件（G32 新登记 D1/D2/D3——锚 memory/
// bj709g32-final-residuals.md,先读该档+campaign-playbook 每刀 Checklist;1457
// 亲读逐件定谳后才动刀）。判语:
//
// 件1 [G32-D1] case 11 Mech 矿车五点光 →【修·mechCartLights 纯函数+Renderer 注入】
//   定谳:vanilla Mount.UpdateEffects case 11 头段（Mount.cs:5072-5094）:
//   vector5=(0.4,0.12,0.15),num8=1+|vx|/RunSpeed×2.5（RunSpeed=Mount getter
//   :453-486——矿车族无 swimSpeed 态支,SuperCart 档 20/常档 MountData.runSpeed
//   =13）,num9（sign(vx)||direction,:5076-5080）只喂尘面;netMode==2 早退
//   （:5081-5084,服务器域）后 vector5×=num8,五点 AddLight(Center/Top/Bottom/
//   Left/Right)——AddLight(Vector2)=(int)(x/16),(int)(y/16) tile 下取整
//   （Lighting.cs:144-148）;骑乘盒=车盒 20×(42+heightBoost)（SetMount
//   PlayerSize 委派改盒 :6309-6320,骑乘者与车同盒）。仓内零发射方（G32 只落
//   尘面）→ 落地=Minecart.mechCartLights 纯函数（五点逐位）+Renderer 车身绘制
//   块前置渲染帧注入（mountId 11 门;坐骑灯惯例=状态派生量 tick/渲染域同值,
//   拍位差 ≤1 帧;骑乘态与 sitting/sleeping 双绘互斥=无双加;LightingEngine
//   perFrame 逐周期消费无累积）。
//
// 件2 [G32-D2] case 22 Hell 矿车 lavaMax+=420 →【修·逐拍提帽+聚合消费+无条件钳】
//   定谳:vanilla :5138 `mountedPlayer.lavaMax += 420`（UpdateEffects case 22 首行,
//   装备面——lavaMax 单帧累计字段:ResetEffects :18779 清零→ApplyEquips 配饰
//   :15286/:15295（906/4038/3999/4003+908/5000 lavaRose 面）→mount.UpdateEffects
//   :25855 坐骑面→岩浆段 :27880-27932 消费,同帧序）。语义=提帽非回填（lavaTime
//   只在离浆/免疫态 +1/tick 恢复 :27926）。仓内 equipStats.lavaMax 只有配饰面
//   → 落地=Minecart.fixedUpdate 逐拍写 p.cartLavaMaxBonus（cartDefenseBonus 同
//   模式;下车三位清零:脱轨下车/坠界/dismountMinecart）+Player 岩浆段
//   lavaMax=eqM.lavaMax+bonus 两门聚合+:27930-27932 无条件钳（仓内原缺——护身符
//   域静止面不可达[lavaImmuneTicks 只由恢复/Spawn 写入且均以 lavaMax 为帽],坐骑
//   动态面落地后下车拍即需=同刀承重）。recall/respawn 两 Spawn face 只接
//   equipStats 面（vanilla :37874 lavaTime=lavaMax 同拍值含坐骑面,但仓矿车实体
//   不随传送迁移=recall-while-riding 位移被车拖回系域级既有缺口,边角债登记不扩刀）。
//
// 件3 [G32-D3] shadowPos 采样 gfxOffY 域差 →【修·窄修采样并入轨面项】
//   定谳:vanilla UpdateSocialShadow 采样 shadowPos[0]=position+gfxOffY
//   （Player.cs:16722-16723）——骑矿车 onTrack 拍玩家单字段 gfxOffY 被
//   TrackRotation 返回值【整体覆写】（:28325 `gfxOffY = Minecart.TrackRotation
//   (…)`）⇒ 采样天然含轨面项;仓内贴轨值存 cart.gfxOffY（Minecart.fixedUpdate
//   :485）,p.gfxOffY 骑乘态恒 0 → 采样少含轨面项,Hell 尾焰轨迹起点 Y 偏 ≤轨
//   gfxOffY（平轨零差）。窄修=采样聚合 this.gfxOffY+cart.gfxOffY（ridingCart&&cart
//   门;三态互斥口径与 PositionInWorld :10119 聚合同式;滚轴鞋贴轨仍写玩家字段
//   =已含）。spY 仍单源,Hell 尾焰/shadowLagDist 两消费面同享修正。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Minecart, mechCartLights } from '../src/entities/Minecart';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TileStore, LIQUID_TYPE } from '../src/world/TileStore';
import { World } from '../src/world/World';
import { placeTrack, frameTrackArea, getOnTrack } from '../src/world/MinecartTrack';
import type { GameHooks } from '../src/entities/types';
import type { VDust } from '../src/fx/VanillaDust';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = {
  cart: readFileSync(join(ROOT, 'src/entities/Minecart.ts'), 'utf8'),
  player: readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8'),
  renderer: readFileSync(join(ROOT, 'src/render/Renderer.ts'), 'utf8'),
  game: readFileSync(join(ROOT, 'src/core/Game.ts'), 'utf8'),
};

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

const priv = (o: object): Record<string, any> => o as unknown as Record<string, any>;

const mkDust = (type: number, over: Partial<VDust> = {}): VDust => ({
  active: true, x: 0, y: 0, vx: 0, vy: 0, type, scale: 1, alpha: 0, fadeIn: 0,
  noGravity: false, noLight: false, noLightEmittance: false, color: null, rotation: 0,
  fx: 0, fy: 0, followPlayer: false, followOnce: false, dyeVid: -1, followEnt: null, attractTo: null,
  ...over,
}) as VDust;

/** 直驱矿车夹具（G32 同款:面方法 priv 直调/手置状态=零物理干扰） */
function mkCart(mountId: number, x = 1000, y = 500): Minecart {
  const c = new Minecart();
  c.mountId = mountId;
  c.applyMountStats();
  c.mounted = true;
  c.x = x; c.y = y;
  return c;
}

/** 矿车 fixedUpdate 最小钩桩（G32 mkDustHooks 同形） */
function makeCartHooks(p: Player, st?: TileStore): GameHooks {
  return {
    world: { store: st ?? new TileStore(40, 40) } as never,
    player: p as never,
    enemies: () => [], critters: () => [], npcs: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {},
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    showPickupLabel: () => {},
    spawnDust: () => mkDust(65),
  } as unknown as GameHooks;
}

/** 真实 World 玩家钩桩（G20 同款;damagePlayer=spy 供岩浆伤害面计数） */
function makeWorldHooks(w: World) {
  return {
    world: w, player: null as unknown,
    enemies: () => [], critters: () => [], npcs: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
    spawnParticles: () => {}, spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: vi.fn((): number => 0),
    notifyInventoryChanged: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, cutTile: () => {},
  } as unknown as GameHooks & { damagePlayer: ReturnType<typeof vi.fn> };
}

/** 干地世界（G20 makeGroundWorld 同款） */
function makeGroundWorld(seed: string, ground = 150) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, ground, 1, 0, 0);
    w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  }
  return w;
}

/** 岩浆池世界（G20 makePoolWorld 同款） */
function makeLavaPoolWorld(seed: string, top = 90, bottom = 137) {
  const w = new World(60, 220, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, LIQUID_TYPE.LAVA);
  }
  return w;
}

// =====================================================================
// §A 件1 [G32-D1] case 11 Mech 矿车五点光（mechCartLights 纯函数+Renderer 注入）
// =====================================================================
describe('BJ709-G34 §A G32-D1 机械矿车五点光（Mount.cs:5072-5094）', () => {
  it('A1 静止档:num8=1 → 五点各 (0.4,0.12,0.15);点位=车盒 Center/Top/Bottom/Left/Right 的 tile 下取整（Lighting.cs:144-148）', () => {
    const ls = mechCartLights(100, 500, 20, 54, 0, 13);
    expect(ls).toHaveLength(5);
    expect(ls.map((l) => [l.tx, l.ty])).toEqual([[6, 32], [6, 31], [6, 34], [6, 32], [7, 32]]);
    for (const l of ls) expect([l.r, l.g, l.b]).toEqual([0.4, 0.12, 0.15]);
  });

  it('A2 亚格对齐:盒跨界时 Left/Right 分列（x=112 → Left tx7/Right tx8）,Center/Top/Bottom 各行独立取整', () => {
    const ls = mechCartLights(112, 501, 20, 54, 0, 13);
    expect(ls.map((l) => [l.tx, l.ty])).toEqual([[7, 33], [7, 31], [7, 34], [7, 33], [8, 33]]);
  });

  it('A3 速度档 num8=1+|vx|/RunSpeed×2.5（:5075）:满速 13/13 → ×3.5;SuperCart 档 runSpeed=20（:480-486）', () => {
    const full = mechCartLights(0, 0, 20, 54, 13, 13);
    expect(full[0].r).toBeCloseTo(0.4 * 3.5, 9);
    expect(full[0].g).toBeCloseTo(0.12 * 3.5, 9);
    expect(full[0].b).toBeCloseTo(0.15 * 3.5, 9);
    const sup = mechCartLights(0, 0, 20, 54, 10, 20);          // SuperCart:runSpeed 实参 20
    expect(sup[0].r).toBeCloseTo(0.4 * (1 + (10 / 20) * 2.5), 9);
  });

  it('A4 实体链:cart.runSpeed=MountData 13 常档/SuperCart 20 覆写档——Renderer 注入读同一 getter（Mount.cs:453-486）', () => {
    const c = mkCart(11, 0, 0);                                 // MinecartMech,h=54（heightBoost 12）
    expect(c.h).toBe(54);
    expect(c.runSpeed).toBe(13);                                // MOUNT_DATA['11'].runSpeed
    c.superCart = true;
    expect(c.runSpeed).toBe(20);                                // SuperCartRunSpeed（:483-484）
    c.superCart = false; c.vx = 13;
    const ls = mechCartLights(c.x, c.y, c.w, c.h, Math.abs(c.vx), c.runSpeed);
    expect(ls[0].r).toBeCloseTo(1.4, 9);                        // 满速 3.5 档
  });

  it('A5 结构锁:Renderer mountId 11 门注入在车身绘制块【前】+ mechCartLights 导入/导出在位', () => {
    expect(SRC.renderer).toContain("import { mechCartLights } from '../entities/Minecart';");
    expect(SRC.renderer).toContain('if (cart && cart.mountId === 11 && this.lighting) {');
    expect(SRC.renderer).toContain('mechCartLights(cart.x, cart.y, cart.w, cart.h, Math.abs(cart.vx), cart.runSpeed)');
    const iInject = SRC.renderer.indexOf('if (cart && cart.mountId === 11 && this.lighting) {');
    const iDraw = SRC.renderer.indexOf('if (cart && this.atlas) {');
    expect(iInject).toBeGreaterThan(-1);
    expect(iDraw).toBeGreaterThan(iInject);                     // 注入先于车身绘制块
    expect(SRC.cart).toContain('export function mechCartLights(');
    // 五点 AddLight 逐位注释锚（:5086-:5090）
    expect(SRC.cart).toContain('// :5086 Center');
    expect(SRC.cart).toContain('// :5090 Right');
  });
});

// =====================================================================
// §B 件2 [G32-D2] case 22 Hell 矿车 lavaMax+=420（提帽/聚合/钳三面）
// =====================================================================
describe('BJ709-G34 §B G32-D2 Hell 矿车岩浆宽限提帽 +420（Mount.cs:5138）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('B1 链头:Minecart.fixedUpdate 逐拍写 p.cartLavaMaxBonus——mountId 22 → 420;6/13/11 → 0（无条件=跳轨悬空拍同授,UpdateEffects 无 onTrack 门）', () => {
    const st = new TileStore(60, 40);
    for (let k = 8; k < 38; k++) { placeTrack(st, k, 12, 0); frameTrackArea(st, k, 12); }
    const mk = (mid: number): { c: Minecart; p: Player } => {
      const p = new Player(0, 0, new Inventory());
      const c = new Minecart();
      c.mountId = mid; c.applyMountStats();
      const snap = getOnTrack(st, 9, 12, 9 * 16, 12 * 16 - 40, c.w, c.h);
      c.x = snap ? snap.x : 9 * 16;
      c.y = snap ? snap.y : 12 * 16 + 6 - c.h;
      c.mounted = true;
      return { c, p };
    };
    const hell = mk(22);
    hell.c.fixedUpdate(1 / 60, makeCartHooks(hell.p, st));
    expect(hell.c.onTrackNow).toBe(true);                       // 夹具有效性:确贴轨
    expect(hell.p.cartLavaMaxBonus).toBe(420);                  // ★case 22 装备面
    for (const mid of [6, 13, 11, 25]) {
      const o = mk(mid);
      o.c.fixedUpdate(1 / 60, makeCartHooks(o.p, st));
      expect(o.p.cartLavaMaxBonus, `mount ${mid}`).toBe(0);     // 非 Hell 车零提帽
    }
  });

  it('B2 回复帽:离浆 +1/tick 至 lavaMax=配饰+坐骑聚合——bonus 420 无护身符 → 帽 420;906+bonus → 840;无源 → 0（:27926）', () => {
    const w = makeGroundWorld('g34-b2');
    const game = makeWorldHooks(w);
    const p = new Player(21 * 16, 149 * 16 - 42, new Inventory());
    p.ridingCart = true; p.cart = mkCart(22, p.x, p.y);
    p.cartLavaMaxBonus = 420;                                   // 链头产物（B1 锁）
    p.lavaImmuneTicks = 419;
    p.fixedUpdate(1 / 60, game);
    expect(p.inLava).toBe(false);                               // 夹具有效性:干地
    expect(p.lavaImmuneTicks).toBe(420);                        // 恢复至聚合帽
    p.fixedUpdate(1 / 60, game);
    expect(p.lavaImmuneTicks).toBe(420);                        // 帽持位不越界
    // 配饰面+坐骑面聚合（Player.cs:15286/:15295 与 :5138 相加=单帧累计字段现值）
    const pCharm = new Player(21 * 16, 149 * 16 - 42, new Inventory());
    pCharm.inv.armor[4] = { id: iid(906), stack: 1 };           // 熔岩护身符 420
    pCharm.ridingCart = true; pCharm.cart = mkCart(22, pCharm.x, pCharm.y);
    pCharm.cartLavaMaxBonus = 420;
    pCharm.lavaImmuneTicks = 839;
    pCharm.fixedUpdate(1 / 60, game);
    expect(pCharm.equipStats.lavaMax).toBe(420);                // 配饰面夹具自证
    expect(pCharm.lavaImmuneTicks).toBe(840);                   // 420+420 聚合帽
    // 无宽限源零恢复（防幻影）
    const p0 = new Player(21 * 16, 149 * 16 - 42, new Inventory());
    p0.lavaImmuneTicks = 0;
    p0.fixedUpdate(1 / 60, game);
    expect(p0.lavaImmuneTicks).toBe(0);
  });

  it('B3 可感知主面:骑 Hell 车宽限 420 拍浸浆零伤;第 421 拍起 80 伤站开火（vanilla 提帽 7s 宽限本相）', () => {
    const dry = makeGroundWorld('g34-b3-dry');
    const dryGame = makeWorldHooks(dry);
    const p = new Player(21 * 16, 149 * 16 - 42, new Inventory());
    p.ridingCart = true; p.cart = mkCart(22, p.x, p.y);
    p.cartLavaMaxBonus = 420;
    p.lavaImmuneTicks = 420;                                    // 已回满态（B2 帽）
    p.fixedUpdate(1 / 60, dryGame);                             // 干地拍:夹具起步（无伤）
    expect(dryGame.damagePlayer).not.toHaveBeenCalled();
    const pool = makeLavaPoolWorld('g34-b3-pool');
    const poolGame = makeWorldHooks(pool);
    p.x = 21 * 16; p.y = 136 * 16 - 42;                         // G20 A1 同位（池内）
    for (let t = 0; t < 420; t++) p.fixedUpdate(1 / 60, poolGame);
    expect(p.inLava).toBe(true);                                // 夹具有效性:确在岩浆中
    expect(p.lavaImmuneTicks).toBe(0);                          // 宽限恰好耗尽
    expect(poolGame.damagePlayer).not.toHaveBeenCalled();       // ★420 拍零伤（旧=立即开火）
    p.fixedUpdate(1 / 60, poolGame);
    expect(poolGame.damagePlayer).toHaveBeenCalled();           // 宽限尽 → 80 伤站
  }, 120000);

  it('B4 无条件钳（:27930-27932）:下车拍（bonus 清 0）超额宽限立即截断——840→420;无源 500→0', () => {
    const w = makeGroundWorld('g34-b4');
    const game = makeWorldHooks(w);
    const pCharm = new Player(21 * 16, 149 * 16 - 42, new Inventory());
    pCharm.inv.armor[4] = { id: iid(906), stack: 1 };
    pCharm.cartLavaMaxBonus = 0;                                // 下车拍:提帽已解除
    pCharm.lavaImmuneTicks = 840;                               // 骑乘期回满的聚合宽限
    pCharm.fixedUpdate(1 / 60, game);
    expect(pCharm.lavaImmuneTicks).toBe(420);                   // ★钳到配饰面
    const p0 = new Player(21 * 16, 149 * 16 - 42, new Inventory());
    p0.cartLavaMaxBonus = 0;
    p0.lavaImmuneTicks = 500;
    p0.fixedUpdate(1 / 60, game);
    expect(p0.lavaImmuneTicks).toBe(0);                         // 无源钳到 0
  });

  it('B5 下车清零:脱轨方向键沿下车（fixedUpdate onWrongGround 支）→ bonus/ridingCart/cart 三清', () => {
    const st = new TileStore(40, 40);
    for (let x = 0; x < 40; x++) st.setTileSilent(x, 20, 1, 0, 0);   // 实心地面行（无轨）
    const p = new Player(0, 0, new Inventory());
    const c = new Minecart();
    c.mountId = 22; c.applyMountStats();
    c.x = 10 * 16; c.y = 20 * 16 - c.h;
    c.vy = 0; c.mounted = true;
    p.ridingCart = true; p.cart = c;
    p.cartLavaMaxBonus = 420;                                   // 骑乘态提帽在位
    p.inputX = 1;                                               // 0→1 沿 = 脱轨下车门（:326）
    c.fixedUpdate(1 / 60, makeCartHooks(p, st));
    expect(c.dead).toBe(true);
    expect(p.ridingCart).toBe(false);
    expect(p.cartLavaMaxBonus).toBe(0);                         // ★随下车解除
  });

  it('B6 结构锁:聚合单源+两门消费+钳行+三下车清位在案（防回滚）', () => {
    // Player:聚合 const 单源（旧两支内联 `const lavaMax = eqM.lavaMax;` 退役）
    expect((SRC.player.match(/const lavaMax = eqM\.lavaMax;/g) ?? []).length).toBe(0);
    expect(SRC.player).toContain('const lavaMax = eqM.lavaMax + this.cartLavaMaxBonus;');
    expect(SRC.player).toContain('if (this.lavaImmuneTicks > lavaMax) this.lavaImmuneTicks = lavaMax;');
    expect(SRC.player).toContain('cartLavaMaxBonus = 0;');
    // Minecart:逐拍写 + 脱轨/坠界两清位
    expect(SRC.cart).toContain('p.cartLavaMaxBonus = this.mountId === 22 ? 420 : 0;');
    expect((SRC.cart.match(/p\.cartLavaMaxBonus = 0;/g) ?? []).length).toBe(2);
    // Game.dismountMinecart 第三清位（G31 A2「Game.ts lavaImmuneTicks 直写恰两处」不受扰）
    expect(SRC.game).toContain('p.cartLavaMaxBonus = 0;');
    expect((SRC.game.match(/p\.lavaImmuneTicks = [^;]+;/g) ?? []).length).toBe(2);
  });
});

// =====================================================================
// §C 件3 [G32-D3] shadowPos 采样 gfxOffY 域差（轨面项并入）
// =====================================================================
describe('BJ709-G34 §C G32-D3 shadowPos 采样并入 cart.gfxOffY 轨面项', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('C1 骑车坡面采样:cart.gfxOffY=7 → 3 拍轮转稳态 shadowPos[2].y=y+7（vanilla :28325 整体覆写等价）', () => {
    const p = new Player(400, 400, new Inventory());
    p.x = 1000; p.y = 2000;
    p.ridingCart = true;
    p.cart = mkCart(22, 1000, 2000);
    (p.cart as Minecart).gfxOffY = 7;                           // 轨面纵向补偿（坡面）
    for (let i = 0; i < 7; i++) p.updateSocialShadow();
    expect(p.socialShadowPos2()).toEqual({ x: 1000, y: 2007 }); // ★含轨面项
  });

  it('C2 域分立:平轨 gfxOffY=0 零差;无车时玩家 gfxOffY 域照含（滚轴鞋/台阶补偿不回归）;car=null 不炸', () => {
    const flat = new Player(400, 400, new Inventory());
    flat.x = 1000; flat.y = 2000;
    flat.ridingCart = true;
    flat.cart = mkCart(22, 1000, 2000);                         // gfxOffY 缺省 0（平轨）
    for (let i = 0; i < 7; i++) flat.updateSocialShadow();
    expect(flat.socialShadowPos2().y).toBe(2000);               // 平轨零差
    const walk = new Player(400, 400, new Inventory());
    walk.x = 1000; walk.y = 2000;
    walk.gfxOffY = 3;                                           // 玩家域（台阶/滑轮补偿）
    for (let i = 0; i < 7; i++) walk.updateSocialShadow();
    expect(walk.socialShadowPos2().y).toBe(2003);               // 玩家域保留
    const ghost = new Player(400, 400, new Inventory());        // ridingCart=true 但 cart=null
    ghost.x = 1000; ghost.y = 2000;
    ghost.ridingCart = true;
    ghost.gfxOffY = 0;
    for (let i = 0; i < 7; i++) ghost.updateSocialShadow();
    expect(ghost.socialShadowPos2().y).toBe(2000);              // 门兜底不 NaN
  });

  it('C3 聚合口径:玩家域 3 + 轨面 7 → 采样 10（三态互斥口径与 PositionInWorld :10119 同式）', () => {
    const p = new Player(400, 400, new Inventory());
    p.x = 1000; p.y = 2000;
    p.gfxOffY = 3;
    p.ridingCart = true;
    p.cart = mkCart(22, 1000, 2000);
    (p.cart as Minecart).gfxOffY = 7;
    for (let i = 0; i < 7; i++) p.updateSocialShadow();
    expect(p.socialShadowPos2().y).toBe(2010);
  });

  it('C4 可感知链:Hell 尾焰轨迹起点吃修正采样——首粒 y=采样(y+7)−车y+锚（G32 C6 基线 +7）', () => {
    const p = new Player(400, 400, new Inventory());
    p.x = 1000; p.y = 2000;
    p.ridingCart = true;
    const c = mkCart(22, 1200, 2050);
    c.gfxOffY = 7;
    p.cart = c;
    for (let i = 0; i < 7; i++) p.updateSocialShadow();
    expect(p.socialShadowPos2()).toEqual({ x: 1000, y: 2007 });
    const recs: Array<Record<string, number>> = [];
    const hooks = makeCartHooks(p);
    (hooks as unknown as { spawnDust: unknown }).spawnDust = (
      x: number, y: number, w: number, h: number, type: number,
    ) => { recs.push({ x, y, w, h, type }); return mkDust(type, { x, y }); };
    const q = [0.5, 0.25, 0.75, 0.99];                          // C6 首粒四掷（门/圆a/圆r/Next(10) 弃）
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => (q.length ? q.shift()! : 0.5));
    priv(c).hellMinecartDust(p, hooks);
    spy.mockRestore();
    expect(recs.length).toBe(11);
    const ay = c.cy + 10;                                       // 锚 Center+(20,10)·Directions
    // value=shadowPos[2]−position+锚:采样项含轨面 +7（本刀）,锚项经 cart RRP
    // 枢轴（Bottom+gfxOffY,:4075 同式）亦含 +7——两项各带=vanilla 双含本相
    // （旧无采样项修复时=2043,恰差轨面 7px=本刀判别量）。
    expect(recs[0].y).toBeCloseTo(2007 - 2050 + ay + 7, 9);
    expect(recs[10].y).toBeCloseTo(ay + 7, 6);                  // 末点 ≈ 锚（t≈1,含 RRP 轨面项）
  });

  it('C5 结构锁:采样行含轨面项+旧「登记」判语退役（G32-D3 销账注在案）', () => {
    expect(SRC.player).toContain(
      'this.spY[0] = this.y + this.gfxOffY + (this.ridingCart && this.cart ? this.cart.gfxOffY : 0);');
    expect(SRC.player).not.toContain('采样少含轨面 gfxOffY 项=登记');   // 旧债判语退役
    expect(SRC.player).toContain('★BJ709-G34（G32-D3 清偿）');
    expect(SRC.cart).toContain('G32-D3');                       // Minecart census 注同步（G32 C9 锚链保持）
    expect(SRC.cart).toContain('G32-D2');
    expect(SRC.cart).toContain('G32-D1');
  });
});
