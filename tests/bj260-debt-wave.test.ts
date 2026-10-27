// ★BJ260 清债刀（S6/S1/S7 漏修中项批）五件回归：
//   ① SOCIAL_VANITY_EFFECTS_VIDS 提取器化根治（S7 漏修#1）——vanilla-vanity-effects.json
//     承载（tools/extract-vanity-effects.mjs 三版交叉+era guard 四要素,守卫测试另档）：
//     天壳 3110/泰拉靴 5000/金表 17/高尔夫球 4242/音乐盒 562 社交槽零警示行 + 旧 4 件回归
//     + 4 铜阔剑负控（仍警示）。★S7 简报勘误随测钉死：音乐盒族 van 臂不压（itemstats
//     acc=1 无 van 键）必须留集；van 同置 7 件（3581/3929/4563/4762/5075/5076/1987）扣除。
//   ② 409 剃刀台风撞块支（S1 漏修#1）——HandleMovement :18629-18638 双轴全速反/无门/
//     不消亡/不耗穿透（SetDefaults :4905-4917 penetrate=−1）。
//   ③ F1 湿链 jumpSpd 残项（S6）——湿支覆写后补 UpdateJumpHeight 尾段（jumpBoost 钳
//     :19717-19720 + jumpSpeed+=jumpSpeedBoost :19745）：水档 6.01+1.8=7.81;
//     蜜/人鱼支不覆写（mJumpSpd 已含加成）同测钉住。
//   ④ F2 树妖叶 scale（S6）——叶精灵乘 proj.scale（Main.cs:32428/:32439;生长窗
//     age<100 scale=age/100）。
//   ⑤ BJ232 死亡段割面（S7）——叶弹 227 命中即亡弹当拍照割（CutTiles :12517 先于
//     Damage_PVE :12523;子步域 :17184 在 numUpdates 循环内）;908 实锤【证伪】
//     （CanCutTiles :15421 显式排除）不测割、测排除面已对齐。
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { World } from '../src/world/World';
import { Arrow, setProjSpriteOverride } from '../src/entities/Arrow';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { ITEM_DEFS, ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ChloroLeafShot } from '../src/entities/ChloroLeafCrystalProj';
import { DryadWardRingShot } from '../src/entities/TownShot';
import { assembleTooltipLines } from '../src/ui/itemTooltip';
import { languageManager } from '../src/i18n/LanguageManager';
import productJson from '../src/data/vanilla-vanity-effects.json';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
// ★C档可移植:仓库外依赖(game/ 兄弟目录,clone 侧缺=正常形态)——缺则本文件 skip,本机在=真跑零语义变化
const EXT_MISSING = !['Terarria1457'].every((d) => existsSync(new URL(`../../${d}`, import.meta.url)));


languageManager.loadPackJson(JSON.parse(readFileSync('public/l10n/zh-Hans.json', 'utf8')));

