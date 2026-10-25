// ★BJ704-G22（2026-10-21）新登记窄边债清算·两簇十一件（锚 memory/bj704g21-proj-r2-
// clearance.md 与 memory/bj704g20-mount-r2-clearance.md,1457 反编译逐锚亲读复核）。
// 烟花簇（Dart.ts）：
// · [g21-fw-box-cut] 0 伤烟花盒 415-418 爆面缺——vanilla Kill 尾段 :78549-78556
//   Resize(192)+penetrate=-1+Damage() 无 damage 门（CutTiles :12516 先于 damage<=0
//   整退 :12576）→ 0 伤盒 192² 照割;旧 explodeFirework 调用位 `if (damage > 0)` 把
//   割面一并拦死。修=调用位门拆除（blastDamage 头部已有 damage<=0 早退,PVE no-op
//   同相,唯割面放行）。
// · [g21-fw-idstatic-1t] 烟花 167-170 应为全场共享 1t 窗——SetDefaults :2568-2570
//   usesIDStaticNPCImmunity+idStaticNPCHitCooldown=1（immunityIdentity=type :784 →
//   逐型一张桶）;旧走私表 hitCdT 10t（实为 windowGate=false 全关）。修=blastDamage
//   idStaticKey 参数化,cd 单源 projectileData。
// · [g21-fw-anchor] explodeFirework 注锚 :73912 错位（真位 :78549-78556;块
//   :78125-78557）——R8-N3 混代锚族整族勘正（含 style 表/docstring/喷泉/马桶锚）。
// · 连带新发现（烟花域扫面）：①飞行火箭接触面整缺（vanilla Damage() :17184 逐拍跑
//   → friendly 直击+penetrate 1 耗尽 Kill :17312-17315 爆段;旧仓 fireworkUpdate 早退
//   路径=穿敌不伤不爆）;②飞行/喷泉逐拍 CutTiles 整缺（CanCutTiles :15407 黑名单制,
//   aiStyle 34/73 可割;马桶 733 vanilla friendly=false 同相不割）;③尾烟 2 tick 一发
//   节流=维持登记近似（1:1=45 尘/t,引擎粒子成本翻倍）;④发射器档烟花（3546 Arrow
//   载体）Kill 爆段缺 192² Damage——Arrow.ts 争用禁触,登记 [g22-launcher-fw-blast]。
// 坐骑簇（Player.ts/Mounts.ts）：
// · [g20-mountjump-firefx] 坐骑特殊跳起跳帧特效整缺（SoundID16+独角兽/山羊/蜥蜴
//   5×14 椭圆尘环+圣诞坦克 15×双尘+3 gore,:20935-21196 各执行支）——干湿两支同拍
//   接线 mountJumpBurstFx（armor shader 染色略=登记近似）。
// · [g20-buff305-firewalk] 熔岩鲨 buff305 火上行（:9998）——Player.ts hurtTiles
//   消费位 fireWalkFx 并集补 `ridingMount && mount.buff===305` 腿;Game.ts 海螺落点
//   镜像（TeleportHelpers TileIsDangerous 同读 player.fireWalk）争用禁触,登记
//   [g22-fw-conch-mirror]。
// · [g20-buff305-lavavision] 维持域外登记——消费面 VanillaLiquidRenderer 前后景
//   双 pass 的岩浆 α 需 Renderer.ts 五调用位穿参（争用禁触）+Player.lavaOpacity
//   0.04/t 斜坡状态,渲染域另刀。
// · [g20-wet-clamp-rising-side] ★销案+回滚近似——登记「活面=水中受击退」复核为
//   死面（玩家受击退固定 vx±4.5/vy=-3.5,:37908-37912 两域同相 |-3.5|<6.01 恒不
//   触发;其余上升写位边界 no-op/让位/每拍重写零消费）→ 上升侧钳回滚 1:1（vanilla
//   :27563-27595 单侧 per gravDir 只钳坠落端）。
// · [g20-cced-release-decay] ★销案——冻结上升拍 0.01/t（90t 全程 0.9px）零感知,
//   根修归 [g19-jump-release-zero] 相位族（0.01 模型=家族承载,勿单独再登记）。
// · [g20-mounted-hitbox-42plus-boost] 维持登记——全仓架构近似（触碰=碰撞/相机/
//   渲染 pivot 重构,非漏行;驯鹿 0 boost20=vanilla 20×62 vs 仓恒 20×42）。
// · [g20-stool-memory-quirk] ★销案——vanilla 凳位跨骑「记忆」自中和零净效
//   （HeightOffsetBoost :3265-3279 mount 分支优先 + SetMount else :6331-6337 底锚
//   回放 + ResetEffects :18899 逐拍清;SW 清位 ≙ 净效等价）,防再登记注三重源锚。
// · isDownDashing 微残——vanilla :20934 门帧无条件 flag13=false（任何过门跳清
//   下砸）;坐骑跳/首跳四臂补齐（瓶族臂既有）。残留旗吃 0.85 重力+封翼封滑翔。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { existsSync } from 'fs';
import { World } from '../src/world/World';
import { LIQUID_TYPE } from '../src/world/TileStore';
import { seededRandom, BATTERY_SEED } from './seeded-rng';
import { BuffType } from '../src/stats/Buffs';
import { TILE_BY_KEY } from '../src/data/tiles';
import { TrapShot } from '../src/entities/Dart';
import { pinGameTimeTicks, gameTickCount } from '../src/core/GameTime';
import { resetGorePool, liveGorePieces } from '../src/entities/GorePiece';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_BY_KEY } from '../src/data/items';

