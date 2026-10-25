// ★BJ704-G20（2026-10-21）二轮审查清偿·坐骑域七件（R10 两 P1 置顶 + R10 P2 三件 +
// G19 新登记两件判语）。锚全在 memory/bj704r10-mount-redblue2.md 与
// memory/bj704g19-registry-sweep.md,反编译 1457 亲读复核：
// · 件1【P1】[r10-mount49-lava-immunity] 熔岩鲨 49 骑者吃岩浆伤害——vanilla buff305
//   授 lavaImmune（UpdateBuffs :9992-9998）,修=lavaTotalImmune 并集补
//   `ridingMount && mount.buff===305`（姊妹面海龟 4 免淹 :5899 先例）;G5 探针
//   lavaImmuneTicks=1e9「观测保险」随刀退役（workaround 掩盖缺口=R10 判语）。
//   lavaVision/fireWalk 两腿另册登记（[g20-buff305-lavavision]/[g20-buff305-firewalk]）。
// · 件2【P1】[r10-wet-mountjump-family] 湿支缺坐骑跳族——vanilla JumpMovement 单块
//   无干湿分裂（外门 :20845 canJumpAgain_Unicorn/Santank/WoFGoat/Basilisk 湿态照常
//   放行;selection :20875-20900 坐骑族在 flag13/瓶族【前】）;修=湿链补 mountJump
//   分支（镜像干支）+ 链前 per-tick 回满（:26258 vy==0→RefreshDoubleJumps 湿位）+
//   优先序修正（骑独角兽+瓶湿态按跳 → vanilla 消费坐骑选项非瓶）。连带干/湿两支
//   performingJump 接线（:22119 独角兽上升尾迹——doubleJumpVisuals 'Unicorn' 消费面
//   原死码激活）。
// · 件3 R10-P2 [r10-quickmount-summon-cced-gate] QuickMount 召唤侧头门缺
//   CCed/tongued/noItems 腿（vanilla :6068 整支 return 不落 QuickMinecart）——修=
//   五腿头门 + 三态返回（'blocked' 不落矿车）。
// · 件4 R10-P2 [r10-wet-cced-terminal-twosided] 湿支 CCed 终端钳双侧 vs vanilla
//   单侧（:27006-27010 `vy+=gravity; if(vy>maxFallSpeed) vy=maxFallSpeed`）——修=
//   CCed 臂单侧钳;非 CCed 的 -lJSpd 上升侧钳（:27569-27596 单侧 per gravDir 无对应,
//   水中受击退面）维持登记 [g20-wet-clamp-rising-side]。
// · 件5 R10-P2 [r10-case49-tilt-deadwrite] G5 case49 倾转死写——bodyRotationFor
//   :1058 写面在,消费门 {7,8,23} 不放行 49（Mounts.ts playerFullRotationOf /
//   Renderer.ts playerMountRotation + drawMountLayer 外门三处扩员;origin=(w/2,h/2)
//   盒心 :3745 同 7/8 支）。
// · 件6 R10-P2 [r10-setmount-box-restore-latent] setMount 缺 vanilla else 支回盒
//   （Mount.cs :6329-6342+ResizeHitbox :29439-29451 持保）——窄修=非委派坐骑直调
//   setMount 回 SW 稳态 20×42（当前玩法不可达,mod/未来通道）;连带折叠凳位不随骑
//   继承（stoolInUse 清位——旧态骑 55 后 :6019 凳出口双扣 h=14-26=-12 盒腐化）。
//   mounted 盒 42+heightBoost 全仓近似（驯鹿 0=20×62 vs 仓恒 42）维持登记。
// · 件7 G19 新登记两件判语：[g19-mountjump-residual] ★销案（G19「真活面=下坐后
//   残余 boost」过读——消费面 :26788-26803/:22119 全部 AND hasJumpOption_*,该位
//   ResetEffects :18883-18891 逐拍清、仅 Mount.UpdateEffects 骑乘期重授 → 骑乘期
//   被 stats 覆写支冲掉、下坐后恒假,两态皆死码;山羊/蜥蜴标志位不复位=无消费者怪癖）;
//   [g19-jump-release-zero] 维持登记（机动面批:jumpHold 全体消费者共有近似——
//   翼飞门/飞毯门/坐骑飞行门/瓶族 boost 窗口/本刀 mountJump 门,松键即 jump=0 的
//   相位重构非坐骑域漏行补刀）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { seededRandom, BATTERY_SEED } from './seeded-rng';
import { MountInstance, playerFullRotationOf, bodyRotationFor } from '../src/entities/Mounts';
import { BuffType } from '../src/stats/Buffs';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