// ================================================================
// ① 社交槽 hasVanityEffects 门（提取产物承载）
// ================================================================
describe.skipIf(EXT_MISSING)('BJ260-① SOCIAL_VANITY_EFFECTS_VIDS 提取器化（S7 漏修#1）', () => {
  const product = productJson as { all: number[]; social: number[]; _meta: { counts: Record<string, number> } };

  it('数据面：all=171/social=164/vanCoSet=7;抽检新件在集、van 同置 7 件扣除、音乐盒留集', () => {
    expect(product._meta.counts.all).toBe(171);
    expect(product._meta.counts.social).toBe(164);
    expect(product._meta.counts.vanCoSet).toBe(7);
    // S7 点名漏件抽检（信息配饰族/天壳/泰拉靴/悠悠球弦/高尔夫球/音乐盒）
    for (const v of [15, 16, 17, 18, 3110, 5000, 5113, 5331, 5452, 5547, 3293, 3308, 4242, 4255, 3989, 562]) {
      expect(product.social).toContain(v);
    }
    // van 臂实压 7 件扣除（S7 已核;音乐盒族不在其列——itemstats 无 van 键）
    for (const v of [3581, 3929, 4563, 4762, 5075, 5076, 1987]) {
      expect(product.social).not.toContain(v);
      expect(product.all).toContain(v);
    }
    // 音乐盒族留集（S7 简报「音乐盒族扣除」会造成 SW 警示/原版无警示分歧——勘误面）
    expect(product.all).toContain(562);
    expect(product.social).toContain(562);
    // 旧 4 件回归
    for (const v of [485, 497, 861]) expect(product.social).toContain(v);
  });

  function socialLines(vid: number) {
    const def = ITEM_DEFS_OF(vid);
    const all = assembleTooltipLines(def, { id: ITEM_BY_KEY[def.key], stack: 1 }, null, null, { socialSlot: true });
    return all.filter((l) => l.tag === 'social');
  }
  const defsCache = new Map<number, ReturnType<typeof getDef>>();
  function getDef(vid: number) {
    return ITEM_DEFS.find((d: { vid?: number; key: string } | undefined) =>
      d && (d.vid ?? -1) === vid)!;   // ★方案 A:守洞;★BJ283 parseInt 兜底退役
  }
  function ITEM_DEFS_OF(vid: number) {
    if (!defsCache.has(vid)) {
      const def = getDef(vid);
      expect(def, `vid ${vid} 缺 def（ITEM_DEFS 注册面）`).toBeTruthy();
      defsCache.set(vid, def);
    }
    return defsCache.get(vid)!;
  }

  it('tooltip 面：S7 点名四件（天壳 3110/泰拉靴 5000/金表 17/高尔夫球 4242）社交槽零警示行', () => {
    for (const vid of [3110, 5000, 17, 4242]) expect(socialLines(vid)).toHaveLength(0);
  });

  it('tooltip 面：音乐盒 562 社交槽零警示行（S7 勘误面——van 臂不压,hasVanityEffects 门兜住）', () => {
    expect(socialLines(562)).toHaveLength(0);
  });

  it('tooltip 面：旧 4 件回归（485/497/861 零行）+ 负控 4 铜阔剑仍警示', () => {
    for (const vid of [485, 497, 861]) expect(socialLines(vid)).toHaveLength(0);
    const soc = socialLines(4);
    expect(soc).toHaveLength(1);
    expect(soc[0]!.text).toBe('在社交栏中不起作用');
  });
});

// ================================================================
// ② 409 剃刀台风撞块支（HandleMovement :18629-18638）
// ================================================================
function emptyWorld(): World {
  const w = new World(200, 140, 30, 'bj260');
  for (let x = 0; x < 200; x++) w.store.setTileSilent(x, 120, 1, 0, 0);
  return w;
}
function wallColumn(w: World, x: number, yTop: number, yBot: number): void {
  for (let y = yTop; y <= yBot; y++) w.store.setTileSilent(x, y, 1, 0, 0);
}
function game409(w: World): GameHooks {
  return {
    world: w, player: null, enemies: () => [], entities: { nextId: 1, add: () => {} },
    playSfx: () => {}, playSfxFiles: () => {}, playSfxFile: () => {}, playSfxWav: () => {},
    startTrackedLoop: () => null, spawnParticles: () => {}, addDamageNumber: () => {},
    spawnDrop: () => null, damagePlayer: () => 0, critters: () => {},
    notifyInventoryChanged: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    cutTile: () => {}, onProjectileDeath: () => {},
    spawnDust: () => ({ x: 0, y: 0, vx: 1.5, vy: -0.5, noGravity: false }),
  } as unknown as GameHooks;
}