// ★SW-BN6 电池族 RNG 统一播种
beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

const ROOT = join2();
function join2() {
  return path.join(path.dirname(fileURLToPath(new URL(import.meta.url))), '..');
}
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const dartSrc = () => read('src/entities/Dart.ts');
const playerSrc = () => read('src/entities/Player.ts');
const mountsSrc = () => read('src/entities/Mounts.ts');

const VAN = path.join(ROOT, '..', 'Terarria1457');
const EXT_MISSING = !existsSync(path.join(VAN, 'Terraria', 'Projectile.cs'));
const van = EXT_MISSING ? '' : readFileSync(path.join(VAN, 'Terraria', 'Projectile.cs'), 'utf8');
const vanPlayer = EXT_MISSING ? '' : readFileSync(path.join(VAN, 'Terraria', 'Player.cs'), 'utf8');

const TILE = 16;
/** ★共享桶模块级单表（ID_STATIC_TABLES）——逐测单调推钟隔离（g14/g21 同式） */
let g22Clock = 9000;
beforeEach(() => {
  g22Clock += 1000;
  pinGameTimeTicks(g22Clock);
  resetGorePool();
});

// ================================================================ §0 原版锚
describe.skipIf(EXT_MISSING)('§0 原版锚（读错/漂移即红——G22 定谳链）', () => {
  it('a1 烟花 Kill 尾段 Resize(192)→Damage() 无 damage 门（0 伤盒照割的源锚）', () => {
    const iKill = van.indexOf('public void Kill()');
    const i34 = van.indexOf('else if (aiStyle == 34)', iKill);
    const b34 = van.slice(i34, i34 + 20000);   // 块跨 :78125-78557
    const i192 = b34.indexOf('width = 192;');
    const iDmg = b34.indexOf('Damage();', i192);
    expect(i192).toBeGreaterThan(-1);
    expect(iDmg).toBeGreaterThan(i192);
    expect(b34.slice(i192, iDmg)).not.toContain('damage > 0');   // 兔 128 盒有门（:77375）,烟花尾段无门=0 伤盒照割
  });
  it('a2 167-170 SetDefaults：usesIDStatic + cd=1 + appliesImmunityTimeOnSingleHits（:2560-2571）', () => {
    const i = van.indexOf('else if (type == 167 || type == 168 || type == 169 || type == 170)');
    const b = van.slice(i, i + 500);
    expect(b).toContain('usesIDStaticNPCImmunity = true;');
    expect(b).toContain('idStaticNPCHitCooldown = 1;');
    expect(b).toContain('appliesImmunityTimeOnSingleHits = true;');
    // 415-418 共 aiStyle34 块无 idStatic 行（:4944-4951）
    const i415 = van.indexOf('else if (type == 415 || type == 416 || type == 417 || type == 418)');
    expect(van.slice(i415, i415 + 220)).not.toContain('usesIDStaticNPCImmunity');
  });
  it('a3 坐骑跳执行支：三族 5×14 椭圆尘环（176/177/179、6、31）+ 坦克双尘/gore Next(61,63)', () => {
    expect(vanPlayer).toContain('Utils.SelectRandom<int>(Main.rand, 176, 177, 179)');
    expect(vanPlayer).toContain('for (float num13 = 0f; num13 < 14f; num13++)');
    const i10 = vanPlayer.indexOf('else if (flag10)');
    const b10 = vanPlayer.slice(i10, i10 + 2600);
    expect(b10).toContain('Dust.NewDust(new Vector2(position.X - 34f, position.Y + (float)num20 - 16f), 102, 32, 4,');
    expect(b10).toContain('Main.rand.Next(61, 63)');   // 右开=61|62（G20 注「61-63」勘正）
    expect(vanPlayer).toContain('SoundEngine.PlaySound(16, (int)position.X, (int)position.Y);');
  });
  it('a4 buff305 块四授予（:9992-9998 lavaImmune/lavaVision/fireWalk）', () => {
    const i = vanPlayer.indexOf('else if (buffType[j] == 305)');
    const b = vanPlayer.slice(i, i + 260);
    expect(b).toContain('lavaImmune = true;');
    expect(b).toContain('lavaVision = true;');
    expect(b).toContain('fireWalk = true;');
  });
  it('a5 液体终端钳单侧 per gravDir（:27563-27595 无 -jumpSpeed 上升钳）', () => {
    const i = vanPlayer.indexOf('if (!mount.Active || mount.Type != 5)', vanPlayer.indexOf('private void JumpMovement'));
    const b = vanPlayer.slice(i, i + 1600);   // :27563-27595 段
    expect(b).toContain('if (velocity.Y > maxFallSpeed)');
    expect(b).toContain('if (velocity.Y < 0f - maxFallSpeed)');
    expect(b).not.toContain('jumpSpeed');   // 无上升侧钳（G22 销案源锚）
  });
  it('a6 :20934 门帧无条件写 isPerformingJump_DownDash=flag13（任何过门跳清下砸）', () => {
    const i = vanPlayer.indexOf('isPerformingJump_DownDash = flag13;');
    expect(i).toBeGreaterThan(-1);
    expect(vanPlayer.slice(i - 700, i)).toContain('if (velocity.Y == 0f || sliding || (autoJump && justJumped))');
  });
});