type P = import('../src/entities/Player').Player;

const playerSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Player.ts'), 'utf8');
const mountsSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/entities/Mounts.ts'), 'utf8');
const rendererSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/render/Renderer.ts'), 'utf8');
const gameSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/core/Game.ts'), 'utf8');

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

/** 真实 Player 最小钩桩（g16 同款;damagePlayer=spy 供岩浆伤害面计数） */
function makeHooks(w: World) {
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
  } as unknown as Parameters<P['fixedUpdate']>[1] & { damagePlayer: ReturnType<typeof vi.fn> };
}

/** 干地世界（地面 ground 行,num6=1 带:ground≥120 且 y≥80 行） */
function makeGroundWorld(seed: string, ground = 150) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, ground, 1, 0, 0);
    w.store.setTileSilent(x, ground + 1, 1, 0, 0);
  }
  return w;
}

/** 液池世界（liquid 行 top..bottom-1 cols14-28,池底 bottom;高 220 保 wetCollision 扫描界） */
function makePoolWorld(seed: string, liquid: LIQUID_TYPE, top = 90, bottom = 137) {
  const w = new World(60, 220, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, liquid);
  }
  return w;
}

async function makePlayer(xPx: number, yPx: number, accVid?: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  const inv = new Inventory();
  if (accVid !== undefined) inv.armor[4] = { id: iid(accVid), stack: 1 };
  return new Player(xPx, yPx, inv);
}

// ---------------------------------------------------------------------------
// A. 件1【P1】熔岩鲨 49 岩浆免伤（buff305 lavaImmune,Player.cs:9992-9998）
// ---------------------------------------------------------------------------
describe('BJ704-G20 A 熔岩鲨 49 岩浆免伤（R10-P1①）', () => {
  it('A1 骑 49 浸岩浆 90 拍零伤害调用（旧=R10 探针 N2 hp 500→15 边悬停边烧死）', async () => {
    const w = makePoolWorld('bj704g20-a1', LIQUID_TYPE.LAVA);
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 136 * 16 - 42);
    p.mount.setMount(49, p);                                   // 熔岩鲨（buff305）
    expect(p.mount.type).toBe(49);
    p.inputJump = false; p.inputDown = false; p.inputUp = false;
    for (let t = 0; t < 90; t++) p.fixedUpdate(1 / 60, game);
    expect(p.inLava).toBe(true);                               // 夹具有效性:确在岩浆中
    expect(game.damagePlayer).not.toHaveBeenCalled();          // ★免伤（旧=每拍 80 伤）
    expect(p.ridingMount).toBe(true);
  }, 30000);

  it('A2 对照:裸玩家同池伤害调用>0（伤害站点活性自证,非空转门）', async () => {
    const w = makePoolWorld('bj704g20-a2', LIQUID_TYPE.LAVA);
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 136 * 16 - 42);
    for (let t = 0; t < 90; t++) p.fixedUpdate(1 / 60, game);
    expect(p.inLava).toBe(true);
    expect(game.damagePlayer.mock.calls.length).toBeGreaterThan(0);
  }, 30000);

  it('A3 对照:海龟 4 骑者同池照吃伤害（门=buff305 专属,非任意坐骑）', async () => {
    const w = makePoolWorld('bj704g20-a3', LIQUID_TYPE.LAVA);
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 136 * 16 - 42);
    p.mount.setMount(4, p);                                    // 海龟（buff131,无 lava 面）
    for (let t = 0; t < 90; t++) p.fixedUpdate(1 / 60, game);
    expect(p.inLava).toBe(true);
    expect(game.damagePlayer.mock.calls.length).toBeGreaterThan(0);
  }, 30000);

  it('A4 结构锁:lavaTotalImmune 并集含 buff305 腿（防回滚）', () => {
    expect(playerSrc).toContain('|| (this.ridingMount && this.mount.buff === 305);');
  });
});

