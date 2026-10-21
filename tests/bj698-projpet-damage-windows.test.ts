// ★BJ698（2026-10-20）：BJ696/BJ697 登记债③——projPet 门逐型伤害窗普查判别锁。
// 定谳（反编译亲读，Terarria1457/Terraria/Projectile.cs:12461-12500 全函数逐句）：
//  · Damage_CanDealDamage（:12461）首行（:12463）直拒族（本仓实装面）：613/653/831/
//    970 恒拒；833-835 ∧ ai[0]==4 拒；1022 ∧ ai[2]>0（跃击段）拒；1106/85 ∧
//    localAI[0]>=54 拒（Arrow 域 BJ642 已锁,不入本文件）。
//  · projPet 门（:12495）`projPet[type] && <全 carve-out 子句>` 拒——子句极性判读
//    （判例防错:负内衬 `ai[0] != 2f` = 唯该态放行;正内衬 `ai[0] == 0f`/`frame == last`
//    = 唯该态【拒】）逐型窗：
//      放行族（bare carve-out=恒放行）:266/407/317/390-392/393-395/1093/1112/1118/
//        625-628/758/951/963/1022/833-835/864;
//      唯态放行:388@ai0==2、623@ai0==2、533@ai0∈[6,8];
//      唯态拒绝:755@ai0==0（待机）、946@ai0==0（待机）、759@frame==projFrames-1（栖息）;
//      永拒（projPet 无 carve-out）:191-194/373/375/387/423/613/831/970/1094/1113/1119。
//  · friendly 面（Damage_PVE_Inner :12630 `!friendly` 拒——projPet 门之外的第二道闸）:
//      AI_067（:50455 逐拍顶置 false）:flag2/758、flag3/833-835、flag5/951、flag6/1022、
//        flag7/1036 恒 true;海盗 393-395/捣蛋猫 1093·1112/黏土蓓蕾 1118 唯扑击块
//        （:50867/:50876/:50904）置 true;758 另有 ai0==2∧ai1<0 扑后过渡拍置 false。
//      AI_026（无顶置,唯 (266|flag7) 块 :62963-63017 写）:266/390-392 = LOS 目标
//        <800+40×minionPos 且非撤退;ai[0]==1 归位段零写=残留承袭。191-194/1094/1113
//        无任何写位+SetDefaults 无 friendly=true（:2793-2815/:10212-10222/:10379-10389
//        亲读——旧注「SetDefaults friendly=true 恒开」系伪锚）=永 false。
//      AI_062/AI_066/AI_158/AI_156/AI_206 零 friendly 写位:373/375/407/423/613/963/
//        387/388/759/755/946/1119 看 SetDefaults（亲读:407/423/533/613/623/755/758/
//        759/831/864/946/951/963/970/387/388=true;191-194/266/317/390-392/393-395/
//        625-628/833-835/1022/1093/1094/1112/1113/1118/1119=缺省 false 由 AI 置位）。
//  修面（14 处,每处带原版锚,见 MinionProj.ts ★BJ698 标记）:
//    多窗摘除:373/375/423/613 尾位+冲刺子步、387/388 巡航尾位、191-194/1094/1113
//      地面+归位、1119 尾位、946/755 待机拍、759 栖息拍;
//    缺窗补齐:951/1022/758 归位飞行、833-835 state5 追离拍、390-392 归位（残留
//      friendly 承袭）;
//    错窗矫正:390-392 地面（!retreat → spFriendly 镜像=LOS 门）。
//  判别锁：§0 反编译源锚（读错即红）+ §1 逐型行为锁（修过的型:阻断态零伤/放行态
//  可伤,旧形回潮恰红）+ §2 已判对型调用位结构锁（防静默回退）。
//  ★夹具纪律（BJ514/BJ634/BJ635/BJ696 判例防「夹具喂幻影」）：真 World/真 Player/
//  真盒重叠/直驱 fixedUpdate；不可追敌（maxHp=3 ≤ lifeMax>5 门,canBeChasedBy :91141）
//  用于「纯接触窗探针」——摘掉索敌/射击副作用,唯 contact 面可观测。
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { MinionProj } from '../src/entities/MinionProj';
import type { GameHooks } from '../src/entities/types';

// ★C档可移植：仓库外反编译依赖——缺则源码锚节 skip（本机在=真跑）
const EXT_MISSING = !existsSync(new URL('../../Terarria1457', import.meta.url));
const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457', 'Terraria');

interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; maxHp?: number; vanillaId?: number;
  hurt: (d: number, ...rest: unknown[]) => boolean;
  hits: number[];
}
/** 真敌盒夹具：maxHp=100000 过 canBeChasedBy lifeMax>5 门（可追/可射） */
const mkEnemy = (id: number, cx: number, cy: number, w = 60, h = 60): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy,
    hp: 100000, maxHp: 100000, vanillaId: 48, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};
/** 不可追敌（maxHp=3 ≤ 5 → canBeChasedBy false）：索敌/射击/1-in-20 起手全灭,
 *  唯接触面可观测的「纯接触窗探针」 */
const mkUnchaseable = (id: number, cx: number, cy: number, w = 60, h = 60): MockEnemy => {
  const e = mkEnemy(id, cx, cy, w, h);
  e.maxHp = 3;
  return e;
};

function makeHooks(enemies: MockEnemy[] = []) {
  const w = new World(200, 120, 7, 'bj698');
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) w.store.setTile(x, y, 1);
  w.groundLevel = 100;
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: w as never,
    player: player as never,
    enemies: () => enemies,
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
  };
  (hooks as unknown as { entities: { projectiles: unknown[]; add: (e: unknown) => void } }).entities = {
    projectiles: added,
    add: (e: unknown) => { added.push(e); },
  };
  return { hooks, player, added };
}

let seq = 0;
const minion = (player: Player, hooks: GameHooks, cx: number, cy: number,
  projId: number, damage = 20): MinionProj => {
  const m = new MinionProj(cx, cy, projId, damage, 2, false, 0, false, () => player);
  m.id = ++seq;
  m.x = cx - m.w / 2; m.y = cy - m.h / 2;   // NewProjectile 中心域（γ 判例）
  (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(m);
  return m;
};
const overlap = (m: MinionProj, e: MockEnemy): void => {
  m.x = e.cx - m.w / 2; m.y = e.cy - m.h / 2;
};
/** 类型手术面（BJ436/BJ511/BJ684 同式——private 状态直驱） */
const S = (m: MinionProj) => m as unknown as Record<string, number | boolean>;

// ============================================================
// §0 反编译源锚（Damage_CanDealDamage 全函数逐句锁——读错/漂移即红）
// ============================================================
describe.skipIf(EXT_MISSING)('§0 原版锚：projPet 门/首行拒族/布表（:12463/:12495/Main.cs）', () => {
  const van = readFileSync(join(VAN, 'Projectile.cs'), 'utf8');
  const main = readFileSync(join(VAN, 'Main.cs'), 'utf8');
  const i = van.indexOf('private bool Damage_CanDealDamage()');
  const fn = van.slice(i, van.indexOf('public void Damage()'));

  it('projPet 门整句在位（:12495——carve-out 全集逐字）', () => {
    expect(fn).toContain('Main.projPet[type] && type != 266 && type != 407 && type != 317 && (type != 388 || ai[0] != 2f)');
    expect(fn).toContain('type != 1093 && type != 1112 && type != 1118');
    expect(fn).toContain('(type != 533 || !(ai[0] >= 6f) || !(ai[0] <= 8f))');
    expect(fn).toContain('(type != 755 || ai[0] == 0f)');
    expect(fn).toContain('(type != 946 || ai[0] == 0f)');
    expect(fn).toContain('(type != 759 || frame == Main.projFrames[type] - 1)');
    expect(fn).toContain('type != 758 && type != 951 && type != 963 && type != 1022');
    expect(fn).toContain('(type != 623 || ai[0] != 2f)');
    expect(fn).toContain('type != 833 && type != 834 && type != 835 && type != 864');
  });
  it('首行拒族（:12463）——613/831/970/653 恒拒 + 833-835@ai0==4 + 1022@ai[2]>0', () => {
    expect(fn).toContain('type == 613');
    expect(fn).toContain('type == 831 || type == 970');
    expect(fn).toContain('type == 653');
    expect(fn).toContain('(type == 833 && ai[0] == 4f)');
    expect(fn).toContain('(type == 1022 && ai[2] > 0f)');
  });
  it('projPet 布表（Main.cs:8867-8991）——永拒族全在表（无 carve-out=门吃projPet真值）', () => {
    for (const t of [191, 373, 375, 387, 423, 613, 831, 970, 1094, 1113, 1119]) {
      expect(main, `projPet[${t}]`).toContain(`projPet[${t}] = true;`);
    }
  });
  it('projFrames[759]=5（栖息帧=4=projFrames-1;Main.cs:8645）', () => {
    expect(main).toContain('projFrames[759] = 5;');
  });
});

// ============================================================
// §1 逐型行为锁——修过的型（阻断态零伤=旧形回潮恰红 / 放行态可伤=不矫枉过正）
// ============================================================
describe('§1a 永拒族摘窗（373/375/423/613/387/191-194/1094·1113/1119——纯接触窗探针）', () => {
  it.each([
    ['373 黄蜂巡航尾位', 373],
    ['375 小鬼巡航尾位', 375],
    ['387 激光眼巡航尾位', 387],
    ['191 俾格米地面+归位', 191],
    ['1094 狐地面+归位', 1094],
    ['1119 禁戒魂灵尾位', 1119],
  ])('%s：盒叠不可追敌 20 拍零伤（旧无条件 contact 回潮 → 必红）', (_name, pid) => {
    const en = mkUnchaseable(1, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, pid as number);
    overlap(m, en);
    for (let t = 0; t < 20; t++) m.fixedUpdate(1, hooks);
    expect(100000 - en.hp, `type ${pid} 本体永不可伤`).toBe(0);
  });

  it('423 冲刺子步穿敌零伤（旧子步 contact 回潮 → 必红;唯 1120 族输出在弹上）', () => {
    const en = mkUnchaseable(2, 60 * 16 + 300, 90 * 16 - 60);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 423);
    overlap(m, en);
    S(m).a62A0 = 2; S(m).a62A1 = 3; S(m).a62EU = 2;   // 冲刺态直入（:5252 支）
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBe(0);
  });

  it('613 冲刺子步穿敌零伤（首行 :12463 + projPet 门双拒）', () => {
    const en = mkUnchaseable(3, 60 * 16 + 300, 90 * 16 - 60);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 613);
    overlap(m, en);
    S(m).a62A0 = 2; S(m).a62A1 = 3; S(m).a62EU = 2;
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBe(0);
  });

  it('407 暴风雨鲨卷对照：尾位接触可达（carve-out `type != 407`——矫枉过正防线）', () => {
    const en = mkUnchaseable(4, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 407);
    overlap(m, en);
    for (let t = 0; t < 5; t++) m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBeGreaterThan(0);
  });
});

