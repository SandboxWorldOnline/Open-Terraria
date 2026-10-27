// ★BJ467（2026-10-03）tag/crit 臂九残余判别测试（BJ461+BJ462 合并批）。
//  定谳锚（Terarria1457 亲读,行号=BJ467 落刀日盘上）：
//   · ①WhipProj 鞭命中面 TimerCrit :12928 独立无条件消费（鞭 DefaultToWhip 无类旗
//     =三类掷 :12916-27 不达,但 TryConsumingTimerCrit 对一切玩家弹无条件）。
//   · ②四件套 Damage_PVE_Inner 等价面 :12928 消费——ChloroLeaf/SporeSac/OrichalcumPetal
//     三件走 proj1457.dealContacts F11 既有接位（盘上 :446-448,判据=孢子云锚）;
//     InsanityShadowFriendly 964 自建直调 e.hurt 面【缺】→ 本刀补。
//   · ③Minecart 机械激光：原版 CastSuperCartLaser（Mount.cs:5264-5290）对每靶
//     NewProjectile(591) 直调 Damage()=全管线 → TimerCrit 照消费（三类掷不达）。
//   · ④Game.ts 爆炸结算面（explodePrimeBomb102 DD2 水晶臂 + scarabBombExplode
//     敌/小动物/城镇三臂）：Damage_PVE_Inner `if (ownedBySomeone)` crit 段对全部
//    受害靶同达 → TimerCrit 无条件消费。
//   · ⑤AI_137 T3 场盒档（Projectile.cs:69937-69938 `if (setMonkT3) { num=14; num5=8; }`
//     → 场盒钳 [num5×16, num×16] :69972-77,T3=[128,224];旧档恒 [64,160]）。
//   · ⑥:12686 头门前置（Damage_PVE 循环门 `flag2 && (!dontTakeDamage ||
//     ZappingJellyfish)` 先于 Inner）——拳盒/光环/爆弹/爆裂四敌臂 dontTakeDamage 靶
//     不达 TimerCrit/tag ModifyHit,不白吃私表 cd（快照纪律,读 hurt 前状态）。
//   · ⑦Arrow else 支 flag3 收窄——:12636 `flag3 = maxPen==1 && !usesLocal &&
//     !usesIDStatic`——usesIDStatic 族【不】豁免（286 实弹 penetrate 1+usesIDStatic）。
//   · ⑧Arrow 城镇受理照耗 pierce（:14189 penetrate-- 对城镇受害靶同达）——消费位
//     移 face1 受理面,尾段第二城镇面退役（BJ455④ 定谳后尾面恒拒/跳过=消费悬空）。
//   · ⑨Arrow 502/局部免疫支 cd 检查前置——原版 flag2 私表门（:12585-92）先于水母块
//     :12680,cd 活跃靶连 zap 都不可达;旧序先 zap 后查 cd=充能+cd 叠态多电一次。
//  判别力（旧码必红项）：§1-§4 TimerCrit 消费位 charge→−15+crit 参+×2（旧恒 false
//    必红）;§5 场盒钉值（T3 [128,224] vs 恒 [64,160]）;§6 dontTakeDamage 靶 hurt 0 调
//    +charge 不动（旧白吃必红）;§7 286 窗内 0 调（旧豁免照命中必红）/283 豁免照命中;
//    §8 pierce 1 城镇受理即亡（旧 pierce 悬空不递减必红）;§9 cd 窗内 0 电+窗清照电
//    （旧多电一次必红）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { Enemy } from '../src/entities/Enemy';
import { TownNPC } from '../src/entities/TownNPC';
import { MinionProj } from '../src/entities/MinionProj';
import { Arrow } from '../src/entities/Arrow';
import { WhipProj } from '../src/entities/WhipProj';
import { Minecart } from '../src/entities/Minecart';
import { InsanityShadowFriendly } from '../src/entities/InsanityShadowFriendly';
import { SporeSacCloud } from '../src/entities/SporeSacProj';
import { Game } from '../src/core/Game';
import { damageVarRoll } from '../src/stats/DamageVar';
import type { GameHooks } from '../src/entities/types';

// ---- mock 环境（bj453/bj455 同款：真 World+真 Player+ projectiles 桶） ----
function makeGame(): { hooks: GameHooks; player: Player; added: unknown[]; zaps: unknown[];
  list: Enemy[]; towns: TownNPC[] } {
  const w = new World(200, 120, 7, 'bj467-tag-crit-residuals-nine');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const zaps: unknown[] = [];
  const projectiles: unknown[] = [];
  const list: Enemy[] = [];
  const towns: TownNPC[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => list,
    npcs: () => towns,
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
    spawnFriendlyProj: (e: unknown) => { added.push(e); return undefined; },
    takeDamageFromJellyfish: (e: unknown) => { zaps.push(e); },
    entities: { add: (e: unknown) => { added.push(e); projectiles.push(e); }, nextId: 1, projectiles } as never,
    applyLifeSteal: () => 0,
  } as unknown as GameHooks;
  return { hooks, player, added, zaps, list, towns };
}