// ---------------------------------------------------------------------------
// B. 件2【P1】湿支坐骑跳族（JumpMovement :20845 外门 canJumpAgain_* 湿态放行）
// ---------------------------------------------------------------------------
describe('BJ704-G20 B 湿支坐骑特殊跳（R10-P1②）', () => {
  /** 湿夹具:池底骑独角兽稳定（vy==0,回满拍≥2） */
  async function wetUnicorn(seed: string, bottleVid?: number) {
    const w = makePoolWorld(seed, LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 136 * 16 - 42, bottleVid);
    for (let t = 0; t < 30; t++) p.fixedUpdate(1 / 60, game);   // 落底稳定
    expect(p.onGround).toBe(true);
    p.mount.setMount(10, p);                                    // 独角兽（jumpOption Unicorn）
    for (let t = 0; t < 5; t++) p.fixedUpdate(1 / 60, game);    // 池底 vy==0 回满拍
    expect(p.inWater).toBe(true);
    expect(p.mount.mountJumpReady).toBe(true);                  // 回满位（vanilla vy==0 → RefreshDoubleJumps）
    return { p, game };
  }

  it('B1 池底首跳=普通湿跳;空中再按=坐骑特殊跳（jumpHold=20/vy=坐骑档 8.01−grav,★BJ717-A F1/F6 迁移）', async () => {
    const { p, game } = await wetUnicorn('bj704g20-b1');
    // 首跳（池底 vy==0 → 首门普通跳,坐骑档跳参:jumpSpeed 8.01/jumpHeight 10）
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.jumpHold).toBe(10);                                // 普通跳=坐骑档 10（jumpStartedThisTick → sustain 让位）
    p.inputJump = false;
    for (let t = 0; t < 16; t++) p.fixedUpdate(1 / 60, game);   // 耗尽首跳窗（10）+余裕
    expect(p.jumpHold).toBe(0);
    expect(p.mount.mountJumpReady).toBe(true);                  // 首跳不消费坐骑选项（vanilla 净效）
    // 空中再按（jumpEdge）→ 坐骑特殊跳（旧=零响应,R10 探针 N3 hold=0）
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.jumpHold).toBe(20);                                // ★BJ717-A F6 迁移:mountJumpTicks=10×2=20,fire 拍 sustain 不再同拍跑（旧 19≡20-1=R10 N3c 判例,oracle S3:fire 拍原值）
    expect(p.vy).toBeCloseTo(-8.01 + 0.2, 5);                   // ★BJ717-A F1 迁移:fire 拍 vy=arm(-effJumpSpd 坐骑档 8.01)+湿重力 0.2（钉→重力→积分序;旧=钉后置恒 -8.01）
    expect(p.mount.mountJumpReady).toBe(false);                 // 已消费
    expect(p.mount.mountJumpPerforming).toBe(true);
    expect(p.performingJump).toBe('Unicorn');                   // 尾迹旗接线（:22119）
    p.inputJump = false;
  }, 30000);

  it('B2 干支对照:同坐骑陆上空中再跳照常（干支无回归+performingJump 同拍接线）', async () => {
    const w = makeGroundWorld('bj704g20-b2');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 140 * 16);
    for (let t = 0; t < 60; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
    expect(p.onGround).toBe(true);
    p.mount.setMount(10, p);
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game);
    expect(p.mount.mountJumpReady).toBe(true);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    p.inputJump = false;
    for (let t = 0; t < 16; t++) p.fixedUpdate(1 / 60, game);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.jumpHold).toBe(20);                                // ★BJ717-A F6 迁移（旧 19=同拍 sustain -1）
    expect(p.performingJump).toBe('Unicorn');                   // 干支接线（旧=恒 null,'Unicorn' 尾迹死码）
    p.inputJump = false;
  }, 30000);

  it('B3 优先序:骑独角兽+云瓶湿态空中按跳 → 消费坐骑选项非瓶（vanilla selection 坐骑族在瓶族前）', async () => {
    const { p, game } = await wetUnicorn('bj704g20-b3', 53);    // 云瓶（armor[4]）
    expect(p.extraJumps).toEqual(['Cloud']);                    // 池底 vy==0 回满
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    p.inputJump = false;
    for (let t = 0; t < 16; t++) p.fixedUpdate(1 / 60, game);
    expect(p.jumpHold).toBe(0);
    // 空中再按:坐骑选项优先（旧=SW 消费瓶,vanilla 消费坐骑选项——R10 优先序反转）
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBe('Unicorn');
    expect(p.extraJumps).toEqual(['Cloud']);                    // 瓶未被消费
    p.inputJump = false;
    // 选项耗尽后再按:落瓶支（vanilla selection 顺位下探）
    for (let t = 0; t < 24; t++) p.fixedUpdate(1 / 60, game);
    if (p.jumpHold > 0) { for (let t = 0; t < p.jumpHold + 2; t++) p.fixedUpdate(1 / 60, game); }
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBe('Cloud');                     // 瓶支接管（ready=false 后顺位下探）
    expect(p.extraJumps).toEqual([]);
    p.inputJump = false;
  }, 30000);

  it('B4 脚蹼湿态:泳跳优先且不消费坐骑选项（vanilla flag2 → selection 跳过 → flag4 首支）', async () => {
    const { p, game } = await wetUnicorn('bj704g20-b4');
    p.buffs.apply(BuffType.FlipperPotion, 30);                  // 脚蹼药（ignoreWater+accFlipper :10257-59）
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    p.inputJump = false;
    for (let t = 0; t < 16; t++) p.fixedUpdate(1 / 60, game);
    expect(p.jumpHold).toBe(0);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.jumpHold).toBe(10);                                // flag4 泳跳（首门 lJT=坐骑档 10）,非 mountJump 20
    expect(p.mount.mountJumpReady).toBe(true);                  // 未消费
    expect(p.performingJump).toBeNull();
    p.inputJump = false;
  }, 30000);

  it('B5 回满:坐骑跳消费后回池底（vy==0 拍）再武装（vanilla RefreshDoubleJumps 湿位）', async () => {
    const { p, game } = await wetUnicorn('bj704g20-b5');
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    p.inputJump = false;
    for (let t = 0; t < 16; t++) p.fixedUpdate(1 / 60, game);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.mount.mountJumpReady).toBe(false);
    p.inputJump = false;
    for (let t = 0; t < 600 && p.vy !== 0; t++) p.fixedUpdate(1 / 60, game);   // 落回池底
    expect(p.vy).toBe(0);
    p.fixedUpdate(1 / 60, game);                                // vy==0 拍回满
    expect(p.mount.mountJumpReady).toBe(true);
  }, 30000);

  it('B6 结构锁:湿支 mountJump 分支+链前回满位（防回滚）', () => {
    expect(playerSrc).toContain('if (mnt2?.jumpOption && this.vy === 0) this.mount.mountJumpReady = true;');
    expect(playerSrc).toContain('} else if (jumpEdge && mnt2?.jumpOption && this.mount.mountJumpReady');
  });
});

