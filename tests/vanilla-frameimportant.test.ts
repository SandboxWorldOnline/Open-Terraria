// vanilla tileFrameImportant 权威表闸门（2026-10-24）。
// wire 帧门错一位=段流失步（rig 判例：消费超跑 32719/3991）。本闸门从 Terarria1458
// Main.cs 再提取权威集（字面量 + AddEchoFurnitureTile 调用族 + :10125 循环 435-439）
// 与 sections.ts 内嵌区间表对账——反编译树换版/表被手改当场爆红。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VANILLA_FRAME_IMPORTANT } from '../src/net/vanilla/sections';

const MAIN_CS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'Terarria1458', 'Terraria', 'Main.cs');

describe('vanilla tileFrameImportant 权威表闸门', () => {
  it('内嵌表 === Main.cs 再提取集（412 员,漂移即爆）', () => {
    const src = fs.readFileSync(MAIN_CS, 'utf8');
    expect(src.length).toBeGreaterThan(1_000_000); // 反编译树在位性门
    const auth = new Set<number>();
    for (const m of src.matchAll(/tileFrameImportant\[(\d+)\] = true/g)) auth.add(Number(m[1]));
    // AddEchoFurnitureTile(N) 调用族（helper 内为变量形态赋值,字面量 grep 不中）
    for (const m of src.matchAll(/AddEchoFurnitureTile\((\d+)\)/g)) auth.add(Number(m[1]));
    // :10125 循环 for (num2 = 435; num2 <= 439) tileFrameImportant[num2] = true
    for (let i = 435; i <= 439; i++) auth.add(i);
    expect(auth.size).toBe(412);
    for (let wt = 0; wt < 754; wt++) {
      expect(VANILLA_FRAME_IMPORTANT[wt] === 1, `tile ${wt}`).toBe(auth.has(wt));
    }
  });

  it('4 处引擎差集锚（引擎 TILE_DEFS.framed 与原版表的已知分歧,勿随手"修复"任一侧）', () => {
    // 19 Platforms / 380 PlanterBox：原版 true、引擎 false（引擎渲染自派生,渲染域债在档）
    expect(VANILLA_FRAME_IMPORTANT[19]).toBe(1);
    expect(VANILLA_FRAME_IMPORTANT[380]).toBe(1);
    // 32 CorruptThorns / 80 Cactus：原版 false（渲染期随机帧,非 wire 帧）、引擎 true
    expect(VANILLA_FRAME_IMPORTANT[32]).toBe(0);
    expect(VANILLA_FRAME_IMPORTANT[80]).toBe(0);
  });
});
