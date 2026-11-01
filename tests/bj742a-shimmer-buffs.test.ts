// ★BJ742-A R20-③ + R21-④/⑥（2026-10-31 红蓝清偿）：微光闪避 AllowShimmerDodge 参数门
// + BUFF_NO_SAVE 补 7 员 + toSave tick 精度。
//
// 原版锚（Terarria1457 亲读）：
//   · R20-③ Player.cs:38484 `if (shimmering && AllowShimmerDodge(damageSource,
//     cooldownCounter, dodgeable)) return 0.0;` + :39049-39058 参数门（!dodgeable →
//     false;cooldownCounter==1 → false）。1 = ImmunityCooldownID.BossNoCheese
//     （ImmunityCooldownID.cs:52）——月总族接触 Update_NPCCollision :31571-31587 /
//     敌弹族 Damage_EVP 分槽走该桶;圣骑士盾转移包 :38649 实参 dodgeable:false。
//     源实体三查门（:39059-39072 boss/入侵/CanHitPastShimmer）= D-BJ742-③ 登记债。
//   · R21-④ Main.cs:9124 buffNoSave[156] / :9125 [149] / :9137 [395] / :9205-9208
//     [397][398][399][400]（+ :9209-9212 for 173-181 循环段——非多收,备案勿动）。
//   · R21-⑥ Player.cs:55518-55530 写 / :56243-56252 读——buffType Int32 + buffTime
//     Int32【tick 域】往返逐位无损;旧 Math.round(sec) 整秒化=每 buff 至多 +0.5s
//     膨胀（ApplyPotionDelay :52487-52516 的 2400-4200 随机 tick 档系统性偏移）。
//
// 变异恰红映射：
//   M1 微光门回无条件早退           → S2/S3 红
//   M2 BUFF_NO_SAVE 撤 7 员         → S5 红
//   M3 toSave 回整秒取整            → S7/S8 红
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { BuffState, BuffType, BUFF_NO_SAVE } from '../src/stats/Buffs';
import {
  HurtCooldownBuckets, registerGlobalHurtBuckets, ImmunityCooldownID,
} from '../src/player/HurtCooldownBuckets';
import { withMutation, lockTargetFile, unlockTargetFile } from './mutation-guard';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = (p: string): string => readFileSync(join(ROOT, 'src', p), 'utf8');
const PT = join(ROOT, 'src', 'entities', 'Player.ts');
const BT = join(ROOT, 'src', 'stats', 'Buffs.ts');

// ===================== ① 微光闪避参数门（Player.cs:38484+:39049-39058） =====================
describe('BJ742-A① 微光闪避 AllowShimmerDodge 参数门', () => {
  const mkP = (): Player => new Player(500, 500, new Inventory());

  it('S1 基线：shimmering + dodgeable 缺省 + General 桶 → 完全免伤（return 0）', () => {
    const p = mkP();
    p.shimmering = true;
    const hp0 = p.hp;
    expect(p.damage(30, 520, 520)).toBe(0);
    expect(p.hp).toBe(hp0);
  });

  it('S2 !dodgeable（圣骑士盾转移包 :38649 实参）→ 照常受伤', () => {
    const p = mkP();
    p.shimmering = true;
    const hp0 = p.hp;
    const dealt = p.damage(30, 520, 520, true, false, -1, false);
    expect(dealt).toBeGreaterThan(0);
    expect(p.hp).toBeLessThan(hp0);
  });

  it('S3 BossNoCheese 桶（cooldownCounter==1 / __swNextHitBucket 注入两道）→ 照常受伤', () => {
    // 道 A：cooldownCounter 参直传（Hurt 形参位）
    const a = mkP();
    a.shimmering = true;
    const hpA = a.hp;
    expect(a.damage(30, 520, 520, true, false, ImmunityCooldownID.BossNoCheese)).toBeGreaterThan(0);
    expect(a.hp).toBeLessThan(hpA);
    // 道 B：瞬态通道注入（Enemy 接触链/damageEvPNoCheese 的仓内等价形）
    const t = new HurtCooldownBuckets();
    registerGlobalHurtBuckets(t);
    const b = mkP();
    b.shimmering = true;
    const chan = b as unknown as { __swNextHitBucket?: { id: number; table: HurtCooldownBuckets } | undefined };
    chan.__swNextHitBucket = { id: ImmunityCooldownID.BossNoCheese, table: t };
    try {
      const hpB = b.hp;
      expect(b.damage(30, 520, 520)).toBeGreaterThan(0);
      expect(b.hp).toBeLessThan(hpB);
    } finally {
      chan.__swNextHitBucket = undefined;
    }
  });

  it('S4 非 BossNoCheese 特殊桶（Lava=4）不拦微光（:39055 只认 ==1）', () => {
    const t = new HurtCooldownBuckets();
    registerGlobalHurtBuckets(t);
    const p = mkP();
    p.shimmering = true;
    const chan = p as unknown as { __swNextHitBucket?: { id: number; table: HurtCooldownBuckets } | undefined };
    chan.__swNextHitBucket = { id: ImmunityCooldownID.Lava, table: t };
    try {
      expect(p.damage(30, 520, 520)).toBe(0);   // Lava 桶 ≠ 1 → 微光照吃
    } finally {
      chan.__swNextHitBucket = undefined;
    }
  });
});