// ---------------------------------------------------------------------------
// C. 件3 R10-P2 QuickMount 召唤侧头门（Player.cs:6068 五腿）
// ---------------------------------------------------------------------------
describe('BJ704-G20 C QuickMount 召唤侧头门（R10-P2③）', () => {
  type FakePlayer = {
    cced: boolean; gravDir: number; dead: boolean;
    buffs: { has(t: unknown): boolean };
    inv: { miscEquips: unknown[]; slots: unknown[] };
  };
  type FakeGame = { player: FakePlayer; useMountItem(vid: number): boolean };

  function fakeQM(over: {
    cced?: boolean; tongued?: boolean; cursed?: boolean; gravDir?: number; dead?: boolean; saddle?: boolean;
  } = {}) {
    const used: number[] = [];
    const slot = over.saddle === false ? null : { id: iid(3260), stack: 1 };   // 独角兽鞍
    const fake: FakeGame = {
      player: {
        cced: over.cced ?? false, gravDir: over.gravDir ?? 1, dead: over.dead ?? false,
        buffs: {
          has: (t: unknown) => (t === BuffType.TheTongue ? (over.tongued ?? false)
            : t === BuffType.Cursed ? (over.cursed ?? false) : false),
        },
        inv: { miscEquips: [null, null, null, null], slots: [slot] },
      },
      useMountItem: (vid: number) => { used.push(vid); return true; },
    };
    return { fake, used };
  }

  async function qm(fake: FakeGame) {
    const { Game } = await import('../src/core/Game');
    const fn = (Game.prototype as unknown as { quickMount(this: FakeGame): string }).quickMount;
    return fn.call(fake);
  }

  it('C1 冻结(CCed) → blocked 且不触物品（旧=冻结玩家按 R 可召唤,R10 :15338 路径）', async () => {
    const { fake, used } = fakeQM({ cced: true });
    expect(await qm(fake)).toBe('blocked');
    expect(used).toEqual([]);
  });

  it('C2 舌缚(tongued buff38) → blocked', async () => {
    const { fake, used } = fakeQM({ tongued: true });
    expect(await qm(fake)).toBe('blocked');
    expect(used).toEqual([]);
  });

  it('C3 诅咒(noItems=buff23 召唤侧唯一源) → blocked', async () => {
    const { fake, used } = fakeQM({ cursed: true });
    expect(await qm(fake)).toBe('blocked');
    expect(used).toEqual([]);
  });

  it('C4 倒挂/死亡 → blocked（FX19 既有两腿保持）', async () => {
    expect(await qm(fakeQM({ gravDir: -1 }).fake)).toBe('blocked');
    expect(await qm(fakeQM({ dead: true }).fake)).toBe('blocked');
  });

  it("C5 干净+鞍在包 → ok（useMountItem 消费）", async () => {
    const { fake, used } = fakeQM({});
    expect(await qm(fake)).toBe('ok');
    expect(used.length).toBe(1);
  });

  it("C6 干净+无鞍 → none（落 QuickMinecart 通道）", async () => {
    const { fake, used } = fakeQM({ saddle: false });
    expect(await qm(fake)).toBe('none');
    expect(used).toEqual([]);
  });

  it('C7 结构锁:头门五腿+调用方仅 none 落矿车（blocked 不落——vanilla 整支 return）', () => {
    expect(gameSrc).toContain("if (p.cced || p.buffs.has(BuffType.TheTongue) || p.buffs.has(BuffType.Cursed)");
    expect(gameSrc).toContain("if (this.quickMount() === 'none') this.tryQuickMinecart();");
    expect(gameSrc).not.toContain('if (!this.quickMount()) this.tryQuickMinecart();');
  });
});