describe('§1b 双子 388 唯冲刺窗（触发拍放行/巡航拍拒）', () => {
  it('388 触发拍接触可伤（ai0==2 post-AI 读位——Damage() :17184 子步内同相）', () => {
    const en = mkEnemy(5, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 388);
    overlap(m, en);
    S(m).twA1 = 0;                     // 攻击触发门（:4643 num526<500 → twA0=2 → 尾位放行）
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBeGreaterThan(0);
    expect(S(m).twA0).toBe(2);         // 已入冲刺态
  });
  it('388 巡航拍（twA0=0 无触发源）盒叠不可追敌零伤（旧尾位无条件回潮 → 必红）', () => {
    const en = mkUnchaseable(6, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 388);
    overlap(m, en);
    for (let t = 0; t < 10; t++) m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBe(0);
  });
});

describe('§1c AI_156 族待机拒（755/946 唯 ai0==0 拒——`ai[0] == 0f` 正内衬=拒态）', () => {
  it('755 待机拍零伤（旧待机 bHitTick 回潮 → 必红;随机压 0.99 抑 1/20 起手）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const en = mkEnemy(7, 60 * 16, 90 * 16 - 30);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 755);
    overlap(m, en);
    for (let t = 0; t < 10; t++) m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBe(0);
    expect(S(m).bA0).toBe(0);          // 仍待机（起手 roll 被压）
    vi.restoreAllMocks();
  });
  it('755 攻击段可伤（bA0=66 减速段——矫枉过正防线）', () => {
    const en = mkEnemy(8, 60 * 16, 90 * 16 - 30);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 755);
    overlap(m, en);
    S(m).bA0 = 66; S(m).bA1 = en.id;
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBeGreaterThan(0);
  });
  it('946 待机拍零伤（旧待机 tHitTick 回潮 → 必红）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const en = mkEnemy(9, 60 * 16, 90 * 16, 90, 90);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, player.cx, player.cy, 946);
    for (let t = 0; t < 10; t++) m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBe(0);
    expect(S(m).tA0).toBe(0);
    vi.restoreAllMocks();
  });
  it('946 攻击段可伤（tA0=80 跃空首拍——BJ684 §2 同夹具）', () => {
    const en = mkEnemy(10, 60 * 16, 90 * 16, 90, 90);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, player.cx, player.cy, 946);
    S(m).tA0 = 80; S(m).tA1 = en.id;
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBeGreaterThan(0);
  });
});

