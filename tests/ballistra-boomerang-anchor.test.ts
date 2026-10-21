// 1457 弩车首射延迟 / 回力镖回程攻速缩放 锚定闸门(2026-08-21 补盲):
//   · 弩车 GetBallistraShotDelay(1457 :69721-69735):160 基档 → T3 侍从套 100 →
//     恐慌 60 → 双真 30;1457 :69599-69609 落位首帧 ai[1]=shotDelay(放置后不再
//     立即射第一箭,先等满一档装填)
//   · 回力镖回程参数接攻速(1457 :40172-40186,1456 无):toMax=1/meleeSpeed(M 倒数档)
//     →num30 = 1.5×toMax−0.5 钳 1..10,spd/acc 同乘;光刃族豁免(flag3=false)
//     ★BJ640 语义翻案:旧注「num30=1.5×attackSpeedMult−0.5」把 M 当攻速和用=方向反
import { describe, it, expect } from 'vitest';
import { MinionProj } from '../src/entities/MinionProj';
import { Boomerang } from '../src/entities/WeaponProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

function makeHooks(opts: { player?: unknown; enemies?: Array<Record<string, unknown>> } = {}) {
  const store = new TileStore(200, 120);
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) store.setTile(x, y, 1);
  const added: unknown[] = [];
  const hooks = {
    world: { store } as never,
    player: opts.player ?? new Player(60 * 16, 90 * 16, new Inventory()),
    enemies: () => opts.enemies ?? [],
    critters: () => [],
    npcs: () => [],
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
  };
  // ★BJ703-F 夹具勘误（2026-10-21,存量红分诊=夹具病）：BJ650件1 起 MinionProj.
  //  fixedUpdate 头 whoAmI 槽位懒快照读 game.entities.projectiles.indexOf(this)
  //  ——旧 entities 桩只有 add 无 projectiles 数组 = TypeError。补活体表（未入表
  //  弹 indexOf=−1 → Math.max(0,−1)=0=首空闲槽同语义,断言面零变化）。
  (hooks as unknown as { entities: { add: (e: unknown) => void; projectiles: unknown[] } }).entities =
    { add: (e: unknown) => { added.push(e); }, projectiles: added };
  return { hooks: hooks as unknown as GameHooks, added };
}

const inRangeEnemy = (id: number): Record<string, unknown> => ({
  id, x: 60 * 16, y: 88 * 16, w: 24, h: 40, cx: 60 * 16 + 12, cy: 88 * 16 + 20, dead: false,
});

describe('1457 弩车首射延迟(GetBallistraShotDelay + 落位首帧装填)', () => {
  it('落位首帧 sInit 置位且 sCool=160(基档)——放置后不立即射第一箭', () => {
    const { hooks, added } = makeHooks({ enemies: [inRangeEnemy(1)] });
    const b = new MinionProj(60 * 16, 95 * 16, 677, 20, 2, true, 0, false, () => hooks.player as never);
    b.fixedUpdate(1 / 60, hooks);
    expect(b['sInit']).toBe(1);
    expect(b['sCool']).toBe(159);      // 首帧装填 160 后同帧自减 1(160→159)
    expect(b['sFire']).toBe(0);        // 未进开火态
    expect(added).toHaveLength(0);     // 无弩箭
  });
  it('满 160t 装填前不开火;开火帧起 12t 出弩箭 680(首射延迟=160 档)', () => {
    const { hooks, added } = makeHooks({ enemies: [inRangeEnemy(1)] });
    const b = new MinionProj(60 * 16, 95 * 16, 677, 20, 2, true, 0, false, () => hooks.player as never);
    for (let t = 1; t <= 160; t++) b.fixedUpdate(1 / 60, hooks);
    expect(added).toHaveLength(0);     // 160t 内零射击
    expect(b['sFire']).toBe(0);
    for (let t = 161; added.length === 0 && t <= 200; t++) b.fixedUpdate(1 / 60, hooks);
    expect(added).toHaveLength(1);     // 开火动画第 12t 出弹
    expect((added[0] as { projId: number }).projId).toBe(680);
  });
  it('档位结构:侍从 T3 套装 100 / 恐慌 60 / 双真 30(旗标本仓未接线,函数档先落)', () => {
    const delayOf = (flags: { setSquireT3?: boolean; ballistaPanic?: boolean }): number => {
      const { hooks } = makeHooks({ player: Object.assign(new Player(60 * 16, 90 * 16, new Inventory()), flags) });
      const b = new MinionProj(60 * 16, 95 * 16, 677, 20, 2, true, 0, false, () => hooks.player as never);
      b.fixedUpdate(1 / 60, hooks);
      return b['sCool'] + 1;           // 还原首帧自减前的装填档
    };
    expect(delayOf({})).toBe(160);
    expect(delayOf({ setSquireT3: true })).toBe(100);
    expect(delayOf({ ballistaPanic: true })).toBe(60);
    expect(delayOf({ setSquireT3: true, ballistaPanic: true })).toBe(30);
  });
});

