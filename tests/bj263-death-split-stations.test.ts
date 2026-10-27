// ★BJ263（2026-09-22）S4 亡体分裂 3 站收口——HitEffect 死亡段 NewNPC 站（Enemy.ts 死亡管线）：
//   · 站 1 :86418 飞尸 121 死 → 1× 小腐化史莱姆（NewNPC(…,81)+SetDefaults(-2)）——
//     netID -2=腐化史莱姆基底（FromNetId→NetIdMap[1]=81,NPCID.cs:12478）×override0.9
//     （盒=(int)(40×0.9f)×(int)(30×0.9f)=36×27,hp90/dmg45/def20/kb1.2/value100f 走
//     npcValueOf(-2)）。速度=父 vx/vy 原值继承（:86421-86422）。
//   · 站 2 :86434 腐化史莱姆 81（npc.scale 终态≥1f）死 → Next(2)+2=2-3× 幼体
//     （NewNPC(…,1) 被 SetDefaults(-1) 重写为基底 81×0.6=24×18,hp90/dmg45/def10）——
//     ai[1]=k 分裂序号【原版本相】（首只 ai1==0 走 slimeAI 首帧体内物掷,:60951）;
//     速度=父 vx×3f+Next(−10,10)×0.1+k×direction×0.3 / 父 vy−Next(0,10)×0.1−k。
//   · 站 3 :87982 蛆虫僵尸 632 死 → Next(2)+2=2-3× 蛆虫 606——Bottom 锚 Y=父顶+
//     Next(h/2)+10（父体下半带,逐只独掷）;速度=(Next(−10,10)×0.2,−3.5−Next(5,10)×0.3−k×0.5)。
//   判别面：Bottom 锚语义（旧中心锚=半盒偏低=红）;netID 变体域（vanillaNetId/渲染乘
//     v.scale×vanillaScale=npc.scale）;门=scale 终态≥1（-2/-1 产物不再分裂）。
//   断言口径：锚/盒/属性/序号=确定性逐项;数量与掷速=6 种子统计+数值域（Math.random
//   实体 A/B 判例——死亡尘面先行掷骰,定点序列脆弱不采）。
import { describe, it, expect } from 'vitest';
import { Enemy } from '../src/entities/Enemy';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const W = 160, H = 140, FLOOR = 120;

function makeWorld(): World {
  const w = new World(W, H, 7, 'bj263-test');
  const st = w.store;
  w.groundLevel = 60;
  for (let x = 0; x < W; x++) {
    st.setTile(x, FLOOR, 1);
    st.setTile(x, FLOOR + 1, 1);
  }
  return w;
}

function makeHooks(world: World) {
  const enemies: Enemy[] = [];
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: 'enemies' | 'projectiles') => {
      const ent = e as { id: number };
      ent.id = em.nextId++;
      if (bucket === 'enemies') enemies.push(e as Enemy);
    },
  };
  const hooks = {
    world,
    player: {
      x: 100 * TILE, y: (FLOOR - 4) * TILE, w: 20, h: 42, cx: 100 * TILE + 10, cy: (FLOOR - 4) * TILE + 21,
      vx: 0, vy: 0, hp: 400, maxHp: 400, mana: 100, maxMana: 100, dead: false,
      luck: 0, useTime: 1, aabbOverlaps: () => false,
    },
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    spawnDust: () => null,
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    entities: em,
  } as unknown as GameHooks;
  return { hooks, enemies, em };
}

function spawn(h: ReturnType<typeof makeHooks>, id: number, tx: number, ty: number): Enemy {
  const e = Enemy.fromVanilla(id, tx * TILE, ty * TILE)!;
  e.id = h.em.nextId++;
  h.enemies.push(e);
  return e;
}
const aliveOf = (h: ReturnType<typeof makeHooks>, id: number): Enemy[] =>
  h.enemies.filter((e) => !e.dead && e.vanillaId === id);

// ---------------------------------------------------------------------------
describe('BJ263 站 1：121 飞尸死 → 1× netID-2 小腐化史莱姆（NPC.cs:86418-86431）', () => {
  it('数量恒 1;变体域/属性/盒 36×27/Bottom 锚/速度继承全 1:1', () => {
    const h = makeHooks(makeWorld());
    const slimer = spawn(h, 121, 70, FLOOR - 4);
    slimer.vx = 1.7; slimer.vy = -0.9;
    slimer.hurt(9999, 0, 0, h.hooks);
    const babies = aliveOf(h, 81);
    expect(babies.length).toBe(1);
    const b = babies[0];
    expect(b.vanillaId).toBe(81);                      // 基底 81（非蓝史莱姆 1——NetIdMap 定谳）
    expect(b.vanillaNetId).toBe(-2);
    expect(b.hp).toBe(90); expect(b.maxHp).toBe(90);
    expect(b.def.damage).toBe(45); expect(b.def.defense).toBe(20);
    // ★BJ730 改判史：旧值 1.2（D12 前旧码 kb 直写经典档）→ 新值 f32(1.2)=
    //  1.2000000476837158——BJ720-A D12（2026-10-26）netIdFlagTrueRescale kb 乘子
    //  f32 保真（NPC.cs case 体 `knockBackResist *= 1.2f` C# float 位级结果）。
    expect(b.def.knockbackResist).toBe(Math.fround(1.2));   // SetDefaults(-2) kbResist×1.2（基 1f,f32）
    expect(b.w).toBe(36); expect(b.h).toBe(27);        // (int)(40×0.9f)=36,(int)(30×0.9f)=27
    expect(b.x).toBe(slimer.cx - b.w / 2);             // 底中锚 X
    expect(b.y + b.h).toBe(slimer.y + slimer.h);       // ★判别：Bottom=父底（中心锚=红）
    expect(b.vx).toBe(1.7); expect(b.vy).toBe(-0.9);   // :86421-86422 原值继承
  });
});

