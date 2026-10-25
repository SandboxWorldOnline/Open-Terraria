// ★BJ713-A 登记债清偿·断路域收官刀（锚 memory/bj709g34-minecart-edges.md 登记债
// ①②——先读该档+campaign-playbook 每刀 Checklist;1457/1458 亲读定谳后才动刀）。
//
// 双线定谳（1457 行号主锚;1458 同域 diff=same——Teleport/Spawn/KillMe 三函数对
// 勘,唯 KillMe 含一处 mount 面）:
//
// 件1 [G34 债①] 骑矿车传送被车拖回 →【修·cart 实体随迁 migrateMinecartOnTeleport】
//   定谳:vanilla Teleport（Player.cs:37698-37780）与 Spawn（:37819-37995;魔镜族/
//   回忆药水 :43324/:43459 → Spawn(RecallFromItem)）全文【零】mount/Dismount 面
//   ——矿车=MountID.Sets.Cart 族 mount 状态（非实体）,position 迁移即整体随迁=
//   落点仍在车上;矿车不在 dismountsOnItemUse 三员（55/56/61 Rat/Bat/Pixie,
//   Mount.cs:2376/:2434/:2498）→ 使用魔镜不提前卸车;Mount.cs 零 teleport 引用/
//   零脱轨强卸。仓内车=props 实体且 fixedUpdate 每拍锁玩家回车位（玩家坐骑位回写
//   段 :627-628,entities.update 在 player.fixedUpdate 之后同拍即锁回）→ 不随迁=
//   传送位移下一拍被车拖回=传送失效。等价面=车坐标/速度镜像玩家传送终值+fallStart
//   重置（Teleport :37739/Spawn ResetFallDamage :37924）;接线面=fireRecallTeleport
//   （五种 kind 单口）+teleportToMouse（混乱之杖 style1/F10）+wormholeTeleportTo
//   （虫洞/团结 style3）+teleportWhenReadyInner（晶塔 style9/地图选点,teleportNear
//   三落位支单口汇线）。playerNoSpaceTeleport=常规坐骑下坐后置位（结构不可达矿车）
//   /respawnPlayer=死亡已卸（件2）均不接。
//
// 件2 [G34 债②] p.dead 后矿车仍挂载 →【修·settlePlayerDeath 头段 dismountMinecart】
//   定谳:vanilla KillMe :39209 `mount.Dismount(this)`——死亡无条件卸坐骑（矿车
//   Cart mount 无特例分支;原版序=KillMe_DustExplosion 后、dead=true 前）。仓内
//   等价=死亡结算单点 settlePlayerDeath（damagePlayer 致死支/Player.fixedUpdate
//   hp<=0 过渡块/联机 onPlayerHurt 三入口共用,幂等门 __swDeathSettled）头段
//   dismount。不卸=尸体随车（车 fixedUpdate 死亡相照跑每拍回写 p.x/p.y）+重生
//   被拖回（placePlayerAtSpawn 后同拍 entities.update 锁回旧车位）。重生拍 mount
//   初值=vanilla 步行（Spawn 无 mount 面,死亡已卸）。
//
// 件3 [G34 债①连带] recall 'spawn' 支 lavaTime=lavaMax 读聚合 →【修·equipStats.
//   lavaMax+cartLavaMaxBonus】
//   定谳:vanilla :37874 lavaTime=lavaMax 同拍值【含坐骑面】（UpdateEffects :25855
//   先于 ItemCheck :43324 同帧序——骑 Hell 车 +420（Mount.cs:5138）;且传送不卸
//   mount=随迁后仍骑乘,后续拍帽持续含 420,:27930 钳不回吞）。旧读 equipStats
//   单面=0（无配饰时）,骑 Hell 车召回宽限面缺失;G31 A1/A2 锁随本刀更新（G29
//   respawnPlayer 锁不动——死亡已卸=equip 面单读原式即 vanilla 等价）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Minecart } from '../src/entities/Minecart';
import { Game } from '../src/core/Game';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TileStore } from '../src/world/TileStore';
import { World } from '../src/world/World';
import { placeTrack, frameTrackArea } from '../src/world/MinecartTrack';
import type { GameHooks } from '../src/entities/types';
import type { VDust } from '../src/fx/VanillaDust';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = {
  game: readFileSync(join(ROOT, 'src/core/Game.ts'), 'utf8'),
  player: readFileSync(join(ROOT, 'src/entities/Player.ts'), 'utf8'),
  cart: readFileSync(join(ROOT, 'src/entities/Minecart.ts'), 'utf8'),
};

const iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];
const proto = Game.prototype as unknown as Record<string, unknown>;
const TILE = 16;

const mkDust = (type: number, over: Partial<VDust> = {}): VDust => ({
  active: true, x: 0, y: 0, vx: 0, vy: 0, type, scale: 1, alpha: 0, fadeIn: 0,
  noGravity: false, noLight: false, noLightEmittance: false, color: null, rotation: 0,
  fx: 0, fy: 0, followPlayer: false, followOnce: false, dyeVid: -1, followEnt: null, attractTo: null,
  ...over,
}) as VDust;

/** 直驱矿车夹具（G34 同款:手置状态=零物理干扰） */
function mkCart(mountId: number, x = 1000, y = 500): Minecart {
  const c = new Minecart();
  c.mountId = mountId;
  c.applyMountStats();
  c.mounted = true;
  c.x = x; c.y = y;
  return c;
}

/** 矿车 fixedUpdate 最小钩桩（G34 makeCartHooks 同形） */
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

/** 贴轨世界（G34 B1 同款:12 行铺轨 8..37） */
function makeTrackStore(): TileStore {
  const st = new TileStore(60, 40);
  for (let k = 8; k < 38; k++) { placeTrack(st, k, 12, 0); frameTrackArea(st, k, 12); }
  return st;
}

/** 干地世界（G34 makeGroundWorld 同款） */
function makeGroundWorld(seed: string, ground = 150) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, ground, 1, 0, 0);
    w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  }
  return w;
}

/** fireRecallTeleport 驱动 fakeThis（bj569 fakeThis 驾驭判例:prototype 方法
 *  .call 窄视图;Game 侧重面全桩,recall 尘/音/相机/落位链不入测） */
function recallFake(p: Player, w: World, minecart: Minecart | null,
  over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    player: p, world: w, minecart,
    spawnPlacementCoords: () => [30 * TILE + 8, (150 - 3) * TILE],
    requestMagicConchTeleportPosition: () => ({ x: 8 * TILE, y: 100 * TILE }),
    requestDemonConchSpot: () => ({ x: 8 * TILE, y: 160 * TILE }),
    requestTeleportationPotionSpot: () => ({ x: 12 * TILE, y: 120 * TILE }),
    sfx: { play: () => {} },
    recallSparkleDust: () => {}, conchWaterDust: () => {},
    shellphoneSpawnDust: () => {}, teleportStyle2Dust: () => {},
    setSpectating: () => {}, startCameraTransitionForPlayerTeleport: () => {},
    updateUnbreakableWallScan: () => {},
    // ★this.* 内呼面照 bj569 判例挂 prototype 方法（migrateMinecartOnTeleport）
    migrateMinecartOnTeleport: proto.migrateMinecartOnTeleport,
    cb: { onInventoryChanged: () => {} },
    ...over,
  };
}

/** settlePlayerDeath 驱动 shell（hardcore-extra-life deathShell 同款:
 *  Object.create(Game.prototype)——dismountMinecart 经原型链在位） */
function deathShell(w: World, minecart: Minecart | null): Record<string, any> {
  const g = Object.create(Game.prototype) as Record<string, any>;
  const p = new Player(24 * TILE, 20 * TILE, new Inventory());
  g.player = p;
  g.world = w;
  g.minecart = minecart;
  g.torchGod = { abort: () => {} };
  g.coinsOwned = () => 0;
  g.spawnDrop = () => null;
  g.lostCoins = 0;
  g.cb = { onToast: () => {}, onHardcoreDeath: () => {} };
  return g;
}

