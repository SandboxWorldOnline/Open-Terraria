// ★BJ245（2026-09-21）光照域两缺口清偿——三面行为锁：
//   ① 833-835 沙漠虎自发光（BJ235 登记债）：AI_067 flag3 支 ai[0]!=4 门内逐型
//      Lighting.AddLight（1457 Projectile.cs:50164 门/:50174-50185 三型;
//      1458 :50175-50186 同文零变更）：
//        833 = Vector3.One×0.5 / 834 = Vector3.One×0.8
//        835 = Color.Lerp(OurFavoriteColor(255,231,69),White,0.8).ToVector3()×1
//            = (255,250.2,217.8)/255（Main.cs:886 OurFavoriteColor）
//      ——本仓通道 = MinionProj.lightRGB（Game 实体点光循环 Game.ts:11305 消费,
//      同 755/613/623 既有口径）;ai[0]==4（链发后等待态）原版不发光。
//   ② 811 判镰白化 k 衰减（BJ109 域勘误）：ai0 写入方 = AI_001 flag3 缺省支
//      ai[0]++（P.cs:57019-57021,排除表 :56931-57018 无 811——旧注「全域无写入
//      方→恒 1.0」勘误）;k=Utils.Remap(ai0,0,15,1,0.3)（Utils.cs:345）=
//      1−0.7·clamp01(ai0/15),消费双点 = Dart.draw 白化 filter（Main.cs:30847
//      projectileColor 链）+ Renderer.SELF_LUMINOUS_PROJS[811] 光地板。
//      ai0 ≡ Dart.age（1 基逐拍;811 无 extraUpdates）。
// 变异判别：①摘 834 值红/摘 ai[0]!=4 门红 ②k 常数化红/尾值 0.3→0.5 红。
import { describe, it, expect, beforeAll } from 'vitest';
import { MinionProj } from '../src/entities/MinionProj';
import { DART_STYLE, whiteK811 } from '../src/entities/Dart';

// Renderer 深导入较重（Image 桩链）,白化 filter 结构锁走源码面;
// 光地板序列锁在 self-luminous-floor.test.ts（BJ245 块已扩）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const DART_TS = readFileSync(join(import.meta.dirname, '../src/entities/Dart.ts'), 'utf8');

/** 最小随从假体（构造签名 :4402;owner 闭包不触 Player） */
const minion = (id: number): MinionProj =>
  new MinionProj(0, 0, id, 10, 1, false, 0, false, () => null);
const setA0 = (m: MinionProj, v: number) => { (m as unknown as { tigerA0: number }).tigerA0 = v; };
const lightOf = (m: MinionProj): [number, number, number] | null =>
  (m as unknown as { lightRGB: [number, number, number] | null }).lightRGB;

describe('BJ245-① 沙漠虎 833-835 自发光（AI_067 :50174-50185 钉值）', () => {
  it('833 = 白光 0.5（Vector3.One×0.5f）', () => {
    const m = minion(833);
    setA0(m, 0);
    const l = lightOf(m);
    expect(l).not.toBeNull();
    expect(l![0]).toBeCloseTo(0.5, 9);
    expect(l![1]).toBeCloseTo(0.5, 9);
    expect(l![2]).toBeCloseTo(0.5, 9);
  });
  it('834 = 白光 0.8（Vector3.One×0.8f）', () => {
    const m = minion(834);
    setA0(m, 2);
    const l = lightOf(m);
    expect(l![0]).toBeCloseTo(0.8, 9);
    expect(l![1]).toBeCloseTo(0.8, 9);
    expect(l![2]).toBeCloseTo(0.8, 9);
  });
  it('835 = Lerp(OurFavoriteColor,White,0.8) 暖白黄 (255,250.2,217.8)/255', () => {
    const m = minion(835);
    setA0(m, 1);
    const l = lightOf(m);
    expect(l![0]).toBeCloseTo(255 / 255, 9);
    expect(l![1]).toBeCloseTo(250.2 / 255, 9);   // 231+(255−231)×0.8
    expect(l![2]).toBeCloseTo(217.8 / 255, 9);   // 69+(255−69)×0.8
  });
  it('ai[0]==4 门（链发后等待态）三型全灭——原版 ai[0]!=4f 门 :50164', () => {
    for (const id of [833, 834, 835]) {
      const m = minion(id);
      setA0(m, 4);
      expect(lightOf(m), `id=${id} 等待态不发光`).toBeNull();
    }
  });
  it('门只对 ai0==4 收紧：其余状态（0/5 等）照亮', () => {
    const m = minion(834);
    setA0(m, 5);
    expect(lightOf(m)).not.toBeNull();
  });
});

