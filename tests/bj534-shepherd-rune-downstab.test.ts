// BJ534 重锤符文（用户口称「牧羊符文」= DeadCells Ram Rune,原版物品 5465）下砸全链回归：
//   原版锚——装备链 ApplyEquipFunctional case 5465（1457 Player.cs:14498-14501
//   hasDeadCellsDownDash=true）；触发腿 JumpMovement :20895-20898 flag13 支
//   （hasDeadCellsDownDash && controlDown && vy!=0 && !isPerformingJump_DownDash &&
//   !mount.Active,外门 releaseJump 跳键沿,链位=坐骑多段跳后/瓶族前）+
//   :20934 置位 + :20958-20961 velocity.Y=16×gravDir；踩踏 B 支 :20731-20765；
//   第二竖向碰撞趟 :28424-28430（快坠承载体）；湿态重力档 :24576-24580；
//   落地冲击波 DoDeadCellsGroundPoundEffect :29004-29040（:25516-25519 num11=0 免摔伤）
//   + downDashTime 计时 :24803-24810 / 蓄力判据 :29014（32×t>300）。
// 本仓载体：Player.isDownDashing/downDashTime + eqM.hasDeadCellsDownDash +
//   MountCombat.ramRuneDownDashStomp（B 支本体既有,本批接线）+
//   deadCellsGroundPound（冲击波+编排粒子 producer 闭合）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { statOfInternal } from '../src/data/vanillaItemStats';
import { TILE_BY_KEY } from '../src/data/tiles';
import { ParticleOrchestraType } from '../src/net/syncModules';
import { seededRandom, BATTERY_SEED } from './seeded-rng';

beforeEach(() => { vi.spyOn(Math, 'random').mockImplementation(seededRandom(BATTERY_SEED)); });
afterEach(() => { vi.restoreAllMocks(); });

const _iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];
const RAM_RUNE = _iid(5465);

const STONE = TILE_BY_KEY['stone'];

/** 地面世界：x 0..59 全行石板（缺省 y=104,上方全空;floorY 可下沉给深落测试） */
function makeWorld(floorY = 104): World {
  const w = new World(60, 180, 44, 'bj534');
  for (let x = 0; x < 60; x++) w.store.setTileSilent(x, floorY, STONE, 0, 0);
  return w;
}

interface StubEnemy {
  x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead?: boolean; iframes?: number; dontTakeDamage?: boolean;
  hits: Array<{ dmg: number; kbx: number; kby: number; crit: boolean; fromPlayer: boolean }>;
  hurt(dmg: number, kbx: number, kby: number, g: unknown, ap?: number, crit?: boolean,
    pierce?: number, fp?: boolean): boolean;
}

function mkEnemy(o: Partial<StubEnemy>): StubEnemy {
  const e = {
    x: 0, y: 0, w: 24, h: 24, dead: false, iframes: 0, dontTakeDamage: false, ...o,
    hits: [] as StubEnemy['hits'],
    hurt(this: StubEnemy, dmg: number, kbx: number, kby: number, _g: unknown,
      _ap?: number, crit?: boolean, _pi?: number, fp?: boolean) {
      this.hits.push({ dmg, kbx, kby, crit: !!crit, fromPlayer: !!fp });
      return true;
    },
  } as StubEnemy;
  if (o.cx === undefined) e.cx = e.x + e.w / 2;
  if (o.cy === undefined) e.cy = e.y + e.h / 2;
  return e;
}

/** 真实 Player 最小钩桩（slime-mount-water-jump 同口径 + 伤害/编排粒子记录面） */
function makeHooks(w: World) {
  const fallDamages: number[] = [];
  const orchestras: Array<{ type: number; x: number; y: number; mx?: number; my?: number; ui?: number }> = [];
  const game = {
    world: w, player: null as unknown,
    enemies: () => [] as unknown[], critters: () => [] as unknown[], npcs: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
    spawnParticles: () => {}, spawnDust: () => ({ vx: 0, vy: 0, scale: 1 }),
    addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (dmg: number): number => { fallDamages.push(dmg); return dmg; },
    notifyInventoryChanged: () => {}, onEnemyKilled: () => {},
    spawnEnemy: () => {}, cutTile: () => {},
    broadcastParticleOrchestra: (type: number, x: number, y: number, mx?: number, my?: number, ui?: number) => {
      orchestras.push({ type, x, y, mx, my, ui });
    },
    fallDamages, orchestras,
  } as never as Parameters<Player['fixedUpdate']>[1] & {
    fallDamages: number[];
    orchestras: Array<{ type: number; x: number; y: number; mx?: number; my?: number; ui?: number }>;
  };
  return game;
}