interface SpyEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; maxHp: number; hp: number; vanillaId: number;
  realLife: number; dontTakeDamage: boolean; dontTakeDamageFromHostiles?: boolean;
  def?: { friendly?: boolean };
  vx: number; vy: number;
  calls: Array<{ d: number; kx: number; ky: number; pen: number; crit: boolean; pierce: number; fromPlayer: boolean }>;
  hurt(d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean, penPercent?: number): boolean;
}
let spySeq = 1;
function spyEnemy(cx: number, cy: number, w = 38, h = 38): SpyEnemy {
  const e: SpyEnemy = {
    id: spySeq++, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, iframes: 0, maxHp: 500000, hp: 500000, vanillaId: 0,
    realLife: -1, dontTakeDamage: false, vx: 0, vy: 0, calls: [],
    hurt(d, _kx, _ky, _g, pen = 0, crit = false, pierce = 0, fromPlayer = false) {
      e.calls.push({ d, kx: _kx, ky: _ky, pen, crit, pierce, fromPlayer });
      return true;
    },
  };
  return e;
}
const push = (hooks: GameHooks, e: SpyEnemy): void => {
  (hooks.enemies() as unknown as SpyEnemy[]).push(e);
};
const timerOn = (p: Player): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, accTimerCrit: true }), configurable: true,
  });
};
const setMonk = (p: Player, t3: boolean, t2: boolean): void => {
  (p as unknown as { setMonkT3?: boolean; setMonkT2?: boolean }).setMonkT3 = t3;
  (p as unknown as { setMonkT2?: boolean }).setMonkT2 = t2;
};
const voodooOn = (p: Player): void => {
  Object.defineProperty(p, 'equipStats', {
    value: Object.freeze({ ...p.equipStats, killGuide: true }), configurable: true,
  });
};
function guide(_hooks: GameHooks, towns: TownNPC[], cx: number, cy: number): TownNPC {
  const g = new TownNPC('guide', 0, 0);
  g.id = 100 + towns.length;
  g.maxHp = 5000; g.hp = 5000;
  g.x = cx - g.w / 2; g.y = cy - g.h / 2;
  towns.push(g);
  return g;
}
const tickUntil = (m: { fixedUpdate: (dt: number, g: GameHooks) => void; dead: boolean },
  hooks: GameHooks, until: () => boolean, max = 120): number => {
  for (let i = 0; i < max && !until(); i++) m.fixedUpdate(1, hooks);
  return max;
};
const tickN = (m: { fixedUpdate: (dt: number, g: GameHooks) => void }, hooks: GameHooks, n: number): void => {
  for (let i = 0; i < n; i++) m.fixedUpdate(1, hooks);
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

// ================ §1（BJ467①）WhipProj 鞭命中面 TimerCrit ================
describe('BJ467-①：WhipProj tryHit TimerCrit :12928 消费（三类掷不达但 TimerCrit 照消费）', () => {
  /** 鞭 841 首挥：tick 9 摆到展开位 → 敌移到鞭尖 pts[10] → 下一拍命中（batch-d 同式） */
  const whipHit = (hooks: GameHooks, player: Player, e: SpyEnemy): void => {
    const w = new WhipProj(player.cx, player.cy, 0, 841, 4672, 14, 1, 30, 4, () => player);
    for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
    const pts = w.pointsAt(20, true);
    e.cx = pts[10].x; e.cy = pts[10].y;
    e.x = pts[10].x - e.w / 2; e.y = pts[10].y - e.h / 2;
    w.fixedUpdate(1, hooks);
  };

  it('1a 满蓄在场：鞭伤 ×2 + crit 参 true + charge 消费置 −15（旧 14/false 必红）', () => {
    const { hooks, player } = makeGame();
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = spyEnemy(400, 552);
    push(hooks, e);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);       // ★BJ723-C S03 位移修复:鞭 DV 中性档（确定性复稳）
    whipHit(hooks, player, e);
    expect(e.calls.length).toBe(1);                       // 夹具自证：鞭尖命中成立
    expect(e.calls[0]!.d).toBe(14);                      // ★S02(BJ723-B)改判:×2=Enemy.hurt 防后——未翻倍基伤(旧 28=预倍形;旧 14=零翻倍)
    expect(e.calls[0]!.crit).toBe(true);                 // ★主判别②:crit 参（旧恒 false 必红）
    expect(player.accTimerCritCharge).toBe(-15);         // ★主判别③:消费位（:28568-71）
  });

  it('1b 无饰品零行为变：charge 满蓄不消费不强制（d=14/crit=false/charge 不变）', () => {
    const { hooks, player } = makeGame();
    player.accTimerCritCharge = 1000;                    // 蓄满但未装备 6170
    const e = spyEnemy(400, 552);
    push(hooks, e);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);       // ★BJ723-C S03 位移修复:鞭 DV 中性档
    whipHit(hooks, player, e);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(14);
    expect(e.calls[0]!.crit).toBe(false);
    expect(player.accTimerCritCharge).toBe(1000);        // 零行为变：charge 不动
  });
});

