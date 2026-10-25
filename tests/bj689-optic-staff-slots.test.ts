// ★BJ689（2026-10-16）用户实报「魔眼法杖只能顶替一个召唤位:已经招满了其他召唤物时,
//   使用魔眼法杖只能顶替掉原来的一个召唤物,无法继续召唤替换槽位」——当时定谳=
//   【原版相,零修刀】:SW 与反编译 1:1,所述行为即原版 Terraria 行为本身。
//   ★★BJ710-A 改判（2026-10-24）：用户对同一 5+1 现象再次实报并明令分歧——
//   「如果确定是原版行为,按我们的预期优化:允许替换更多槽位」。BJ689 零修刀
//   判语就此推翻：驱逐序改为【先异型（与 incoming 家族不同,池内保原版升序）
//   后同型回落】（Game.ts freeUpMinionsForSummon evictOrder 分区 + minionFamilyOf
//   家族口径,改判史详见其注）。本文件判别锁随迁:S2/S6 断言面改为分歧语义,
//   原版锚（升序池/0.5 粒度/成对生成）在非本家路径上照钉。
//
// 定谳链(锚 1457;1456 同构并注):
//   · 一次用杖=成对双子:Item.cs:24640-24658 case 2535(shoot=387/buffType=134/
//     summon/autoReuse/reuseDelay2)+ Player.cs:48957-48966 双 SpawnMinionOnCursor
//     (387 与 projToShoot+1=388;num4/num5=0f 的旋转=no-op → 两眼同点零速出生)。
//   · 双子槽位:Projectile.cs:4709/4725 minionSlots=0.5f(1456 :4434/:4450,一对=1.0)。
//   · 腾位量:ItemID.cs:1112 StaffMinionSlotsRequired=Factory.CreateIntSet(1)——
//     全表=1 无任何覆写(全树 grep 唯一消费点 Player.cs:52384)→ 满板首用恰好顶替
//     【一只 1.0 槽随从】(逐杀条件 :52420 num−num3>maxMinions−num2)。
//   · 后续使用不推进:驱逐池=按 minionSlots【升序】稳定插入排序(Player.cs:52370-
//     52388,1456 :50977-50989)+ 逐杀从池首(最小槽位)起(:52418-52420,1456
//     :51018-51020)→ 0.5 槽双子恒排 1.0 槽随从之前 → 二用起【旧双子对先死】
//     (num4 交替门 :52429-52436 保成对死),其余旧随从永不被顶替——用户所述
//     「无法继续召唤替换槽位」即此,原版要更多对只能:右键摘其他随从 buff 腾槽
//     (BJ405 链)/随从战死/提 maxMinions(装备+buff)。
//   · 实跑实证:scripts/_bj689-optic-staff-slots.mjs(真实物品使用链,9/9 PASS:
//     B 满板 266×3 首用→266×2+对,B2-B4 双子 id 逐次刷新而 266 组成恒定;E 摘 64
//     腾槽后连补两对;C max1 一对恰好占满;D 空板累积至 3 对后逐对顶替最旧对)。
//   · SpawnMinionOnCursor(1457 Player.cs:50093-50123)无上限门——满员裁决全在
//     出手前 FreeUpPetsAndMinions(:43109-43111 先于 :43115 StartActualUse)+
//     每 tick 上限自裁(Projectile.cs:16814-16844,SW Game.ts 召唤上限缩水自裁段)。
//
// 判别锁场景(S1-S7 与变异自证 M1-M3 一一对应):
//   S1 满槽首用恰顶一只 / S2 连用症状语义锁(升序池铁律) / S3 自由槽零驱逐 /
//   S4 非牺牲型整段跳过 / S5 max1 极限一对占满 / S6 0.5 槽粒度锁 / S7 结构锁。
//
// 运行:cd game && npx vitest run tests/bj689-optic-staff-slots.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { freeUpMinionsForSummon, MINION_SACRIFICABLE } from '../src/core/Game';
import { MinionProj } from '../src/entities/MinionProj';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { withMutation, lockTargetFile, unlockTargetFile } from './mutation-guard';

