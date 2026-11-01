// ★清偿刀 F（2026-09-29）：634/635 星云烈焰飞行盒 flag3 豁免判别测试
//   （清偿刀 B 新立债 #1：旧 strike 传 pierce=0 → Enemy.ts:13988 免疫门整跳,
//   原版 flag3（maxPenetrate==1）豁免 :12635-12637 → iframes 残窗内照打）。
//   定谳链（Terarria1457/Terraria/Projectile.cs）：
//     :366   `public int penetrate = 1;`（字段缺省——634/635 SetDefaults :6818-6839
//            无 penetrate / usesLocalNPCImmunity / usesIDStaticNPCImmunity 行）
//     :10675 `maxPenetrate = penetrate;`（SetDefaults 尾统一赋值）
//     :12635 `bool flag3 = maxPenetrate == 1 && !usesLocalNPCImmunity && !usesIDStaticNPCImmunity;`
//     :12636 `if (!((owner < 0 || targetNPC.immune[owner] == 0) | flag3)) return;`
//            → flag3=真 ⇒ immune[owner]>0（本仓 iframes 残窗）【不】拦
//     :14080-14082 命中写支 `type == 634 || 635 → targetNPC.immune[owner] = 5;`
//            （无条件赋值——残窗余值被覆写为 5;后续非 flag3 弹 5t 内被拦=原版窗语义）
//   对照面（flag3=假,免疫门照走,keep pierce=0）：Kill AoE（Kill :73267-73269 先置
//   maxPenetrate=penetrate=-1 再 Damage()）与 645（SetDefaults :6955-6965
//   penetrate=-1+usesLocalNPCImmunity → flag3 假）。
//   判别力：夹具用【真 Enemy.fromVanilla】——门在真 hurt 内部（Enemy.ts:13988
//   `pierce !== 1 && this.iframes > 0` 早退）,非 spy 桩;旧码（pierce=0）下第二发
//   飞行盒 hp 零扣、log 零 proc、iframes=10（hurt 写支）,全红;新码全绿。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';
import { Enemy } from '../src/entities/Enemy';
import { NebulaBlazeBolt } from '../src/entities/LunarNebula';

interface StealCall { kind: string; dmg: number; numHits: number }

function makeGame(log: StealCall[], list: Enemy[]): GameHooks {
  return {
    world: new World(200, 200, 30, 'debt-f'),
    player: null as unknown,
    enemies: () => list,
    entities: { nextId: 1, add: () => {} },
    playSfxFiles: () => {}, playSfx: () => {}, playSfxFile: () => {},
    spawnParticles: () => {}, addDamageNumber: () => {}, spawnDrop: () => null,
    damagePlayer: (): number => 0, critters: () => [], notifyInventoryChanged: () => {},
    onEnemyKilled: () => {}, spawnEnemy: () => {}, cutTile: () => {},
    applyLifeSteal: (kind: 'vampire' | 'ghost', dmg: number, numHits: number) => {
      log.push({ kind, dmg, numHits });
      return 0;
    },
  } as unknown as GameHooks;
}

/** 坦克桩敌（真 Enemy 管线;血量抬高避开死亡管线=判别面只看「门过不过+写支」）。
 *  静止不动（测试不 tick 敌）→ iframes 残窗保持到第二发到达。 */
function tankEnemy(game: GameHooks, tx: number, ty: number): Enemy {
  const e = Enemy.fromVanilla(15, tx * TILE, ty * TILE)!;   // 僵尸：friendly=false/非 384 族
  e.id = 1;
  e.maxHp = 5000;
  e.hp = 5000;
  (game as unknown as { enemies: () => Enemy[] }).enemies().push(e);
  return e;
}

function flyContact(e: Enemy, game: GameHooks, variant: 634 | 635): NebulaBlazeBolt {
  const bolt = new NebulaBlazeBolt(80 * TILE, 100 * TILE, 6, 0, 130, 3, variant);
  bolt.critChance = 0;
  for (let t = 0; t < 40 && !bolt.dead; t++) bolt.fixedUpdate(1, game);
  expect(bolt.dead).toBe(true);                             // 接触命中 → penetrate 0 → Kill
  return bolt;
}

