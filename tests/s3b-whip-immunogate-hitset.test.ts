// ★清偿刀 S3b（2026-10-01）：Whip 环既有形态专项——hitSet.add 先于 e.hurt 且环无前置
//  全局免疫窗门（V2 登记债）。定谳锚（Terarria1457/Terraria/Projectile.cs 亲读）：
//   · 门位 :12635-12639（Damage_PVE_Inner）：`flag3 = maxPenetrate==1 &&
//     !usesLocalNPCImmunity && !usesIDStaticNPCImmunity`——鞭 DefaultToWhip
//     （:10706-10720）=usesLocalNPCImmunity=true + penetrate=-1 ⇒ flag3 恒 false ⇒
//     `targetNPC.immune[owner]==0` 门【严格生效】;门拒 = :12638 整跳 return：
//     不 tag（TryApplyTagToNPC :13637 门后）/ 不 falloff（衰减链 :13453-13550 门后）/
//     不 proc（:13641 TryDoingOnHitEffects 门后）/ 不 debuff（StatusNPC :13634 门后）/
//     不写 MinionAttackTargetNPC（:14321-14327 门后）/ 不占局部表（写梯
//     :14175-14179 门后）——窗期满后同鞭照吃（局部表留白）。
//   · 写位 :14175-14179（usesLocal 主支,localNPCHitCooldown=-1 ≠ -2 达）：受理命中写
//     `immune[owner]=0`【清全局窗不开窗】+ immuneArray[victim]=-1（:17380 仅 >0 递减
//     = 本挥动每敌一次）。旧 pierce=0 走 Enemy.hurt 缺省档写 iframes=10 = 原版无的
//     全局窗（鞭→他弹/双鞭回声连携被自造窗拒 10t=两向偏差）;pierce=-3（Enemy.ts
//     BJ398 清零档,:14427/:14541）=门照走+命中清零=梯 1:1。
//   · jellyfish 块 :12676-12688 在门后——残窗水母不反噬（前置门已按序覆盖）。
//  判别力：夹具用【真 Enemy.fromVanilla】（门/写支在真 hurt 内部,非 spy 桩,debt-L 同法）。
//    旧码下：§A 残窗敌照挂 tag/照吃 falloff/占 hitSet（§A3 同拍次敌被衰减连坐）;
//    §B 命中写 iframes=10（后到他弹/第二鞭被拒）。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';
import { Enemy } from '../src/entities/Enemy';
import { WhipProj } from '../src/entities/WhipProj';

function makeGame(list: Enemy[]): { hooks: GameHooks; player: Player } {
  const w = new World(200, 120, 7, 's3b-whip');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => list,
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
    // ★912/1028 酷鞭/麻线鞭命中出伴生哨兵（WHIP_HIT_SIDEKICK）→ entities.projectiles 桶须在
    entities: { add: () => {}, nextId: 1, projectiles: [] } as never,
    applyLifeSteal: () => 0,
  } as unknown as GameHooks;
  return { hooks, player };
}

/** 坦克桩敌（真 Enemy 管线;血量抬高避开死亡管线;不 tick → iframes 残窗保持） */
function tankEnemy(hooks: GameHooks, px: number, py: number): Enemy {
  const e = Enemy.fromVanilla(15, px, py)!;   // 僵尸：friendly=false、非 ImmuneToWhips
  e.id = 1 + hooks.enemies().length;
  e.maxHp = 5000;
  e.hp = 5000;
  hooks.enemies().push(e);
  return e;
}

/** 鞭命中驱动（v2 landOneHit 同式）：9 拍起手 → 敌移到 ai0=20 快照曲线控制点 → 1 拍 */
function landOneHit(w: WhipProj, hooks: GameHooks, ...enemies: Enemy[]): void {
  for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
  const p = w.pointsAt(20, true)[10];
  for (const e of enemies) { e.x = p.x - 12; e.y = p.y - 12; }   // 24 盒对控制点同心
  w.fixedUpdate(1, hooks);
}

const mkWhip = (player: Player, dmg: number, projId = 841, itemId = 4672): WhipProj =>
  new WhipProj(player.cx, player.cy, 0, projId, itemId, dmg, 4, 30, 4, () => player);

/** 参照满伤（独立 whip+零残窗敌,同几何同防 = 首拍满伤基准） */
function landRef(hooks: GameHooks, player: Player, ref: Enemy): number {
  const w = mkWhip(player, 60);
  const hp0 = ref.hp;
  landOneHit(w, hooks, ref);
  return hp0 - ref.hp;
}