// =====================================================================
// §A 件1 [G34 债①] 传送随迁（migrateMinecartOnTeleport + 四接线面）
// =====================================================================
describe('BJ713-A §A G34 债① 骑矿车传送随迁（vanilla Teleport/Spawn 零 Dismount）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('A1 随迁机械面:车坐标/速度镜像玩家传送终值+fallStart 重置;mounted 保持（vanilla 不卸 mount）;无车/未骑=零操作不炸', () => {
    const p = new Player(0, 0, new Inventory());
    p.x = 100; p.y = 200; p.vx = 0; p.vy = 0.001;   // 海螺双败 0.001f 档（:56824）
    const c = mkCart(22, 5000, 800);
    c.vx = 13; c.vy = 3; c.fallStart = 4;
    (proto.migrateMinecartOnTeleport as (this: unknown) => void).call({ minecart: c, player: p });
    expect(c.x).toBe(100);                                   // 坐标镜像（Teleport :37711 position=newPos）
    expect(c.y).toBe(200);
    expect(c.vx).toBe(0);                                    // 速度镜像玩家终值
    expect(c.vy).toBe(0.001);
    expect(c.fallStart).toBe(Math.trunc(200 / 16));          // :37739 fallStart=(int)(position.Y/16f)
    expect(c.mounted).toBe(true);                            // ★保持骑乘（vanilla mount 态随迁本相）
    // 无车/未挂载:守卫零操作（不炸、不动既有字段）
    (proto.migrateMinecartOnTeleport as (this: unknown) => void).call({ minecart: null, player: p });
    const idle = mkCart(13, 1, 2); idle.mounted = false; idle.x = 7;
    (proto.migrateMinecartOnTeleport as (this: unknown) => void).call({ minecart: idle, player: p });
    expect(idle.x).toBe(7);
  });

  it('A2 拖回机制判别锁:未随迁态（p 置远处而车留旧轨）下 cart.fixedUpdate 同拍锁回——随迁是承重面（G34① 断路域机制在案）', () => {
    const st = makeTrackStore();
    const p = new Player(0, 0, new Inventory());
    const c = mkCart(13, 9 * TILE, 12 * TILE + 6 - 52);       // 贴轨位（G34 B1 同式）
    c.vy = 0;
    p.ridingCart = true; p.cart = c;
    const destX = 55 * TILE, destY = 30 * TILE;               // 传送终位（远处）
    p.x = destX; p.y = destY; p.vx = 0; p.vy = 0;
    c.fixedUpdate(1 / 60, makeCartHooks(p, st));              // 实体更新（player 后同拍）
    expect(p.x).toBe(c.x);                                    // 玩家坐骑位回写段:玩家位=车位
    expect(Math.abs(p.x - destX)).toBeGreaterThan(200);       // 传送位移被吞（拖回）
  });

  it("A3 fireRecallTeleport 行为面（fakeThis 驱动）:魔镜 'spawn' 支——玩家与车同落出生点、保持骑乘、fallStart 重置、lavaImmuneTicks=聚合", () => {
    const w = makeGroundWorld('bj713a-a3');
    const p = new Player(21 * TILE, 149 * TILE - 42, new Inventory());
    const c = mkCart(22, p.x, p.y);                           // Hell 车
    p.ridingCart = true; p.cart = c;
    p.cartLavaMaxBonus = 420;                                 // fixedUpdate 逐拍写产物（G34 B1 锁）
    const destX = 30 * TILE + 8, destY = (150 - 3) * TILE;
    (proto.fireRecallTeleport as (this: unknown, c: unknown) => void)
      .call(recallFake(p, w, c, { spawnPlacementCoords: () => [destX, destY] }),
        { vid: 50, kind: 'spawn', triggerAt: 1, consume: false });
    expect(p.x).toBe(destX);                                  // 传送成立（旧=下一拍被拖回）
    expect(p.y).toBe(destY);
    expect(c.x).toBe(destX);                                  // ★车随迁同落
    expect(c.y).toBe(destY);
    expect(c.vx).toBe(0);                                     // Spawn :37925-37926 velocity 归零镜像
    expect(c.vy).toBe(0);
    expect(c.fallStart).toBe(Math.trunc(destY / 16));
    expect(c.mounted).toBe(true);                             // vanilla 不卸 mount（落点仍在车上）
    expect(p.ridingCart).toBe(true);
    expect(p.cartLavaMaxBonus).toBe(420);                     // 随迁后仍骑乘=提帽保持（钳不回吞）
    expect(p.lavaImmuneTicks).toBe(420);                      // ★聚合 0+420（旧=equipStats 单读 0）
  });

  it('A4 lava 聚合分档:配饰 906+Hell 车 → 840;无车 → equip 面;Teleport 面（ocean kind）不写 lavaImmuneTicks 且车照随迁', () => {
    const w = makeGroundWorld('bj713a-a4');
    // 护身符 420 + Hell 车 420 → 聚合 840（vanilla :37874 同拍 lavaMax 含坐骑面）
    const pCharm = new Player(21 * TILE, 149 * TILE - 42, new Inventory());
    pCharm.inv.armor[4] = { id: iid(906), stack: 1 };
    const c1 = mkCart(22, pCharm.x, pCharm.y);
    pCharm.ridingCart = true; pCharm.cart = c1; pCharm.cartLavaMaxBonus = 420;
    (proto.fireRecallTeleport as (this: unknown, c: unknown) => void)
      .call(recallFake(pCharm, w, c1), { vid: 50, kind: 'spawn', triggerAt: 1, consume: false });
    expect(pCharm.equipStats.lavaMax).toBe(420);              // 配饰面夹具自证（G34 B2 同款）
    expect(pCharm.lavaImmuneTicks).toBe(840);                 // ★420+420 聚合（旧=420 丢坐骑面）
    // 无车:equip 单面等价（bonus=0 聚合恒等）
    const pWalk = new Player(21 * TILE, 149 * TILE - 42, new Inventory());
    pWalk.inv.armor[4] = { id: iid(906), stack: 1 };
    (proto.fireRecallTeleport as (this: unknown, c: unknown) => void)
      .call(recallFake(pWalk, w, null), { vid: 50, kind: 'spawn', triggerAt: 1, consume: false });
    expect(pWalk.lavaImmuneTicks).toBe(420);
    // Teleport 面（海螺 kind='ocean'）:vanilla 无 Spawn 复位段=lavaImmuneTicks 不写;车随迁照走
    const pConch = new Player(21 * TILE, 149 * TILE - 42, new Inventory());
    const c2 = mkCart(13, pConch.x, pConch.y);
    pConch.ridingCart = true; pConch.cart = c2;
    pConch.lavaImmuneTicks = 123;                             // 镜前耗损残值（Teleport 面应原样保持）
    (proto.fireRecallTeleport as (this: unknown, c: unknown) => void)
      .call(recallFake(pConch, w, c2), { vid: 4263, kind: 'ocean', triggerAt: 1, consume: false });
    expect(pConch.lavaImmuneTicks).toBe(123);                 // Teleport 面零写（G31 A2 域保持）
    expect(c2.x).toBe(8 * TILE);                              // 落海螺点=车随迁
    expect(c2.mounted).toBe(true);
  });

  it('A5 结构锁:随迁助手+四接线面在案;respawn face equip 单读原式恰一处;G31/G34 邻锁不破', () => {
    // 助手定义 + 四接线面（fireRecallTeleport/wormholeTeleportTo/teleportWhenReadyInner/teleportToMouse）
    // ★BJ714-A:private→public（GameHooks 实体侧单口,BJ108 同先例）——锁随刀升格
    expect(SRC.game).not.toContain('private migrateMinecartOnTeleport(): void {');
    expect(SRC.game).toContain('migrateMinecartOnTeleport(): void {');
    const wired = SRC.game.match(/this\.migrateMinecartOnTeleport\(\);/g) ?? [];
    expect(wired.length).toBe(4);
    for (const fn of ['fireRecallTeleport', 'wormholeTeleportTo', 'teleportWhenReadyInner', 'teleportToMouse']) {
      const i = SRC.game.indexOf(`private ${fn}(`) >= 0
        ? SRC.game.indexOf(`private ${fn}(`)
        : SRC.game.indexOf(`${fn}(`);
      expect(i, fn).toBeGreaterThan(0);
      expect(SRC.game.slice(i, i + 9000)).toContain('this.migrateMinecartOnTeleport();');
    }
    // respawnPlayer 不接（死亡已卸=vanilla Spawn(revive) mount inactive;防无据扩刀）
    const iResp = SRC.game.indexOf('respawnPlayer() {');
    expect(SRC.game.slice(iResp, iResp + 2600)).not.toContain('migrateMinecartOnTeleport');
    // lava 双面:聚合式恰 1 处（recall spawn 支）+ equip 单读恰 1 处（respawn face）
    expect((SRC.game.match(/p\.lavaImmuneTicks = p\.equipStats\.lavaMax \+ p\.cartLavaMaxBonus;/g) ?? []).length).toBe(1);
    expect((SRC.game.match(/p\.lavaImmuneTicks = p\.equipStats\.lavaMax;/g) ?? []).length).toBe(1);
    // G34 B6 邻锁域:lavaImmuneTicks 直写总数仍 2（respawn+recall）;dismountMinecart 清位在案
    expect((SRC.game.match(/p\.lavaImmuneTicks = [^;]+;/g) ?? []).length).toBe(2);
    expect(SRC.game).toContain('p.cartLavaMaxBonus = 0;');
    // 定谳判语锚（防回滚=vanilla 语义证据链）
    expect(SRC.game).toContain('Teleport（Player.cs:37698-37780）与 Spawn（:37819-37995,魔镜');
    expect(SRC.game).toContain('dismountsOnItemUse 三员（55/56/61,Mount.cs:2376/:2434/:2498）');
  });
});