describe('§1d 759 雀宝宝唯栖息拒（frame==projFrames-1=4 写位 :49753/:49823）', () => {
  it('栖息拍（bbFrame=4）零伤;飞行拍可伤（双段对照）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 压 1/20 起手
    const en = mkUnchaseable(11, 60 * 16, 90 * 16 - 30);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, player.cx, player.cy - 40, 759);
    // 段① 飞行接近期（bbFrame=-1）：盒叠敌 → 接触放行（飞行窗）
    overlap(m, en);
    m.fixedUpdate(1, hooks);
    const flyingDmg = 100000 - en.hp;
    expect(flyingDmg).toBeGreaterThan(0);             // 飞行拍可伤（wiki 佐证:撞敌接触伤）
    // 段② 栖息收敛（SmoothStep 0.45 → 头顶 home;敌移开不扰收敛）
    en.x = -10000; en.y = -10000; en.cx = -10000 + 30; en.cy = -10000 + 30;
    let perched = false;
    for (let t = 0; t < 400 && !perched; t++) {
      m.fixedUpdate(1, hooks);
      perched = S(m).bbFrame === 4;
    }
    expect(perched, '收敛至栖息位（bbFrame=4 通道）').toBe(true);
    // 段③ 栖息拍接触探针：敌移回盒叠 → 唯栖息拍拒（旧无条件 contact 回潮 → 必红）
    en.x = m.x; en.y = m.y; en.cx = m.cx; en.cy = m.cy;
    const hp0 = en.hp;
    m.fixedUpdate(1, hooks);
    expect(hp0 - en.hp, '栖息拍（frame==4）拒伤').toBe(0);
    expect(S(m).bbFrame).toBe(4);                     // 本拍确为栖息拍
    vi.restoreAllMocks();
  });
});

describe('§1e 归位飞行缺窗补齐（951/1022/758——friendly 恒真族全态可伤）', () => {
  it.each([
    ['951 小雪怪归位飞行', 951, 'flinA0'],
    ['1022 蘑菇小伙伴归位飞行', 1022, 'mbA0'],
    ['758 吸血蛙归位飞行', 758, 'frA0'],
  ])('%s：ai0==1 拍盒叠敌可伤（旧 return 早退回潮 → 零伤必红）', (_n, pid, key) => {
    const en = mkUnchaseable(12, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, pid as number);
    overlap(m, en);
    S(m)[key as string] = 1;          // 归位态直入
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBeGreaterThan(0);
  });

  it('1022 跃击段（ai[2]>0）对照拒（首行 :12463——矫枉过正防线,既有面）', () => {
    const en = mkUnchaseable(13, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 1022);
    overlap(m, en);
    S(m).mbA0 = 1; S(m).mbA2 = 30;    // 跃击段（首行拒）
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBe(0);
  });
});

describe('§1f 沙漠虎 833-835：state5 追离拍缺窗补齐 + ai0==4 拒（首行）', () => {
  it('833 state5 环绕拍盒叠敌可伤（旧 return 早退回潮 → 零伤必红）', () => {
    const en = mkEnemy(14, 60 * 16 + 200, 90 * 16 - 60);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 833);
    overlap(m, en);
    S(m).pounceCd = 10;               // 摘特殊攻击触发面（818 链防污染）
    S(m).tigerA0 = 5;                 // 追离态直入（ai067StateFive 环绕→接触）
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBeGreaterThan(0);
  });
  it('834 state4 等待拍对照拒（首行 `ai[0]==4`——矫枉过正防线,既有面）', () => {
    const en = mkEnemy(15, 60 * 16 + 200, 90 * 16 - 60);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 834);
    overlap(m, en);
    S(m).tigerA0 = 4;
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBe(0);
  });
});