describe('S3b-§A：前置全局免疫窗门（:12635-12639）——门拒拍整跳', () => {
  it('A1 残窗敌（iframes=10）：零伤/tag 不挂/minionTarget 不写/不占位（旧码 tag+占位照跑必红）', () => {
    const list: Enemy[] = [];
    const { hooks, player } = makeGame(list);
    const e = tankEnemy(hooks, 400, 600);
    e.iframes = 10;                                   // 他弹残窗（Enemy.hurt 同源共享窗）
    const hp0 = e.hp;
    const w = mkWhip(player, 60);
    landOneHit(w, hooks, e);
    expect(e.hp).toBe(hp0);                           // 整跳：零伤（:12638 return）
    expect(player.tagEffectStack.isNPCTagged(4672, e.id)).toBe(false);  // 不 tag（:13637 门后）
    expect(player.minionTargetId).toBe(-1);           // 不写集火槽（:14321-14327 门后）
    expect(w.pveNumHits).toBe(0);                     // 不计数（:14263 门后）
    // 整跳后同鞭窗期满照吃（写梯 :14175-14179 未达=局部表留白,非「占位后饿死」）
    e.iframes = 0;
    const hpBefore = e.hp;
    w.fixedUpdate(1, hooks);                          // 曲线缓移 ~4px,24 盒仍叠 → 受理
    expect(e.hp).toBeLessThan(hpBefore);              // 窗期满照吃
    expect(player.tagEffectStack.isNPCTagged(4672, e.id)).toBe(true);   // 受理拍才挂 tag
    expect(w.pveNumHits).toBe(1);
  });

  it('A2 门拒不跑 falloff（:13453-13550 门后）：同拍残窗敌A+活敌B,B 吃满伤（旧码 B 被衰减连坐必红）', () => {
    // ★BJ723-C S03：鞭本体 DV（:12970）后满伤基准含逐受理靶独立掷——本测比 B 与
    //  参照的【同值】,mock Math.random=0.5（tier 0 档,DV 恒等）恢复确定性;
    //  判别语义不变（B 满伤=衰减未被 A 拍吃掉）。
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const list: Enemy[] = [];
    const { hooks, player } = makeGame(list);
    const a = tankEnemy(hooks, 400, 600);
    const b = tankEnemy(hooks, 400, 600);             // 同点叠放,enemies 序 = A 先 B 后
    a.iframes = 10;
    // 参照：独立 game 实例（同 WhipProj 链路会跨敌连坐衰减/互打,必须隔离取满伤基准）
    const refList: Enemy[] = [];
    const { hooks: refHooks, player: refPlayer } = makeGame(refList);
    const ref = tankEnemy(refHooks, 400, 600);
    const hpA0 = a.hp, hpB0 = b.hp;
    landOneHit(mkWhip(player, 60), hooks, a, b);
    const hitFull = landRef(refHooks, refPlayer, ref);
    expect(hitFull).toBeGreaterThan(0);
    expect(a.hp).toBe(hpA0);                          // A 整跳
    expect(hpB0 - b.hp).toBe(hitFull);                // ★主判别:B 满伤=衰减未被 A 拍吃掉
    rnd.mockRestore();
  });

  it('A3 门拒不跑 debuff（StatusNPC :13634 门后）：912 酷鞭残窗敌 frostburn2T 不写,窗期满照写', () => {
    const list: Enemy[] = [];
    const { hooks, player } = makeGame(list);
    const e = tankEnemy(hooks, 400, 600);
    e.iframes = 10;
    const w = mkWhip(player, 60, 912, 4911);
    landOneHit(w, hooks, e);
    expect(e.frostburn2T ?? 0).toBe(0);               // 门拒不写 debuff
    e.iframes = 0;
    w.fixedUpdate(1, hooks);
    expect(e.frostburn2T ?? 0).toBe(4);               // 受理拍 AddBuff(324,240)=4s
  });
});

describe('S3b-§B：受理写位（写梯 :14175-14179 usesLocal 主支,pierce=-3 清全局窗）', () => {
  it('B1 受理命中 iframes 恒 0 非 10（旧 pierce=0 写 10=自造全局窗必红）', () => {
    const list: Enemy[] = [];
    const { hooks, player } = makeGame(list);
    const e = tankEnemy(hooks, 400, 600);
    const hp0 = e.hp;
    landOneHit(mkWhip(player, 60), hooks, e);
    expect(e.hp).toBeLessThan(hp0);                   // 受理
    expect(e.iframes).toBe(0);                        // ★主判别:immune[owner]=0（:14175-14178）
  });

  it('B2 鞭→他弹连携：鞭受理后 pierce=0 他弹照达（旧码自造 10t 窗拒他弹必红）', () => {
    const list: Enemy[] = [];
    const { hooks, player } = makeGame(list);
    const e = tankEnemy(hooks, 400, 600);
    const hp0 = e.hp;
    landOneHit(mkWhip(player, 60), hooks, e);
    const hp1 = e.hp;
    expect(e.iframes).toBe(0);
    const hpBeforeFollow = e.hp;
    e.hurt(30, 0, 0, hooks, 0, false, 0, true);       // 泛用 pierce=0 他弹面（返值=是否致死,非受理谓词——Enemy.hurt :15337 未致死返 false）
    expect(e.hp).toBeLessThan(hpBeforeFollow);        // ★主判别:鞭不开全局窗 → 他弹照达
    expect(hp0 - e.hp).toBeGreaterThan(hp0 - hp1);    // 双命中都落账
  });

  it('B3 双鞭同拍同敌：第二鞭（独立局部表）照吃（旧码被第一鞭自造窗拒必红）', () => {
    const list: Enemy[] = [];
    const { hooks, player } = makeGame(list);
    const e = tankEnemy(hooks, 400, 600);
    const w1 = mkWhip(player, 60);
    const w2 = mkWhip(player, 60);
    for (let i = 0; i < 9; i++) { w1.fixedUpdate(1, hooks); w2.fixedUpdate(1, hooks); }
    const p = w1.pointsAt(20, true)[10];
    e.x = p.x - 12; e.y = p.y - 12;
    const hp0 = e.hp;
    w1.fixedUpdate(1, hooks);
    const hp1 = e.hp;
    w2.fixedUpdate(1, hooks);
    expect(hp1).toBeLessThan(hp0);                    // 鞭1 受理
    expect(e.hp).toBeLessThan(hp1);                   // ★主判别:鞭2 照吃（immune[owner]=0）
    expect(player.tagEffectStack.isNPCTagged(4672, e.id)).toBe(true);
  });
});