// ================ §2（BJ467②）四件套等价面 TimerCrit ================
describe('BJ467-②：四件套 :12928 消费——964 直调面补位（三件 dealContacts F11 既有=锚）', () => {
  it('2a 964 骸骨幻影：满蓄强制 ×2+crit 参+charge −15（旧 18/false 必红）', () => {
    const { hooks, player } = makeGame();
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = spyEnemy(400, 552);
    push(hooks, e);
    const sh = new InsanityShadowFriendly(
      { x: e.x, y: e.y, vx: 0, vy: 0, ai0: 0, ai1: 0 }, 18);
    tickUntil(sh, hooks, () => e.calls.length > 0);
    expect(e.calls.length).toBeGreaterThanOrEqual(1);    // 夹具自证：淡入后命中成立
    expect(e.calls[0]!.d).toBe(18);                      // ★S02(BJ723-B)改判:×2=Enemy.hurt 防后——未翻倍基伤(旧 36=预倍形;旧 18=零翻倍)
    expect(e.calls[0]!.crit).toBe(true);                 // ★主判别②（旧恒 false 必红）
    expect(player.accTimerCritCharge).toBe(-15);         // ★主判别③:消费位
  });

  it('2b 964 无饰品零行为变：d=18/crit=false/charge 不动', () => {
    const { hooks, player } = makeGame();
    player.accTimerCritCharge = 1000;
    const e = spyEnemy(400, 552);
    push(hooks, e);
    const sh = new InsanityShadowFriendly(
      { x: e.x, y: e.y, vx: 0, vy: 0, ai0: 0, ai1: 0 }, 18);
    tickUntil(sh, hooks, () => e.calls.length > 0);
    expect(e.calls[0]!.d).toBe(18);
    expect(e.calls[0]!.crit).toBe(false);
    expect(player.accTimerCritCharge).toBe(1000);
  });

  it('2c 判据锚：孢子云 567（dealContacts F11 既有接位）满蓄照消费'
    + '——ChloroLeaf 227/OrichalcumPetal 同通道同证（本刀不触,回归锚）', () => {
    const { hooks, player } = makeGame();
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = spyEnemy(400, 552);
    push(hooks, e);
    const cloud = new SporeSacCloud(e.cx - 7, e.cy - 7, 567, 70, 1.5, 1, undefined);
    tickUntil(cloud, hooks, () => e.calls.length > 0);
    expect(e.calls.length).toBeGreaterThanOrEqual(1);    // 夹具自证
    expect(e.calls[0]!.crit).toBe(true);                 // F11 既有接位=消费成立
    expect(player.accTimerCritCharge).toBe(-15);
  });
});

// ================ §3（BJ467③）Minecart 机械激光 TimerCrit ================
describe('BJ467-③：SuperCart 激光 TimerCrit :12928 消费（Mount.cs:5282 Damage() 全管线）', () => {
  /** 车体 (2400,1400) vx=8 → mech 点 ≈(2420,1433);敌 (2550,1433) 距 ≈130<300、
   *  前向 ±π/4 锥内（angleFrom≈0=rotation 面）、视线空域直通 */
  const laserHit = (hooks: GameHooks, player: Player, e: SpyEnemy): void => {
    const cart = new Minecart();
    cart.x = 2400; cart.y = 1400; cart.vx = 8;
    (cart as unknown as { castSuperCartLaser: (p: Player, g: GameHooks) => void })
      .castSuperCartLaser(player, hooks);
  };

  it('3a 满蓄在场：基伤 60 + crit 参 true + charge −15（S02 改判史:旧 120 必红）', () => {
    const { hooks, player } = makeGame();
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = spyEnemy(2550, 1433);
    push(hooks, e);
    laserHit(hooks, player, e);
    expect(e.calls.length).toBe(1);                      // 夹具自证：锥内视线命中成立
    // ★BJ729-A（2026-10-27）改判史：S02（BJ723-B）crit ×2 移 Enemy.hurt 防后单次
    //  （NPC.cs:82067）——调用侧预倍 ×2 为 S02 全仓清偿漏站（×4 双倍,BJ729-A 摘除）,
    //  spyEnemy mock 观调用侧=基伤 60,crit 旗真值由 Enemy.hurt 承载翻倍。
    expect(e.calls[0]!.d).toBe(60);                      // ★主判别①:基伤无预倍（旧 ×2 预倍形必红）
    expect(e.calls[0]!.crit).toBe(true);                 // ★主判别②（旧恒 false 必红）
    expect(player.accTimerCritCharge).toBe(-15);         // ★主判别③:消费位
  });

  it('3b 无饰品零行为变：d=60/crit=false/charge 不动', () => {
    const { hooks, player } = makeGame();
    player.accTimerCritCharge = 1000;
    const e = spyEnemy(2550, 1433);
    push(hooks, e);
    laserHit(hooks, player, e);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(60);
    expect(e.calls[0]!.crit).toBe(false);
    expect(player.accTimerCritCharge).toBe(1000);
  });
});

