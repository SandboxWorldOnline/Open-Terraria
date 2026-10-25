// BJ711-A 探针:拜月教邪教徒仪式链(437 石碑 → 四教徒 → 439 教主触发)
// 用户实报:「拜月教邪教徒事件只有 2 个——打死这 2 个依然无法引发后续 boss」。
// 权威锚:
//   · CultistRitual.cs CheckFloor(:102-131):i∈{-5,-3,3,5} 四列(跳 ±1),每列
//     j=-5..11 取首个「实心/平台 + 上 3 行净空」;num≠4=仪式失败静默退场。
//   · NPC.cs:37120-37260(aiStyle 83,type 437):首拍 CheckFloor→循环 4 只
//     (槽{1,2}→438 白袍 localAI[1..2],槽{0,3}→379 蓝袍 ai[0..1],全 ai[3]=-(碑+1));
//     localAI[0]==1→弓手激活;四槽 active∧type 全不匹配 → ai[0]=-1 + NewNPC 439
//     + TabletDestroyed()。
// 夹具:平仪式台 + 石碑直生成 + 逐拍驱动 fixedUpdate;断言四只出生/杀光触发。
import { describe, it, expect } from 'vitest';
import { Enemy } from '../src/entities/Enemy';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { lunarLocalAI } from '../src/entities/bossAI_lunar_misc';
import type { GameHooks } from '../src/entities/types';

const Wt = 160, Ht = 120;
const TX = 80, TY = 52;          // 石碑中心 tile
const FLOOR_Y = 60;              // 仪式平台面(石碑 ty+8,在 j∈-5..11 扫描窗内)

function makeWorld(): World {
  const w = new World(Wt, Ht, 7, 'bj711a-cultist');
  const st = w.store;
  // 仪式平台:整排实心,四柱 70/74/86/90 全命中;上 3 行净空
  for (let x = 60; x <= 100; x++) st.setTile(x, FLOOR_Y, 1);
  return w;
}

function makeHooks(world: World) {
  const enemies: Enemy[] = [];
  const projectiles: Array<Record<string, unknown>> = [];
  const em = {
    nextId: 1,
    add: (e: unknown, bucket: string) => {
      (e as { id: number }).id = em.nextId++;
      if (bucket === 'enemies') enemies.push(e as Enemy);
      else if (bucket === 'projectiles') projectiles.push(e as Record<string, unknown>);
    },
  };
  const hooks = {
    world,
    player: { x: 80 * TILE, y: 55 * TILE, w: 20, h: 42, cx: 80 * TILE + 10, cy: 55 * TILE + 21,
      vx: 0, vy: 0, hp: 400, maxHp: 400, dead: false, iframes: 0, luck: 0,
      aabbOverlaps: () => false, useTime: 1, addDPS: () => {} },
    enemies: () => enemies,
    critters: () => [],
    entities: em,
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxWav: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
    spawnDust: () => null,
  } as unknown as GameHooks;
  return { hooks, enemies, projectiles, em };
}

/** EntityManager.update 同构:for..of 活数组,当拍 append 当拍访问 */
function tick(h: ReturnType<typeof makeHooks>, n: number): void {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < h.enemies.length; j++) {
      const e = h.enemies[j];
      if (!e.dead) e.fixedUpdate(1 / 60, h.hooks);
    }
  }
}

function putTablet(h: ReturnType<typeof makeHooks>): Enemy {
  const t = Enemy.fromVanilla(437, TX * TILE + 8, TY * TILE + 8)!;
  h.em.add(t, 'enemies');
  return t;
}

const cultists = (h: ReturnType<typeof makeHooks>) =>
  h.enemies.filter((n) => (n.vanillaId === 438 || n.vanillaId === 379) && !n.dead);