// ---------------------------------------------------------------------------
// D. 件4 R10-P2 湿支 CCed 终端钳单侧（Player.cs:27006-27010）
// ---------------------------------------------------------------------------
describe('BJ704-G20 D 湿支 CCed 单侧钳（R10-P2④）', () => {
  it('D1 冻结拍上升段 vy=-9 不被剪到 -lJSpd（旧双侧钳 -6.01;vanilla 单侧只钳坠落端）', async () => {
    const w = makePoolWorld('bj704g20-d1', LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 120 * 16);              // 池中悬空
    for (let t = 0; t < 5; t++) p.fixedUpdate(1 / 60, game);
    expect(p.inWater).toBe(true);
    p.buffs.apply(BuffType.Frozen, 10);                         // CCed（秒制,G19 判例）
    expect(p.cced).toBe(true);
    p.vy = -9;                                                  // 冻结拍火箭/受击退上升段（|vy|>lJSpd=6.01）
    p.fixedUpdate(1 / 60, game);
    // 期望分解:-9 + lGrav(0.2) + 松键上升衰减 0.01（:8336 既有模型,CCed 清 inputJump
    // 亦入其门）= -8.79;★BJ704-G22 判语:[g20-cced-release-decay] 销案——冻结上升
    // 拍 0.01/t（90t 冻结全程 0.9px）零感知,根修归 [g19-jump-release-zero] 相位族
    // （本 0.01 模型是其家族承载,勿单独再登记）
    // 判别面=无 -lJSpd(-6.01) 上升钳（旧双侧钳 → -6.0,跳变 ~2.8px/t）
    expect(p.vy).toBeCloseTo(-9 + 0.2 + 0.01, 5);
  }, 30000);

  it('D2 冻结拍坠落端钳保持（vy=+9 → lMaxFall=5.01 单侧正钳不回退）', async () => {
    const w = makePoolWorld('bj704g20-d2', LIQUID_TYPE.WATER);
    const game = makeHooks(w);
    const p = await makePlayer(21 * 16, 120 * 16);
    for (let t = 0; t < 5; t++) p.fixedUpdate(1 / 60, game);
    expect(p.inWater).toBe(true);
    p.buffs.apply(BuffType.Frozen, 10);
    p.vy = 9;
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(5.01, 5);                          // maxFallSpeed 钳（vanilla :27007-27009）
  }, 30000);

  it('D3 结构锁:CCed 单侧臂在（防回滚双侧）', () => {
    expect(playerSrc).toContain('if (this.cced) {\n          this.vy += lGrav;\n          if (this.vy > lMaxFall) this.vy = lMaxFall;');
  });
});