// ================ §4（BJ467④）Game.ts 爆炸结算面 TimerCrit ================
describe('BJ467-④：Game.ts 爆炸结算面 TimerCrit :12928 消费（水晶臂+scarab 三臂）', () => {
  /** fakeThis 驾驭（全仓 0 处 new Game()——prototype 方法 .call 窄视图,stub 面=两法
   *  this.* 消费清单;真 World+真 Player 承载 store/蓄能暴击） */
  const makeFake = () => {
    const w = new World(200, 120, 7, 'bj467-explosion-fake');
    for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
    const player = new Player(60 * 16, 90 * 16, new Inventory());
    const enemies: SpyEnemy[] = [];
    const fake: Record<string, unknown> = {
      world: w,
      player,
      entities: { enemies, critters: [], npcs: [] },
      recLog: () => {},
      breakTile: () => {},
      killWallSound: () => {},
      skeletronDowned: () => false,
      spawnDrop: () => null,
      spawnParticles: () => {},
      cutTile: () => {},
      addDamageNumber: () => {},
      damagePlayer: () => 0,
      net: undefined,
      renderer: undefined,
      remotePlayerProxies: [],
      vanillaDust: undefined,
      sfxAt: () => {},
      reportPlayerHurt: () => {},
      rangedCritPct: () => 4,
    };
    fake.explodeAt = (Game.prototype as unknown as Record<string, unknown>).explodeAt;
    fake.explodeFriendlyVictimDamage =
      (Game.prototype as unknown as Record<string, unknown>).explodeFriendlyVictimDamage;
    return { fake, player, enemies, w };
  };

  it('4a scarabBombExplode 敌臂：满蓄 DV 终值 ×2+crit 参+charge −15（旧无 ×2 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);     // DV 掷流钉值（31 档确定性）
    const { fake, player, enemies } = makeFake();
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = spyEnemy(1600, 1500);                    // 48×96 爆盒心
    enemies.push(e);
    const base = damageVarRoll(100, 0);                // 同掷流参考值（banner 非活跃）
    (Game.prototype as unknown as { scarabBombExplode: Function })
      .scarabBombExplode.call(fake, 1600, 1500, 100, 0);
    expect(e.calls.length).toBe(1);                    // 夹具自证：爆炸盒命中成立
    // ★BJ729-A（2026-10-27）改判史：S02（BJ723-B）crit ×2 移 Enemy.hurt 防后单次
    //  （NPC.cs:82067）——scarab 敌臂预倍 ×2 为 S02 全仓清偿漏站（×4 双倍,BJ729-A
    //  摘除）,spyEnemy mock 观调用侧=DV 终值基伤,crit 旗真值由 Enemy.hurt 承载翻倍。
    expect(e.calls[0]!.d).toBe(base);                  // ★主判别①:DV 终值基伤（旧 ×2 预倍形必红）
    expect(e.calls[0]!.crit).toBe(true);               // ★主判别②（旧恒 false 必红）
    expect(player.accTimerCritCharge).toBe(-15);       // ★主判别③:消费位
  });

  it('4b scarab 敌臂无饰品零行为变：d=base/crit=false/charge 不动', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { fake, player, enemies } = makeFake();
    player.accTimerCritCharge = 1000;
    const e = spyEnemy(1600, 1500);
    enemies.push(e);
    const base = damageVarRoll(100, 0);
    (Game.prototype as unknown as { scarabBombExplode: Function })
      .scarabBombExplode.call(fake, 1600, 1500, 100, 0);
    expect(e.calls.length).toBe(1);
    expect(e.calls[0]!.d).toBe(base);
    expect(e.calls[0]!.crit).toBe(false);
    expect(player.accTimerCritCharge).toBe(1000);
  });

  it('4c explodePrimeBomb102 DD2 水晶 548 臂：满蓄 DV(40) 终值 ×2+crit 参+charge −15', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { fake, player, enemies } = makeFake();
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const crystal = spyEnemy(1600, 1440);
    crystal.vanillaId = 548;                           // DD2 永恒水晶（flag2 受害集成员）
    crystal.def = { friendly: true };                  // explodeAt 敌臂 friendly 门拒=不双结算
    enemies.push(crystal);
    const base = damageVarRoll(40, 0);
    (Game.prototype as unknown as { explodePrimeBomb102: Function })
      .explodePrimeBomb102.call(fake, 100, 90, 1600, 1440, 3, false, 0);
    expect(crystal.calls.length).toBe(1);              // 夹具自证（explodeAt 臂被 friendly 门拒）
    // ★BJ729-A 改判史（同 4a）：预倍 ×2=S02 漏站,基伤+crit 旗现役形。
    expect(crystal.calls[0]!.d).toBe(base);            // ★主判别①:DV(40) 基伤（旧 ×2 预倍形必红）
    expect(crystal.calls[0]!.crit).toBe(true);         // ★主判别②（旧恒 false 必红）
    expect(player.accTimerCritCharge).toBe(-15);       // ★主判别③:消费位
  });
});