// ---------------------------------------------------------------------------
describe('BJ263 站 2：81 腐化史莱姆（scale≥1）死 → 2-3× netID-1 幼体（NPC.cs:86434-86452）', () => {
  it('变体域/属性/盒 24×18/ai1=分裂序号/Bottom 锚逐项', () => {
    const h = makeHooks(makeWorld());
    const cs = spawn(h, 81, 70, FLOOR - 4);
    cs.vx = 0; cs.vy = 0;
    cs.hurt(9999, 0, 0, h.hooks);
    const babies = aliveOf(h, 81);
    expect([2, 3]).toContain(babies.length);
    for (let i = 0; i < babies.length; i++) {
      const b = babies[i];
      expect(b.vanillaNetId).toBe(-1);
      expect(b.hp).toBe(90);
      expect(b.def.damage).toBe(45); expect(b.def.defense).toBe(10);
      expect(b.def.knockbackResist).toBe(Math.fround(1.2));   // ★BJ730 改判史同上（D12 f32 保真）
      expect(b.w).toBe(24); expect(b.h).toBe(18);      // (int)(40×0.6f),(int)(30×0.6f)
      expect(b.ai1).toBe(i);                           // ★ai[1]=num419 分裂序号（确定性）
      expect(b.x).toBe(cs.cx - b.w / 2);
      expect(b.y + b.h).toBe(cs.y + cs.h);             // ★Bottom=父底
      // 速度域（父静止）：vx=Next(−10,10)×0.1+k×direction×0.3 ∈ [−1.6,1.6];
      //  vy=−Next(0,10)×0.1−k ∈ (−3,0]
      expect(b.vx).toBeGreaterThanOrEqual(-1.6);
      expect(b.vx).toBeLessThanOrEqual(1.6);
      expect(b.vy).toBeLessThanOrEqual(0);
      expect(b.vy).toBeGreaterThan(-3);
    }
  });
  it('门：-2 小骑乘/-1 幼体死不再分裂（npc.scale 终态<1）', () => {
    const h = makeHooks(makeWorld());
    const slimer = spawn(h, 121, 70, FLOOR - 4);
    slimer.hurt(9999, 0, 0, h.hooks);
    const rider = aliveOf(h, 81)[0];                   // -2 小骑乘
    expect(rider.vanillaNetId).toBe(-2);
    rider.hurt(9999, 0, 0, h.hooks);
    expect(aliveOf(h, 81).length).toBe(0);             // ★判别：无门=再裂 2-3 只=红
    const h2 = makeHooks(makeWorld());
    const cs = spawn(h2, 81, 70, FLOOR - 4);
    cs.hurt(9999, 0, 0, h2.hooks);
    const babies = aliveOf(h2, 81);
    expect(babies.length).toBeGreaterThanOrEqual(2);
    for (const baby of babies) {
      baby.hurt(9999, 0, 0, h2.hooks);                 // 幼体死不产出新体
    }
    expect(aliveOf(h2, 81).length).toBe(0);
  });
  it('6 种子统计：数量恒落 {2,3}（Next(2)+2;旧"Next(3)+2"1-3 域=红）', () => {
    for (let s = 0; s < 6; s++) {
      const h = makeHooks(makeWorld());
      const cs = spawn(h, 81, 70, FLOOR - 4);
      cs.hurt(9999, 0, 0, h.hooks);
      expect([2, 3]).toContain(aliveOf(h, 81).length);
    }
  });
});

// ---------------------------------------------------------------------------
describe('BJ263 站 3：632 蛆虫僵尸死 → 2-3× 606 蛆虫（NPC.cs:87982-87993）', () => {
  it('锚（Bottom=父顶+Next(h/2)+10 落父体下半带）/速度域/载体逐项', () => {
    const h = makeHooks(makeWorld());
    const mz = spawn(h, 632, 70, FLOOR - 5);
    mz.hurt(9999, 0, 0, h.hooks);
    const maggots = aliveOf(h, 606);
    expect([2, 3]).toContain(maggots.length);
    for (const m of maggots) {
      expect(m.vanillaId).toBe(606);
      expect(m.x).toBe(mz.cx - m.w / 2);               // 底中锚 X
      const bottom = m.y + m.h;
      expect(bottom).toBeGreaterThanOrEqual(mz.y + 10);
      expect(bottom).toBeLessThan(mz.y + mz.h / 2 + 10);  // ★父体下半带（父底锚=越界红）
      expect(m.vx).toBeGreaterThanOrEqual(-2);          // Next(−10,10)×0.2
      expect(m.vx).toBeLessThanOrEqual(2);
      expect(m.vy).toBeLessThanOrEqual(-5.0);           // ≤ −3.5−Next(5,10)min 5×0.3
      expect(m.vy).toBeGreaterThanOrEqual(-7.2);        // ≥ −3.5−9×0.3−2×0.5
    }
  });
  it('6 种子统计：数量恒落 {2,3}', () => {
    for (let s = 0; s < 6; s++) {
      const h = makeHooks(makeWorld());
      const mz = spawn(h, 632, 70, FLOOR - 5);
      mz.hurt(9999, 0, 0, h.hooks);
      expect([2, 3]).toContain(aliveOf(h, 606).length);
    }
  });
});