// =====================================================================
// §B 件2 [G34 债②] 死亡卸车（settlePlayerDeath = KillMe :39209 等价）
// =====================================================================
describe('BJ713-A §B G34 债② 死亡卸车（KillMe :39209 mount.Dismount 无条件）', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('B1 行为面:settlePlayerDeath 头段卸车——车消亡+四清位+玩家骑乘态解除（respawn 初值=vanilla 步行）', () => {
    const w = makeGroundWorld('bj713a-b1');
    const p0 = new Player(24 * TILE, 20 * TILE, new Inventory());
    const c = mkCart(22, p0.x, p0.y);
    c.vx = 8;
    const g = deathShell(w, c);
    const p = g.player as Player;
    p.dead = true;
    p.ridingCart = true; p.cart = c;
    p.cartLavaMaxBonus = 420;                                 // 骑乘期提帽在位
    p.cartDefenseBonus = 5;                                   // SuperCart 防御加成在位
    (proto.settlePlayerDeath as (this: unknown, pvp: boolean) => void).call(g, false);
    expect(c.dead).toBe(true);                                // 车实体消亡（坐骑语义）
    expect(c.mounted).toBe(false);
    expect(g.minecart).toBe(null);                            // Game 引用清位
    expect(p.ridingCart).toBe(false);                         // 重生拍步行初值
    expect(p.cart).toBe(null);
    expect(p.cartLavaMaxBonus).toBe(0);                       // Hell 提帽解除（:5138 停授）
    expect(p.cartDefenseBonus).toBe(0);                       // SuperCart 防御解除
  });

  it('B2 尸体随车机制判别锁:未卸车态（p.dead 且车仍 mounted）下 cart.fixedUpdate 照跑照锁位——B1 卸车是承重面（G34② 机制在案）', () => {
    const st = makeTrackStore();
    const p = new Player(0, 0, new Inventory());
    const c = mkCart(13, 9 * TILE, 12 * TILE + 6 - 52);
    c.vy = 0;
    p.dead = true;                                            // 死亡相（旧缺陷态:车未卸）
    p.ridingCart = true; p.cart = c;
    const corpseX = 40 * TILE;
    p.x = corpseX; p.y = 12 * TILE;
    c.fixedUpdate(1 / 60, makeCartHooks(p, st));              // entities.update 死亡相照跑
    expect(p.x).toBe(c.x);                                    // 尸体被车锁走（=G34 观察「尸体随车」）
    expect(Math.abs(p.x - corpseX)).toBeGreaterThan(100);
  });

  it('B3 幂等/前置门:二次结算（__swDeathSettled）与非死亡调用（!p.dead）均早退不动矿车', () => {
    const w = makeGroundWorld('bj713a-b3');
    // 二次调用:首调已结算 → 早退,新矿车不被误杀
    const c1 = mkCart(13, 100, 100);
    const g1 = deathShell(w, c1);
    (g1.player as Player).dead = true;
    (g1.player as Player).ridingCart = true;
    (g1.player as Player).cart = c1;
    (proto.settlePlayerDeath as (this: unknown, pvp: boolean) => void).call(g1, false);
    expect(c1.dead).toBe(true);                               // 首调卸车
    const c2 = mkCart(13, 200, 200);                          // 复位引用模拟「又一车」
    g1.minecart = c2;
    (g1.player as Player).ridingCart = true;
    (proto.settlePlayerDeath as (this: unknown, pvp: boolean) => void).call(g1, false);
    expect(c2.dead).toBe(false);                              // 幂等门:不重复结算
    // 非死亡调用:直接早退
    const c3 = mkCart(13, 300, 300);
    const g2 = deathShell(w, c3);
    (g2.player as Player).dead = false;
    (g2.player as Player).ridingCart = true;
    (proto.settlePlayerDeath as (this: unknown, pvp: boolean) => void).call(g2, false);
    expect(c3.dead).toBe(false);
    expect((g2.player as Player).ridingCart).toBe(true);
  });

  it('B4 结构锁:KillMe :39209 锚注+卸车行在 settlePlayerDeath 头段;三入口共用单点（F2 管线不破）;常规坐骑邻债注在案（不扩刀防误伤）', () => {
    const iSettle = SRC.game.indexOf('settlePlayerDeath(pvp: boolean): void {');
    expect(iSettle).toBeGreaterThan(0);
    const head = SRC.game.slice(iSettle, iSettle + 1600);
    expect(head).toContain('KillMe :39209 `mount.Dismount(this)`');
    expect(head).toContain('if (this.minecart) this.dismountMinecart();');
    // 头段位置:幂等门之后（幂等门文本锚在前 400 字内）
    expect(head.indexOf('__swDeathSettled = true;')).toBeGreaterThan(0);
    expect(head.indexOf('if (this.minecart) this.dismountMinecart();'))
      .toBeGreaterThan(head.indexOf('__swDeathSettled = true;'));
    // 常规坐骑死亡不卸=邻域债另案登记注在案（防误扩刀）
    expect(head).toContain('常规坐骑（MountInstance.mount.active）同锚');
    // 三入口仍汇单点:damagePlayer 致死支+联机 onPlayerHurt（Game.ts 两处 this. 调用）
    // + Player.fixedUpdate hp<=0 过渡块（Player.ts 的 game.settlePlayerDeath?.()）
    expect((SRC.game.match(/this\.settlePlayerDeath\(/g) ?? []).length).toBe(2);
    expect(SRC.player).toContain('game.settlePlayerDeath?.(this.lastPvpDeath === true);');
  });
});