const GAME = join(__dirname, '..');
const GT = join(GAME, 'src', 'core', 'Game.ts');

// ---------------- 夹具(weapon-summon-evict.test.ts 同式) ----------------
const player = new Player(60 * 16, 90 * 16, new Inventory());
const mk = (projId: number): MinionProj =>
  new MinionProj(player.cx, player.cy - 40, projId, 10, 2, false, 0, false, () => player);
/** 满板/混板构造:入参序=生成序(驱逐池同权稳定序的输入面) */
const alive = (...ids: number[]): MinionProj[] => ids.map(mk);

describe('BJ689 魔眼法杖槽位顶替面(原版相判别锁,FreeUpPetsAndMinions :52335-52458)', () => {
  it('S1 满槽首用:266×3 满板(max3)再召 387 → 恰好逐一只 266(腾 1.0=StaffMinionSlotsRequired 全表 1)', () => {
    // 原版:Player.cs:52420 num−num3>max−num2=3−0>2 → 杀一只 1.0 槽 → 3−1=2≤2 停
    const [a, b, c] = alive(266, 266, 266);
    freeUpMinionsForSummon(387, [a, b, c], 3);
    expect([a.dead, b.dead, c.dead]).toEqual([true, false, false]);
  });

  it('BJ689-S2 连用置换锁（BJ710-A 分歧面）:266×2+双子对满板再召 387 → 逐最老 266、双子对存活', () => {
    // ★改判史:BJ689 原判（2026-10-16）=原版升序池铁律,旧对先死、266 永不被顶替
    //   =用户实报 5+1 锁死的原版真相,零修刀。BJ710-A（2026-10-24）用户明令分歧:
    //   先异型后同型（evictOrder 分区）——本断言面=分歧语义:266a 被逐、旧对存活。
    //   原版锚仍钉于 S6/纯核（非本家路径升序照旧）+ Game.ts minionFamilyOf 注。
    const [a, b, t1, t2] = alive(266, 266, 387, 388);
    freeUpMinionsForSummon(387, [a, b, t1, t2], 3);
    expect([a.dead, b.dead]).toEqual([true, false]);    // 最老异型被逐（分歧面）
    expect([t1.dead, t2.dead]).toEqual([false, false]); // 上一按召出的双子对存活
  });

  it('S3 自由槽零驱逐:仅一对(used1/max3)再召 387 → 谁都不死(空槽允许第二对入板)', () => {
    const [t1, t2] = alive(387, 388);
    freeUpMinionsForSummon(387, [t1, t2], 3);
    expect([t1.dead, t2.dead]).toEqual([false, false]);
  });

  it('S4 非牺牲型不驱逐:shoot 1025(哨兵,MinionSacrificable 表外) → 整段跳过一个不杀', () => {
    // ProjectileID.cs:401 表(387/388 在表;1025 星旋炮台不在)→ :52371 门
    expect(MINION_SACRIFICABLE.has(387)).toBe(true);
    expect(MINION_SACRIFICABLE.has(388)).toBe(true);
    const [a, b] = alive(266, 375);
    freeUpMinionsForSummon(1025, [a, b], 1);
    expect([a.dead, b.dead]).toEqual([false, false]);
  });

  it('S5 max1 极限:266 满板(max1)再召 387 → 266 被逐、一对恰好占满 1 槽(0.5+0.5)', () => {
    const [a] = alive(266);
    freeUpMinionsForSummon(387, [a], 1);
    expect(a.dead).toBe(true);
  });

  it('BJ689-S6 0.5 槽粒度锁（非本家路径,原版升序照钉）:孤残 387+266 混板(max2)再召 375 → 先杀 0.5 槽孤残、266 存活', () => {
    // ★BJ710-A 改判随迁:原 S6（incoming=387）断言面已被分歧分区改写（387 属
    //   incoming 家族受保护→死 266）,粒度锁改钉【非本家路径】incoming=375:
    //   family(375)={375} → 全池异型=原版升序铁律照旧。腾位需求=1.5−(2−1)=0.5:
    //   杀池首 0.5 槽孤残 387 即够;若 387/388 被误计 1.0,稳定序=[266,387] →
    //   死 266(粒度翻转必红)。
    const [a, orphan] = alive(266, 387);
    freeUpMinionsForSummon(375, [a, orphan], 2);
    expect(orphan.dead).toBe(true);
    expect(a.dead).toBe(false);
  });

  it('BJ689-S7 成对生成结构锁:一次用杖双 SpawnMinionOnCursor(387+388)+驱逐调用+buff 表', () => {
    // Player.cs:48957-48966:2535 双 SpawnMinionOnCursor(387 与 shoot+1=388);
    // 结构锁防「只召一只」回归(弹载体错误五起判例:写码前必 grep)
    const src = readFileSync(GT, 'utf8');
    expect(src).toContain('if (cw.shoot === 387) {\n          spawnMinion(387);\n          spawnMinion(388);');
    // 出手前驱逐接线(:43109-43111 先于 :43115)
    expect(src).toContain('freeUpMinionsForSummon(cw.shoot, minions, this.player.maxMinions)');
    // 伴生 buff 表条目(buff 134/staff 2535/projs [387,388],UpdateBuffs :10248-10256)
    expect(src).toContain('{ buff: 134, staff: 2535, projs: [387, 388] }');
    // 槽位权重表( Projectile.cs:4709/4725=0.5f,1456 :4434/:4450)
    expect(src).toContain('if (m.projId === 387 || m.projId === 388) return 0.5;');
  });
});