// ================================================================ §A 烟花簇（Dart.ts）
type Foe = {
  id: number; vanillaId: number; x: number; y: number; w: number; h: number;
  dead: boolean; iframes: number; dontTakeDamage?: boolean;
  hurt: (d: number, kx: number, ky: number) => boolean;
};
function mkFoe(id: number, x: number, y: number, setIframes: boolean, hurts: Array<{ id: number; dmg: number }>): Foe {
  const f: Foe = {
    id, vanillaId: 3, x, y, w: 24, h: 24, dead: false, iframes: 0,
    hurt: (d: number) => { hurts.push({ id, dmg: d }); if (setIframes) f.iframes = 8; return true; },
  };
  return f;
}
function fwWorld(enemyList: unknown[] = []) {
  const w = new World(80, 60, 42, 'open');
  w.groundLevel = 42;
  const hurts: Array<{ id: number; dmg: number }> = [];
  const cutTiles: Array<[number, number]> = [];
  const hooks = {
    world: w,
    player: { x: -500, y: -500, w: 20, h: 42, dead: true, cx: -490, cy: -479, luck: 0,
      buffs: new Set(), inv: {} },
    enemies: () => enemyList,
    critters: () => [], npcs: () => [],
    playSfx: () => {}, playSfxFiles: () => {}, playSfxWav: () => {},
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    cutTile: (x: number, y: number) => { cutTiles.push([x, y]); },
    spawnParticles: () => {}, addDamageNumber: () => {}, onEnemyKilled: () => {},
    spawnDrop: () => null, damagePlayer: (): number => 0, spawnEnemy: () => {},
    notifyInventoryChanged: () => {}, showPickupLabel: () => {},
    entities: { add: () => {}, projectiles: [] as unknown[] },
  } as never;
  return { w, hooks, hurts, cutTiles };
}

