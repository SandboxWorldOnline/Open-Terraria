// SW-FX40 反重力波 5——移交八项 + 既有债三项（1457 金标逐锚）。
//  ★本波验收分类矩阵（gd=1 行为变更项 与 gd=-1/无关 新增项 分开钉面）：
//   a 飞毯续期门 :22037-22040   —— gd=1 行为变更（补 `vy>-g` 门,上升不再剪成 -0.4）;
//                                  gd=-1 恒等（FX34 域D 已钉,本波只回归锁）
//   b 羽落终端钳 :27563-27595   —— gd=1 行为变更（maxFall/3 与 /5→/10 钳,终速 10→3.33）;
//                                  gd=-1 新增镜像臂;蜜蜂坐骑(5)豁免=原文
//   c 顶头臂 :28463-28470       —— gd=1 行为变更（vy=+0.01+jumpHold=0,merman 豁免）;
//                                  gd=-1 恒等（FX34 域G1,本波按原文归位 if/else-if）
//   d MakeFloorDust :23981-24234 —— gd 无关整支新增（行走/落地地板尘 76/32/16/322-328+
//                                  Item177 音;gd=-1 出尘位/速度镜像随支）
//   e mount43 弹跳臂 :19909-19921 —— gd=1 新增行为（弹跳 vy=-(max(js·gd·0.5,2)+0.01)）;
//                                  gd=-1 倒挂 quirk（clamp<2 吞负值=向上顶,原文照单）
//   f BordersMovement 底界 :24292-24317 —— gd 无关行为变更（skyblock 门+(-height) 脚底钳
//                                  +ROCK_BOTTOM 事件 10;旧"恒杀"=自造域）
//   g TouchedTiles :57734/:29182 —— gd 无关新增（UpdateTouchingTiles + GetHurtTile 兜底）
//   h1 StepUp 门腿 :28265/:28276 —— gd 无关（controlDown/IsRidingTracks 矿车腿/flag28/29）
//   h2 gravity 字段门 :24884/:28265/:23610 —— gd=1 行为变更（深度缩水带门值 0.4→0.4·num6）;
//                                  gd=-1 慢Fall 签名因子新增（:27228 ×gravDir）
//   h3 FloorVisuals 门 :28479    —— gd 无关（!ridingCart → grappling[0]==-1）
//  ★变异证红：每组注明「旧实现退化值」——回退任一刀对应组必红。
//  ★测试世界注：groundLevel 缺省 0 → 深度重力 num6 钳 0.25（y/16<60.13 带,gField=0.1）
//  /1（row 61+ 带,gField=0.4）——两带各有一组断言。
import { describe, it, expect } from 'vitest';
import { Player } from '../src/entities/Player';
import { moveAndCollide } from '../src/physics/TileCollision';
import { World } from '../src/world/World';
import { TILE, GRAVITY, MAX_FALL_SPEED, PLAYER_MAX_FALL_SPEED, PLAYER_JUMP_TICKS } from '../src/core/constants';
import { TILE_DEFS, TILE_BY_KEY } from '../src/data/tiles';
import { Inventory } from '../src/items/Inventory';
import { BuffType } from '../src/stats/Buffs';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_BY_KEY } from '../src/data/items';
import type { GameHooks } from '../src/entities/types';
import type { Body } from '../src/physics/TileCollision';

const STONE_ID = TILE_BY_KEY['stone'] ?? 1;
const JS = 5.01;

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};
/** TS tile id ← 原版 sheet id（MakeFloorDust 表按 sheet 映射） */
const tileBySheet = (sheet: number): number => {
  for (let i = 1; i < TILE_DEFS.length; i++) {
    if (TILE_DEFS[i]?.vanilla?.sheet === sheet) return i;
  }
  return -1;
};

interface DustRec { x: number; y: number; w: number; h: number; type: number }

