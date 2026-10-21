// ★BJ704-G14（2026-10-21）件2② [g11-trapshot-idstatic 残项②] CanReleaseNPCs
//   释放限流门清偿 判别锁。
//  原版（1457 亲读）：
//   · NPC.CanReleaseNPCs（NPC.cs:80887-80921）：num=0.7（单机 +0.05）→
//     num3=活 NPC 数 < 200×0.75=150 ∧ num2=本人已释放数 < floor(200×0.75/1)=150。
//   · 消费①ItemCheck_TryStartUse（Player.cs:52755-52758）：makeNPC>0 且超限 →
//     flag=false=使用整支不启动（无消耗/无动画/无释放）。
//   · 消费②ReleaseNPC 内门（NPC.cs:80930）：`(npcCatchable[Type] ∨ who==myPlayer)
//     ∧ CanReleaseNPCs(who)`——单机 who==myPlayer 恒真;超限返 -1 无生成。
//   · 仓内映射：释放域入口=spawnNpcByVanilla(released ∨ style)（1338 直放/鼠标格
//     通用支/Dart.ts 281 落定放兔）;NewNPC 域（微光 Transform/AnyNPCs）不入。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Game } from '../src/core/Game';

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const gameSrc = () => read('src/core/Game.ts');
const dartSrc = () => read('src/entities/Dart.ts');

/** Game 原型桩：只注入 canReleaseNpcs / spawnNpcByVanilla 消费面字段 */
function stubGame(buckets: { enemies?: unknown[]; critters?: unknown[]; npcs?: unknown[] } = {}) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  g.net = undefined;
  g.entities = {
    enemies: buckets.enemies ?? [],
    critters: buckets.critters ?? [],
    npcs: buckets.npcs ?? [],
    nextId: 1,
    add: () => {},
  };
  return g;
}
const npc = (o: Partial<{ dead: boolean; releasedFromItem: boolean }> = {}) => ({
  dead: false, releasedFromItem: false, ...o,
});
const canRelease = (g: Record<string, unknown>) =>
  (Game.prototype as unknown as { canReleaseNpcs: () => boolean }).canReleaseNpcs.call(g);

// ================================================================ §0 源锚/结构锁
describe('§0 源锚（双门位 + 释放域路由）', () => {
  it('[A] TryStartUse 门：释放臂头 canReleaseNpcs 早退（Player.cs:52755-52758）', () => {
    const s = gameSrc();
    expect(s).toContain('if (!this.canReleaseNpcs()) return;');
    // 在 CRITTER_RELEASE 臂内（makeNPC 域）——锚在 relNpc 判定之后
    const iRel = s.indexOf('const relNpc = CRITTER_RELEASE_BY_ITEM[relItemId];');
    const iGate = s.indexOf('if (!this.canReleaseNpcs()) return;');
    expect(iGate).toBeGreaterThan(iRel);
  });
  it('[B] ReleaseNPC 内门：spawnNpcByVanilla 释放域（NPC.cs:80930）', () => {
    expect(gameSrc()).toContain(
      'if ((released || style !== undefined) && !this.canReleaseNpcs()) return null;');
  });
  it('[C] Dart.ts 281 落定放兔走释放域（released=true 参）', () => {
    expect(dartSrc()).toContain(
      'spawnNpcByVanilla?.(614,\n          Math.trunc(this.cx), Math.trunc(this.y + this.h) - 4, undefined, true);');
  });
});

// ================================================================ §1 行为面
describe('§1 canReleaseNpcs（NPC.cs:80887-80921 单机 0.75 档）', () => {
  it('[A] 空场放行（active 0 < 150 ∧ released 0 < 150）', () => {
    expect(canRelease(stubGame())).toBe(true);
  });
  it('[B] 拥挤门：活 NPC 150 → 拒（active < 150 越界即拒）', () => {
    expect(canRelease(stubGame({ critters: Array.from({ length: 150 }, () => npc()) }))).toBe(false);
    expect(canRelease(stubGame({ critters: Array.from({ length: 149 }, () => npc()) }))).toBe(true);
  });
  it('[C] 本人预算门：已释放 150 → 拒（releasedFromItem=releaseOwner!=255 单机面）', () => {
    expect(canRelease(stubGame({ critters: Array.from({ length: 150 }, () => npc({ releasedFromItem: true })) }))).toBe(false);
    expect(canRelease(stubGame({ critters: Array.from({ length: 149 }, () => npc({ releasedFromItem: true })) }))).toBe(true);
  });
  it('[D] 三桶合计（enemies∪critters∪npcs=Main.npc 单数组全域）+ dead 剔除', () => {
    const g = stubGame({
      enemies: Array.from({ length: 80 }, () => npc()),
      critters: Array.from({ length: 50 }, () => npc()),
      npcs: Array.from({ length: 20 }, () => npc()),
    });
    expect(canRelease(g)).toBe(false);          // 80+50+20=150
    const g2 = stubGame({
      enemies: Array.from({ length: 79 }, () => npc()).concat([npc({ dead: true })]),
      critters: Array.from({ length: 50 }, () => npc()),
      npcs: Array.from({ length: 20 }, () => npc()),
    });
    expect(canRelease(g2)).toBe(true);          // 死亡不计（active 门）
  });
  it('[E] ReleaseNPC 内门行为：释放域超限返 null（NewNPC 域不受限）', () => {
    const g = stubGame({ critters: Array.from({ length: 150 }, () => npc()) }) as unknown as {
      spawnNpcByVanilla: (id: number, x: number, y: number, style?: number, released?: boolean) => unknown;
      net?: unknown; world?: unknown; entities?: unknown;
    };
    const spawn = (Game.prototype as unknown as { spawnNpcByVanilla: typeof g.spawnNpcByVanilla })
      .spawnNpcByVanilla;
    // 释放域（released=true / style 携带）超限 → null（无构造副作用——门在 Enemy 构造前）
    expect(spawn.call(g, 614, 100, 100, undefined, true)).toBeNull();
    expect(spawn.call(g, 356, 100, 100, 3)).toBeNull();
    // NewNPC 域（无 style 无 released）不入门——超限场照常出生（AnyNPCs 677 面等）
    const spawned = spawn.call(g, 677, 100, 100) as unknown as { vanillaId?: number } | null;
    expect(spawned).not.toBeNull();
  });
  it('[F] 释放域放行档：预算内正常出生（releasedFromItem 置位随迁）', () => {
    const g = stubGame({ critters: [npc()] }) as unknown as Record<string, unknown>;
    const spawn = (Game.prototype as unknown as { spawnNpcByVanilla: (id: number, x: number, y: number, style?: number, released?: boolean) => { releasedFromItem: boolean } | null })
      .spawnNpcByVanilla;
    const e = spawn.call(g, 614, 100, 100, undefined, true);
    expect(e).not.toBeNull();
    expect(e!.releasedFromItem).toBe(true);     // releaseOwner!=255（:48271 既有语义）
  });
});