describe('§A1 g21-fw-box-cut：0 伤烟花盒爆面照割（调用位门拆除）', () => {
  it('行为：damage=0 盒寿终爆 → 192² 割 169 + 死亡拍小盒 1 = 170（旧=0）', () => {
    const a = fwWorld();
    const box = new TrapShot(40 * TILE, 40 * TILE, 0, -5, 0, 'fireworksBoxRocket');
    (box as unknown as { life: number }).life = 1;
    box.fixedUpdate(1, a.hooks);
    expect(box.dead).toBe(true);
    expect(a.cutTiles.length).toBe(170);   // 169（192 盒 551..743）+1（小盒 @(40,40) 同拍重报,记录器无去重=原版双 Damage 同格幂等）
  });
  it('结构：调用位无 damage 门 + idStatic 键形态（火箭 167-170 传 / 盒传 0）', () => {
    const s = dartSrc();
    expect(s).toContain("this.blastDamage(game, cx, cy, 96, this.kind === 'fireworkRocket' ? this.projId : 0);");
    expect(s).not.toContain('if (this.damage > 0) this.blastDamage(game, cx, cy, 96);');
  });
});

describe('§A2 g21-fw-idstatic-1t：烟花 167-170 全场共享 1t 窗（逐型分桶）', () => {
  it('行为：同型同拍第二发爆盒拒;异型（168）照结;+2t 窗到期重开', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（烟花接触/爆面首掷 ×1.0）
    const hurts: Array<{ id: number; dmg: number }> = [];
    const foe = mkFoe(5, 40 * TILE - 12, 40 * TILE + 40, false, hurts);   // 爆心 (647,647) 下方 40..64px:盒内/弹外
    const a = fwWorld([foe]);
    const boom = (form: number) => {
      const r = new TrapShot(40 * TILE, 40 * TILE, 0, -5, 150, 'fireworkRocket', form);
      (r as unknown as { life: number }).life = 1;
      r.fixedUpdate(1, a.hooks);
      expect(r.dead).toBe(true);
    };
    boom(0);                                      // 167 → 结算（写 167 桶 count+1）
    expect(hurts).toHaveLength(1);
    boom(0);                                      // 167 同拍第二发 → 1t 窗拒（旧=无窗照结）
    expect(hurts).toHaveLength(1);
    boom(1);                                      // 168 异型 → 独立桶照结
    expect(hurts).toHaveLength(2);
    expect(hurts[1]!.dmg).toBe(150);
    pinGameTimeTicks(gameTickCount() + 2);        // 窗=count+1 ≤ count+2 → 到期
    boom(0);                                      // 167 窗外重开
    expect(hurts).toHaveLength(3);
  });
  it('结构：cd 单源 projectileData（281=10/167-170=1）+ 键=projId 逐型', () => {
    const s = dartSrc();
    expect(s).toContain('const idCd = idStaticKey ? (projectileData(idStaticKey)?.idStaticNPCHitCooldown ?? 10) : 0;');
    expect(s).toContain('private blastDamage(game: GameHooks, cx: number, cy: number, r: number, idStaticKey = 0): void {');
  });
});

describe('§A3 g21-fw-anchor：混代锚整族勘正（R8-N3 族）', () => {
  it('结构：新锚在（:78125-78557×2/:78549-78556/:78131）,旧漂移锚全退役', () => {
    const s = dartSrc();
    expect(s.match(/:78125-78557/g)).toHaveLength(3);   // style 表 Kill 行 + explodeFirework 头注 + life 检查行（M11 判别）
    expect(s).toContain('Kill（:78125-78557）：Item14 + 按色爆尘 + 192×192 Damage()');
    expect(s.match(/:73435-73921/g)).toHaveLength(1);   // 仅 explodeFirework 勘正注合法引用一次
    expect(s).toContain(':78549-78556');
    expect(s).toContain('SoundID.Item14（:78131）');
    // 旧混代锚（:73435-73921/:73912-73920 两枚在 explodeFirework 勘正注、:21540-21592/
    // :21978-21981/:26822-26913 在 style 表勘正注中合法引用,不列入;其余全部退役）
    for (const stale of [':73437）', ':29369-29510', ':49278-29314', ':29385-29406', ':73803-73898',
      ':25677-25739', ':2291-2300', ':4669-4676', ':7434-7441', ':72768-72831', ':72704-72758']) {
      expect(s).not.toContain(stale);
    }
  });
});

