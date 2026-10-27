// SW-AF1 2026-09-04 回归：① F-1 城镇 NPC 击退补 knockBackResist 乘（NPC.cs:82216-82312
//   1457 锚;向导 22 resist=0.5f=SetDefaults :9089 → kb10 实效 num3=5）② F-4 爆炸对
//   ranged 弹暴击掷（Damage_PVE_Inner :12920;EXPLODE_RANGED_PROJS 表=SetDefaults 旗）
//   ③ F-3 踢墙门收敛 beeWallPushDir 单源摄取器（99/1047/655 三支;斜坡/半砖不踢=1:1）
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { Game } from '../src/core/Game';
import { TownNPC } from '../src/entities/TownNPC';
import { TrapShot } from '../src/entities/Dart';
import { VANILLA_NPCS } from '../src/data/vanillaNpcs';
import { TILE_BY_KEY } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';

function townStub() {
  const npc = new TownNPC('guide', 100 * TILE, 90 * TILE);
  return { npc, game: {
    world: new World(200, 200, 110, 'af1-town'),
    player: { hp: 100, maxHp: 100, dead: true, x: -9999, y: -9999, w: 0, h: 0 },
    npcs: () => [], enemies: () => [], critters: () => [],
    addDamageNumber: () => {}, spawnParticles: () => {}, playSfxFiles: () => {},
    behavioLog: () => {}, recLog: () => {},
  } as never };
}

describe('SW-AF1 F-1：城镇 NPC 击退 knockBackResist 乘（NPC.cs:82218/:82304/:82310）', () => {
  it('向导 resist=0.5：kb10 → num3=5,常规门置换 vx=5×dir×0.5=2.5、vy=−5×0.75×0.5=−1.875', () => {
    expect(VANILLA_NPCS['22'].knockBackResist).toBe(0.5);   // SetDefaults NPC.cs:9089 值源
    const { npc, game } = townStub();
    npc.hurt(10, 10, 0, game);
    expect(npc.vx).toBeCloseTo(2.5, 12);       // 旧版缺 resist 乘=10（4× 放大）
    expect(npc.vy).toBeCloseTo(-1.875, 12);
  });
  it('resist 乘在大伤害门前（dmg×10>lifeMax 叠加支同吃）且 Y 加法钳=vy>num3 才追加', () => {
    const { npc, game } = townStub();
    npc.hurt(41, 10, 0, game);                 // calc=41−15=26 → num8=260>250 走大伤害门
    expect(npc.vx).toBeCloseTo(5, 12);         // num3=5 叠加钳顶（旧版 10）
    expect(npc.vy).toBeCloseTo(-3.75, 12);     // −5×0.75（旧版 −7.5）
  });
  it('暴击 kb×1.4 在软帽后（:82251-82254,F-4 命中面）：num3=5×1.4=7', () => {
    const { npc, game } = townStub();
    npc.hurt(10, 10, 0, game, 0, 0, true);
    expect(npc.vx).toBeCloseTo(3.5, 12);       // 7×0.5
    expect(npc.vy).toBeCloseTo(-2.625, 12);
  });
  it('双门 kb>0&&resist>0（:82216）：kbx=0 整段跳过——旧版误清上升 vy', () => {
    const { npc, game } = townStub();
    npc.vx = 0.3; npc.vy = -5;                 // 上升中被零 kb 弹命中
    npc.hurt(10, 0, 0, game);
    expect(npc.vy).toBe(-5);                   // 旧版 `vy = -kb*0.75` 会覆写 0
    expect(npc.vx).toBeCloseTo(0.3, 12);
  });
});