describe('1457 回力镖回程攻速缩放(:40172-40186 toMax=1/meleeSpeed,num30=1.5×toMax−0.5 钳 1..10)', () => {
  /** ai[0]=1(返回段)首步轴向步进 acc×num30——用 vx 增量反读 num30 */
  const returnAccOf = (attackSpeedMult: number, projId = 6): number => {
    const player = {
      attackSpeedMult, dead: false,
      x: 1490, y: 990, w: 20, h: 42, cx: 1500, cy: 1011,   // 距弹 1000px(<3000 Kill 门)
      // hitEnemies 预取面（α-H3 浸剂/parry 查询 2026-08-31 补齐——裸 stub 缺 buffs
      // 会让 hitEnemies 首查 .has 崩,与本闸门的回程缩放无关）
      buffs: { has: () => false },
      critChance: () => 0,
      equipStats: { frostBurn: false, magmaStone: false },
    };
    const { hooks } = makeHooks({ player });
    const b = new Boomerang(500, 1000, 0, 0, 10, 2, projId);
    b.ai0 = 1;                                   // 直接进返回段
    b.fixedUpdate(1 / 60, hooks);
    return b.vx;                                 // steerTo:0→+acc(异号加倍不触发)
  };

  // ★BJ640（2026-10-11）语义翻案：原版 :40175 `toMax = 1f/meleeSpeed`、meleeSpeed 字段 =
  //   CapAttackSpeeds 倒数档 M（:26176 每拍先翻转）→ toMax = 1/M = 攻速和 A，
  //   num30 = 1.5×A − 0.5。旧期望把 attackSpeedMult（=M）直接当 A 用 = 方向反
  //   （加速档 num30 应 2.5 旧式给了减速档……入参按 M 注：加速档 M=1/2）。
  it('基档 asm=1 → num30=1,acc=0.4(缺省族 [9,0.4])', () => {
    expect(returnAccOf(1)).toBeCloseTo(0.4, 6);
  });
  it('加速档 A=2（M=1/2）→ num30=2.5,acc=1.0(回程更急)', () => {
    expect(returnAccOf(1 / 2)).toBeCloseTo(1.0, 6);
  });
  it('上钳:A=7（M=1/7）→ num30=1.5×7−0.5=10,acc=4.0(不超 10)', () => {
    expect(returnAccOf(1 / 7)).toBeCloseTo(4.0, 6);
    expect(returnAccOf(1 / 20)).toBeCloseTo(4.0, 6);   // 29.5 → 仍钳 10
  });
  it('下钳:A=0.5（M=2）→ num30=0.25 → 钳底 1(攻速惩罚档回程不更飘)', () => {
    expect(returnAccOf(2)).toBeCloseTo(0.4, 6);
  });
  it('光刃族豁免(flag3=false):A=7 时 acc 仍 3(不缩放)', () => {
    expect(returnAccOf(1 / 7, 1059)).toBeCloseTo(3, 6);
    expect(returnAccOf(1, 1059)).toBeCloseTo(3, 6);
  });
});