describe('§A4 烟花域扫面：飞行火箭接触面（直击+接触杀爆花,旧=穿敌不伤不爆）', () => {
  it('行为：接触敌吃 150 直击（iframes 语义）+爆花死+远敌爆盒结算+同敌不二结', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    const hurts: Array<{ id: number; dmg: number }> = [];
    const near = mkFoe(7, 40 * TILE - 4, 40 * TILE - 20, true, hurts);    // 覆盖上移后弹盒（接触面）
    const far = mkFoe(8, 40 * TILE - 12, 40 * TILE + 40, false, hurts);   // 爆盒内/弹外
    const a = fwWorld([near, far]);
    const r = new TrapShot(40 * TILE, 40 * TILE, 0, -8, 150, 'fireworkRocket');
    r.fixedUpdate(1, a.hooks);   // 位移 8px 上移 → 与 near 重叠
    expect(r.dead).toBe(true);   // penetrate 1 耗尽 → Kill()（:17312-17315）→ aiStyle34 爆段
    expect(hurts).toHaveLength(2);
    expect(hurts.find((h) => h.id === 7)!.dmg).toBe(150);   // 接触直击
    expect(hurts.find((h) => h.id === 8)!.dmg).toBe(150);   // 爆盒（192²）结算
    expect(a.cutTiles.length).toBe(170);                    // 1（飞行拍小盒）+169（爆盒）
  });
  it('行为：烟花盒 damage=0 穿敌不触不发（Damage_PVE :12576 同相）', () => {
    const hurts: Array<{ id: number; dmg: number }> = [];
    const near = mkFoe(9, 40 * TILE - 4, 40 * TILE - 20, true, hurts);
    const a = fwWorld([near]);
    const box = new TrapShot(40 * TILE, 40 * TILE, 0, -8, 0, 'fireworksBoxRocket');
    box.fixedUpdate(1, a.hooks);
    expect(box.dead).toBe(false);   // 不死不爆（伤 0 无接触面）
    expect(hurts).toHaveLength(0);
  });
});

describe('§A5 烟花域扫面：飞行逐拍 CutTiles（Damage() 内建,旧=早退路由整缺）', () => {
  it('行为：火箭飞行 3 拍小盒割 3 次（马桶 hostile=true 同相不割）', () => {
    const a = fwWorld();
    const r = new TrapShot(40 * TILE, 40 * TILE, 0, -8, 150, 'fireworkRocket');
    for (let t = 0; t < 3; t++) r.fixedUpdate(1, a.hooks);
    expect(r.dead).toBe(false);
    // 每拍 14×14 小盒上报（cutTilesBox 排除界,盒跨行数随对齐波动）：拍1 y=640 对齐=1 格;
    // 拍2 y=632 跨 39/40 行=2 格;拍3 y=624 落回 39 单行=1 格 → 恰 4（对齐确定性锁）
    expect(a.cutTiles.length).toBe(4);
  });
});

// ================================================================ §B 坐骑簇（Player.ts/Mounts.ts）
type P = import('../src/entities/Player').Player;

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

/** 记录型钩桩（尘/音面断言用——vanillaDust 伪体返回可变对象,后置写按引用入账） */
function makeRecHooks(w: World) {
  const dusts: Array<{ type: number; x: number; y: number; vx: number; vy: number; scale: number; fadeIn: number; noGravity: boolean }> = [];
  const sfx: string[] = [];
  const hooks = {
    world: w, player: null as unknown,
    enemies: () => [], critters: () => [], npcs: () => [],
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {},
    playSfxWav: (f: string) => { sfx.push(f); },
    spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    vanillaDust: {
      spawn: (x: number, y: number, _w: number, _h: number, type: number) => {
        const d = { type, x, y, vx: 0, vy: 0, scale: 1, fadeIn: 0, noGravity: false };
        dusts.push(d);
        return d;
      },
    },
    cutTile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: vi.fn((): number => 0), notifyInventoryChanged: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, showPickupLabel: () => {},
    entities: { add: () => {}, projectiles: [] as unknown[] },
  } as unknown as Parameters<P['fixedUpdate']>[1];
  return { hooks, dusts, sfx };
}