function makeGame(w: World): { game: GameHooks; dust: DustRec[]; sfx: string[]; ach: number[]; dmg: number[] } {
  const dust: DustRec[] = [];
  const sfx: string[] = [];
  const ach: number[] = [];
  const dmg: number[] = [];
  const game = {
    world: w, player: null as unknown, enemies: () => [], critters: () => [],
    entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: (f: string) => { sfx.push(f); },
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (d: number): number => { dmg.push(d); return d; }, notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    achievements: {
      notifyProgressionEvent: () => {},
      handleSpecialEvent: (id: number) => { ach.push(id); },
    },
    vanillaDust: {
      spawn: (x: number, y: number, ww: number, hh: number, type: number) => {
        const o = { x, y, w: ww, h: hh, type, vx: 0, vy: 0, scale: 1, alpha: 50, noGravity: false, noLight: false };
        dust.push(o);                              // 推返回体:刀后写位（镜像/scale/noGravity）可见
        return o;
      },
    },
  } as unknown as GameHooks;
  return { game, dust, sfx, ach, dmg };
}

/** 平地世界：地板 70/71 行石（row 61+ = gField 0.4 带） */
function flatWorld(): World {
  const w = new World(480, 120, 30, 'open');
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, 70, STONE_ID, 0, 0);
    w.store.setTileSilent(x, 71, STONE_ID, 0, 0);
  }
  return w;
}

/** 竖井世界：顶 62/63 行石、地板 68 行 */
function shaftWorld(): World {
  const w = new World(480, 120, 30, 'open');
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, 62, STONE_ID, 0, 0);
    w.store.setTileSilent(x, 63, STONE_ID, 0, 0);
    w.store.setTileSilent(x, 68, STONE_ID, 0, 0);
  }
  return w;
}

/** 沙/雪/便便地板世界（MakeFloorDust 材质面） */
function materialWorld(sheet: number, ceiling = false): World {
  const w = new World(480, 120, 30, 'open');
  const id = tileBySheet(sheet);
  for (let x = 0; x < w.w; x++) {
    w.store.setTileSilent(x, 70, id, 0, 0);
    if (ceiling) w.store.setTileSilent(x, 63, id, 0, 0);
  }
  return w;
}

// ---- 域A（a）：飞毯续期门 Player.cs:22037-22045 ----
describe('SW-FX40 域A：飞毯续期 gd=1 门（:22037-22040;旧实现退化值=无条件钉写）', () => {
  function carpetPlayer(gd: 1 | -1, vy0: number): { p: Player; game: GameHooks } {
    const w = flatWorld();
    const p = new Player(60 * TILE, 65 * TILE, new Inventory());
    p.inv.armor[3] = { id: iid(934), stack: 1 };   // 飞毯
    p.gravDir = gd; p.vy = vy0;
    if (gd === -1) p.buffs.apply(BuffType.Gravitation, 600);
    p.carpetTime = 300;
    p.extraJumps = [];
    p.inputJump = true;
    p.jumpEdgePrev = true;                          // 静化跳沿（空中无起跳面）
    return { p, game: makeGame(w).game };
  }

  it('A1 gd=1 行为变更：上升段（vy=-5）过门不钉——续升照旧（变异=删门 → 钉回 -0.4 本组红）', () => {
    const { p, game } = carpetPlayer(1, -5);
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(-4.6, 9);              // -5 + 0.4 重力,门内不写 → 续升
    expect(Math.abs(p.vy)).toBeGreaterThan(4);      // 旧退化值 ≈ 0（钉 -0.400001 + 0.4）
  });

  it('A2 gd=1 下降段恒等：vy=3 过门钉 -(g+ε) → 重力后 ≈ 0（FX34 D1 同值面回归锁）', () => {
    const { p, game } = carpetPlayer(1, 3);
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeLessThan(0);
    expect(Math.abs(p.vy)).toBeLessThan(1e-5);      // -(0.400001)+0.4 ≈ -1e-6
  });

  it('A3 gd=-1 恒等：倒挂续期臂照旧（FX34 D2 回归锁,本波未动）', () => {
    const { p, game } = carpetPlayer(-1, -2);
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeGreaterThan(0);
    expect(Math.abs(p.vy)).toBeLessThan(1e-5);      // +0.400001 - 0.4 ≈ 1e-6
  });
});