describe('§1g 蜘蛛 390-392 friendly 镜像（LOS 门+撤退门+归位残留承袭）', () => {
  it('390 地面作战：LOS 目标在域 → 可伤（放行对照,spFriendly=true）', () => {
    const en = mkEnemy(16, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 390);
    overlap(m, en);
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBeGreaterThan(0);
  });
  it('390 无 LOS 目标拍零伤（旧 !retreat 门回潮 → 必红;:63015-63017 friendly=false）', () => {
    const en = mkUnchaseable(17, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 390);
    overlap(m, en);
    for (let t = 0; t < 10; t++) m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBe(0);
  });
  it('391 撤退拍对照拒（:63004 flag25——既有面）', () => {
    const en = mkEnemy(18, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 391);
    overlap(m, en);
    S(m).spLai1 = 20;
    m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBe(0);
  });
  it('392 归位飞行：残留 friendly 承袭（true 可伤/old 早退零伤必红;false 拒）', () => {
    const enT = mkUnchaseable(19, 60 * 16 + 200, 90 * 16 - 40);
    const hT = makeHooks([enT]);
    const mT = minion(hT.player, hT.hooks, enT.cx, enT.cy, 392);
    overlap(mT, enT);
    S(mT).spA0 = 1; S(mT).spFriendly = true;    // 残留 true（交战中离场）
    mT.fixedUpdate(1, hT.hooks);
    expect(100000 - enT.hp).toBeGreaterThan(0);
    const enF = mkUnchaseable(20, 60 * 16 + 200, 90 * 16 - 40);
    const hF = makeHooks([enF]);
    const mF = minion(hF.player, hF.hooks, enF.cx, enF.cy, 392);
    overlap(mF, enF);
    S(mF).spA0 = 1; S(mF).spFriendly = false;   // 残留 false（无敌期离场）
    mF.fixedUpdate(1, hF.hooks);
    expect(100000 - enF.hp).toBe(0);
  });
});

describe('§1h 宝宝史莱姆 266：friendly 域翻转 + 归位残留（(266|flag7) 块 :62963-63017）', () => {
  it('266 地面接敌域（a026Friendly=true）可伤（放行对照——carve-out `type != 266`）', () => {
    const en = mkEnemy(21, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 266);
    overlap(m, en);
    m.fixedUpdate(1, hooks);
    expect(S(m).a026Friendly).toBe(true);       // LOS 目标在 800+40×slot 域内
    expect(100000 - en.hp).toBeGreaterThan(0);
  });
  it('266 无 LOS 目标拍零伤（旧 `!is266 ||` 门回潮=非 266 全放行 → 191 系必红;本例钉 266 域关支）', () => {
    const en = mkUnchaseable(22, 60 * 16 + 200, 90 * 16 - 40);
    const { hooks, player } = makeHooks([en]);
    const m = minion(player, hooks, en.cx, en.cy, 266);
    overlap(m, en);
    for (let t = 0; t < 10; t++) m.fixedUpdate(1, hooks);
    expect(100000 - en.hp).toBe(0);
  });
  it('266 归位飞行：残留 friendly 承袭（true 可伤/old 无条件含 false 亦伤 → false 支必红）', () => {
    const enT = mkUnchaseable(23, 60 * 16 + 200, 90 * 16 - 40);
    const hT = makeHooks([enT]);
    const mT = minion(hT.player, hT.hooks, enT.cx, enT.cy, 266);
    overlap(mT, enT);
    S(mT).a026A0 = 1; S(mT).a026Friendly = true;
    mT.fixedUpdate(1, hT.hooks);
    expect(100000 - enT.hp).toBeGreaterThan(0);
    const enF = mkUnchaseable(24, 60 * 16 + 200, 90 * 16 - 40);
    const hF = makeHooks([enF]);
    const mF = minion(hF.player, hF.hooks, enF.cx, enF.cy, 266);
    overlap(mF, enF);
    S(mF).a026A0 = 1; S(mF).a026Friendly = false;
    mF.fixedUpdate(1, hF.hooks);
    expect(100000 - enF.hp).toBe(0);
  });
});