async function makePlayer(xTile = 21, yTile = 100) {
  return new Player(xTile * 16, yTile * 16, new Inventory());
}

/** 落地稳定 + 落地后续 3 拍（RefreshDoubleJumps 落地段补跑——extraJumps/下砸态复位达成） */
function settle(p: Player, game: Parameters<Player['fixedUpdate']>[1]): void {
  for (let i = 0; i < 30 && !p.onGround; i++) p.fixedUpdate(1 / 60, game);
  for (let i = 0; i < 3; i++) p.fixedUpdate(1 / 60, game);
  if (!p.onGround) throw new Error('settle 失败：未落地');
}

/** 人造空中态：原地抬升 dy 像素 + 下坠初速,清落地残留 */
function lift(p: Player, dy: number): void {
  p.y -= dy;
  p.vy = 2;
  p.onGround = false;
  p.fallStartY = p.y;
}

describe('BJ534 ①物品身份（用户实报「牧羊符文」= DeadCellsRamRune 5465「重锤符文」）', () => {
  it('vid 5465 + 装备面 acc=1（ApplyEquipFunctional case 5465 载体）', () => {
    expect(ITEM_BY_KEY['vi_5465_ram_rune']).toBeDefined();
    expect(vanillaItemKey(5465)).toBe('vi_5465_ram_rune');
    expect(statOfInternal(RAM_RUNE)?.acc).toBe(1);   // SetDefaults accessory=true（Item.cs:43129-43132）
  });

  it('l10n 钉值：官方 zh-Hans 名「重锤符文」+ 按住DOWN下砸 tooltip（身份↔用户实报对链）', () => {
    const l10n = JSON.parse(readFileSync(new URL('../public/l10n/zh-Hans.json', import.meta.url), 'utf-8')) as Record<string, unknown>;
    const names = l10n['ItemName'] as Record<string, string>;
    const tips = l10n['ItemTooltip'] as Record<string, string>;
    expect(names['DeadCellsRamRune']).toBe('重锤符文');
    expect(tips['DeadCellsRamRune']).toContain('向下猛击');
  });
});