// ---- 域B（b）：慢Fall 终端钳 Player.cs:27563-27595 ----
describe('SW-FX40 域B：羽落终端钳（:27571-27578/:27586-27593;旧实现退化值=整缺,终速 10）', () => {
  function ffPlayer(gd: 1 | -1, vy0: number, inputUp = false): { p: Player; game: GameHooks } {
    const w = flatWorld();
    const p = new Player(60 * TILE, 65 * TILE, new Inventory());
    p.gravDir = gd; p.vy = vy0; p.inputUp = inputUp;
    p.buffs.apply(BuffType.Featherfall, 600);
    if (gd === -1) p.buffs.apply(BuffType.Gravitation, 600);
    return { p, game: makeGame(w).game };
  }

  it('B1 gd=1 行为变更：慢Fall 终端钳 maxFall/3≈3.33（变异=删钳 → vy=8.4 本组红）', () => {
    const { p, game } = ffPlayer(1, 8);
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(PLAYER_MAX_FALL_SPEED / 3, 6);   // 10.01/3 ≈ 3.3367（★SW-RB14d :24637 +0.01 字段终值）
  });

  it('B2 gd=1 TryingToHoverUp 档：/5 过门 → /10=1.0 驻留（:27575-27578）', () => {
    const { p, game } = ffPlayer(1, 8, true);
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(PLAYER_MAX_FALL_SPEED / 10, 6);  // 1.0
  });

  it('B3 gd=-1 新增镜像臂：倒挂坠落 vy=-8 → 钳 -maxFall/3（变异=删镜像 → -8.4 本组红）', () => {
    const { p, game } = ffPlayer(-1, -8);
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeCloseTo(-PLAYER_MAX_FALL_SPEED / 3, 6);
  });
});

// ---- 域C（c）：正挂顶头臂 Player.cs:28463-28470 ----
describe('SW-FX40 域C：顶头 +0.01+jump=0（:28463-28470;旧实现退化值=臂缺,vy=0+jumpHold 拖拍）', () => {
  function bumper(): { p: Player; game: GameHooks } {
    const w = shaftWorld();
    const p = new Player(100, 64 * TILE + 4, new Inventory());   // 顶边 1028,天花板底 1024
    p.vy = -5; p.inputJump = true; p.jumpHold = 12;              // 模拟跳跃中段
    return { p, game: makeGame(w).game };
  }

  it('C1 gd=1 行为变更：上撞天花板同拍 vy=+0.01 + jumpHold=0（变异=删臂 → vy=0/jumpHold=11 本组红）', () => {
    const { p, game } = bumper();
    p.fixedUpdate(1 / 60, game);
    expect(p.hitHead).toBe(true);
    expect(p.vy).toBe(0.01);                        // :28465 velocity.Y=0.01f
    expect(p.jumpHold).toBe(0);                     // :28468-28469 同拍取消
  });

  it('C2 gd=1 行为链：顶头次拍不再续钉（自由下落;变异=删臂 → sustain 重钉 vy<0 本组红）', () => {
    const { p, game } = bumper();
    p.fixedUpdate(1 / 60, game);
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBeGreaterThan(0.4);              // 0.01+0.4=0.41 下落
  });

  it('C3 gd=1 merman 豁免（:28466 !merman 门）——merman 为每拍终态裁定块重算位（:25774-25785）',
    () => {
      // 单测无法直写 merman（每拍重算覆盖）——门体已按原文落刀（!this.merman），
      // 豁免面留待人鱼变身链既有测试域覆盖；此处钉 vy=+0.01 写位不受 merman 影响面
      const { p, game } = bumper();
      p.fixedUpdate(1 / 60, game);
      expect(p.hitHead).toBe(true);
      expect(p.vy).toBe(0.01);
    });
});

