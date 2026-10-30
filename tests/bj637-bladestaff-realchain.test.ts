// ★BJ637（2026-10-11）刃杖 864 真实链伤害=0 追凶收口（BJ635 转交 bj528 F3 RED 定谳）：
//  四段断点定位（探针 P1/P2/P3 实证,见会话录）：
//   段①索敌不锁 = 真（旧 F3 几何）——但机制≠BJ635 转交猜想的 canHitWithOwnBodyBox md=∞
//     （P3 实证重叠位 canBeChasedBy=true/canHitWithOwnBodyBox=true/md=0 全过）,真门=
//     viewRect（:49903 全局扫 `(boss || rectangle.Intersects(player.Center±(960,600)))`，
//     Main.cs:758 MaxWorldViewSize=1920×1200）：旧敌位 (400,600) 距玩家 1032.6px（pd>800
//     双距超程）且敌盒 y 580..620 在窗口 y 840..2040 上方外 → 原版同样不锁=忠实相;
//   段②命中不判 = 真——864 忠实巡航首拍 40px/t（num4=10+GetLerpValue(200,600,dist)×30,
//     dist≈985 满档;原版 :46588-46597 同式）拍尾即脱离重叠盒,contact 用位移后盒判交
//     （原版时序同相:AI→HandleMovement→Damage）;contact 每拍被调 ret=false、hurt 零调
//     （探针 P1 实锤 20 拍 contact calls 全 dmg=6/ret=false、hurts=[]）;
//   段③④未断：dmg0=6 全程达 contact（探针实锤）——伤害链供血无断。
//  责任归属：非 C15 连带（R15-F7 CUT_EXCLUDE 表只消费于 EntityManager 割草门 cutTilesBox、
//  R15-F8 纯注释登记、R15-F9 玩家承伤拆步——三 hunk 均不在 864 链上;C15 套件 36/36 绿）,
//  亦非 BJ634 实现缺陷（bj634 套件 20/20 绿,可现实几何伤害面已钉）——真凶=**bj528 F3
//  金标陈旧**：钉的是 BJ634 前通用飞行路径（追击 5px/t 无 viewRect 门）的非忠实相,
//  该相在旧夹具几何（召唤物直接叠在 viewRect 外/双距超程敌上）下不可现实化。
//  处置=金标重产（判例「金标陈旧须 oracle 重产」）：F3 几何迁 viewRect 内钉值不变
//  +本文件三面判别锁（L1 锁敌/L2 viewRect 外不锁=原版本相防回潮/L3 全链追击伤害）。
//  判别力（旧码/变异必红项）：
//   L1 锁敌摘除（a169St=60→0）→ st 恒 0 红;
//   L2 viewRect 门摘除 → 旧几何照锁 → st=60≠0 红（防「顺手解锁」回潮=忠实相锁）;
//   L3 伤害断供（dmg 链断→钳 1）≠6 红 / 追击面断裂（锁敌摘除）→ 零接触红。
import { describe, expect, it } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import type { GameHooks } from '../src/entities/types';
import { Enemy } from '../src/entities/Enemy';
import { MinionProj } from '../src/entities/MinionProj';
import { damageVarRoll } from '../src/stats/DamageVar';

/** BJ528 同款夹具（世界/玩家/敌靶） */
function makeGame(): { hooks: GameHooks; player: Player } {
  const w = new World(200, 120, 7, 'bj637-realchain');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const list: Enemy[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => list,
    npcs: () => [],
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
    spawnFriendlyProj: () => undefined,
    applyLifeSteal: () => 0,
    entities: { projectiles: [], add: () => {}, nextId: 1 },
    tickCount: 0,
    noteNpcPlayerImmune: () => {},
  } as unknown as GameHooks;
  return { hooks, player };
}

/** 敌怪桩（bj528 同式;手动 id=私表键域隔离;px/py=盒心） */
function foe(hooks: GameHooks, vid: number, uid: number, px: number, py: number): Enemy {
  const e = Enemy.fromVanilla(vid, px, py)!;
  e.id = uid;
  e.maxHp = 5000;
  e.hp = 5000;
  (hooks as unknown as { enemies: () => Enemy[] }).enemies().push(e);
  return e;
}