describe('BJ534 ②触发链（空中+按住↓+跳键沿+装备 5465）', () => {
  it('装备 5465 空中按住↓按跳：isDownDashing 置位 + vy 达终端速（16 被重力链钳回）', async () => {
    const w = makeWorld();
    const game = makeHooks(w);
    const p = await makePlayer();
    p.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    settle(p, game);
    lift(p, 240);
    p.inputDown = true;
    p.inputJump = true; p.jumpEdgePrev = false;   // press 边沿 ≙ releaseJump
    p.fixedUpdate(1 / 60, game);
    expect(p.isDownDashing).toBe(true);
    expect(p.vy).toBeCloseTo(10.01, 6);           // 16×gravDir 当帧被 maxFallSpeed 钳回（:27556）
  }, 30000);

  it('快坠承载体 = 第二竖向碰撞趟：终端速深落段位移 ≈2× 自由落体（:28424-28430）', async () => {
    // ★地板下沉 y=130：落窗全程保持 tile>60 全重力带（本仓 gField 深度重力缩水带
    //   为原版同款——高空 gravity<0.4,浅井会污染控制组的终端速基线）
    const mk = async () => {
      const w = makeWorld(130);
      const game = makeHooks(w);
      const p = await makePlayer(21, 124);
      return { p, game };
    };
    const dash = await mk(); dash.p.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    const fall = await mk();
    for (const s of [dash, fall]) {
      settle(s.p, s.game);
      lift(s.p, 800);                             // 深井：双方全程不落地
      s.p.inputDown = true;
      s.p.inputJump = true; s.p.jumpEdgePrev = false;
      s.p.fixedUpdate(1 / 60, s.game);            // 触发帧
      s.p.inputJump = false;
    }
    expect(dash.p.isDownDashing).toBe(true);
    // 热身 30 拍：控制组亦达终端速（vy≈10.01）——采样窗双方同在终端段,
    // 比值判别面纯对第二趟（无第二趟 = 双方 10.01/t → 比值 1.0 恰红）
    for (let i = 0; i < 30; i++) {
      dash.p.fixedUpdate(1 / 60, dash.game);
      fall.p.fixedUpdate(1 / 60, fall.game);
    }
    const y0d = dash.p.y, y0f = fall.p.y;
    for (let i = 0; i < 8; i++) {
      dash.p.fixedUpdate(1 / 60, dash.game);
      fall.p.fixedUpdate(1 / 60, fall.game);
      expect(dash.p.onGround).toBe(false);
      expect(fall.p.onGround).toBe(false);
    }
    const dDash = dash.p.y - y0d, dFall = fall.p.y - y0f;
    expect(dFall).toBeGreaterThan(70);            // 控制组确在终端速（8×10.01≈80）
    expect(dDash).toBeGreaterThan(dFall * 1.8);   // 双趟 ≈2×（20.02/t vs 10.01/t）
  }, 30000);

  it('四负门：无符文 / 未按↓ / 骑乘 / 已在地面 → 均不置位', async () => {
    // 无符文
    const g1 = makeHooks(makeWorld());
    const p1 = await makePlayer();
    settle(p1, g1); lift(p1, 200);
    p1.inputDown = true; p1.inputJump = true; p1.jumpEdgePrev = false;
    p1.fixedUpdate(1 / 60, g1);
    expect(p1.isDownDashing).toBe(false);
    // 有符文未按↓
    const g2 = makeHooks(makeWorld());
    const p2 = await makePlayer();
    p2.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    settle(p2, g2); lift(p2, 200);
    p2.inputDown = false; p2.inputJump = true; p2.jumpEdgePrev = false;
    p2.fixedUpdate(1 / 60, g2);
    expect(p2.isDownDashing).toBe(false);
    // 有符文+按↓ 但骑乘（ridingMount = mount.active 派生 getter,直置 mount）
    const g3 = makeHooks(makeWorld());
    const p3 = await makePlayer();
    p3.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    settle(p3, g3); lift(p3, 200);
    p3.mount.active = true; p3.mount.type = 3;
    p3.inputDown = true; p3.inputJump = true; p3.jumpEdgePrev = false;
    p3.fixedUpdate(1 / 60, g3);
    expect(p3.isDownDashing).toBe(false);
    // 有符文+按↓ 但贴地（vy==0 → flag13 支 vy!=0 门拒绝,常规跳接管）
    const g4 = makeHooks(makeWorld());
    const p4 = await makePlayer();
    p4.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    settle(p4, g4);
    p4.inputDown = true; p4.inputJump = true; p4.jumpEdgePrev = false;
    p4.fixedUpdate(1 / 60, g4);
    expect(p4.isDownDashing).toBe(false);
    expect(p4.vy).toBeLessThan(0);                // 常规起跳照常
  }, 30000);

  it('优先序：按住↓时下砸腿先于瓶族多段跳（云瓶不被消费,:20895 else-if 链位）', async () => {
    const w = makeWorld();
    const game = makeHooks(w);
    const p = await makePlayer();
    p.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    p.inv.armor[4] = { id: _iid(53), stack: 1 };   // 云朵瓶 → jumpOpts ['Cloud']
    settle(p, game);
    expect(p.equipStats.jumpOpts).toContain('Cloud');
    expect(p.extraJumps.length).toBe(1);           // 落地段已回满
    lift(p, 240);
    p.inputDown = true; p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.isDownDashing).toBe(true);
    expect(p.performingJump).toBeNull();
    expect(p.extraJumps.length).toBe(1);           // 瓶未被消费
  }, 30000);

  it('跳跃上升中松跳再按（↓+跳沿,sustain 窗口残余）：下砸夺帧（:21203 松键 jump=0 净效,jumpHold 清）', async () => {
    const w = makeWorld();
    const game = makeHooks(w);
    const p = await makePlayer();
    p.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    settle(p, game);
    // 原地跳 6 拍（进 sustain 窗口,vy<0 上升中;升幅 ~30px 保证下砸首拍不落地）
    p.inputJump = true; p.jumpEdgePrev = false;
    for (let i = 0; i < 6; i++) p.fixedUpdate(1 / 60, game);
    expect(p.jumpHold).toBeGreaterThan(0);        // sustain 窗口存续
    expect(p.vy).toBeLessThan(0);
    // 松跳一拍（仓内窗口不清零 :6807 判例）→ 按住↓再按跳
    p.inputJump = false; p.inputDown = true;
    p.fixedUpdate(1 / 60, game);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.isDownDashing).toBe(true);
    expect(p.jumpHold).toBe(0);                   // sustain 停（:20823 分支不可达净效）
    expect(p.vy).toBeGreaterThan(0);              // 上升翻转为下砸
  }, 30000);

  it('家族不回归：不按↓时云瓶二段跳照常消费 + 消费帧打断下砸（:20934 写 flag13=false）', async () => {
    const w = makeWorld();
    const game = makeHooks(w);
    const p = await makePlayer();
    p.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    p.inv.armor[4] = { id: _iid(53), stack: 1 };
    settle(p, game);
    lift(p, 300);
    p.inputDown = true; p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.isDownDashing).toBe(true);
    // 松开↓与跳键一拍（边沿复位）,再按跳（无↓）→ 云瓶消费 + 下砸态清
    p.inputDown = false; p.inputJump = false;
    p.fixedUpdate(1 / 60, game);
    p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.performingJump).toBe('Cloud');
    expect(p.isDownDashing).toBe(false);
    expect(p.extraJumps.length).toBe(0);
  }, 30000);
});

