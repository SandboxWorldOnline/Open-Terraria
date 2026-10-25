// BJ344（2026-09-25）netID flag=false 族 stat×scale f32 派生判别面。
// 原版真值 = SetDefaultsFromNetId case 体（Terarria1457/Terraria/NPC.cs:7784-8360 逐支亲读）：
//   各 case 在基底完整 SetDefaults【含尾段 ScaleStats :17888 + 种子档调整 :17873-17881】
//   之后跑：def/dmg/life/value = (int)((float)v×scale)；-14 dmg/life 与 -15 dmg 走
//   (int)((double)((float)v×scale)×1.1) 双精度链（:7830-7831/:7840）；knockBackResist
//   ×= 2f−scale（f32）；flag=false ⇒ :8368-8372 ScaleStats 门不达（无二次难度缩放）。
//   case -15 :7845 height=44 硬置（盒后覆写仅高）。npcSlots 无运行时承载=residual 登记。
// f32 逐拍定谳（Math.fround 逐级,Math.trunc 截断——四舍五入链判伪）：
//   -13 = 72/23/7（旧硬置同值）; -14 = 101/32/9（旧硬置 dmg 33/def 10 系「先四舍五入」
//   错链:fround(26×1.15f)=29.8999996 → ×1.1=32.889… 截 32,四舍五入 29.9→30→33 伪）。
//   scale 表勘误（case 体逐值）: -43=1.15f/-47=1.1f/-48=0.93f/-49=1.07f/-50=0.87f/
//   -51=1.13f/-52=0.85f/-53=1.15f/-59=1.15f/-60=0.92f/-61=1.1f（旧表全 0.9/错抄族）。
// 运行：cd game && npx vitest run tests/bj344-netid-stat-scale.test.ts
import { describe, it, expect } from 'vitest';
import { VanillaSpawner, NET_ID_MAP } from '../src/world/spawn/VanillaSpawner';
import { World } from '../src/world/World';
import { RNG } from '../src/core/rng';

interface Spawned {
  vanillaId: number;
  maxHp: number;
  h: number;
  def: { damage?: number; defense?: number; knockbackResist?: number; value?: number };
}

describe('BJ344 scale 表勘误钉值（1457 case 体逐值）', () => {
  it('十一处错抄 scale 逐行钉死', () => {
    // [netId, 原版 scale 字面, case 体行锚]
    const pins: Array<[number, number, string]> = [
      [-43, 1.15, ':8130-8131'],
      [-47, 1.1, ':8170-8171'], [-48, 0.93, ':8180-8181'], [-49, 1.07, ':8190-8191'],
      [-50, 0.87, ':8200-8201'], [-51, 1.13, ':8030 区 case -51'], [-52, 0.85, 'case -52'],
      [-53, 1.15, 'case -53'],
      [-59, 1.15, 'case -59'], [-60, 0.92, 'case -60'], [-61, 1.1, 'case -61'],
    ];
    for (const [id, sc, at] of pins) {
      expect(NET_ID_MAP[id]!.scale, `netID ${id} scale（case 体 ${at}）`).toBe(sc);
    }
  });

  it('-13/-14 预计算硬置退役（转运行时派生,x11 链旗在 -14/-15）', () => {
    expect(NET_ID_MAP[-13]).toEqual({ base: 31, scale: 0.9 });
    expect(NET_ID_MAP[-14]).toEqual({ base: 31, scale: 1.15, x11: true });
    expect(NET_ID_MAP[-15]).toEqual({ base: 77, scale: 1.15, hp: 400, x11: true });
  });
});