describe('SW-AF1 F-4：爆炸 ranged 弹暴击掷（Damage_PVE_Inner :12920）', () => {
  it('EXPLODE_RANGED_PROJS 表面：ranged 旗弹 ∈ 表,28/29/102/108/164/1002/773 不 ∈', () => {
    expect(Game.explodeCritRoll(30, 100, () => 0.99)).toBe(true);
    expect(Game.explodeCritRoll(397, 100, () => 0.99)).toBe(true);
    expect(Game.explodeCritRoll(517, 100, () => 0.99)).toBe(true);
    expect(Game.explodeCritRoll(588, 100, () => 0.99)).toBe(true);
    expect(Game.explodeCritRoll(681, 100, () => 0.99)).toBe(true);
    expect(Game.explodeCritRoll(133, 100, () => 0.99)).toBe(true);
    expect(Game.explodeCritRoll(776, 100, () => 0.99)).toBe(true);
    expect(Game.explodeCritRoll(862, 100, () => 0.99)).toBe(true);
    expect(Game.explodeCritRoll(715, 100, () => 0.99)).toBe(true);
    // 手雷 28(:1108)/炸药棍 29(:1116)/102(:1898)/108(:1955)/164(:2528)/1002(:9525)/
    // 773(:7904) SetDefaults 无 ranged 标 = 不暴击（勿误加）
    for (const id of [28, 29, 102, 108, 164, 1002, 773, 470, 516, 519, 637, 903, 910]) {
      expect(Game.explodeCritRoll(id, 100, () => 0)).toBe(false);
    }
  });
  it('roll 概率面：Next(1,101)<=crit ⇔ rnd×100<crit（边界 4：0.04→false/0.0399→true）', () => {
    expect(Game.explodeCritRoll(30, 4, () => 0.04)).toBe(false);
    expect(Game.explodeCritRoll(30, 4, () => 0.0399)).toBe(true);
    expect(Game.explodeCritRoll(30, 0, () => 0)).toBe(false);
  });
  it('explodeAt 三 victim 支接线（敌怪/小动物/城镇）：源面逐支掷入', () => {
    const src = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    expect(src.match(/Game\.explodeCritRoll\(projId, this\.rangedCritPct\(\)\)/g)?.length).toBe(3);
    // ★BJ730 改判史：旧形 `/en\.hurt\(hurt,/`——BJ723-B D4 清偿（BJ725-A）snap 双支
    //  给敌怪支入参合法加 snap 加成（`hurt + (snapE ? snapE : 0),`）,逗号紧跟形破窗;
    //  改前缀形（锁「敌怪支以 hurt 直传未预倍」语义,×2=Enemy.hurt 防后,S02 判语不变）。
    expect(src).toMatch(/en\.hurt\(hurt/);                                // ★S02(BJ723-B)改判:敌怪支未翻倍直传（×2=Enemy.hurt 防后;BJ725-A snap 加成随入参）
    expect(src).toMatch(/c\.hurt\(churt,/);                               // ★S02 改判:小动物支同链同掷未翻倍
    expect(src).toMatch(/0, 0, tcrit, false, true, projId\);/);          // 城镇支 crit 参（×2 于防后=TownNPC.hurt 接收端;★R-B-F1 加参后锁随刀走）
  });
});

describe('SW-AF1 F-3：99/1047 踢墙门收敛 beeWallPushDir（斜坡/半砖/平台不踢=1:1）', () => {
  const mkWorld = (mutate?: (w: World) => void) => {
    const w = new World(100, 100, 30, 'af1-boulder');
    for (let x = 0; x < 100; x++) w.store.setTileSilent(x, 80, 1, 0, 0);   // 全宽地面
    for (let y = 70; y < 80; y++) { w.store.setTileSilent(96, y, 1, 0, 0); w.store.setTileSilent(3, y, 1, 0, 0); }
    // 左探窗第二级 col49 放墙（beeWallPushDir 档:x−24px 列）
    w.store.setTileSilent(49, 78, 1, 0, 0);
    w.store.setTileSilent(49, 79, 1, 0, 0);
    mutate?.(w);
    return w;
  };
  const mkGame = (w: World): GameHooks => ({
    world: w,
    player: { x: 0, y: 0, w: 20, h: 42, cx: 10, cy: 21, dead: true, iframes: 0 },
    enemies: () => [], entities: { critters: [], npcs: [], projectiles: [] },
    playSfx: () => {}, spawnParticles: () => {}, addDamageNumber: () => {},
  } as unknown as GameHooks);
  const kick = (w: World): number => {
    const g = mkGame(w);
    const b = new TrapShot(51 * TILE, 80 * TILE - 31, 0, 0, 70, 'boulder');
    b.fixedUpdate(1, g);                       // 落地置位拍（ai[0]=1,首拍不踢）
    b.fixedUpdate(1, g);                       // 踢拍（0.5 档后同拍滚地加速 ±0.05）
    return b.vx;
  };
  it('普通实心墙：左实 → 向右踢（0.5+0.05 加速=0.55,收敛前行为不变面）', () => {
    expect(kick(mkWorld())).toBeCloseTo(0.55, 5);
  });
  it('半砖墙（half=1）：SolidTile 排除 → 不踢,落 Center.X 奇偶兜底（旧 isSolid 误踢 0.55）', () => {
    const w = mkWorld((w) => { w.store.half[w.store.idx(49, 78)] = 1; w.store.half[w.store.idx(49, 79)] = 1; });
    expect(kick(w)).toBeCloseTo(-0.55, 5);     // cx=831.5→51 奇 → −0.5 向左
  });
  it('斜坡墙（slope=1）：同排除 → 奇偶兜底；平台格（solid=false）亦不踢', () => {
    const w1 = mkWorld((w) => { w.store.slope[w.store.idx(49, 78)] = 1; w.store.slope[w.store.idx(49, 79)] = 1; });
    expect(kick(w1)).toBeCloseTo(-0.55, 5);
    const w2 = mkWorld((w) => {
      const p = TILE_BY_KEY['platform'];
      w.store.setTileSilent(49, 78, p, 0, 0); w.store.setTileSilent(49, 79, p, 0, 0);
    });
    expect(kick(w2)).toBeCloseTo(-0.55, 5);
  });
});