// ===================== 变异自证(withMutation 三层守卫+sha256 对拍) =====================
describe.skipIf(process.env.SW_BJ689_MUT)('BJ689 变异自证(三发恰红+逐字节还原 sha256)', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj689-optic-staff-slots.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_BJ689_MUT: '1' },   // ★子进程豁免变异面
    });

  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    let pristineSha = '';
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, {
      label: `BJ689 ${filter}`,
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    // 逐字节还原对拍(BJ662 判例:锁内重读,消除释放→重读间隙竞态)
    lockTargetFile(file, `BJ689 还原对拍 ${filter}`);
    try {
      const post = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(post, `还原对拍 ${file}`).toBe(pristineSha);
    } finally {
      unlockTargetFile(file);
    }
  };

  it('M1 分区倒置(先同型后异型=回退原版 5+1) → S2 连用置换锁红(本判别锁的承重墙)', () => {
    // ★BJ710-A 改判随迁:原 M1（池升序→降序）靶面已被分歧分区接管——S2 断言面
    //   改分歧语义后,池内倒置不再可判（异型遍内同权稳定序不变）。新承重墙=
    //   evictOrder 分区序:倒置(同型先)即回退 BJ689 时代原版相 5+1 行为 → S2 必红。
    mutate(GT,
      `const evictOrder = [
    ...finalPool.filter((m) => !fam.has(m.projId)),
    ...finalPool.filter((m) => fam.has(m.projId)),
  ];`,
      `const evictOrder = [
    ...finalPool.filter((m) => fam.has(m.projId)),
    ...finalPool.filter((m) => !fam.has(m.projId)),
  ];`,
      'BJ689-S2');
  });

  it('M2 双子槽 0.5→1.0 → S6 粒度锁红', () => {
    mutate(GT,
      'if (m.projId === 387 || m.projId === 388) return 0.5;   // :4434/:4450',
      'if (m.projId === 387 || m.projId === 388) return 1;   // :4434/:4450 BJ689-M2',
      'BJ689-S6');
  });

  it('M3 对生成摘除 388 → S7 结构锁红', () => {
    mutate(GT,
      'if (cw.shoot === 387) {\n          spawnMinion(387);\n          spawnMinion(388);',
      'if (cw.shoot === 387) {\n          spawnMinion(387);',
      'BJ689-S7');
  });
});