describe('BJ534 ③态机（计时器/骑乘打断/落地复位）', () => {
  it('downDashTime 下砸期逐拍递增、非下砸清零（:24803-24810）', async () => {
    const w = makeWorld();
    const game = makeHooks(w);
    const p = await makePlayer();
    p.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    settle(p, game);
    expect(p.downDashTime).toBe(0);
    lift(p, 600);
    p.inputDown = true; p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    p.inputJump = false; p.inputDown = false;
    const t0 = p.downDashTime;
    expect(t0).toBeGreaterThanOrEqual(1);
    p.fixedUpdate(1 / 60, game);
    expect(p.downDashTime).toBe(t0 + 1);
    // 落地复位（RefreshDoubleJumps 落地段）
    for (let i = 0; i < 200 && !p.onGround; i++) p.fixedUpdate(1 / 60, game);
    expect(p.onGround).toBe(true);
    p.fixedUpdate(1 / 60, game);
    expect(p.isDownDashing).toBe(false);
    expect(p.downDashTime).toBe(0);
  }, 30000);

  it('骑乘即打断（:24799-24801 mount.Active → isPerformingJump_DownDash=false）', async () => {
    const w = makeWorld();
    const game = makeHooks(w);
    const p = await makePlayer();
    p.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    settle(p, game);
    lift(p, 240);
    p.inputDown = true; p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    expect(p.isDownDashing).toBe(true);
    p.mount.active = true; p.mount.type = 3;      // ridingMount 派生真
    p.fixedUpdate(1 / 60, game);
    expect(p.isDownDashing).toBe(false);
  }, 30000);
});