// ---------------------------------------------------------------------------
// E. 件5 R10-P2 case49 倾转消费面（G5 半截清偿）
// ---------------------------------------------------------------------------
describe('BJ704-G20 E 熔岩鲨 49 机身倾转消费（R10-P2⑤）', () => {
  it('E1 playerMountRotation 门放行 49（盒心支,非 23 底锚支;零角/非倾转族仍 null）', async () => {
    const { playerMountRotation } = await import('../src/render/Renderer');
    const box = { x: 100, y: 200, w: 20, h: 42 };
    const r = playerMountRotation(49, 0.3, box, 8);
    expect(r).not.toBeNull();
    expect(r!.angle).toBeCloseTo(0.3, 6);
    expect(r!.pivotX).toBeCloseTo(110, 6);                      // w/2
    expect(r!.pivotY).toBeCloseTo(200 + 42 - (42 + 8) / 2, 6);  // 盒心（42+boost=50 → y+17）
    expect(playerMountRotation(49, 0, box, 8)).toBeNull();      // 零角
    expect(playerMountRotation(3, 0.3, box, 20)).toBeNull();    // 非倾转族（海龟）
    const r7 = playerMountRotation(7, 0.25, box, 16);           // 7/8 同支回归
    expect(r7!.pivotY).toBeCloseTo(200 + 42 - (42 + 16) / 2, 6);
  });

  it('E2 playerFullRotationOf 同拍放行（Player 侧消费位,Mounts.ts 门）', () => {
    const m = new MountInstance();
    const view = { x: 100, y: 200, w: 20, h: 42 };
    m.setMount(49, view as never);
    m.fullRotation = 0.25;
    const r = playerFullRotationOf(view, m);
    expect(r).not.toBeNull();
    expect(r!.angle).toBeCloseTo(0.25, 6);
    expect(r!.pivotY).toBeCloseTo(200 + 42 - 25, 6);            // (42+8)/2=25 盒心
    m.fullRotation = 0;
    expect(playerFullRotationOf(view, m)).toBeNull();
  });

  it('E3 端到端:骑 49 下落拍 updateBodyRotation 写面 → 消费链通（旧=写而不读死写）', async () => {
    const w = makeGroundWorld('bj704g20-e3');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 100 * 16);
    p.mount.setMount(49, p);
    p.vy = 0; p.onGround = false;
    let fell = 0, rotFromVy = 0;
    for (let t = 0; t < 60; t++) {
      const vyBefore = p.vy;          // upkeep(:6293) 在本拍重力前读 vy（上拍末值）
      p.fixedUpdate(1 / 60, game);
      if (p.vy > 1) { fell = p.vy; rotFromVy = vyBefore; break; }
    }
    expect(fell).toBeGreaterThan(1);                            // 干路自由落体（canHover 需帧态 4）
    const expectRot = rotFromVy * 0.05 * 1;                     // facing=1（初始右）;:3742 vy×0.05
    expect(p.mount.fullRotation).toBeCloseTo(expectRot, 5);     // 写面（G5 既有）
    expect(playerFullRotationOf(p, p.mount)).not.toBeNull();    // ★消费面（旧=恒 null 死写）
  }, 30000);

  it('E4 bodyRotationFor 朝向符号锁（:3742-3744 direction<0 取反）', () => {
    expect(bodyRotationFor(49, 0, 10, 1, 0)).toBeCloseTo(0.5, 6);
    expect(bodyRotationFor(49, 0, 10, -1, 0)).toBeCloseTo(-0.5, 6);
  });

  it('E5 结构锁:Renderer 三门含 49（函数门+drawMountLayer 外门;防回滚）', () => {
    expect(rendererSrc).toContain('(type !== 7 && type !== 8 && type !== 23 && type !== 49)');
    expect(rendererSrc).toContain('(mnt.type === 7 || mnt.type === 8 || mnt.type === 23 || mnt.type === 49)');
    expect(mountsSrc).toContain('(m.type !== 7 && m.type !== 8 && m.type !== 23 && m.type !== 49)');
  });
});