describe('清偿刀 F：634/635 飞行盒 flag3 免疫门豁免（:12635-12637）', () => {
  it('残窗内第二发飞行盒照打：A 命中（写支 iframes=5）→ B 于 5t 残窗内照扣血照 proc（真 Enemy 门）', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const e = tankEnemy(game, 84, 100);
    e.cx; // 触碰 getter 建立（无副作用,占位读）
    const hp0 = e.hp;
    // ★BJ744 改判史（2026-10-31）：G37-A 给接触面（含 634/635 dealContacts）补 DV 掷
    //   （:12970）——固定带宽断言须钉 0.5 中性档（BJ723-B 判例：DV 接入面未 mock 必漂）
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    // 发 A：iframes=0 首中（旧码也过门——判别力在写支值与 B 面）
    const boltA = flyContact(e, game, 634);
    expect(e.hp).toBeLessThan(hp0);                           // 真实扣血（门过）
    expect(e.hp).toBeGreaterThanOrEqual(hp0 - 131);           // 防御后 ≤ 入伤（无暴击,critChance=0）
    expect(e.iframes).toBe(5);                                // ★:14080-14082 专支覆写 5t
    expect(log.length).toBe(1);                               // 受理 → ghost proc 照达
    expect(log[0].kind).toBe('ghost');
    expect(log[0].numHits).toBe(0);                           // :14263 自增在 proc 后
    expect(boltA.pveNumHits).toBe(1);
    void boltA;

    // 敌不 tick → iframes 恒 5（残窗活着）
    expect(e.iframes).toBe(5);

    // 发 B：残窗内第二发飞行盒——flag3 豁免（:12636）照打（旧 pierce=0 码整跳假红）
    const hpMid = e.hp;
    const boltB = flyContact(e, game, 635);                   // 635 同 flag3（SetDefaults :6829-6839 同构）
    expect(e.hp).toBeLessThan(hpMid);                         // ★本刀判别主面：照扣血
    expect(e.iframes).toBe(5);                                // 写支再覆写 5t
    expect(log.length).toBe(2);                               // 受理 → proc 第二达
    expect(log[1].numHits).toBe(0);                           // 每弹自计数器,首跳仍 0
    expect(boltB.pveNumHits).toBe(1);
  });

  it('634 与 635 同面：SetDefaults 双双无 penetrate 行（:6818-6839）→ flag3 同真,635 残窗首中同照打', () => {
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const e = tankEnemy(game, 84, 100);
    e.iframes = 10;                                           // 预置残窗（他源 10t）
    const hp0 = e.hp;
    flyContact(e, game, 635);
    expect(e.hp).toBeLessThan(hp0);                           // 残窗内首中照打
    expect(e.iframes).toBe(5);                                // 残窗 10 被专支覆写 5（无条件赋值）
    expect(log.length).toBe(1);
  });

  it('对照面（flag3=假免疫门照走）：Kill AoE 对非 skipId 残窗敌不 proc——5t 窗消费者=非 flag3 弹面', () => {
    // 敌预置残窗 10 → A 飞行盒照打（写 5）→ 爆盒 skipId 挡自己;
    //  同拍再发 B 于原点:其飞行盒离敌太远未接触（敌静止）,仅记录 A 面终态:
    //  真正的 AoE 门拒面在 bj380「Kill AoE 门拒」案与 645 爆相 pierce=0 面承载。
    //  本案锁：A 命中后 iframes===5 而非 10/0（旧 pierce=0 写 10 = 两向偏差之一）。
    const log: StealCall[] = [];
    const game = makeGame(log, []);
    const e = tankEnemy(game, 84, 100);
    flyContact(e, game, 634);
    expect(e.iframes).toBe(5);
    expect(log.length).toBe(1);
    expect(log[0].dmg).toBeGreaterThan(0);                    // num41 防后实扣等位
  });
});