// ===================== ② BUFF_NO_SAVE 补 7 员（Main.cs:9124/9125/9137/9205-9208） =====================
describe('BJ742-A② BUFF_NO_SAVE 七员', () => {
  it('S5 七员在册：156 Stoned/149 Webbed/395 PotentAcid/397-400（存档/读档双向过滤）', () => {
    for (const v of [149, 156, 395, 397, 398, 399, 400]) {
      expect(BUFF_NO_SAVE.has(v), `vanilla buff ${v} 须在 no-save 名单`).toBe(true);
    }
    // toSave 落盘排除（Stoned 156）
    const b = new BuffState();
    b.apply(BuffType.Stoned, 10);
    b.apply(BuffType.WellFed, 100);
    const saved = b.toSave();
    expect(saved.some(([v]) => v === 156)).toBe(false);
    expect(saved.some(([v]) => v === 26)).toBe(true);
    // applySaved 读档排除（Webbed 149）
    const c = new BuffState();
    c.applySaved([[149, 5], [26, 5]]);
    expect(c.has(BuffType.Webbed)).toBe(false);
    expect(c.has(BuffType.WellFed)).toBe(true);
  });

  it('S6 173-181 循环段保持（原版 :9209-9212 for 循环——R21「多收」判语勘误备案）', () => {
    for (let v = 173; v <= 181; v++) expect(BUFF_NO_SAVE.has(v)).toBe(true);
    // 反对照：相邻未入名单的持久 buff（26 WellFed 原版可存档）
    expect(BUFF_NO_SAVE.has(26)).toBe(false);
  });
});

// ===================== ③ toSave tick 精度（Player.cs:55518-55530/56243-56252） =====================
describe('BJ742-A③ toSave tick 精度', () => {
  it('S7 tick 网格保真：2450t（药水病 2400-4200 随机档中值域）→ 2450/60s 逐位往返', () => {
    const b = new BuffState();
    b.set(BuffType.Resistance, 2450 / 60);   // 直写剩余秒（buffTime 赋值语义）
    const saved = b.toSave();
    expect(saved).toEqual([[21, 2450 / 60]]);   // 21 药水病可存档;值=2450/60≠41（旧整秒化膨胀 +10t）
    // 读档往返（applySaved 直收浮点）
    const c = new BuffState();
    c.applySaved(saved);
    expect(c.active.get(BuffType.Resistance)).toBeCloseTo(2450 / 60, 12);
  });

  it('S8 亚半秒残余：70t → 70/60s（旧 Math.round(70/60)=1s=+60t 膨胀）;亚 0.05s 过滤保持', () => {
    const b = new BuffState();
    b.set(BuffType.Resistance, 70 / 60);
    expect(b.toSave()).toEqual([[21, 70 / 60]]);
    b.set(BuffType.Resistance, 2 / 60);      // 2t 环境光环续钉稳态——不落盘（既有行为）
    expect(b.toSave()).toEqual([]);
  });
});

// ===================== ④ 变异恰红 =====================
describe.skipIf(process.env.SW_BJ742A_MUT)('BJ742-A④ 变异自证（三发恰红+逐字节还原）', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj742a-shimmer-buffs.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_BJ742A_MUT: '1' },
    });

  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    let pristineSha = '';
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, {
      label: `BJ742A ${filter}`,
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    lockTargetFile(file, `BJ742A 还原对拍 ${filter}`);
    try {
      const post = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(post, `还原对拍 ${file}`).toBe(pristineSha);
    } finally {
      unlockTargetFile(file);
    }
  };

  it('M1 微光门回无条件早退 → S2/S3 红（转移包/月总桶被微光吞）', () => {
    // ★G39-A 改判史（2026-11-01,bj742a D-③ 清偿）：注入串随判据扩形重锚——
    // 微光门新增源实体三查位 `&& !shmSrcNoDodge`（AllowShimmerDodge :39059-39072）,
    // 旧串不含该后缀=盘面漂移误报。变异语义不变（回无条件早退=吞转移包/月总桶）。
    mutate(PT,
      'if (this.shimmering && dodgeable && shmEffCc !== ImmunityCooldownID.BossNoCheese && !shmSrcNoDodge) return 0;',
      'if (this.shimmering) return 0;   // BJ742A-M1',
      'S2 !dodgeable（圣骑士盾转移包');
  });

  it('M2 BUFF_NO_SAVE 撤 7 员 → S5 红（Stoned 跨存档落盘）', () => {
    mutate(BT,
      '  149, 156, 395, 397, 398, 399, 400,',
      '  // BJ742A-M2 七员撤除',
      'S5 七员在册');
  });

  it('M3 toSave 回整秒取整 → S7/S8 红（半秒膨胀复活）', () => {
    mutate(BT,
      'out.push([v, Math.max(1 / 60, Math.round(sec * 60) / 60)]);',
      'out.push([v, Math.max(1, Math.round(sec))]);   // BJ742A-M3',
      'S7 tick 网格保真');
  });
});