// ---- 域D（d）：MakeFloorDust Player.cs:23981-24234 ----
describe('SW-FX40 域D：MakeFloorDust 整支（:23981-24234;旧实现退化值=整函数缺,零尘）', () => {
  it('D1 行走尘（沙 53→尘 32）：贴地行走按 |vx|/3 概率出尘（变异=删调用 → 零尘 本组红）', () => {
    const w = materialWorld(53);
    const { game, dust } = makeGame(w);
    const p = new Player(60 * TILE, 70 * TILE - 42, new Inventory());
    for (let i = 0; i < 120; i++) {
      p.inputX = 1;
      p.fixedUpdate(1 / 60, game);                  // 加速到满速贴地行走
    }
    expect(p.vy).toBe(0);                           // 贴地
    expect(dust.length).toBeGreaterThan(0);         // 120 拍 50% 出尘概率,空转概率 2^-120
    expect(dust.every((d) => d.type === 32)).toBe(true);
    expect(dust[0].y).toBe(70 * TILE - 2);          // 盒顶 = y+h-2 = feet-2（:24174）
  });

  it('D2 落地 20 连发（雪 147→尘 76 无掷豁）：landing 拍恰 20 枚+noGravity（变异=删 falling 支 → ≤1 本组红）', () => {
    const w = materialWorld(147);
    const { game, dust } = makeGame(w);
    const p = new Player(60 * TILE, 64 * TILE, new Inventory());   // 高空坠落
    for (let i = 0; i < 40 && dust.length === 0; i++) p.fixedUpdate(1 / 60, game);
    expect(dust.length).toBe(20);                   // :24018 num2=20（尘 76 无稀疏掷）
    expect(dust.every((d) => d.type === 76)).toBe(true);
  });

  it('D3 gd=-1 镜像出尘位：dust.y -= height+4（:24175-24177;变异=删镜像 → 尘落身体下方 本组红）', () => {
    const w = materialWorld(53, true);
    const { game, dust } = makeGame(w);
    const p = new Player(60 * TILE, 64 * TILE + 8, new Inventory());   // 倒挂顶边 1032,顶 1024
    p.gravDir = -1;
    p.buffs.apply(BuffType.Gravitation, 600);       // 倒挂态每拍维持（FX34 同款;防拍内复位）
    for (let i = 0; i < 40 && dust.length === 0; i++) p.fixedUpdate(1 / 60, game);
    expect(dust.length).toBeGreaterThan(0);         // 沙 32 有 50% 稀疏掷,20 连发非全出
    expect(dust.length).toBeLessThanOrEqual(20);
    expect(dust.every((d) => d.type === 32)).toBe(true);
    // 落定后 y=1024：spawn 盒顶 = y+h-2 = 1064 → 镜像 -(h+4)=-46 → 1018（贴天花板侧）
    expect(dust[0].y).toBe(64 * TILE - 6);
  });

  it('D4 便便族落地音 Item177 + 尘 322（:24021/:24034;变异=删音 → sfx 空 本组红）', () => {
    const w = materialWorld(666);
    const { game, dust, sfx } = makeGame(w);
    const p = new Player(60 * TILE, 64 * TILE, new Inventory());
    for (let i = 0; i < 40 && dust.length === 0; i++) p.fixedUpdate(1 / 60, game);
    expect(sfx).toContain('Item_177');
    expect(dust.length).toBe(20);
    expect(dust.every((d) => d.type === 322)).toBe(true);
  });

  it('D5 石材零尘（:24011 允许集闸——sheet 1 不在表 → 早退）', () => {
    const w = flatWorld();
    const { game, dust } = makeGame(w);
    const p = new Player(60 * TILE, 64 * TILE, new Inventory());
    for (let i = 0; i < 40; i++) p.fixedUpdate(1 / 60, game);
    expect(dust.length).toBe(0);
  });
});