describe.skipIf(EXT_MISSING)('BJ260-② 409 剃刀台风撞块支（:18629-18638 双轴全速反,无门/无消亡/无穿透消耗）', () => {
  it('X 撞墙：全速镜像不消亡,穿透 −1 不变（曾缺=首撞即灭）', () => {
    const w = emptyWorld();
    const g = game409(w);
    wallColumn(w, 80, 100, 119);
    const p = new Arrow(76 * TILE, 108 * TILE, 8, 0, 100, 2, 409, { grav: 0, life: 600 });
    expect(p.pierce).toBe(-1);                          // SetDefaults penetrate=−1（:4910）
    let guard = 0;
    while (p.vx > 0 && !p.dead && guard++ < 400) p.fixedUpdate(1 / 60, g);
    expect(p.dead).toBe(false);                         // 无消亡支（vanilla 无限弹反）
    expect(p.vx).toBeLessThan(0);
    // 全速反 lastVelocity（:18631-18634 无 |last|>1 门）——AI 爬升 +0.0025/t
    //（:30949-30951 SW 同实现）→ |vx| ∈ (8, 8.1)
    expect(Math.abs(p.vx)).toBeGreaterThan(8);
    expect(Math.abs(p.vx)).toBeLessThan(8.1);
    expect(p.pierce).toBe(-1);                          // 不耗穿透
  });

  it('Y 落地：全速镜像不消亡（:18635-18638）', () => {
    const w = emptyWorld();
    const g = game409(w);
    const p = new Arrow(76 * TILE, 108 * TILE, 0, 8, 100, 2, 409, { grav: 0, life: 600 });
    let guard = 0;
    while (p.vy > 0 && !p.dead && guard++ < 600) p.fixedUpdate(1 / 60, g);
    expect(p.dead).toBe(false);
    expect(p.vy).toBeLessThan(0);
    expect(Math.abs(p.vy)).toBeGreaterThan(8);
    expect(Math.abs(p.vy)).toBeLessThan(8.2);
  });

  it('两次弹反存活（原版无限弹反;曾一撞即灭）', () => {
    const w = emptyWorld();
    const g = game409(w);
    wallColumn(w, 80, 100, 119);
    wallColumn(w, 60, 100, 119);
    const p = new Arrow(76 * TILE, 108 * TILE, 8, 0, 100, 2, 409, { grav: 0, life: 600 });
    let bounces = 0, guard = 0, lastVx = p.vx;
    while (!p.dead && bounces < 2 && guard++ < 1200) {
      p.fixedUpdate(1 / 60, g);
      if (Math.sign(p.vx) !== Math.sign(lastVx) && lastVx !== 0) bounces++;
      lastVx = p.vx;
    }
    expect(bounces).toBe(2);
    expect(p.dead).toBe(false);
  });
});

// ================================================================
// ③ F1 湿链 jumpSpd（UpdateJumpHeight 尾段补接）
// ================================================================
function poolWorld(liquid = 1): World {
  const w = new World(80, 200, 11, 'bj260-pool');
  for (let x = 0; x < 80; x++) {
    w.store.setTileSilent(x, 85, 1);
    for (let y = 60; y < 85; y++) w.store.setLiquid(x, y, 255, liquid);
  }
  return w;
}
function poolHooks(w: World, p: Player): GameHooks {
  return {
    world: w, player: p, enemies: () => [], critters: () => [],
    spawnDrop: () => null, damagePlayer: (): number => 0, addDamageNumber: () => {},
    cutTile: () => {}, onEnemyKilled: () => {}, spawnEnemy: () => {},
    spawnParticles: () => {}, notifyInventoryChanged: () => {}, playSfx: () => {},
    playSfxFiles: () => {}, showPickupLabel: () => {},
  } as never;
}
const INSIGNIA = vanillaItemKey(4989)!;   // 翱翔徽章（accfx jumpSpd +1.8 :19721-19724 聚合位）