function makeGroundWorld(seed: string, ground = 150, tileId?: number) {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  const t = tileId ?? 1;
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, ground, t, 0, 0);
    w.store.setTileSilent(x, ground + 1, t, 0, 0);
  }
  return w;
}
function makePoolWorld(seed: string, liquid: LIQUID_TYPE, top = 90, bottom = 137) {
  const w = new World(60, 220, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 28; x++) w.store.setTileSilent(x, bottom, 1, 0, 0);
  for (let y = top; y < bottom; y++) {
    for (let x = 14; x <= 28; x++) w.store.setLiquid(x, y, 200, liquid);
  }
  return w;
}
async function makePlayer(xPx: number, yPx: number): Promise<P> {
  const { Player } = await import('../src/entities/Player');
  const { Inventory } = await import('../src/items/Inventory');
  return new Player(xPx, yPx, new Inventory());
}

describe('§B1 g20-mountjump-firefx：坐骑跳起跳帧爆发特效（干湿同拍）', () => {
  it('行为：独角兽空中特殊跳 → Double_Jump 音 + 5×14=70 尘环（176/177/179,noGravity,scale≤1.8,fadeIn≤2,椭圆 50×20）', async () => {
    const w = makeGroundWorld('bj704g22-b1a');
    const rec = makeRecHooks(w);
    const p = await makePlayer(30 * 16, 140 * 16);
    for (let t = 0; t < 60; t++) { p.fixedUpdate(1 / 60, rec.hooks); if (p.onGround) break; }
    expect(p.onGround).toBe(true);
    p.mount.setMount(10, p);                                    // 独角兽
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, rec.hooks);
    p.inputJump = true; p.jumpEdgePrev = false;                 // 首跳（地面=普通跳支,无 FX）
    p.fixedUpdate(1 / 60, rec.hooks);
    p.inputJump = false;
    for (let t = 0; t < 16; t++) p.fixedUpdate(1 / 60, rec.hooks);   // 耗尽首跳窗
    expect(p.mount.mountJumpReady).toBe(true);
    const pcx = p.cx, pcy = p.cy;
    p.inputJump = true; p.jumpEdgePrev = false;                 // 空中再按=坐骑特殊跳
    p.fixedUpdate(1 / 60, rec.hooks);
    p.inputJump = false;
    expect(p.performingJump).toBe('Unicorn');
    const fam = rec.dusts.filter((d) => d.type === 176 || d.type === 177 || d.type === 179);
    expect(fam.length).toBe(71);   // 70（5 环 × 14 点 :21052-21055）+1（同拍独角兽上升尾迹 doubleJumpVisuals :21663-21669——1 尘/t,vanilla 同拍并存;尾迹 vy=0/径向环 vy≠0 可分）
    // n=0 环：位移 0、速度恰 (0, gravDir·4)（dir·0.2·0 + 常量项）——14 粒全在心
    const center = fam.filter((d) => d.vx === 0 && d.vy === 4);
    expect(center.length).toBe(14);
    for (const d of center) {
      expect(d.x).toBeCloseTo(pcx, 6);
      expect(d.y).toBeCloseTo(pcy, 6);
      expect(d.noGravity).toBe(true);
      expect(d.scale).toBeGreaterThanOrEqual(1);
      expect(d.scale).toBeLessThanOrEqual(1.8);                 // 1+rand·0.8
      expect(d.fadeIn).toBeGreaterThanOrEqual(0);
      expect(d.fadeIn).toBeLessThanOrEqual(2);                  // rand·2
    }
    // n≥1 环（56 粒）：径向速度（vy≠0/4）+ 椭圆 50×20 界内
    const outer = fam.filter((d) => d.vy !== 0 && d.vy !== 4);
    expect(outer.length).toBe(56);
    for (const d of outer) {
      expect(d.noGravity).toBe(true);
      expect(d.scale).toBeGreaterThanOrEqual(1);
      expect(d.scale).toBeLessThanOrEqual(1.8);
      expect(d.fadeIn).toBeLessThanOrEqual(2);
      expect(Math.abs(d.x - pcx)).toBeLessThanOrEqual(50 * 0.8 + 1);   // 椭圆半轴 50×0.2n（n≤4）
      expect(Math.abs(d.y - pcy)).toBeLessThanOrEqual(20 * 0.8 + 1);   // 椭圆半轴 20×0.2n
    }
    expect(rec.sfx.filter((f) => f === 'Double_Jump').length).toBe(1);   // SoundID16（:21046）
  }, 30000);
  it('行为：圣诞坦克空中特殊跳 → 15×2=30 尘（4 色/6）+ gore 61|62×3（Next(61,63) 右开）', async () => {
    const w = makeGroundWorld('bj704g22-b1b');
    const rec = makeRecHooks(w);
    const p = await makePlayer(30 * 16, 140 * 16);
    for (let t = 0; t < 60; t++) { p.fixedUpdate(1 / 60, rec.hooks); if (p.onGround) break; }
    p.mount.setMount(46, p);                                    // 圣诞坦克
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, rec.hooks);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, rec.hooks);
    p.inputJump = false;
    for (let t = 0; t < 16; t++) p.fixedUpdate(1 / 60, rec.hooks);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, rec.hooks);
    p.inputJump = false;
    expect(p.performingJump).toBe('Santank');
    const fw = rec.dusts.filter((d) => d.type === 4 || d.type === 6);
    expect(fw.length).toBe(30);                                 // 15×（尘4+尘6）（:21135-21147）
    const gores = liveGorePieces().map((g) => g.goreId);
    const tankGores = gores.filter((t) => t === 61 || t === 62);
    expect(tankGores.length).toBe(3);                           // gore 61|62×3（:21149-21169）
    expect(gores.includes(63)).toBe(false);                     // Next(61,63) 右开不含 63
    expect(rec.sfx.filter((f) => f === 'Double_Jump').length).toBe(1);
  }, 30000);
  it('结构：mountJumpBurstFx 单源 + 干湿两支接线（湿支 else-if 链互斥）', () => {
    const s = playerSrc();
    expect(s).toContain("private mountJumpBurstFx(game: GameHooks, opt: 'Unicorn' | 'Santank' | 'WallOfFleshGoat' | 'Basilisk'): void {");
    expect(s.match(/this\.mountJumpBurstFx\(game, mnt2\.jumpOption\);/g)).toHaveLength(2);   // 干+湿
    expect(s).toContain("const type = opt === 'Unicorn' ? [176, 177, 179][Math.floor(Math.random() * 3)]!");
    expect(s).toContain("GorePiece.newGore(61 + Math.floor(Math.random() * 2), gx, gy, -this.vx, -this.vy);");
  });
});