/** a169 三槽读口（private——测试面类型手术） */
const st = (m: MinionProj): number => (m as unknown as { a169St: number }).a169St;
const tg = (m: MinionProj): number => (m as unknown as { a169Tg: number }).a169Tg;

describe('BJ637 刃杖 864 真实链四段定谳回归锁（AI_169 忠实相;BJ634 套件不破前提）', () => {
  it('L1 索敌锁场景：敌在 viewRect+双距内 → 巡航拍锁敌 a169St=60/a169Tg=敌id（:46603-46608）', () => {
    const { hooks, player } = makeGame();
    // 敌盒心 (1160,1240)：pd=hypot(200,200)=282.8<800;盒 1151..1169/1220..1260 ⊂
    // viewRect(player.Center±(960,600)=0..1920/840..2040) → 双距+可见门全过
    const z = foe(hooks, 3, 6371, 1160, 1240);
    // 仆从召在敌左 105px（不重叠,验纯索敌支;巡航向锚=左下=离敌向,无顺拍接触）
    const blade = new MinionProj(z.cx - 105 - 5, z.cy - 5, 864, 6, 2, false, 0, false, () => player);
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(blade);
    blade.fixedUpdate(1, hooks);   // 巡航拍：索敌→锁（先于位移,:46603-46608）
    blade.fixedUpdate(1, hooks);   // 攻击拍首拍：无接触 → 恒 60（M2 锁敌面）
    expect(st(blade)).toBe(60);    // 锁敌态机落位（变异 a169St=60→0 必红）
    expect(tg(blade)).toBe(z.id);  // ai[1]=attackTarget 钉值
  });

  it('L2 viewRect 外+双距超程不锁=原版本相钉（:49903 门;旧 bj528 F3 几何的机制解释,防解锁回潮）', () => {
    const { hooks, player } = makeGame();
    // 旧 F3 几何原样：敌盒心 (400,600)——pd=1032.6>800;敌盒 y 580..620 全在窗口
    // y 840..2040 上方（敌盒底 620 ≤ 840 → 不相交）→ 原版全局扫拒锁
    const z = foe(hooks, 3, 6372, 400, 600);
    const pd = Math.hypot(z.cx - player.cx, z.cy - player.cy);
    expect(pd).toBeGreaterThan(800);                       // 双距超程前提自证
    expect(z.y + z.h).toBeLessThanOrEqual(player.cy - 600); // viewRect 上缘外前提自证
    const blade = new MinionProj(z.cx - 5, z.cy - 5, 864, 6, 2, false, 0, false, () => player);
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(blade);
    const hp0 = z.hp;
    // ★全程锁态采样（末拍断言不判别：摘 viewRect 门后拍 0 锁→pd≥900 拍 1 弃→md<800
    //  拍 2 重锁振荡,末拍恰回落 0=伪绿——必须全程无一拍 60 才是「门恒拒锁」真语义）
    let everLocked = false;
    for (let t = 0; t < 20; t++) {
      blade.fixedUpdate(1, hooks);
      if (st(blade) !== 0) everLocked = true;
    }
    expect(everLocked).toBe(false); // 全程零锁（viewRect 门拒;摘门→拍 0 即 60 必红）
    expect(st(blade)).toBe(0);
    expect(tg(blade)).toBe(0);
    expect(z.hp).toBe(hp0);        // 原版同场景 0 伤（巡航 40px/t 拍尾脱盒+永不锁）
  });

  it('L3 真实链全链伤害：锁→追击 16px/t→接触→结算 6（非重叠出生;伤害断供→钳1≠6 必红）', () => {
    const { hooks, player } = makeGame();
    const z = foe(hooks, 3, 6373, 1160, 1240);   // L1 同位（viewRect+双距内）
    // 召在敌左 105px（盒距 91px）→ 必经锁敌+追击支达接触（旧通用路径 5px/t 也能达,
    //  但锁敌摘除变异恒巡航离场=零接触必红;伤害断供=钳 1≠6 必红）
    const blade = new MinionProj(z.cx - 105 - 5, z.cy - 5, 864, 6, 2, false, 0, false, () => player);
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(blade);
    const hp0 = z.hp;
    for (let t = 0; t < 30 && z.hp === hp0; t++) blade.fixedUpdate(1, hooks);
    // ★BJ735 改判史（随 BJ716-A R18-F2/BJ723-B,2026-10-25/26）：随从接触环 DamageVar
    // 首掷（Projectile.cs:12970;874 段 dmgV867）→ hp 差=6 基伤 DV 档域 {5,6,7}
    // （16×实测分布 5/6/7 与 damageVarRoll 域全吻合;crit 恒 false=无 tag 掷面;
    // 旧钉 6=平值遗迹,全量棘轮真随机 flaky——非中值档必红）。断供→钳 1 仍必红
    // （1 不在域）,伤害断供判别力保持。
    const dvDomain = new Set<number>();
    for (let i = 0; i < 31; i++) dvDomain.add(damageVarRoll(6, 0, () => i / 31));
    expect(dvDomain.has(hp0 - z.hp)).toBe(true);
    expect(st(blade)).toBe(-1);    // 命中受理转返航（:14129-14141 864 特支,ai[0]>0 门）
    expect(z.iframes).toBe(0);     // local 档清窗（BJ436/BJ511 面不回归）
    const ledger = (blade as unknown as { hitCd: { map: Map<number, number> } }).hitCd.map;
    expect(ledger.get(z.id)).toBe(10);   // cd=10 钉值（原版 :8299）
  });

  it('L4 闲置悬停 rot=π（:46612-46614 UnitY.ToRotation()+π/2=π,竖刃尖朝下）——★BJ637 复报朝向回归锁', () => {
    const { hooks, player } = makeGame();
    // 召在悬浮锚正位（player.Top+(0,-30)=(960,1410),total=1 编队偏移零）→ dist<40
    // 恒闲置档:tAng=π（旧写 π/2 漏加后项=横置 90°,用户截图 107.png 病灶）
    const blade = new MinionProj(960 - 5, 1440 - 30 - 5, 864, 6, 2, false, 0, false, () => player);
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(blade);
    for (let t = 0; t < 40; t++) blade.fixedUpdate(1, hooks);   // 0.2/t 收敛:Δ=0.8π×0.8⁴⁰≈4e-4
    expect(st(blade)).toBe(0);                     // 无敌恒闲置（rot 不被攻击态覆写）
    const rot = (blade as unknown as { rot: number }).rot;
    expect(Math.abs(rot - Math.PI)).toBeLessThan(0.02);   // 竖直（M3 复旧 π/2 必红）
  });

  it('L5 攻击突进 rot→π（:46672-46673 vel.ToRotation()+π/2,垂直下扑尖朝前）——π/2 项面回归锁', () => {
    const { hooks, player } = makeGame();
    // 敌在锚正下空中 (960,1560)（盒 951..969/1540..1580,地面 1600 上方=LOS 通;
    //  pd=120/md=150 双距内+viewRect 内）→ 锁后垂直下扑:velRot=π/2 → tAng=π
    const z = foe(hooks, 3, 6374, 960, 1560);
    const blade = new MinionProj(960 - 5, 1440 - 30 - 5, 864, 6, 2, false, 0, false, () => player);
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(blade);
    for (let t = 0; t < 8; t++) blade.fixedUpdate(1, hooks);   // 拍 0 锁;下扑 7 拍 112px 未触（触点拍 8）
    expect(st(blade)).toBe(60);
    expect(tg(blade)).toBe(z.id);
    const rot = (blade as unknown as { rot: number }).rot;
    expect(Math.abs(rot - Math.PI)).toBeLessThan(0.15);   // Δ=0.8π×0.6⁷≈0.07（M4 摘 +π/2 → π/2 必红）
  });
});