// ---- 域E（e）：mount43 弹跳座 Player.cs:19909-19921 ----
describe('SW-FX40 域E：mount43 自动弹跳臂（:19909-19921;旧实现退化值=臂缺,vy 恒 0 滑行）', () => {
  /** 倒挂座贴天花板世界（gd=-1 的"地面"=顶 62/63 行） */
  function pogo(gd: 1 | -1): { p: Player; game: GameHooks } {
    const w = gd === 1 ? flatWorld() : shaftWorld();
    const { game } = makeGame(w);
    const p = gd === 1
      ? new Player(60 * TILE, 70 * TILE - 42, new Inventory())
      : new Player(60 * TILE, 64 * TILE, new Inventory());       // 顶边贴天花板底 1024
    p.gravDir = gd;
    p.mount.active = true; p.mount.type = 43;
    p.inputX = 0; p.inputJump = false;
    p.fixedUpdate(1 / 60, game);                    // t0 预热：jumpSpeedField=坐骑档 8
    p.inputX = 1;
    return { p, game };
  }

  it('E1 gd=1 弹跳：vy=-(max(8·0.5,2)+0.01)=-4.01（变异=删臂 → vy≈0 本组红）', () => {
    const { p, game } = pogo(1);
    p.fixedUpdate(1 / 60, game);
    // 拍内链：弹跳 -4.01 → 重力 +0.4 → 松键上升衰减 +0.01（:22435-22446）= -3.6
    expect(p.vy).toBeCloseTo(-3.6, 6);
    // ★BJ705-G23 迁移:弹跳臂 :19919 jump=15 后,同拍 JumpMovement(:26945) else 支
    // （controlJump=false——弹跳门本要求 !controlJump）松键即清 jump=0（:21201-08）
    // ——纯冲量无平台段=vanilla 净效;旧期望 14 锁的是耗尽制旧面
    expect(p.jumpHold).toBe(0);
  });

  it('E2 gd=-1 倒挂 quirk：num3=js·(-0.5)<2 钳 2 → vy=-2.01（变异=删钳 → 反号 本组红）', () => {
    // 悬空起测（不着顶：弹跳向顶会被碰撞吞）——jumpSpeedField=缺省 5.01,
    // num3=-2.505<2 → 钳 2（quirk 与坐骑档无关）
    const w = shaftWorld();
    const { game } = makeGame(w);
    const p = new Player(60 * TILE, 64 * TILE + 20, new Inventory());
    p.forcedGravityT = 10;                          // FTW 克脑强制倒挂（:26489-26493;
                                                    //  坐骑态 gravitation 不倒挂(:26933),forcedGravity 才倒）
    p.mount.active = true; p.mount.type = 43;
    p.inputX = 1;
    p.fixedUpdate(1 / 60, game);
    // 拍内链：弹跳 -2.01（钳后）→ 倒挂重力 -0.4 → 衰减臂 gd=-1 vy>0 不触 → -2.41
    expect(p.vy).toBeCloseTo(-2.41, 6);
  });

  it('E3 门否域：无横向输入不出弹（:19909 flag=controlLeft||controlRight 腿）', () => {
    const { p, game } = pogo(1);
    p.inputX = 0;                                   // 撤输入
    p.fixedUpdate(1 / 60, game);
    expect(p.vy).toBe(0);                           // 贴地静置（旧臂缺同值,变异面由 E1 承担）
  });
});

// ---- 域F（f）：BordersMovement 底界 Player.cs:24292-24317 ----
describe('SW-FX40 域F：底界三刀（:24292-24317;旧实现退化值=恒杀+无脚底钳+无事件）', () => {
  it('F1 gd 无关行为变更：普通世界底界不杀、只钳+脚底拉回（变异=回恒杀 → hp=0 本组红）', () => {
    const w = flatWorld();                          // hPx=1920,底界带 y>1280
    const { game } = makeGame(w);
    const p = new Player(100, 1300, new Inventory());
    p.hp = 100;
    p.bordersMovement(w, game);
    expect(p.hp).toBe(100);                         // 旧退化值 0（恒杀）
    expect(p.y).toBe(120 * TILE - 640 - 42);        // 1238 = 1280-42 脚底钳
    expect(p.vy).toBe(0);
  });

  it('F2 skyblock 世界越界即死（:24295-24297 门内面;变异=删门 → 恒不杀 本组红）', () => {
    const w = flatWorld();
    w.seedFlags.skyblock = true;
    const { game } = makeGame(w);
    const p = new Player(100, 1300, new Inventory());
    p.hp = 100;
    p.bordersMovement(w, game);
    expect(p.hp).toBe(0);
    expect(p.y).toBe(120 * TILE - 640);             // 仅 640 钳,脚底钳不生效（flag 假）
  });

  it('F3 界内不动（y ≤ bottom-640-height 带外不钳）', () => {
    const w = flatWorld();
    const { game } = makeGame(w);
    const p = new Player(100, 1200, new Inventory());
    p.bordersMovement(w, game);
    expect(p.y).toBe(1200);
  });

  it('F4 ROCK_BOTTOM：y > bottom-640-118-height 触发事件 10（变异=删事件 → ach 空 本组红）', () => {
    const w = flatWorld();
    const { game, ach } = makeGame(w);
    const p = new Player(100, 1130, new Inventory());
    p.bordersMovement(w, game);
    expect(ach).toContain(10);
    const q = new Player(100, 1100, new Inventory());
    const g2 = makeGame(w);
    q.bordersMovement(w, g2.game);
    expect(g2.ach).not.toContain(10);
  });
});