// ================ §5（BJ467⑤）AI_137 T3 场盒档 ================
describe('BJ467-⑤：AI_137 场盒钳 T3 档（num=14/num5=8 → [128,224];旧恒 [64,160]）', () => {
  const place = (hooks: GameHooks, player: Player): MinionProj =>
    new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
  const sideOf = (m: MinionProj): number => (m as unknown as { auraSide: number }).auraSide;

  it('5a 低天花板（净空 64px）：T3 钳升 128→场盒 256;非 T3 恒 64→128（钉值判别）', () => {
    const { hooks, player } = makeGame();
    for (let x = 0; x < 200; x++) (hooks.world as unknown as { store: World['store'] }).store.setTile(x, 96, 1);   // 天花板 1536
    const mNo = place(hooks, player);
    tickUntil(mNo, hooks, () => sideOf(mNo) > 0);
    expect(sideOf(mNo)).toBe(128);                     // 旧档=64×2（回归锚）
    const { hooks: hooks2, player: player2 } = makeGame();
    for (let x = 0; x < 200; x++) (hooks2.world as unknown as { store: World['store'] }).store.setTile(x, 96, 1);
    setMonk(player2, true, true);                      // T3 在落位拍读（localAI[0]==0 单次）
    const mT3 = place(hooks2, player2);
    tickUntil(mT3, hooks2, () => sideOf(mT3) > 0);
    expect(sideOf(mT3)).toBe(256);                     // ★主判别:128×2（旧 128 必红）
  });

  it('5b 露天（净空 >224）：非 T3 钳 160→场盒 320;T3 保留净空原值（>320）——★BJ606 注：ty 取【出生拍】盒心 tile（原版 origin=Center 在 localAI[0] 首拍盒改写前采样,Projectile.cs:69987;BJ606 盒本体化后实体 cy=地面点,读稳态 cy 不再是净空基准）', () => {
    const { hooks, player } = makeGame();
    const mNo = place(hooks, player);
    const tyNo = Math.floor((mNo as unknown as { cy: number }).cy / 16);   // 出生拍盒心 tile（盒改写前）
    tickUntil(mNo, hooks, () => sideOf(mNo) > 0);
    expect(sideOf(mNo)).toBe(320);                     // 旧档=160×2（回归锚）
    const { hooks: hooks2, player: player2 } = makeGame();
    setMonk(player2, true, true);
    const mT3 = place(hooks2, player2);
    const ty = Math.floor((mT3 as unknown as { cy: number }).cy / 16);     // 出生拍盒心 tile
    expect(ty, '出生位同列同几何（夹具自证）').toBe(tyNo);
    tickUntil(mT3, hooks2, () => sideOf(mT3) > 0);
    // ★R15-F4 钉值重产（2026-10-11）：旧 raw 用 (ty-11) 系把非 T3 档 num=10 硬编码
    //   带进 T3 期望——原版 T3 num=14 → fallback origin.Y−14−1（Projectile.cs:69955-
    //   69957 `result2 = new Point(origin.X, origin.Y - num - 1)`,num 于 :69937 被
    //   `if (setMonkT3) { num = 14; num5 = 8; }` 覆写）→ ty−15。露天档=Up(14) 全空
    //   → raw=1600−(99−15)×16=256 → 钳 [128,224] 取 224 → ×2=448（原版 448px 露天档;
    //   旧钉 384=偏差金标,先破钉后按反编译直读重产）。低天花板 5a 档不受影响
    //   （天花板 96 在 Up(14) 窗内,搜索命中分支与 num 无关）。
    const raw = 1600 - (ty - 15) * 16;                 // 无天花板 → origin-num-1（:69955-57,T3 num=14）
    expect(raw).toBe(256);                             // 夹具自证（旧 (ty-11) 算式=192 必红）
    expect(sideOf(mT3)).toBe(2 * Math.min(224, Math.max(128, raw)));   // ★主判别:T3 钳 [128,224]（旧 ≤320 必红）
    expect(sideOf(mT3)).toBe(448);                     // ★原版 448px 露天档（旧 384 偏差钉已破）
    expect(sideOf(mT3)).toBeGreaterThan(320);
  });
});

