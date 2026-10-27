// SW-I1 2026-09-03：AI_016 投掷弹道四件回归（标杆 Terarria1457/Terraria/Projectile.cs）：
//  ① 重力门 :48377——手雷族 {30,397,517,588,779,783,862,863,1088} ai[0]>10 / 其余 >5
//     （★681 第二析取支排除表漏列 → 实际 >5;655=AI_025 无门）;门未开零重力
//  ② 飞行接触伤 0（:48046 damage=0 豁免表 + Damage_PVE damage<=0 早退 :12576）——
//     炸弹族接触零伤零钳引信,手雷族接触=注入伤+钳 3（:13153）
//  ③ 通用引信烟尘 :48285-48322——Next(2)==0 双尘齐出（31+num30）,排除表 10 型
//  ④ 519 帧动画 :47951-47970（阈值 (num12/10+6)/2、末 15t 双速、4 帧回绕 M.cs:8619）
import { describe, it, expect, vi } from 'vitest';   // ★BJ731:vi=DV 恒等档 mock
import { World } from '../src/world/World';
import { GrenadeProj, bombGravityGateOf, bombFuseSmokeTypeOf, bombFishFrameTick,
  BOMB_DAMAGE_KEEP_16 } from '../src/entities/WeaponProj';
import type { GameHooks } from '../src/entities/types';

function mkGame() {
  const dusts: Array<{ type: number; x: number; y: number; scale: number; noGravity: boolean }> = [];
  const w = new World(80, 60, 30, 'open');
  for (let x = 0; x < 80; x++) w.store.setTileSilent(x, 50, 1, 0, 0);
  const g = {
    world: w, player: null, enemies: () => [], critters: () => [],
    entities: { nextId: 1, add: () => {} }, cutTile: () => {},
    spawnDust: (_x: number, _y: number, _w: number, _h: number, type: number) => {
      const d = { type, x: 0, y: 0, scale: 1, noGravity: false };
      dusts.push(d); return d;
    },
  } as unknown as GameHooks;
  return { g, dusts };
}