describe('BJ344 spawnNPC stat×scale 运行时派生（f32 逐拍金标）', () => {
  const w = new World(400, 400, 42, 'jungle');
  const spawner = new VanillaSpawner(w);
  const s = spawner as unknown as {
    spawnNPC: (x: number, y: number, id: number, rng: RNG) => Spawned | null;
  };

  it('-13 Short Bones：34→(80/26/8 ×0.9)=72/23/7（fround 链,与旧硬置同值=回归钉）', () => {
    const e = s.spawnNPC(100, 100, -13, new RNG(11))!;
    expect(e).not.toBeNull();
    expect(e.maxHp).toBe(72);
    expect(e.def.damage).toBe(23);
    expect(e.def.defense).toBe(7);
  });

  it('-14 Big Boned：×1.15 再 ×1.1 双精度链 = 101/32/9（旧硬置 dmg 33/def 10 判红）', () => {
    const e = s.spawnNPC(100, 100, -14, new RNG(12))!;
    expect(e.maxHp).toBe(101);          // fround(80×1.15f)=92 → ×1.1=101.2 → 101
    expect(e.def.damage).toBe(32);      // fround(26×1.15f)=29.899… → ×1.1=32.889… → 32
    expect(e.def.defense).toBe(9);      // fround(8×1.15f)=9.2 → 9（四舍五入链给 10=红）
    expect(e.def.knockbackResist).toBeCloseTo(0.68, 6);   // 0.8×f32(2−1.15f)=0.68
    expect(e.def.value).toBe(149);      // (int)(130f×1.15f)
  });

  it('-15 Heavy Skeleton：life=400 硬置 + dmg 50（×1.1 链）+ def 32 + height=44 硬置', () => {
    const e = s.spawnNPC(100, 100, -15, new RNG(13))!;
    expect(e.maxHp).toBe(400);          // :7841 life=400 硬置（不吃 ×1.1 链）
    expect(e.def.damage).toBe(50);      // fround(40×1.15f)=46 → ×1.1=50.6 → 50
    expect(e.def.defense).toBe(32);     // fround(28×1.15f)=32.2 → 32
    expect(e.def.knockbackResist).toBeCloseTo(0.34, 6);   // 0.4×f32(2−1.15f)
    expect(e.h).toBe(44);               // :7845 height=44 硬置（盒链后覆写仅高）
  });

  it('-11 小噬魂怪（6×0.85）：40/22/8 → 34/18/6', () => {
    const e = s.spawnNPC(100, 100, -11, new RNG(14))!;
    expect(e.maxHp).toBe(34);
    expect(e.def.damage).toBe(18);
    expect(e.def.defense).toBe(6);
    expect(e.def.knockbackResist).toBeCloseTo(0.575, 6);
  });

  it('-21 Giant Moss Hornet（176×1.2）：220/70/22 → 264/84/26（BJ337 补行+本刀 stat 面）', () => {
    const e = s.spawnNPC(100, 100, -21, new RNG(15))!;
    expect(e.maxHp).toBe(264);
    expect(e.def.damage).toBe(84);
    expect(e.def.defense).toBe(26);
  });

  it('-48 Headache Skeleton 小（201×0.93 勘正 scale）：55/20/12 → 51/18/11', () => {
    const e = s.spawnNPC(100, 100, -48, new RNG(16))!;
    expect(e.maxHp).toBe(51);
    expect(e.def.damage).toBe(18);
    expect(e.def.defense).toBe(11);
  });

  it('flag=true 硬置族不进派生块（-1 hp/dmg/def 硬置零漂移 + kbr ×1.2 case 乘子）', () => {
    const e = s.spawnNPC(100, 100, -1, new RNG(17))!;
    expect(e.maxHp).toBe(90);
    expect(e.def.damage).toBe(45);
    expect(e.def.defense).toBe(10);
    // ★BJ720-A（issue #19 D12）：case -1 体 knockBackResist ×=1.2f（NPC.cs:7694）——
    //  经典档基底 81 无 kbr（缺省 1）×1.2=1.2。旧断言 1 系 case 乘子漏接期定值。
    // ★N2 变异判别位保留：门摘除时 -1 的 kbr 会被 ×(2−0.6f) 污染（→1.68）
    expect(e.def.knockbackResist).toBeCloseTo(1.2, 6);
  });
});