// ================ §6（BJ467⑥）四敌臂 :12686 dontTakeDamage 前置门 ================
describe('BJ467-⑥：拳盒/光环/爆弹/爆裂四敌臂 dontTakeDamage 前置门（不达掷不白吃 cd）', () => {
  it('6a 拳盒 623：dontTakeDamage 靶 hurt 0 调+charge 不动（旧白吃 TimerCrit 必红）', () => {
    const { hooks, player } = makeGame();
    player.x = 560; player.y = 580;                    // BJ455 N5c 同位（nearPlayer 500 门）
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = spyEnemy(700, 600);
    e.dontTakeDamage = true;                           // AI 充能/克脑一阶族同态
    push(hooks, e);
    const m = new MinionProj(600, 600, 623, 30, 2, false, 0, false, () => player);
    (m as unknown as { gA0: number; gA1: number }).gA0 = 2;   // 状态 2 拳盒（BJ455 N5c 同式）
    (m as unknown as { gA1: number }).gA1 = e.id;
    tickN(m, hooks, 40);
    expect(e.calls.length).toBe(0);                    // ★主判别①: hurt 0 调（旧 ≥1 必红）
    expect(player.accTimerCritCharge).toBe(1000);      // ★主判别②:TimerCrit 不消费（旧 −15 必红）
    // 对照组：同几何非 dontTakeDamage 靶照命中=夹具达面自证
    const { hooks: hooks2, player: player2 } = makeGame();
    player2.x = 560; player2.y = 580;
    timerOn(player2);
    player2.accTimerCritCharge = 1000;
    const e2 = spyEnemy(700, 600);
    push(hooks2, e2);
    const m2 = new MinionProj(600, 600, 623, 30, 2, false, 0, false, () => player2);
    (m2 as unknown as { gA0: number; gA1: number }).gA0 = 2;
    (m2 as unknown as { gA1: number }).gA1 = e2.id;
    tickUntil(m2, hooks2, () => e2.calls.length > 0);
    expect(e2.calls.length).toBeGreaterThanOrEqual(1); // 达面自证
    expect(player2.accTimerCritCharge).toBe(-15);      // 对照:TimerCrit 照消费
  });

  it('6b 光环 688：dontTakeDamage 靶 hurt 0 调+charge 不动（同构判别）', () => {
    const { hooks, player } = makeGame();
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const e = spyEnemy(400, 1560);                     // 场盒心轴上（bj453 同几何）
    e.dontTakeDamage = true;
    push(hooks, e);
    const m = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player);
    tickN(m, hooks, 40);
    expect(e.calls.length).toBe(0);                    // ★主判别:0 调（旧 ≥1 必红）
    expect(player.accTimerCritCharge).toBe(1000);      // ★主判别:不消费（旧 −15 必红）
    const { hooks: hooks2, player: player2 } = makeGame();
    timerOn(player2);
    player2.accTimerCritCharge = 1000;
    const e2 = spyEnemy(400, 1560);
    push(hooks2, e2);
    const m2 = new MinionProj(392, 1584, 688, 30, 0, true, 0, false, () => player2);
    tickUntil(m2, hooks2, () => e2.calls.length > 0);
    expect(e2.calls.length).toBeGreaterThanOrEqual(1); // 达面自证
    expect(player2.accTimerCritCharge).toBe(-15);
  });

  it('6c 爆弹 691→694：DTD 靶在场（触发靶同拍引爆）hurt 0 调（旧白吃必红）', () => {
    const { hooks, player } = makeGame();
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const trigger = spyEnemy(381, 552);                // chaseable 触发靶（BJ455 N5a 几何）
    push(hooks, trigger);
    const dtd = spyEnemy(430, 560);                    // DTD 靶同在 144² 引爆盒内
    dtd.dontTakeDamage = true;
    push(hooks, dtd);
    const m = new MinionProj(400 - 15, 600 - 15, 691, 40, 2, true, 0, false, () => player);
    tickUntil(m, hooks, () => trigger.calls.length > 0);   // 引爆拍自证（触发靶照伤）
    expect(trigger.calls.length).toBeGreaterThanOrEqual(1);
    expect(dtd.calls.length).toBe(0);                  // ★主判别:DTD 靶 0 调（旧 ≥1 必红）
  });

  it('6d 爆裂 643 volley：DTD 靶在场（索敌靶同落点引爆）hurt 0 调（旧白吃必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);     // 散布偏移=0 → 落点=索敌靶心
    const { hooks, player } = makeGame();
    timerOn(player);
    player.accTimerCritCharge = 1000;
    const target = spyEnemy(400, 552);                 // chaseable 索敌靶
    push(hooks, target);
    const dtd = spyEnemy(404, 556);                    // DTD 靶同在 14+半宽 爆盒内
    dtd.dontTakeDamage = true;
    push(hooks, dtd);
    const m = new MinionProj(400 - 8, 600 - 8, 643, 30, 0, true, 0, false, () => player);
    // ★BJ660 件2 重锚（2026-10-12）：BJ639 批 1 重建后 643 volley = 真 644 爆裂弹实体
    //  （RainbowCrystalBurst,t=30 引爆——原版 Projectile.cs :34975-34998 friendly=true
    //  60×60 penetrate=-1 走 Damage() 全管线;旧「落点即时 AoE」同步结算面已退役）。
    //  夹具须随实体桶推进（bj639 判别锁 ② 同式）：643 哨兵拍 + projectiles 桶各一拍。
    //  旧 tickUntil 单驱哨兵=644 实体永不引爆 → 达面自证恒 0 调=确定性红（BJ659 误诊
    //  BJ650/生产链无罪）。DTD 门现挂重建链 rainbowBurstHitFace :12686 头门前置+
    //  城镇臂 townVoodooGateOpen 巫毒窄门（Damage_PVE_Inner :12618-12631 22+killGuide/
    //  54+killClothier 1:1）——本锁随重建链语义。
    const bucket = (hooks as unknown as { entities: { projectiles: Array<{
      fixedUpdate?: (dt: number, g: GameHooks) => void; dead?: boolean }> } }).entities.projectiles;
    for (let i = 0; i < 120 && target.calls.length === 0; i++) {
      m.fixedUpdate(1, hooks);
      for (const p of [...bucket]) {
        if (p.fixedUpdate && !p.dead) p.fixedUpdate(1, hooks);
      }
    }
    expect(target.calls.length).toBeGreaterThanOrEqual(1);   // 引爆拍自证（644 实体 t=30 引爆）
    expect(dtd.calls.length).toBe(0);                  // ★主判别:DTD 靶 0 调（旧 ≥1 必红;
                                                       //  锁重建链 rainbowBurstHitFace 头门）
  });
});