describe.skipIf(EXT_MISSING)('BJ260-③ F1 湿链 jumpSpd 残项（覆写后补 UpdateJumpHeight 尾段）', () => {
  it('水档起跳 = 6.01+1.8：首帧 vy=−7.61（重力 +0.2 同帧）、jumpHold 30、sustain 钉 −7.81', () => {
    const w = poolWorld();
    const p = new Player(40 * 16, 65 * 16, new Inventory());
    p.inv.armor[3] = { id: ITEM_BY_KEY[INSIGNIA], stack: 1 };
    expect(p.equipStats.jumpSpd).toBeCloseTo(1.8, 6);
    p.inputJump = false;
    for (let i = 0; i < 400; i++) p.fixedUpdate(1 / 60, poolHooks(w, p));   // 沉底
    expect(p.inWater).toBe(true);
    expect(p.vy).toBe(0);
    p.inputJump = true;
    p.fixedUpdate(1 / 60, poolHooks(w, p));
    expect(p.vy).toBeCloseTo(-7.61, 5);                 // −(6.01+1.8)+0.2（旧=−5.81 平值）
    expect(p.jumpHold).toBe(30);
    for (let i = 0; i < 5; i++) {                        // 按住跳平台段（松键=断 sustain）
      p.fixedUpdate(1 / 60, poolHooks(w, p));
      // ★BJ730 改判史：旧值 −7.81（BJ717-A 前旧序=重力后钉,钉覆写重力=恒终值）→
      //  新值 −7.61——BJ717-A F1+F8（2026-10-25,R13 P0 清偿）钉序翻正为原版序
      //  （JumpMovement 钉 :20831 → 重力 :27556 → 积分 :28385）,平台拍净速 =
      //  −js+grav = −(6.01+1.8)+0.2 = −7.61（oracle 双证:vanilla-headless S1
      //  逐拍 vy=−js+grav,apex 98.07 吻合;湿档 grav=0.2 同式）。
      expect(p.vy).toBeCloseTo(-7.61, 5);               // sustain 钉后同拍重力=净 −js+grav
    }
    p.inputJump = false;
  });

  it('裸装回归：水档首帧 −5.81（6.01 平值不受刀影响）', () => {
    const w = poolWorld();
    const p = new Player(40 * 16, 65 * 16, new Inventory());
    p.inputJump = false;
    for (let i = 0; i < 400; i++) p.fixedUpdate(1 / 60, poolHooks(w, p));
    p.inputJump = true;
    p.fixedUpdate(1 / 60, poolHooks(w, p));
    expect(p.vy).toBeCloseTo(-5.81, 5);
    p.inputJump = false;
  });

  it('蜂蜜档（不覆写支）加成保留：mJumpSpd 已含 1.8 → 首帧 −6.71（5.01+1.8−0.1）', () => {
    const w = poolWorld(3);
    const p = new Player(40 * 16, 65 * 16, new Inventory());
    p.inv.armor[3] = { id: ITEM_BY_KEY[INSIGNIA], stack: 1 };
    p.inputJump = false;
    for (let i = 0; i < 900; i++) p.fixedUpdate(1 / 60, poolHooks(w, p));   // 蜜中沉底（慢）
    expect(p.inHoney).toBe(true);
    expect(p.vy).toBe(0);
    p.inputJump = true;
    p.fixedUpdate(1 / 60, poolHooks(w, p));
    expect(p.vy).toBeCloseTo(-6.71, 5);                 // −(5.01+1.8)+0.1（原版蜜支不覆写 :24604-24608）
    p.inputJump = false;
  });
});

// ================================================================
// ④ F2 树妖叶 scale（Main.cs:32428/:32439 proj.scale）
// ================================================================
describe.skipIf(EXT_MISSING)('BJ260-④ 树妖 586 叶精灵乘 scale（生长窗 age<100 scale=age/100）', () => {
  interface Rec { args: unknown[] }
  function fakeRenderer(): { r: unknown; calls: Rec[] } {
    const calls: Rec[] = [];
    const ctx = {
      imageSmoothingEnabled: false,
      save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {},
      drawImage: (...args: unknown[]) => { calls.push({ args }); },
    };
    return { r: { ctx, lighting: undefined }, calls };
  }
  function ringAtAge(age: number, owner: { dead: boolean; wardCasting: boolean }): DryadWardRingShot {
    const ring = new DryadWardRingShot(100 * TILE, 100 * TILE, 0, owner);
    for (let t = 0; t < age; t++) ring.fixedUpdate(1 / 60, { world: new World(80, 80, 11, 'x') } as never);
    return ring;
  }
  const owner = { dead: false, wardCasting: true };

  it('age 50（scale 0.5）→ 30 叶全部半尺寸（fw24→12,fh16→8,中心原点）', () => {
    setProjSpriteOverride(586, { width: 24, height: 80 } as unknown as HTMLImageElement);
    const { r, calls } = fakeRenderer();
    const ring = ringAtAge(50, owner);
    ring.draw(r as never, {} as never);
    expect(calls.length).toBe(30);                      // 内环 10 + 外环 20
    for (const { args } of calls) {
      const [, sx, sy, fw, fh, ox, oy, dw, dh] = args as number[];
      expect(fw).toBe(24);
      expect(fh).toBe(16);                              // 80/5 帧
      expect(sx).toBe(0);
      expect(dw).toBeCloseTo(12, 5);                    // 24×0.5（:32428 尾参 proj.scale）
      expect(dh).toBeCloseTo(8, 5);                     // 16×0.5
      expect(ox).toBeCloseTo(-6, 5);                    // origin=帧中心（Size()/2）
      expect(oy).toBeCloseTo(-4, 5);
      void sy;
    }
  });

  it('age 120（scale 钳 1）→ 全尺寸 24×16（回归）', () => {
    setProjSpriteOverride(586, { width: 24, height: 80 } as unknown as HTMLImageElement);
    const { r, calls } = fakeRenderer();
    const ring = ringAtAge(120, owner);
    ring.draw(r as never, {} as never);
    expect(calls.length).toBe(30);
    for (const { args } of calls) {
      const dw = (args as number[])[7], dh = (args as number[])[8];
      expect(dw).toBeCloseTo(24, 5);
      expect(dh).toBeCloseTo(16, 5);
    }
  });
});