// ---- 域G（g）：TouchedTiles Player.cs:57734/:29182 ----
describe('SW-FX40 域G：TouchedTiles + GetHurtTile 兜底（:57734-57765/:29189-29201;旧=兜底整缺）', () => {
  it('G1 兜底消费：盒扫落空时上拍触碰格可伤（尖刺 48）（变异=删兜底 → 零伤害 本组红）', () => {
    const w = flatWorld();
    const { game, dmg } = makeGame(w);
    const spike = tileBySheet(48);
    w.store.setTileSilent(60, 70, spike, 0, 0);
    const p = new Player(50 * TILE, 40 * TILE, new Inventory());   // 远离尖刺（盒扫必空）
    p.touchedTiles.push({ x: 60, y: 70 });          // 模拟上拍触碰清单
    p.hp = 100;
    p.fixedUpdate(1 / 60, game);
    expect(dmg.length).toBeGreaterThan(0);          // TOUCH_IMMEDIATE 48=60（DamageVar 掷后）
    expect(dmg[0]).toBeGreaterThan(0);
  });

  it('G2 窒息族豁免（:29192 !Suffocate——埋沙不走兜底触伤）', () => {
    const w = flatWorld();
    const { game, dmg } = makeGame(w);
    w.store.setTileSilent(60, 70, tileBySheet(53), 0, 0);
    const p = new Player(50 * TILE, 40 * TILE, new Inventory());
    p.touchedTiles.push({ x: 60, y: 70 });
    p.hp = 100;
    p.fixedUpdate(1 / 60, game);
    expect(dmg.length).toBe(0);
  });

  it('G3 收集：嵌入态 probe 命中脚下实心行（变异=删 updateTouchingTiles 调用 → 空 本组红）', () => {
    const w = flatWorld();
    const p = new Player(100, 1089, new Inventory());   // feet=1131（嵌入 70/71 行）
    p.vy = 6;
    p.updateTouchingTiles(w);
    expect(p.touchedTiles.length).toBeGreaterThan(0);
    expect(p.touchedTiles.some((t) => t.x === 6 && t.y >= 70 && t.y <= 71)).toBe(true);
    expect(p.touchedTiles.every((t) => t.y >= 70 && t.y <= 71)).toBe(true);
  });

  it('G4 净空态零清单（原版 TouchedTiles.Clear 语义——贴脚 exact-touch 探针不命中）', () => {
    const w = flatWorld();
    const p = new Player(100, 70 * TILE - 42, new Inventory());   // feet=1120 贴面
    p.vy = 0;
    p.updateTouchingTiles(w);
    expect(p.touchedTiles.length).toBe(0);
  });
});

// ---- 域H（h1/h2/h3）：既有债三刀 ----
describe('SW-FX40 域H1：StepUp/StepDown 门腿（:28265/:28276;旧实现退化值=腿缺恒开）', () => {
  it('H1 flag28 腿：飞行/钻探坐骑（7/8/12/44/49）不自动上台阶（变异=删腿 → stepUp true 本组红）', () => {
    const w = flatWorld();
    const { game } = makeGame(w);
    const p = new Player(60 * TILE, 70 * TILE - 42, new Inventory());
    p.mount.active = true; p.mount.type = 7;        // UFO
    p.fixedUpdate(1 / 60, game);
    expect(p.stepUp).toBe(false);
    const q = new Player(60 * TILE, 70 * TILE - 42, new Inventory());
    q.fixedUpdate(1 / 60, game);
    expect(q.stepUp).toBe(true);
  });

  it('H2 controlDown 腿：按 ↓ 不探台阶（:28276 !controlDown）', () => {
    const w = flatWorld();
    const { game } = makeGame(w);
    const p = new Player(60 * TILE, 70 * TILE - 42, new Inventory());
    p.inputDown = true;
    p.fixedUpdate(1 / 60, game);
    expect(p.stepUp).toBe(false);
  });

  it('H3 flag29 腿：黑魔书 48 禁 StepDown（:28265 !flag29 → stepDownGate never）', () => {
    const w = flatWorld();
    const { game } = makeGame(w);
    const p = new Player(60 * TILE, 70 * TILE - 42, new Inventory());
    p.mount.active = true; p.mount.type = 48;
    p.fixedUpdate(1 / 60, game);
    expect(p.stepDownGate).toBe('never');
  });
});