// ================ §7（BJ467⑦）Arrow flag3 豁免收窄（!usesIDStatic） ================
describe('BJ467-⑦：Arrow else 支 flag3 收窄——usesIDStatic 族不豁免全局窗', () => {
  /** 283（penetrate 1 无 idStatic=flag3 真）vs 286（penetrate 1+usesIDStatic+cd60
   *  =flag3 假）A/B 对：同 iframes=10 残窗,283 照命中、286 必拦（:12636 原版语义） */
  it('7a 286 usesIDStatic 实弹：iframes 残窗内 0 调（旧豁免照命中必红）', () => {
    const { hooks } = makeGame();
    const e = spyEnemy(400, 552);
    e.iframes = 10;                                    // 外源残窗
    push(hooks, e);
    const a = new Arrow(400 - 5, 552 - 5, 0, 0, 30, 1, 286, { grav: 0, life: 40 });
    tickN(a, hooks, 3);
    expect(e.calls.length).toBe(0);                    // ★主判别:usesIDStatic 不豁免（旧 ≥1 必红）
  });

  it('7b 283 对照（flag3 真）：同残窗豁免照命中——收窄面恰为 usesIDStatic 族', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（主环首掷 ×1.0）
    const { hooks } = makeGame();
    const e = spyEnemy(400, 552);
    e.iframes = 10;
    push(hooks, e);
    const a = new Arrow(400 - 5, 552 - 5, 0, 0, 30, 1, 283, { grav: 0, life: 40 });
    tickUntil(a, hooks, () => e.calls.length > 0);
    expect(e.calls.length).toBeGreaterThanOrEqual(1);  // 对照:flag3 豁免保持（回归锚;
    expect(e.calls[0]!.d).toBe(30);                    //  EU=2 子步多跳=既有形,不钉计数）
  });

  it('7c 286 窗清立即命中（拦=整跳不写表不耗穿,窗清照达）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    const { hooks } = makeGame();
    const e = spyEnemy(400, 552);
    e.iframes = 10;
    push(hooks, e);
    const a = new Arrow(400 - 5, 552 - 5, 0, 0, 30, 1, 286, { grav: 0, life: 60 });
    tickN(a, hooks, 3);
    expect(e.calls.length).toBe(0);                    // 残窗内恒拦
    e.iframes = 0;                                     // 窗清（快照窗语义,spy 无自衰减）
    tickUntil(a, hooks, () => e.calls.length > 0, 20);
    expect(e.calls.length).toBeGreaterThanOrEqual(1);  // 窗清照达（拒收=整跳同相）
    expect(e.calls[0]!.d).toBe(30);
  });
});