describe('BJ534 ④执行面（踩踏 B 支接线 + 落地冲击波）', () => {
  it('下砸下坠期脚底横带踩踏：40×minionDamage/kb5/fromPlayer（:20731-20765 接线）', async () => {
    const w = makeWorld();
    const game = makeHooks(w);
    const p = await makePlayer();
    p.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    settle(p, game);
    lift(p, 100);
    p.isDownDashing = true;                       // 直接置态（触发链已由②覆盖）——单拍踩踏窗口
    p.vy = 5;
    // 敌怪正卡脚底横带（band = rect.Offset(0,h-1).Height=2.Inflate(12,6)）
    const e = mkEnemy({ x: p.x - 2, y: p.y + p.h - 1 - 8, w: 24, h: 24 });
    (game as unknown as { enemies: () => unknown[] }).enemies = () => [e];
    p.fixedUpdate(1 / 60, game);
    expect(e.hits.length).toBe(1);
    expect(e.hits[0].dmg).toBe(40);               // (int)(40×minionDamage=1)
    expect(Math.abs(e.hits[0].kbx)).toBe(5);
    expect(e.hits[0].crit).toBe(false);
    expect(e.hits[0].fromPlayer).toBe(true);
  }, 30000);

  it('落地冲击波非蓄力档：30 平值/crit=false/kb10 + 半径 128 + 编排粒子 uniqueInfo=0', async () => {
    const w = makeWorld();
    const game = makeHooks(w);
    const p = await makePlayer();
    p.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    settle(p, game);
    const landY = p.y;                            // 落地 = 原踩地位（lift 原地抬升）
    lift(p, 40);                                  // 短距 → 落地拍 downDashTime≈3 <10 = 非蓄力
    const near = mkEnemy({ x: p.x + 38, y: landY - 34, w: 24, h: 24 });  // 中心距 ~50 ≤128
    const far = mkEnemy({ x: p.x + 128, y: landY - 34, w: 24, h: 24 });  // 中心距 ~140 >128
    (game as unknown as { enemies: () => unknown[] }).enemies = () => [near, far];
    p.inputDown = true; p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);                  // 触发
    p.inputJump = false; p.inputDown = false;
    for (let i = 0; i < 120 && !p.onGround; i++) p.fixedUpdate(1 / 60, game);
    expect(p.onGround).toBe(true);
    expect(near.hits.length).toBe(1);
    expect(near.hits[0].dmg).toBe(30);            // 平值,无 DamageVar/minionDamage 乘区
    expect(near.hits[0].crit).toBe(false);
    expect(near.hits[0].kbx).toBe(10);            // 目标在玩家右侧 → +10
    expect(far.hits.length).toBe(0);              // 超出 128 半径
    const orch = game.orchestras.filter((o) => o.type === ParticleOrchestraType.DeadCellsDownDashExplosion);
    expect(orch.length).toBe(1);
    expect(orch[0].ui).toBe(0);                   // 蓄力档 uniqueInfoPiece=0
  }, 30000);

  it('蓄力档（32×downDashTime>300 ⇔ ≥10t）：30 伤+crit 旗（防后 ×2=Enemy.hurt 承载）/kb20/crit=true + 半径 176', async () => {
    const w = makeWorld();
    const game = makeHooks(w);
    const p = await makePlayer();
    p.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    settle(p, game);
    const landY = p.y;
    lift(p, 400);                                 // 长距 → 落地时 ≥10t 蓄满
    const near = mkEnemy({ x: p.x + 38, y: landY - 34, w: 24, h: 24 });
    const mid = mkEnemy({ x: p.x + 128, y: landY - 34, w: 24, h: 24 });  // >128 ≤176 只蓄力档可达
    (game as unknown as { enemies: () => unknown[] }).enemies = () => [near, mid];
    p.inputDown = true; p.inputJump = true; p.jumpEdgePrev = false;
    p.fixedUpdate(1 / 60, game);
    p.inputJump = false; p.inputDown = false;
    for (let i = 0; i < 200 && !p.onGround; i++) p.fixedUpdate(1 / 60, game);
    expect(p.onGround).toBe(true);
    expect(p.downDashTime).toBeGreaterThanOrEqual(10);
    expect(near.hits.length).toBe(1);
    expect(near.hits[0].dmg).toBe(30);            // ★BJ741 R19-8：:29011 平值 30 恒定——crit 旗单布尔承载 ×2（Enemy.hurt 防后,S02 域）;旧「30×2 调用侧预倍」=×4 双倍已摘
    expect(near.hits[0].crit).toBe(true);
    expect(near.hits[0].kbx).toBe(20);
    expect(mid.hits.length).toBe(1);              // 176 半径臂
    expect(mid.hits[0].dmg).toBe(30);
    const orch = game.orchestras.filter((o) => o.type === ParticleOrchestraType.DeadCellsDownDashExplosion);
    expect(orch.length).toBe(1);
    expect(orch[0].ui).toBe(1);                   // 蓄力档 uniqueInfoPiece=1
  }, 30000);

  it('下砸落地免摔伤（:25516-25519 num11=0）：同高自由落体结伤、下砸落地零伤', async () => {
    // 对照组：无符文 34 格自由落体 → 摔伤入账（先落 1 拍出 vy≠0,次拍才按跳沿=无效无符文）
    const gC = makeHooks(makeWorld());
    const pC = await makePlayer(21, 70);
    for (let i = 0; i < 300 && !pC.onGround; i++) pC.fixedUpdate(1 / 60, gC);
    expect(pC.onGround).toBe(true);
    expect(gC.fallDamages.length).toBeGreaterThan(0);
    // 实验组：同高下砸（首拍自由落 0.4 出 vy≠0,次拍按跳沿触发）落地 → 摔伤零调用
    const gD = makeHooks(makeWorld());
    const pD = await makePlayer(21, 70);
    pD.inv.armor[3] = { id: RAM_RUNE, stack: 1 };
    pD.inputDown = true;
    pD.fixedUpdate(1 / 60, gD);                   // 首拍：起落 vy≈0.4
    pD.inputJump = true; pD.jumpEdgePrev = false;
    for (let i = 0; i < 300 && !pD.onGround; i++) pD.fixedUpdate(1 / 60, gD);
    expect(pD.onGround).toBe(true);
    expect(gD.fallDamages.length).toBe(0);
    expect(gD.orchestras.some((o) => o.type === ParticleOrchestraType.DeadCellsDownDashExplosion)).toBe(true);
  }, 30000);
});