// =====================================================================
// §C 域回归锁（防回退面:既有下车链/G34 清位族/G31 邻锁）
// =====================================================================
describe('BJ713-A §C 域回归锁（下车链/G34 清位族未受扰）', () => {
  it('C1 dismountMinecart 四清位+车消亡语义不变（G34/D32 既有面零扰动）;R 键/轨道右键下车路径在案', () => {
    const iDismount = SRC.game.indexOf('private dismountMinecart(): void {');
    const body = SRC.game.slice(iDismount, iDismount + 700);
    expect(body).toContain('p.ridingCart = false;');
    expect(body).toContain('p.cart = null;');
    expect(body).toContain('p.cartDefenseBonus = 0;');
    expect(body).toContain('p.cartLavaMaxBonus = 0;');
    expect(body).toContain('cart.mounted = false;');
    expect(body).toContain('cart.dead = true;');
    // R 键下车（:15400 面）与轨道右键下车（minecartTrackInteraction）仍走 dismountMinecart
    const iR = SRC.game.indexOf("inp.downAction('QuickMount') && !this.cartKeyLatch");
    expect(SRC.game.slice(iR, iR + 200)).toContain('this.dismountMinecart();');
    expect(SRC.game).toContain('private minecartTrackInteraction(tx: number, ty: number): boolean {');
  });

  it('C2 Minecart 玩家锁位段未受扰（随迁修的是 Game 侧传送面,车 tick 运动学零改动）', () => {
    expect(SRC.cart).toContain('p.x = this.x;');
    expect(SRC.cart).toContain('p.y = this.y;');
    expect(SRC.cart).toContain('p.cartLavaMaxBonus = this.mountId === 22 ? 420 : 0;');
    // G34 三清位（脱轨下车/坠界）保持
    expect((SRC.cart.match(/p\.cartLavaMaxBonus = 0;/g) ?? []).length).toBe(2);
  });

  it('C3 Player 岩浆段聚合/钳零改动（G34 B2/B4/B6 域保持）+ BJ713-A 判语注在案', () => {
    expect(SRC.player).toContain('const lavaMax = eqM.lavaMax + this.cartLavaMaxBonus;');
    expect(SRC.player).toContain('if (this.lavaImmuneTicks > lavaMax) this.lavaImmuneTicks = lavaMax;');
    expect(SRC.player).toContain('recall Spawn face');
    expect(SRC.player).toContain('读同一聚合（★BJ713-A=G34 登记债①清偿');
  });
});