describe('SW-I1 AI_016 投掷弹道四件', () => {
  it('重力门分型（:48377）：28/519=5、30/397=10、681 漏列落 5、655 无门；28 第 6 拍/30 第 11 拍起 vy+0.2', () => {
    expect([28, 519, 29, 773, 911, 1087, 75].map(bombGravityGateOf)).toEqual([5, 5, 5, 5, 5, 5, 5]);
    expect([30, 397, 517, 588, 779, 862, 1088].map(bombGravityGateOf)).toEqual([10, 10, 10, 10, 10, 10, 10]);
    expect([bombGravityGateOf(681), bombGravityGateOf(655)]).toEqual([5, null]);
    const run = (id: number, ticks: number) => {
      const { g } = mkGame();
      const p = new GrenadeProj(640, 704, 3, 0, 100, 180, id, () => {});
      for (let i = 0; i < ticks; i++) p.fixedUpdate(0, g);
      return p.vy;
    };
    expect([run(28, 5), run(28, 6)]).toEqual([0, 0.2]);    // 炸弹族直飞 5 拍
    expect([run(30, 10), run(30, 11)]).toEqual([0, 0.2]);  // 手雷族直飞 10 拍
  });
  it('飞行接触伤：28 碰敌零伤零钳引信（:12576 早退）/ 30 碰敌结算+钳 3（:13153）', () => {
    expect([28, 37, 516, 519, 29, 470, 637, 773, 903, 910, 1086, 1087].map((t) => BOMB_DAMAGE_KEEP_16.has(t)))
      .toEqual([false, false, false, false, false, false, false, false, false, false, false, false]);
    expect([30, 397, 517, 588, 75, 1088, 134, 930].map((t) => BOMB_DAMAGE_KEEP_16.has(t)))
      .toEqual([true, true, true, true, true, true, true, true]);
    const mk = (id: number) => {
      const env = mkGame();
      const hurt: number[] = [];
      (env.g as unknown as { enemies: () => unknown[] }).enemies = () => [{
        x: 630, y: 694, w: 20, h: 20, dead: false, hurt: (d: number) => { hurt.push(d); return true; },
      }];
      const p = new GrenadeProj(640, 704, 0, 0, 100, 180, id, () => {});
      p.contactKb = 2;
      p.fixedUpdate(0, env.g);
      return { hurt, fuse: p.fuse };
    };
    expect(mk(28)).toEqual({ hurt: [], fuse: 179 });
    // SW-L1 2026-09-03 I-2：爆点判前移（--fuse≤2 ≡ 原版 AI timeLeft≤3 先于尾减）,
    //   接触段随之移至爆点判后——首拍 180→179（不爆）→ 接触钳 3,终值=3;
    //   次拍 --fuse→2≤2 爆 = 原版 Damage 钳后次拍 AI Kill 同拍
    // ★BJ731 改判史（2026-10-27）：BJ723-B W01（2026-10-26）起 Damage_PVE_Inner
    //   :12970 每靶掷 DamageVar（damageVarRoll ±15% 31 档）——未 mock 时接触伤
    //   100 必漂（85-115）。0.5 → tier 0 → ×1.0 恒等档（a-batch2 :134 同款修法）。
    const rvi731 = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      expect(mk(30)).toEqual({ hurt: [100], fuse: 3 });
    } finally { rvi731.mockRestore(); }
  });
  it('引信烟尘（:48285-48322）：50%/t 双尘齐出、引信尖差 6.6px、排除表+num30 分型', () => {
    expect([30, 397, 517, 519, 588, 681, 779, 783, 862, 863, 1086, 655].map((t) => bombFuseSmokeTypeOf(t, 33)))
      .toEqual([null, null, null, null, null, null, null, null, null, null, null, null]);
    expect([28, 37, 516, 29, 470, 637, 75, 773, 904, 905, 910, 911, 903]
      .map((t) => bombFuseSmokeTypeOf(t, 33))).toEqual([6, 6, 6, 6, 6, 6, 6, 59, 35, 152, 0, 0, 33]);
    const env = mkGame();
    const p = new GrenadeProj(640, 640, 0, 0, 100, 3600, 28, () => {});
    for (let i = 0; i < 400; i++) p.fixedUpdate(0, env.g);
    const d31 = env.dusts.filter((d) => d.type === 31);
    const d6 = env.dusts.filter((d) => d.type === 6);
    expect(env.dusts.length).toBe(d31.length * 2);          // 双尘同拍齐出
    expect(d31.length).toBeGreaterThan(120);                // 期望 200（1 粒/2t）
    expect(d31.length).toBeLessThan(280);
    expect(d31[0].noGravity && d6[0].noGravity).toBe(true);
    expect(d31[0].y - d6[0].y).toBeCloseTo(6.6, 9);         // (h/2+6)×1.1 − (h/2)×1.1（主尘更靠上）
    expect(d31[0].scale).toBeGreaterThanOrEqual(0.1);
    expect(d6[0].scale).toBeLessThanOrEqual(1.4);
  });
  it('519 帧（:47951-47970）：首翻第 12 拍、节拍渐快、末 15t 双速、4 帧回绕；实例帧态绑定', () => {
    let st = { fuseAge: 0, counter: 0, frame: 0 };
    const flips: number[] = [];
    for (let t = 1; t <= 181; t++) {
      const prev = st.frame;
      st = bombFishFrameTick(st);
      if (st.frame !== prev) flips.push(t);
    }
    expect(flips.slice(0, 4)).toEqual([12, 23, 34, 44]);    // 阈值 (num12/10+6)/2
    expect(flips.slice(-3)).toEqual([177, 179, 181]);       // num12<15 双速 → 2t/帧
    expect(flips.every((t) => t >= 12)).toBe(true);
    const { g } = mkGame();
    const p = new GrenadeProj(640, 704, 0, 0, 100, 180, 519, () => {});
    for (let i = 0; i < 23; i++) p.fixedUpdate(0, g);
    expect(p.bombFishFrame).toBe(2);                        // 渲染侧 drawProj 帧参消费此态
  });
});