describe('BJ245-② 811 判镰 k 衰减（Remap(ai0,0,15,1,0.3),ai0≡age）', () => {
  it('whiteK811 序列钉值：0→1.0 / 1→1−0.7/15 / 15→0.3 / >15 钳尾', () => {
    expect(whiteK811(0)).toBeCloseTo(1.0, 9);
    expect(whiteK811(1)).toBeCloseTo(1 - 0.7 / 15, 9);
    expect(whiteK811(5)).toBeCloseTo(1 - 0.7 * (5 / 15), 9);
    expect(whiteK811(14)).toBeCloseTo(1 - 0.7 * (14 / 15), 9);
    expect(whiteK811(15)).toBeCloseTo(0.3, 9);
    expect(whiteK811(16)).toBeCloseTo(0.3, 9);
    expect(whiteK811(1200)).toBeCloseTo(0.3, 9);
    expect(whiteK811(-3)).toBeCloseTo(1.0, 9);   // 负龄钳上端（防御）
  });
  it('DART_STYLE[811] 白化已动态化（表值不再钉 1.0;814 恒 0.35 不涉）', () => {
    expect(DART_STYLE[811].whiteLerp, '811 改走 draw 内 whiteK811(age) 动态支').toBeUndefined();
    expect(DART_STYLE[814].whiteLerp).toBeCloseTo(0.35, 9);
  });
  it('draw 消费位结构锁：lerpK811 首支 = 811 → whiteK811(this.age)（BJ668b 件2 两遍制形态）', () => {
    // ★BJ703-F 锁勘误（2026-10-21,存量红分诊=锁陈旧非回归）：BJ668b 件2（2026-10-13,
    //  BJ667 债④）把 811/814 白化从静态 whiteFilter 滤镜改道 BJ668 两遍制算子
    //  （基底 brightness(1−k)×ga + projFullbrightQueue 'lighter' ×k 光照后复绘 →
    //  base×light+lift ≡ Lerp(light,White,k)——旧滤镜白抬升被 compositeLight 乘光
    //  归零病根根除;行为面全锁=tests/bj668b-tail-clearance.test.ts 件2）。本结构锁
    //  跟随新形态:k 源仍=811 → whiteK811(this.age) 动态（Remap 链不变）。
    const i = DART_TS.indexOf('const lerpK811 =');
    expect(i).toBeGreaterThan(-1);
    const seg = DART_TS.slice(i, i + 240);
    expect(seg).toContain('this.projId === 811');
    expect(seg).toContain('whiteK811(this.age)');
    expect(seg.indexOf('this.projId === 811')).toBeLessThan(seg.indexOf('st.whiteLerp'));
    // 两遍制消费位:基底 filter=brightness(1−k) + lift 闭包 'lighter' ×k
    const j = DART_TS.indexOf('const whiteFilter =', i);
    const seg2 = DART_TS.slice(j, j + 400);
    expect(seg2).toContain('is596');
    expect(DART_TS.indexOf('brightness(${Math.max(0, 1 - lerpK811)')).toBeGreaterThan(-1);
    expect(DART_TS.indexOf('queueProjFullbright')).toBeGreaterThan(-1);
  });
});