// ================ §8（BJ467⑧）Arrow 城镇受理照耗 pierce ================
describe('BJ467-⑧：Arrow 城镇受理 pierce 消费（:14189 对城镇受害靶同达）', () => {
  it('8a 箭（pierce 1）砸巫毒向导：受理即亡（旧 pierce 悬空不递减必红）', () => {
    const { hooks, player, towns } = makeGame();
    voodooOn(player);
    const g = guide(hooks, towns, 400, 552);
    const a = new Arrow(400 - 5, 552 - 5, 0, 0, 30, 1, 1, { grav: 0, life: 40 });
    tickUntil(a, hooks, () => g.hp < 5000);
    expect(g.hp).toBeLessThan(5000);                   // 城镇受理成立
    expect(a.dead).toBe(true);                         // ★主判别:pierce 1→0 消亡（旧 false 必红）
  });

  it('8b 箭（pierce 3）砸巫毒向导：受理耗 1、余 2 存活（消费=每受理一次）', () => {
    const { hooks, player, towns } = makeGame();
    voodooOn(player);
    const g = guide(hooks, towns, 400, 552);
    const a = new Arrow(400 - 5, 552 - 5, 0, 0, 30, 1, 1, { grav: 0, life: 40, pierce: 3 });
    tickUntil(a, hooks, () => g.hp < 5000);
    expect(g.hp).toBeLessThan(5000);
    expect(a.dead).toBe(false);                        // pierce 3→2 存活（经济面）
    expect((a as unknown as { pierce: number }).pierce).toBe(2);   // ★主判别:恰耗 1（旧 3 必红）
  });
});

// ================ §9（BJ467⑨）Arrow 502/局部免疫支 cd 检查前置 ================
describe('BJ467-⑨：局部免疫支 cd 前置——flag2（:12585-92）先于水母块（:12680）', () => {
  it('9a 611（接触族 cd6）×水母 63：受击写表→进充能态 → cd 窗内【不电】'
    + '（旧序先 zap 后查 cd=多电一次必红）', () => {
    const { hooks, zaps } = makeGame();
    const j = spyEnemy(400, 552);
    j.vanillaId = 63;                                  // Blue Jellyfish（ZAPPING_JELLYFISH 成员）
    j.w = 60; j.h = 60; j.x = 400 - 30; j.y = 552 - 30;
    push(hooks, j);
    const a = new Arrow(j.cx - 5, j.cy - 5, 0, 0, 30, -1, 611, { grav: 0, life: 300 });
    a.fixedUpdate(1, hooks);                           // 拍1:潜伏态受理命中 → 写 localImmuneCd=6
    expect(j.calls.length).toBe(1);                    // 潜伏态照伤（水母块仅充能态）
    expect(zaps.length).toBe(0);
    j.dontTakeDamage = true;                           // 进充能态（S2 同态建模）,私表 cd 活跃
    for (let i = 0; i < 4; i++) a.fixedUpdate(1, hooks);   // 拍2-5:cd 窗内
    expect(zaps.length).toBe(0);                       // ★主判别:cd 活跃靶连 zap 都不可达（旧 ≥1 必红）
    expect(j.calls.length).toBe(1);                    // 充能态零伤保持
  });

  it('9b 同弹 cd 过期后：充能水母 zap 照达（水母块本相保持,S2 §C 回归锚）', () => {
    const { hooks, zaps } = makeGame();
    const j = spyEnemy(400, 552);
    j.vanillaId = 63;
    j.w = 60; j.h = 60; j.x = 400 - 30; j.y = 552 - 30;
    push(hooks, j);
    const a = new Arrow(j.cx - 5, j.cy - 5, 0, 0, 30, -1, 611, { grav: 0, life: 300 });
    a.fixedUpdate(1, hooks);                           // 拍1:潜伏受理写表
    j.dontTakeDamage = true;                           // 充能
    for (let i = 0; i < 14 && zaps.length === 0; i++) a.fixedUpdate(1, hooks);   // 等 cd 过期
    expect(zaps.length).toBeGreaterThanOrEqual(1);     // cd 清 → 水母块照达（ zap 不缺位）
    expect(j.calls.length).toBe(1);                    // 充能期零伤（S2 判别保持）
  });
});