describe('§B2 g20-buff305-firewalk：熔岩鲨火上行（陨石行走免 Burning）', () => {
  it('行为：裸站陨石 30 拍染 Burning;骑 49（buff305）同站零 Burning', async () => {
    const meteorite = TILE_BY_KEY['ore_meteorite']!;
    expect(meteorite).toBeGreaterThan(0);
    // 地面行 100（hurtTiles 扫描界 j1=min(st.h−40,…)=140,行 150 会被顶帽截掉扫不到）
    const w1 = makeGroundWorld('bj704g22-b2a', 100, meteorite);
    const rec1 = makeRecHooks(w1);
    const p1 = await makePlayer(30 * 16, 90 * 16);
    for (let t = 0; t < 60; t++) { p1.fixedUpdate(1 / 60, rec1.hooks); if (p1.onGround) break; }
    expect(p1.onGround).toBe(true);
    for (let t = 0; t < 30; t++) p1.fixedUpdate(1 / 60, rec1.hooks);
    expect(p1.buffs.has(BuffType.Burning)).toBe(true);          // 正对照:火上行面在
    const w2 = makeGroundWorld('bj704g22-b2b', 100, meteorite);
    const rec2 = makeRecHooks(w2);
    const p2 = await makePlayer(30 * 16, 90 * 16);
    for (let t = 0; t < 60; t++) { p2.fixedUpdate(1 / 60, rec2.hooks); if (p2.onGround) break; }
    p2.mount.setMount(49, p2);                                  // 熔岩鲨（buff305）
    expect(p2.mount.buff).toBe(305);
    for (let t = 0; t < 30; t++) p2.fixedUpdate(1 / 60, rec2.hooks);
    expect(p2.buffs.has(BuffType.Burning)).toBe(false);         // fireWalk 腿（:9998;旧=照染）
  }, 30000);
  it('结构：fireWalkFx 并集含骑乘 305 腿（Game.ts 海螺镜像=[g22-fw-conch-mirror] 登记）', () => {
    const s = playerSrc();
    expect(s).toContain('|| (this.ridingMount && this.mount.buff === 305);   // ★BJ704-G22:buff305（mount 49,:9998）');
  });
});