describe('BJ711-A 拜月教仪式链(437→四教徒→439)', () => {
  it('线1:石碑首拍恰召 4 只(2×438 白袍 + 2×379 蓝袍),槽位反链齐备', () => {
    const h = makeHooks(makeWorld());
    const tablet = putTablet(h);
    tick(h, 3);                                        // 首拍召四只 + 两拍稳定
    const kids = cultists(h);
    expect(tablet.dead).toBe(false);
    expect(kids.length).toBe(4);
    expect(kids.filter((n) => n.vanillaId === 438).length).toBe(2);
    expect(kids.filter((n) => n.vanillaId === 379).length).toBe(2);
    // 槽位反链:localAI[1..2]=438 id+1;ai[0..1]=379 id+1(NPC.cs:37142-37149)
    const la = lunarLocalAI(tablet);
    for (const k of [0, 1]) {
      const dev = h.enemies.find((n) => n.id === la[k + 1] - 1)!;
      expect(dev?.vanillaId).toBe(438);
      const arcId = k === 0 ? tablet.ai0 : tablet.ai1;
      const arc = h.enemies.find((n) => n.id === Math.floor(arcId) - 1)!;
      expect(arc?.vanillaId).toBe(379);
      // ai[3]=-(碑id+1) 待机锚
      expect(dev.ai3).toBe(-(tablet.id + 1));
      expect(arc.ai3).toBe(-(tablet.id + 1));
    }
  });

  it('线2:四教徒全灭 → 439 教主生成 + 碑 ai0==-1(ai[2]=教主 id)', () => {
    const h = makeHooks(makeWorld());
    const tablet = putTablet(h);
    tick(h, 3);
    expect(cultists(h).length).toBe(4);
    for (const c of cultists(h)) c.dead = true;        // 杀光四教徒
    tick(h, 2);
    const boss = h.enemies.find((n) => n.vanillaId === 439 && !n.dead);
    expect(boss).toBeTruthy();                         // NewNPC 439(:37194)
    expect(tablet.ai0).toBe(-1);                       // :37183 ai[0]=-1
    expect(tablet.ai2).toBe(boss!.id);                 // :37200 ai[2]=教主 id
    expect(tablet.dead).toBe(false);                   // 倒计时 300t 内碑不灭
  });

  it('线2 变体:只杀 2 只(438 全灭、379 存活)→ 439 不生成(四槽门)', () => {
    const h = makeHooks(makeWorld());
    const tablet = putTablet(h);
    tick(h, 3);
    for (const c of cultists(h)) if (c.vanillaId === 438) c.dead = true;
    tick(h, 5);
    expect(h.enemies.some((n) => n.vanillaId === 439)).toBe(false);
    expect(tablet.ai0).not.toBe(-1);
  });

  it('激活链:教徒受击(真实 hurt→justHitT=2)→ 碑 localAI[0]=1 → 弓手 ai[3]=0 解除待机', () => {
    const h = makeHooks(makeWorld());
    const tablet = putTablet(h);
    tick(h, 3);
    const dev = h.enemies.find((n) => n.vanillaId === 438 && !n.dead)!;
    dev.hurt(5, 0, 0, h.hooks, 0, false, 0, true);     // 信徒受击(:37274 justHit)
    tick(h, 2);
    expect(lunarLocalAI(tablet)[0]).toBe(2);           // 1→2 消费完成(:37151-37152)
    const arcs = h.enemies.filter((n) => n.vanillaId === 379 && !n.dead);
    expect(arcs.length).toBe(2);
    for (const a of arcs) expect(a.ai3).toBe(0);       // :37159 解除待机
    // 信徒 ai[1]=1(:37156,1.4.5.6 无消费方但存档语义保留)
    for (const d of h.enemies.filter((n) => n.vanillaId === 438 && !n.dead)) {
      expect(d.ai1).toBe(1);
    }
  });

  it('439 归属锁:自然链 439 占 boss 槽 + 碑 ai[2]=439 id(NPC.cs:37194-37200)', () => {
    const h = makeHooks(makeWorld());
    const tablet = putTablet(h);
    tick(h, 3);
    for (const c of cultists(h)) c.dead = true;
    tick(h, 2);
    const boss = h.enemies.find((n) => n.vanillaId === 439 && !n.dead)!;
    expect((h.hooks as unknown as { boss?: unknown }).boss).toBe(boss);   // boss 槽接管(F6/召唤链同款)
    expect(tablet.ai2).toBe(boss.id);                    // :37200 ai[2]=邪教徒 id
  });
});