// ============================================================
// §2 已判对型调用位结构锁（窗口/调用位源锚——防静默回退;BJ696/697/670/a-batch2 既判面）
// ============================================================
describe('§2 结构锁：既判对型窗与修面调用位（源文本锚）', () => {
  const src = readFileSync(join(GAME, 'src', 'entities', 'MinionProj.ts'), 'utf8');
  const block = (start: string, end: string): string => {
    const i = src.indexOf(start);
    expect(i, start).toBeGreaterThan(-1);
    return src.slice(i, src.indexOf(end, i));
  };

  it('317 乌鸦：唯冲刺拍（friendly=true :27547 支）——charging 门在位', () => {
    const b = block('private ravenBody(', '/** 致命球 533 相位推进');
    expect(b).toContain('if (charging && this.contact(game, dmg0, 10)) this.rA1 = -1;');
  });
  it('393-395 海盗：唯扑击窗（friendly :50867 支）——pirA0===2 块内 contact', () => {
    const b = block('private pirateStep(', '/** 小雪怪随从 951');
    expect(b).toContain('if (this.pirA0 === 2) {');
    expect(b).toContain('this.contact(game, dmg0, 18);');
    expect(b).not.toContain('this.contact(game, dmg0);');   // 地面/归位/追离零 contact
  });
  it('1093/1112/1118 帕鲁族：唯扑击窗（friendly :50876/:50904/:50916 支）', () => {
    const b = block('private palGroundStep(', 'private cattivaTryAssigningHelp(');
    expect(b).toContain('this.contact(game, dmg0, flag8 ? 9 : 30);');
  });
  it('623 守护者：唯 ai0==2 拳态（projPet `(type != 623 || ai[0] != 2f)`+Colliding :14294）', () => {
    const b = block('private guardianBody(', 'private guardianDustBurst(');
    expect(b).toContain('if (this.gA0 === 2) {');
  });
  it('625-628 星尘龙：全态（carve-out 625-628 段）——头/段无条件 contact', () => {
    expect(block('private dragonHead(', 'lockAfterFoxChannel('))
      .toContain('this.contact(game, dmg0 * scale, 7);');
    expect(block('private dragonSegment(', 'private abigailCounterOriginalDamage('))
      .toContain('this.contact(game, dmg0 * (1 + 0.23 * this.dragonLocalAI0(game)), 7);');
  });
  it('864 刃杖：全态（carve-out `type != 864`）——smolstarAI 三态各一 contact', () => {
    const b = block('private smolstarAI(', 'private babyBirdStep(');
    expect(b.match(/this\.contact\(game, dmg0\)/g)?.length).toBe(3);
  });
  it('963 阿比盖尔：全态（carve-out `type != 963`）——abigailBody 尾位无条件', () => {
    expect(block('private abigailBody(', 'private solidOverlap('))
      .toContain('this.contact(game, dmgAbig * scale, 20);');
  });
  it('1022 地面支 ai[2]>0 门（首行 `(type == 1022 && ai[2] > 0f)`）在位', () => {
    expect(src).toContain('if (this.mbA2 <= 0) this.contact(game, dmg0, 18);');
  });
  it('533 致命球：唯 ai0∈[6,8]（BJ696 已锁——contact533 双出口在位）', () => {
    const b = block('private deadlySpherePhase(', 'private contact533(');
    expect(b.match(/this\.contact533\(game, /g)?.length).toBe(2);
  });
  it('修面调用位：407 尾位门 / 388 触发拍门 / 759 栖息门 / 266 双位门 / 蜘蛛 spFriendly / 1119 摘除', () => {
    expect(src).toContain('if (this.projId === 407) this.contact(game, dmg0);');
    expect(src).toContain('if (this.projId === 388 && this.twA0 === 2) this.contact(game, dmg0);');
    expect(src).toContain('if (this.bbFrame !== 4) this.contact(game, dmg0);');
    expect(src.match(/if \(is266 && this\.a026Friendly\) this\.contact\(game, dmg0\);/g)?.length).toBe(2);
    expect(src.match(/this\.spFriendly && this\.contact\(game, dmg0(, 20)?\)/g)?.length).toBe(2);
    expect(src).toContain('this.spFriendly = !retreat && losT !== null && losD < 800 + 40 * minionPos;');
    expect(src).toContain('if (this.spFriendly) this.contact(game, dmg0);');
    // 1119 尾位摘除：AI_206 分支内零 contact（块界=分支 return 后的 1093 分发）
    const b = block("if (this.projId === 1119) {", '// ---- 1457 帕鲁地面随从 1093/1112/1118');
    expect(b).not.toContain('this.contact(');
  });
});
