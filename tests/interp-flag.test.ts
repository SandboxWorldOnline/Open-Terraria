// ★interp 渲染插值旗闸（2026-10-15 转正缺省开,?interp=0 逃生门）——最小锁:
//  缺省开（node 域 location 缺席恒 true;用户验收一期+二期①②后明令转正）。
//  帧序/像素闸=scripts/_interp-probe.mjs 活机七验（静止 A/B 逐字节/120fps 位差
//  在途/还原旁证/60fps A/B 逐字节/实体快照/还原健康）。
//  ★收益门（2026-10-24 用户实报「30fps 行走时画面幻影感/体验更差」定谳追加）:
//  插值只在渲染率>逻辑率 60Hz 时有中间帧收益;锁 30/60 档下 acc 累计器本已把
//  dt 抖动整步补偿成完美位移节奏,interp 的 alpha 游走反而【制造】9/5 交替步长
//  =3:2 pulldown 式重影（用户「幻影感」）+恒滞后 ≤1 tick 零收益。门=渲染帧距
//  EMA 迟滞闸,关=渲染 curr 位（与 ?interp=0 同路径）。数值定谳探针:
//  scripts/_interp-30fps-judder-probe.mjs（锁 30 量化形态 ON=std 1.04/33% 不规则
//  帧 vs OFF=完全均匀;120fps 对照两者皆均匀=插值收益域不受伤）。
import { describe, it, expect } from 'vitest';
import { Game } from '../src/core/Game';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/core/Game.ts'), 'utf8');

describe('interp 旗', () => {
  it('缺省开（?interp=0 才关;node 域恒 true——误关会立即爆红）', () => {
    expect(Game.interp).toBe(true);
  });
});

describe('interp 收益门（2026-10-24「30fps 幻影感」;渲染率≤逻辑率档禁插）', () => {
  it('门数据源在位:渲染帧距 EMA(0<dt<100 入账/首帧直填)+迟滞闸(开<13.4ms=120/144/90/75 档,关>14.6ms=60/50/48/30 档,带内保持)', () => {
    // EMA 更新与阈值判定（frame() 头,frameDts.push 旁）
    expect(SRC).toContain('if (dtMs > 0 && dtMs < 100) {');
    expect(SRC).toContain('this._renderDtEmaMs = this._renderDtEmaMs < 0 ? dtMs');
    expect(SRC).toContain('if (this._renderDtEmaMs < 13.4) this._interpGate = true;');
    expect(SRC).toContain('else if (this._renderDtEmaMs > 14.6) this._interpGate = false;');
  });
  it('消费点接线:iA 计算含 _interpGate（门关=−1→渲染 curr 位,与 ?interp=0 同路径;SwingArc 等绘制端消费面零改动兼容）', () => {
    expect(SRC).toContain('const iA = Game.interp && this._interpGate && this._iPX > -Infinity && !this.paused');
  });
  it('阈值谱带锚（防拍脑袋改阈伤 75Hz 档或放 60Hz 档进门）:开沿 13.4>75Hz 档周期 13.33;关沿 14.6<60Hz 档周期 16.67——两档各落带外/带内正确侧', () => {
    expect(13.4).toBeGreaterThan(1000 / 75);   // 75Hz=13.33 → 开
    expect(14.6).toBeLessThan(1000 / 60);      // 60Hz=16.67 → 关
    expect(14.6).toBeGreaterThan(13.4);        // 迟滞带非空
  });
});