describe('§B3 g20-wet-clamp-rising-side：销案+回滚（vanilla 单侧只钳坠落端）', () => {
  it('行为：湿非 CCed 上升 vy=-9 不剪（旧=-6.0）;坠落端 vy=+9 单侧钳 5.01', async () => {
    const w = makePoolWorld('bj704g22-b3', LIQUID_TYPE.WATER);
    const rec = makeRecHooks(w);
    const p = await makePlayer(21 * 16, 120 * 16);
    for (let t = 0; t < 5; t++) p.fixedUpdate(1 / 60, rec.hooks);
    expect(p.inWater).toBe(true);
    p.vy = -9;                                                  // 水中上升（受击退形——登记活面复核=死面,-3.5 恒不触发）
    p.fixedUpdate(1 / 60, rec.hooks);
    expect(p.vy).toBeCloseTo(-9 + 0.2 + 0.01, 5);               // 重力 0.2+松键衰减 0.01;无 -lJSpd 钳（旧双侧 → -6.0）
    p.vy = 9;                                                   // 坠落端照钳（vanilla :27567-27570 单侧不回退）
    p.fixedUpdate(1 / 60, rec.hooks);
    expect(p.vy).toBeCloseTo(5.01, 5);
  }, 30000);
  it('结构：非 CCed 两 gd 臂均单侧（无 lJSpd 项）', () => {
    const s = playerSrc();
    expect(s).toContain('if (this.vy < -lMaxFall) this.vy = -lMaxFall;   // :27582-27585 单侧（倒挂坠落端=上行）');
    expect(s).toContain('if (this.vy > lMaxFall) this.vy = lMaxFall;     // :27567-27570 单侧');
    expect(s).not.toContain('Math.max(-lJSpd, Math.min(lMaxFall');
    expect(s).not.toContain('Math.min(lJSpd, Math.max(-lMaxFall');
  });
});

describe('§B4 isDownDashing 微残：:20934 任何过门跳清下砸（四臂补齐）', () => {
  it('行为：干支坐骑跳清残留旗（旧=0.85 重力+封翼挂到落地）', async () => {
    const w = makeGroundWorld('bj704g22-b4a');
    const rec = makeRecHooks(w);
    const p = await makePlayer(30 * 16, 140 * 16);
    for (let t = 0; t < 60; t++) { p.fixedUpdate(1 / 60, rec.hooks); if (p.onGround) break; }
    p.mount.setMount(10, p);
    for (let t = 0; t < 3; t++) p.fixedUpdate(1 / 60, rec.hooks);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, rec.hooks);
    p.inputJump = false;
    for (let t = 0; t < 16; t++) p.fixedUpdate(1 / 60, rec.hooks);
    (p as unknown as { isDownDashing: boolean }).isDownDashing = true;   // 骑前下砸残留（重锤符文腿旗）
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, rec.hooks);
    p.inputJump = false;
    expect(p.performingJump).toBe('Unicorn');                   // 坐骑跳已过门
    expect((p as unknown as { isDownDashing: boolean }).isDownDashing).toBe(false);   // :20934 清（旧=残留 true）
  }, 30000);
  it('结构：四臂清位（湿首跳/湿坐骑跳/干首跳/干坐骑跳——瓶族臂既有）', () => {
    const s = playerSrc();
    expect(s.match(/this\.isDownDashing = false; +\/\/ ★BJ704-G22/g)?.length).toBe(4);
  });
});

describe('§B5 判语销案锁（防再登记）', () => {
  it('g20-stool-memory-quirk ★销案注在（vanilla 自中和三重源锚）', () => {
    const s = mountsSrc();
    expect(s).toContain('g20-stool-memory-quirk ★销案,防再登记');
    expect(s).toContain('if (p.stoolInUse === true) p.stoolInUse = false;');   // 清位本体不回退
  });
  it('g20-cced-release-decay ★销案（0.01/t 零感知,归 g19-jump-release-zero 族）', () => {
    const t = readFileSync(path.join(ROOT, 'tests/bj704g20-mount-r2-clearance.test.ts'), 'utf8');
    expect(t).toContain('[g20-cced-release-decay] 销案');
  });
});