// ---------------------------------------------------------------------------
// F. 件6 R10-P2 setMount 回盒 else 支（窄修:mod/未来直调通道）
// ---------------------------------------------------------------------------
describe('BJ704-G20 F setMount 回盒与凳位（R10-P2⑥）', () => {
  it('F1 直调换骑:鼠 55（14×14）→ setMount(3) 盒回 20×42 底锚保持（旧=残留 14×14,R10 N1）', async () => {
    const p = await makePlayer(21 * 16, 130 * 16);
    p.mount.setMount(55, p);
    expect(p.w).toBe(14); expect(p.h).toBe(14);
    const bottom = p.y + p.h, cx = p.x + p.w / 2;
    p.mount.setMount(3, p);                                     // 直调（未来换骑通道等价入口）
    expect(p.mount.type).toBe(3);
    expect(p.w).toBe(20); expect(p.h).toBe(42);
    expect(p.y + p.h).toBeCloseTo(bottom, 6);                   // 底锚保持
    expect(p.x + p.w / 2).toBeCloseTo(cx, 6);                   // 重心对齐
  });

  it('F2 正常通道零扰动:20×42 玩家 setMount(10) 盒不变（物品上坐路径无位差）', async () => {
    const p = await makePlayer(21 * 16, 130 * 16);
    const y0 = p.y;
    p.mount.setMount(10, p);
    expect(p.w).toBe(20); expect(p.h).toBe(42); expect(p.y).toBe(y0);
  });

  it('F3 凳位+普通坐骑:stoolInUse 清位+盒回 42,fixedUpdate 不双扣（旧=出口 y+=26/h-=26 → h=16）', async () => {
    const w = makeGroundWorld('bj704g20-f3');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 140 * 16);
    for (let t = 0; t < 60; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
    p.stoolInUse = true; p.y -= 26; p.h += 26;                  // 在凳态（h=68）
    const bottom = p.y + p.h;
    p.mount.setMount(3, p);
    expect(p.stoolInUse).toBe(false);                           // 凳位不随骑继承
    expect(p.h).toBe(42);
    expect(p.y + p.h).toBeCloseTo(bottom, 6);
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game);
    expect(p.h).toBe(42);                                       // 无双扣（旧=16）
  }, 30000);

  it('F4 凳位+变身骑:stoolInUse 清位防 h=-12 盒腐化（旧=14-26）', async () => {
    const w = makeGroundWorld('bj704g20-f4');
    const game = makeHooks(w);
    const p = await makePlayer(30 * 16, 140 * 16);
    for (let t = 0; t < 60; t++) { p.fixedUpdate(1 / 60, game); if (p.onGround) break; }
    p.stoolInUse = true; p.y -= 26; p.h += 26;
    p.mount.setMount(55, p);                                    // 鼠（PlayerSize 委派 14×14）
    expect(p.w).toBe(14); expect(p.h).toBe(14);
    expect(p.stoolInUse).toBe(false);
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, game);
    expect(p.h).toBe(14);                                       // 无腐化（旧=-12）
  }, 30000);

  it('F5 结构锁:setMount else 支回盒+凳位清位（防回滚）', () => {
    expect(mountsSrc).toContain('if (p.stoolInUse === true) p.stoolInUse = false;');
    expect(mountsSrc).toContain('p.w = 20;');
    expect(mountsSrc).toContain('p.h = 42;');
  });
});

// ---------------------------------------------------------------------------
// G. 件7 G19 新登记两件判语锁（销案+维持登记的防再登记面）
// ---------------------------------------------------------------------------
describe('BJ704-G20 G G19 两登记判语（R10-G19⑦）', () => {
  it('G1 [g19-mountjump-residual] 销案锁:hasJumpOption AND 门勘正注在位（防再登记判例）', () => {
    // 销案证据链:消费面 :26788-26803/:22119 全部 AND hasJumpOption_*（骑乘期重授/ResetEffects 逐拍清）
    expect(playerSrc).toContain('G19 [g19-mountjump-residual] 销案勘正');
    expect(playerSrc).toContain(':26788-26803 全部 AND hasJumpOption_*');
    // 消费线绝迹锁（G19 既有,复核保持）
    expect(playerSrc).not.toContain('mountJumpPerforming) { runAcc');
    expect(playerSrc).toContain('this.mount.mountJumpPerforming = true;');
  });

  it('G2 [g19-jump-release-zero] 维持登记:湿支 mountJump 门 joinHold<=0（jump 窗口语义家族注在位）', () => {
    expect(playerSrc).toContain('jumpHold <= 0) {');
    expect(playerSrc).toContain('[g19-jump-release-zero] 域,干支同款');
  });
});
