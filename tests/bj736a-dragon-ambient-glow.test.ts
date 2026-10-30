// BJ736-A 星尘龙辉尘锁（2026-10-28 用户报「星尘龙不发光」）——定谳链:
//   原版龙头 1/30 拍环境尘（AI_121 :43638-43649）:dust135(冰火把尘) alpha=0/scale=2/
//   noGravity/fadeIn=2;落点格实心(InWorld 5 边距∧SolidTile)才 noLight,空中默认
//   发光——本块=龙辉光唯一来源（段支淡入尘 :43843 原版即 noLight）;曾整缺。
//   光照侧 SMOKE_LIGHT[135]=[0.75,0.85,1.4] 光链在位（VanillaDust :918-1097 族）,
//   光引擎无需改。夹具=bj709a 同式。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MinionProj } from '../src/entities/MinionProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import type { GameHooks } from '../src/entities/types';
import type { VDust } from '../src/fx/VanillaDust';
import { VanillaDust } from '../src/fx/VanillaDust';

function makeHooks(air = true) {
  const w = new World(200, 120, 7, 'bj736a');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  if (!air) for (let x = 0; x < 200; x++) for (let y = 0; y <= 90; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const projectiles: unknown[] = [];
  const dusts: VDust[] = [];
  const entities = {
    critters: [], npcs: [], enemies: [], projectiles,
    add: (e: unknown, kind: string) => { if (kind === 'projectiles') projectiles.push(e); },
  };
  const hooks: GameHooks = {
    world: w as never, player: player as never,
    entities: entities as never,
    enemies: () => [], npcs: () => [], critters: () => [],
    spawnDrop: () => null, damagePlayer: () => 0, addDamageNumber: () => {},
    spawnDust: ((x: number, y: number, bw: number, bh: number, type: number,
      sx: number, sy: number, alpha: number, color: null, scale: number, noGravity: boolean) => {
      const d = {
        x: x + Math.random() * bw, y: y + Math.random() * bh, type, alpha, scale,
        noGravity, noLight: false, fadeIn: 0, vx: sx, vy: sy,
      } as unknown as VDust;
      dusts.push(d);
      return d;
    }) as never,
  } as unknown as GameHooks;
  return { hooks, player, projectiles, dusts, w };
}

afterEach(() => vi.restoreAllMocks());

describe('BJ736-A ⑤ 光链端到端（真 VanillaDust:尘135 → update → lights 青色输出）', () => {
  it('空中尘 noLight=false 经 update 产出 [0.75,0.85,1.4]×k 光,且存活多拍', () => {
    const vd = new VanillaDust();
    const d = vd.spawn(60 * 16, 90 * 16, 24, 24, 135, 0, 0, 0, null, 2, undefined);
    expect(d).toBeTruthy();
    if (!d) return;
    d.noGravity = true;
    d.fadeIn = 2;
    let sawLight = false, aliveTicks = 0;
    for (let t = 0; t < 60; t++) {
      vd.update(0, 0, 1920, 2400, 0, 0, null, null, null, null);   // 视口须含尘位(y=1440)
      for (const l of vd.lights) {
        if (Math.abs(l.r - 0.75) < 0.01 && Math.abs(l.g - 0.85) < 0.01 && l.b > 1.0) sawLight = true;
      }
      if (d.active) aliveTicks++;
    }
    expect(sawLight, '尘135 应产出冰火把色光(0.75,0.85,1.4×k)').toBe(true);
    expect(aliveTicks, '尘应存活多拍(光可持续)').toBeGreaterThan(3);
  });
});

describe('BJ736-A 星尘龙头环境辉尘（:43638-43649）', () => {
  it('① 1/30 掷中:空中龙头出尘 135,alpha=0/scale=2/noGravity/fadeIn=2/【不】noLight', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // 恒命中掷门(1/30 门与尘位随机同源)
    const fx = makeHooks(true);
    const head = new MinionProj(fx.player.cx, fx.player.cy - 40, 625, 10, 2, false, 0, false, () => fx.player);
    head.fixedUpdate(1, fx.hooks);
    // 环境尘=type135∧alpha0（淡入尘=alpha100 同型,域区分）
    const amb = fx.dusts.filter(d => (d as { type: number; alpha: number }).type === 135
      && (d as { alpha: number }).alpha === 0);
    expect(amb.length).toBe(1);
    const d = amb[0] as unknown as { type: number; alpha: number; scale: number; noGravity: boolean; noLight: boolean; fadeIn: number };
    expect(d.type).toBe(135);
    expect(d.alpha).toBe(0);          // NewDust alpha=0（:43641——与淡入尘 100 区分）
    expect(d.scale).toBe(2);
    expect(d.noGravity).toBe(true);
    expect(d.fadeIn).toBe(2);
    expect(d.noLight, '空中尘默认发光（龙辉光来源）').toBe(false);
  });

  it('② 1/30 未掷中:零尘（1/30 节拍门）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const fx = makeHooks(true);
    const head = new MinionProj(fx.player.cx, fx.player.cy - 40, 625, 10, 2, false, 0, false, () => fx.player);
    head.fixedUpdate(1, fx.hooks);
    expect(fx.dusts.filter(d => (d as { type: number; alpha: number }).type === 135
      && (d as { alpha: number }).alpha === 0).length).toBe(0);   // 环境尘零(淡入尘不计)
  });

  it('③ 实心格内落尘:noLight=true（:43645-43648 墙内不发光）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);   // 恒命中掷门
    const fx = makeHooks(false);   // 头部区域全实心
    const head = new MinionProj(fx.player.cx, fx.player.cy - 40, 625, 10, 2, false, 0, false, () => fx.player);
    head.fixedUpdate(1, fx.hooks);
    const amb3 = fx.dusts.filter(d => (d as { type: number; alpha: number }).type === 135
      && (d as { alpha: number }).alpha === 0);
    expect(amb3.length).toBe(1);
    expect((amb3[0] as unknown as { noLight: boolean }).noLight).toBe(true);
  });

  it('④ 段(626)不出环境尘（原版块仅头支 `num`=type625）', () => {
    const fx = makeHooks(true);
    const seg = new MinionProj(fx.player.cx, fx.player.cy - 40, 626, 10, 2, false, 0, false, () => fx.player);
    seg.parentRef = () => null;   // 独立驱动（无头链段 fixedUpdate 不应崩/不应出尘）
    seg.fixedUpdate(1, fx.hooks);
    expect(fx.dusts.filter(d => (d as { type: number }).type === 135
      && (d as { alpha: number }).alpha === 0).length).toBe(0);   // 淡入尘 alpha=100 排除后为零
  });
});