// ================================================================
// ⑤ BJ232 死亡段割面（叶弹 227 命中即亡当拍照割;908 证伪面）
// ================================================================
describe.skipIf(EXT_MISSING)('BJ260-⑤ BJ232 死亡段割面（CutTiles :12517 先于 Damage_PVE :12523）', () => {
  it('叶弹 227 命中即亡拍：同拍割面在先（cut 先于 hurt 的时序账）+弹亡', () => {
    const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const log: string[] = [];
    const victim = {
      x: 400, y: 400, w: 24, h: 42, id: 777, dead: false, vanillaId: 21,
      hurt: vi.fn(() => { log.push('hurt'); return true; }),
    };
    const shot = new ChloroLeafShot(412, 421, 12, 0);   // 出生即与敌盒相交
    const g = {
      enemies: () => [victim],
      world: new World(160, 160, 33, 'bj260-cut'),
      player: new Player(200, 500, new Inventory()),
      spawnDust: vi.fn(), playSfxWav: vi.fn(),
      bannerNpcActive: () => false,
      broadcastParticleOrchestra: vi.fn(),
      spawnParticles: vi.fn(),
      cutTile: (_x: number, _y: number) => { log.push('cut'); },   // 弹盒内可砍物上报
    } as never;
    // 世界铺一行 dirt + 弹盒位放可砍格（割面上报与格型无关——Game.cutTile 收口内筛）
    const w = (g as { world: World }).world;
    for (let x = 12; x <= 140; x++) w.store.setTileSilent(x, 30, 1);
    w.store.setTileSilent(25, 26, 1);                   // (400..416,416..432) 弹盒含 (25,26)
    shot.fixedUpdate(1 / 60, g);
    expect(shot.dead).toBe(true);                       // 命中即亡（penetrate=1）
    expect(victim.hurt).toHaveBeenCalledTimes(1);
    const cutIdx = log.indexOf('cut');
    expect(cutIdx).toBeGreaterThanOrEqual(0);           // ★死亡拍照割（旧=整缺）
    expect(log.indexOf('hurt')).toBeGreaterThan(cutIdx);// 原版序：割（:12517）→ 伤（:12523）
    randSpy.mockRestore();
  });

  it('908 钛金风暴裂片：CanCutTiles 排除面（:15421 type!=908 → 原版全程不割,SW 已对齐,不补割）', () => {
    // 结构锁：SW CUT_EXCLUDE_VIDS 与原版排除表同位（含 908）——本弹若被补割即爆红
    const entitySrc = readFileSync(resolve(__dirname, '..', 'src', 'entities', 'Entity.ts'), 'utf8');
    const m = entitySrc.match(/CUT_EXCLUDE_VIDS = new Set\(\[([^\]]*)\]\)/);
    expect(m, 'CUT_EXCLUDE_VIDS 表缺位').toBeTruthy();
    const vids = m![1].split(',').map((s) => parseInt(s.trim(), 10));
    for (const v of [908, 463, 69, 70, 1040, 1020, 1105, 833, 834, 835]) expect(vids).toContain(v);
    // 原版排除表同款锚（排他位字面）
    const cs = readFileSync(resolve(__dirname, '..', '..', 'Terarria1457', 'Terraria', 'Projectile.cs'), 'utf8');
    expect(cs).toContain('type != 908');
  });
});
