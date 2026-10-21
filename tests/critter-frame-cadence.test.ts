// 小动物行走帧速档回归（2026-08-18 用户报"走路的金鱼鬼畜"）：
//  aiStyle=7 小动物曾被城镇 NPC 档（帧2起/|vx|*2+1/阈值6）截胡 = 2-3 倍速闪帧；
//  游泳族曾被通用 t/4 档通吃（原版多为 6t 且湿/离水分帧）。
//  此处逐档钉住 FindFrame 专属 case 的节拍（NPC.cs 行号见 Renderer 注释）。
import { describe, expect, it } from 'vitest';
import { vanillaFrameIdx } from '../src/render/Renderer';
import type { Enemy } from '../src/entities/Enemy';

type Shell = Partial<Enemy> & { vanillaId: number; aiStyle: number };
function shell(vanillaId: number, aiStyle: number, o: Partial<Enemy> = {}): Enemy {
  return {
    vanillaId, animT: 0, walkCycleT: 0, vx: 1, vy: 0, onGround: true, wet: false,
    customFrameIdx: null, ai0: 0, ai2: 0,
    vanilla: { aiStyle } as Enemy['vanilla'],
    ...o,
  } as unknown as Enemy;
}

describe('小动物帧速档（FindFrame 专属 case）', () => {
  it('行走金鱼 230/593：|vx|*2+1 累计、>10 才进帧（非城镇档 2 起步 3 倍速）', () => {
    const e = shell(230, 7, { vx: 1 });
    // counter ≡ walkCycleT*2 + t：0 与 10 都还在帧 0，11 才进帧 1
    e.walkCycleT = 0; e.animT = 0; expect(vanillaFrameIdx(e, 6)).toBe(0);
    e.walkCycleT = 5; e.animT = 0; expect(vanillaFrameIdx(e, 6)).toBe(0);   // counter=10
    e.walkCycleT = 5.5; e.animT = 0; expect(vanillaFrameIdx(e, 6)).toBe(1); // counter=11
    // 全帧循环（0..5）
    e.walkCycleT = 33; e.animT = 0; expect(vanillaFrameIdx(e, 6)).toBe(0);  // 66/11=6 → %6=0
    // 腾空=帧0（非城镇档腾空帧1）
    expect(vanillaFrameIdx(shell(230, 7, { onGround: false }), 6)).toBe(0);
    expect(vanillaFrameIdx(shell(593, 7, { walkCycleT: 22 }), 6)).toBe(4); // counter=44 → 4/6
  });

  it('企鹅 148：counter=|vx| 相位 0/1/2（15 回卷），腾空=帧2', () => {
    const p = shell(148, 7, { vx: 1 });
    p.walkCycleT = 0; expect(vanillaFrameIdx(p, 12)).toBe(0);
    p.walkCycleT = 6; expect(vanillaFrameIdx(p, 12)).toBe(1);
    p.walkCycleT = 13; expect(vanillaFrameIdx(p, 12)).toBe(2);
    p.walkCycleT = 15; expect(vanillaFrameIdx(p, 12)).toBe(0);   // 回卷
    expect(vanillaFrameIdx(shell(148, 7, { onGround: false }), 12)).toBe(2);
  });

  it('松鼠 299：|vx|*0.5+1、>6 进帧，循环回卷帧 1（跳过 0）；腾空 vy>0=帧4', () => {
    const s = shell(299, 7, { vx: 1 });
    expect(vanillaFrameIdx(s, 6)).toBe(1);                        // 起步帧 1（非城镇帧 2）
    s.walkCycleT = 12; s.animT = 1; expect(vanillaFrameIdx(s, 6)).toBe(2); // counter=7
    expect(vanillaFrameIdx(shell(299, 7, { onGround: false, vy: 1 }), 6)).toBe(4);
    expect(vanillaFrameIdx(shell(639, 7, { walkCycleT: 12, animT: 1 }), 6)).toBe(2); // 宝石松鼠同档
  });

  it('鼠族 300/447/610：站定嗅探 0/1 @9t；行走回卷帧 2', () => {
    const m = shell(300, 7, { vx: 0 });
    m.animT = 0; expect(vanillaFrameIdx(m, 6)).toBe(0);
    m.animT = 9; expect(vanillaFrameIdx(m, 6)).toBe(1);
    const w = shell(300, 7, { vx: 1 });
    expect(vanillaFrameIdx(w, 6)).toBe(2);
    w.walkCycleT = 12; w.animT = 1; expect(vanillaFrameIdx(w, 6)).toBe(3); // counter=7
    expect(vanillaFrameIdx(shell(610, 7, { vx: 0, animT: 9 }), 6)).toBe(1);
  });

  it('蛙族 361/445/687：wet 按 |vx| 分档 10/11/12；行走相位 [0,6,8,9]；腾空 vy>0=帧9', () => {
    expect(vanillaFrameIdx(shell(361, 7, { wet: true, vx: 0.3 }), 13)).toBe(10);
    expect(vanillaFrameIdx(shell(361, 7, { wet: true, vx: 0.2 }), 13)).toBe(11);
    expect(vanillaFrameIdx(shell(361, 7, { wet: true, vx: 0 }), 13)).toBe(12);
    const f = shell(361, 7, { vx: 1 });
    f.animT = 0; expect(vanillaFrameIdx(f, 13)).toBe(0);
    f.animT = 6; expect(vanillaFrameIdx(f, 13)).toBe(6);
    f.animT = 12; expect(vanillaFrameIdx(f, 13)).toBe(8);
    f.animT = 18; expect(vanillaFrameIdx(f, 13)).toBe(9);
    f.animT = 24; expect(vanillaFrameIdx(f, 13)).toBe(0);   // 相位回卷
    expect(vanillaFrameIdx(shell(361, 7, { onGround: false, vy: 1 }), 13)).toBe(9);
  });

  it('行走鸟 362/602/608：站定帧0；行走循环带 3..9（4t 一帧）', () => {
    expect(vanillaFrameIdx(shell(602, 7, { vx: 0 }), 15)).toBe(0);
    const b = shell(602, 7, { vx: 1 });
    b.animT = 0; expect(vanillaFrameIdx(b, 15)).toBe(3);
    b.animT = 4; expect(vanillaFrameIdx(b, 15)).toBe(4);
    b.animT = 28; expect(vanillaFrameIdx(b, 15)).toBe(3);   // 带内回卷
  });

  it('龟 616/617/625：帧域直读 Enemy.turtleFrame（BJ700b 状态机；帧行 clamp）', () => {
    // BJ700b（2026-10-20）起龟族帧行由 Enemy.turtleFindFrameStep 逐字维护（站定/腾空
    // 双钉重启、湿泳带/陆带分档、落地蜷壳定拍——节拍锁全量在
    // tests/bj700b-jungle-turtle.test.ts）。本档只锁 Renderer 直读 + 越界上限 clamp
    // （旧 animT 相位档断言已随状态机退役;曾 NaN = shell 未带 turtleFrame 字段的
    // 先存红,bj700b 换契约时漏更此锁,BJ703-C 2026-10-21 修复）。
    expect(vanillaFrameIdx(shell(616, 7, { vx: 1, turtleFrame: 3 }), 14)).toBe(3);
    expect(vanillaFrameIdx(shell(617, 7, { wet: true, vx: 1, turtleFrame: 9 }), 14)).toBe(9);
    expect(vanillaFrameIdx(shell(616, 7, { vx: 0, turtleFrame: 0 }), 14)).toBe(0);
    expect(vanillaFrameIdx(shell(625, 7, { wet: true, vx: 1, turtleFrame: 7 }), 12)).toBe(7);
    expect(vanillaFrameIdx(shell(625, 7, { vx: 1, turtleFrame: 99 }), 12)).toBe(11);   // clamp frames-1
  });

  it('海豚 615：搁浅帧4；wet 7t 一帧', () => {
    expect(vanillaFrameIdx(shell(615, 16, { wet: false, ai2: 1 }), 5)).toBe(4);
    const d = shell(615, 16, { wet: true });
    d.animT = 0; expect(vanillaFrameIdx(d, 5)).toBe(0);
    d.animT = 7; expect(vanillaFrameIdx(d, 5)).toBe(1);
  });

  it('鱼族 55：wet 帧0..3 @6t；离水折腾帧 4/5 @6t（不再 4t 连闪）', () => {
    const wet = shell(55, 16, { wet: true, vx: 0 });
    wet.animT = 0; expect(vanillaFrameIdx(wet, 6)).toBe(0);
    wet.animT = 6; expect(vanillaFrameIdx(wet, 6)).toBe(1);
    wet.animT = 24; expect(vanillaFrameIdx(wet, 6)).toBe(0);
    const dry = shell(55, 16, { wet: false, vx: 0 });
    dry.animT = 0; expect(vanillaFrameIdx(dry, 6)).toBe(4);
    dry.animT = 6; expect(vanillaFrameIdx(dry, 6)).toBe(5);
    dry.animT = 12; expect(vanillaFrameIdx(dry, 6)).toBe(4);
  });

  it('鲨鱼 65：wet 6t 一帧；沙鲨 542 4t 一帧不变', () => {
    expect(vanillaFrameIdx(shell(65, 16, { wet: true, animT: 6 }), 4)).toBe(1);
    expect(vanillaFrameIdx(shell(65, 16, { wet: false }), 4)).toBe(3);
    expect(vanillaFrameIdx(shell(542, 16, { animT: 4 }), 4)).toBe(1);
  });

  it('仙灵 583-585：4t 一帧全循环（cs:70617-70630;曾落 6t 兜底=拍翅慢 1.5×）', () => {
    const f = shell(583, 112, { vx: 1 });
    f.animT = 0; expect(vanillaFrameIdx(f, 4)).toBe(0);
    f.animT = 3; expect(vanillaFrameIdx(f, 4)).toBe(0);   // counter<4 仍帧0
    f.animT = 4; expect(vanillaFrameIdx(f, 4)).toBe(1);
    f.animT = 8; expect(vanillaFrameIdx(f, 4)).toBe(2);
    f.animT = 16; expect(vanillaFrameIdx(f, 4)).toBe(0);  // 4 帧回卷
    for (const id of [584, 585]) {
      expect(vanillaFrameIdx(shell(id, 112, { animT: 12 }), 4)).toBe(3);
    }
  });
});