describe('SW-FX40 域H2：gravity 字段门值（:24884/:28265/:23610;旧实现退化值=常数 0.4,缩水带门哑）', () => {
  it('H4 gd=1 行为变更：太空带 gField=0.4×0.25=0.1（变异=回常数 → 0.4 本组红）', () => {
    const w = flatWorld();
    const { game } = makeGame(w);
    for (let x = 0; x < w.w; x++) w.store.setTileSilent(x, 58, STONE_ID, 0, 0);
    const p = new Player(100, 55 * TILE, new Inventory());   // y/16=55 < 60.13 → num6=0.25
    for (let i = 0; i < 3; i++) p.fixedUpdate(1 / 60, game);
    expect(p.gField).toBeCloseTo(0.1, 9);
    const q = new Player(100, 65 * TILE, new Inventory());   // row 61+ 带 → num6=1
    for (let i = 0; i < 3; i++) q.fixedUpdate(1 / 60, game);
    expect(q.gField).toBeCloseTo(0.4, 9);
  });

  it('H5 gd=1 行为变更：StepDown 门吃 gField——缩水带贴地吸附复活（变异=回常数门 → b 不吸附 本组红）', () => {
    const w = flatWorld();
    const mk = (gf?: number, vy0 = 0.1): Body => ({
      x: 100, y: 70 * TILE - 42 - 12, w: 20, h: 42, vx: 1, vy: vy0,
      onGround: false, hitWall: false, hitHead: false, stepUp: true,
      stepDownGate: 'gravity', gField: gf,
    });
    const a = mk(0.1);                              // 缩水带贴地（vy=gField=0.1）
    moveAndCollide(a, w, 2, 0);
    expect(a.y).toBe(70 * TILE - 42);               // 吸附（FX34 E4 同位,门值缩水）
    const b = mk(undefined);                        // 无 gField（旧门字面回退）
    moveAndCollide(b, w, 2, 0);
    expect(b.y).toBe(70 * TILE - 42 - 12);          // 0.1≠0.4 不吸附（回退面=旧行为）
    const c = mk(undefined, 0.4);                   // 全值带旧形态
    moveAndCollide(c, w, 2, 0);
    expect(c.y).toBe(70 * TILE - 42);
  });

  it('H6 gd=1 慢Fall 字段签名（:27228-27235 field 写）：羽落贴地 gField=g/3（门自洽）', () => {
    const w = flatWorld();
    const { game } = makeGame(w);
    const p = new Player(60 * TILE, 70 * TILE - 42, new Inventory());
    p.buffs.apply(BuffType.Featherfall, 600);
    for (let i = 0; i < 3; i++) p.fixedUpdate(1 / 60, game);
    expect(p.gField).toBeCloseTo(GRAVITY / 3, 9);   // 慢Fall 链写 field（gd=1 正号;
                                                    //  贴地拍重力后 vy==gField → StepDown 门可命中）
  });
});

describe('SW-FX40 域H3：FloorVisuals 门（:28479;旧实现退化值=!ridingCart,双面各偏）', () => {
  it('H7 gd 无关：挂钩悬停（grappling[0]!=-1）旗标块整段跳过（变异=回旧门 → 旗刷新 本组红）', () => {
    const w = flatWorld();
    const { game } = makeGame(w);
    const p = new Player(60 * TILE, 70 * TILE - 42, new Inventory());
    p.grappling[0] = { ai0: 2, projType: 446, x: p.x, y: p.y - 100, cx: p.cx, cy: p.cy - 100, rot: 0 } as never;
    p.grapCount = 1;
    p.floorTileT = -7;                              // 哨兵
    p.fixedUpdate(1 / 60, game);
    expect(p.floorTileT).toBe(-7);                  // 旧门（只排矿车）会刷新成石材
  });

  it('H8 gd 无关：无钩贴地旗标照刷（石材 floorTileT≥0,控制组）', () => {
    const w = flatWorld();
    const { game } = makeGame(w);
    const p = new Player(60 * TILE, 70 * TILE - 42, new Inventory());
    p.floorTileT = -7;
    p.fixedUpdate(1 / 60, game);
    expect(p.floorTileT).toBe(STONE_ID);
  });
});
