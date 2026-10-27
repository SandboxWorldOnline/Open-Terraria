// 哨兵携带配饰族 6172/6175/6176/6177——重定位几何 + 各 AI 携带支差异锁定
//（2026-09-03 批）。真值锚：
//   · CanGetPickedUpBySentryBackpack  Projectile.cs:80532-80552（拾起门）
//   · SetAsSelectedSentryBackpackTarget :80554-80557（每拍续约 2）
//   · AI_Sentries_HeavySlingReposition  :70096-70470（per-aiStyle/per-type 落位）
//       早退①aiStyle 123∪84 :70108-70126（641/643 头顶悬停）
//       早退②aiStyle 137     :70127-70137（688/689/690 心位）
//       早退③type 966        :70138-70150（num=21 上浮）
//       per-type 308/377      :70160-70182（vector/0.9h）
//       flag3=1025            :70184-70206（-25*dir、rot ±π/2）
//       flag4=aiStyle 134     :70207-70213（(0,-14)）
//       aiStyle 130           :70214-70227（(dir*10,-11) + 异向 -2*dir）
//       flag5=aiStyle 138     :70228-70250（(-9*dir,±2) + rot 4.712389/π÷2）
//   · 各 AI 携带支：AI_130 :69348-69357 朝向回写 / AI_134 :69615-69623（已接）/
//     AI_053 :37996-38002 朝向回写 / AI_197 :41068-41097 朝向+rot / AI_138
//     :70394-70411 num3=20+num2-=14 探测盒
// 实现落点：src/entities/MinionProj.ts（heavySlingReposition + 各族携带支）。
import { describe, it, expect, vi } from 'vitest';
import { Player } from '../src/entities/Player';
import { MinionProj } from '../src/entities/MinionProj';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { rollGolemSentryCrit } from '../src/entities/projTargets';
import type { GameHooks } from '../src/entities/types';

const W = 200, H = 120;

interface StubEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean; hp: number;
  hurtLog: number[];
  critLog: boolean[];
  readonly cx: number;
  readonly cy: number;
  hurt: (d: number, kx: number, ky: number, g: unknown, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean, ...rest: unknown[]) => boolean;
}
function mkEnemy(id: number, x: number, y: number, w = 16, h = 16): StubEnemy {
  const e = { id, x, y, w, h, dead: false, hp: 10000, hurtLog: [] as number[], critLog: [] as boolean[] } as StubEnemy;
  Object.defineProperties(e, {
    cx: { get: () => e.x + e.w / 2 },
    cy: { get: () => e.y + e.h / 2 },
  });
  e.hurt = (d: number, _kx: number, _ky: number, _g: unknown, _pen?: number, crit?: boolean) => {
    e.hurtLog.push(d);
    e.critLog.push(!!crit);
    return false;
  };
  return e;
}

function makeHooks(enemies: StubEnemy[] = []) {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const hooks = {
    world: { store } as never,
    player: player as never,
    enemies: () => enemies,
    critters: () => [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    breakTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    spawnDust: () => null,
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  };
  (hooks as unknown as { entities: { projectiles: unknown[]; add: (e: unknown, b: string) => void } }).entities =
    { projectiles: [], add: () => {} };
  return { hooks: hooks as unknown as GameHooks, store, player };
}

/** equipStats 覆写（getter 记忆化,实例自有属性遮蔽原型 getter） */
function withEq(player: Player, patch: Record<string, unknown>): void {
  const merged = { ...(player.equipStats as unknown as Record<string, unknown>), ...patch };
  Object.defineProperty(player, 'equipStats', { get: () => merged, configurable: true });
}

/** 挂背包哨兵于玩家心拾起一拍（accSentryBackpack 旗面四件 6172/6175/6176/6177 同旗） */
function carry(projId: number, player: Player, hooks: GameHooks): MinionProj {
  withEq(player, { accSentryBackpack: true });
  const s = new MinionProj(player.cx - 8, player.cy - 8, projId, 10, 1, true, 0, false, () => player);
  s.fixedUpdate(1 / 60, hooks);
  expect(s.carriedByBackpack).toBe(true);
  return s;
}

// ============ ① AI_Sentries_HeavySlingReposition per-aiStyle/per-type 落位 ============

describe('① heavySlingReposition 落位几何（Projectile.cs:70096-70470）', () => {
  it('aiStyle 123（641 月门）：Center = MountedCenter + (0, gravDir*-(21+20+h/2))——头顶悬停（:70110-70112）', () => {
    const { player, hooks } = makeHooks();
    const s = carry(641, player, hooks);
    expect(s.cx).toBe(player.cx);                          // vector2 零
    expect(s.cy).toBe(player.cy - (21 + 20 + 16));         // h=32 → height/2=16（int 除）
  });
  it('aiStyle 137（688 闪电光环）：Center = MountedCenter（:70129）——★BJ606 注：原版首拍支序=携行钉（flag 支）→localAI[0] 场盒化（base.Center=center,Projectile.cs:70016）覆盖一拍（稳态拍 2+ 携行钉回）;本测试取稳态（BJ606 盒本体化后首拍=地面点为 vanilla 同构）', () => {
    const { player, hooks } = makeHooks();
    const s = carry(688, player, hooks);
    s.fixedUpdate(1 / 60, hooks);   // 拍 2：稳态（首拍场盒化已被携行钉覆盖回）
    expect(s.cx).toBe(player.cx);
    expect(s.cy).toBe(player.cy);
  });
  it('type 966 猎犬：Center = MountedCenter + (0, gravDir*-21)（:70140-70142）', () => {
    const { player, hooks } = makeHooks();
    const s = carry(966, player, hooks);
    expect(s.cx).toBe(player.cx);
    expect(s.cy).toBe(player.cy - 21);                     // num = min(21, 42/2)
  });
  it('type 308 冰霜九头蛇（同向）：vector2 = (-14+10, -20)（:70163-70171）', () => {
    const { player, hooks } = makeHooks();
    const s = carry(308, player, hooks);                   // spriteDirection=player.direction=1
    expect(s.cx).toBe(player.cx - 4);
    expect(s.cy).toBe(player.cy - 20);
  });
  it('type 377 蜘蛛皇后（同向）：vector2 = (spriteDirection, -20)（:70173-70180）', () => {
    const { player, hooks } = makeHooks();
    const s = carry(377, player, hooks);
    expect(s.cx).toBe(player.cx + 1);
    expect(s.cy).toBe(player.cy - 20);
  });
  it('aiStyle 134（677 弩车）：Center = MountedCenter + (0, gravDir*-14)（:70209）', () => {
    const { player, hooks } = makeHooks();
    const s = carry(677, player, hooks);
    expect(s.cx).toBe(player.cx);
    expect(s.cy).toBe(player.cy - 14);
  });
  it('aiStyle 138（691 爆炸机关）：vector2 = (-9*direction, 0)、rot=4.712389（:70231-70240）', () => {
    const { player, hooks } = makeHooks();
    const s = carry(691, player, hooks);
    expect(s.cx).toBe(player.cx - 9);
    expect(s.cy).toBe(player.cy);
    expect(s.rot).toBe(Math.fround(4.712389));             // 4.712389f（f32）
  });
  it('type 1025 藤堡（pdir=1）：Center += (-25, gravDir*4)、rot=+π/2（:70186-70187）', () => {
    const { player, hooks } = makeHooks();
    const s = carry(1025, player, hooks);
    expect(s.cx).toBe(player.cx - 25);
    expect(s.cy).toBe(player.cy + 4);
    expect(s.rot).toBe(Math.PI / 2);
    expect(s.facing).toBe(1);                              // AI_197 携带支 :41076 朝向回写
  });
  it('type 1025 藤堡（pdir=-1）：vector2.X = dir*-25 + dir*4 = +21（背后位）、rot=-π/2（:70186-70190）', () => {
    const { player, hooks } = makeHooks();
    player.facing = -1;
    const s = carry(1025, player, hooks);
    expect(s.cx).toBe(player.cx + 21);                     // -1*-25 + (-1*4) = 25-4 = +21
    expect(s.cy).toBe(player.cy + 4);
    expect(s.rot).toBe(-Math.PI / 2);
    expect(s.facing).toBe(-1);
  });
  it('aiStyle 130（663 烈焰塔）塔向≠玩家向：vector2.X += direction*-2（:70216-70219）——拾起拍 -12、回写后拍 -10', () => {
    const { player, hooks } = makeHooks();
    player.facing = -1;                                    // 塔缺省 facing=1 ≠ pdir
    const s = carry(663, player, hooks);
    // 精确式：pdir=-1 → X=pdir*10=-10；塔 facing=1≠pdir → += facing*-2=-2 → -12
    expect(s.cx).toBe(player.cx - 12);
    expect(s.cy).toBe(player.cy - 11);                     // gravDir*-11
    s.fixedUpdate(1 / 60, hooks);                          // 携带支朝向回写（:69348-69357）→ facing=-1
    expect(s.facing).toBe(-1);
    expect(s.cx).toBe(player.cx - 10);                     // 同向后 -2 修正消失
  });
  it('携带中卸下背包 → 当场消亡（:70098-70102）', () => {
    const { player, hooks } = makeHooks();
    const s = carry(691, player, hooks);
    withEq(player, { accSentryBackpack: false });
    s.fixedUpdate(1 / 60, hooks);
    expect(s.dead).toBe(true);
  });
});

// ============ ② 各 AI 携带支差异 ============

describe('② AI_138 携带支探测盒（num2=34 + Inflate(20) :70394-70411）', () => {
  it('携带态：盒心 (Center.X, Center.Y-34)、半宽 34*3/2+20=71——塔心下 40px 敌命中（74<79）', () => {
    const { player, hooks } = makeHooks();
    withEq(player, { accSentryBackpack: true });
    // 敌心 = 携带重定位心 (player.cx-9, player.cy)（:70231）下方 40px——须在拾起拍
    // 前就位（AI_138 探测每 3t,首拍即扫）
    const en = mkEnemy(1, player.cx - 17, player.cy + 32);
    (hooks as unknown as { enemies: () => StubEnemy[] }).enemies = () => [en];
    const s = new MinionProj(player.cx - 8, player.cy - 8, 691, 10, 1, true, 0, false, () => player);
    s.fixedUpdate(1 / 60, hooks);
    expect(s.carriedByBackpack).toBe(true);
    expect(en.hurtLog.length).toBe(1);                     // |40+34|=74 < 71+8 ✅
  });
  it('非携带对照：盒心 -48、半宽 72——同点位（塔心下 40px）不命中（88 ≥ 80）', () => {
    const { player, hooks } = makeHooks();
    const s = new MinionProj(player.cx + 200, player.cy, 691, 10, 1, true, 0, false, () => player);
    withEq(player, { accSentryBackpack: true });           // 不相交 → 不拾起
    const en = mkEnemy(1, s.cx - 8, s.cy + 40 - 8);
    (hooks as unknown as { enemies: () => StubEnemy[] }).enemies = () => [en];
    s.fixedUpdate(1 / 60, hooks);
    expect(s.carriedByBackpack).toBe(false);
    expect(en.hurtLog.length).toBe(0);                     // |40+48|=88 ≥ 72+8
  });
});

describe('② AI_137 携带支场随玩家（重定位 Center=MountedCenter :70127-70137）', () => {
  it('携带态光环场心=玩家心——玩家心敌命中;未携带对照（场锚落位点）同敌不命中', () => {
    const { player, hooks } = makeHooks();
    const s = carry(688, player, hooks);                   // 拾起拍即 init（localAI[0]==0 支在场心=玩家心处跑）
    const en = mkEnemy(1, player.cx - 8, 86 * 16);         // 敌心 (960,1380)：场[1280,1600]内、距心 52<140
    (hooks as unknown as { enemies: () => StubEnemy[] }).enemies = () => [en];
    s.fixedUpdate(1 / 60, hooks);
    expect(en.hurtLog.length).toBe(1);
    // 对照：不拾起（不相交落位）→ 场心钉落位点地面（1600）→ 场盒 y∈[1440,1760]
    // 不含敌盒 y∈[1372,1388] → 盒测直接拒绝
    const s2 = new MinionProj(player.cx + 60, player.cy, 688, 10, 1, true, 0, false, () => player);
    s2.fixedUpdate(1 / 60, hooks);
    const en2 = mkEnemy(2, player.cx - 8, 86 * 16);
    (hooks as unknown as { enemies: () => StubEnemy[] }).enemies = () => [en2];
    s2.fixedUpdate(1 / 60, hooks);
    expect(s2.carriedByBackpack).toBe(false);
    expect(en2.hurtLog.length).toBe(0);
  });
});

describe('② AI_053 携带支朝向回写（ai[0]<=0 → direction=player.direction :37996-38002）', () => {
  it('初始冷却 120 走完后：无目标拍随玩家转向', () => {
    const { player, hooks } = makeHooks();
    player.facing = -1;
    const s = carry(308, player, hooks);
    expect(s.facing).toBe(1);                              // 冷却期不回写（ai[0]=120）
    for (let i = 0; i < 121; i++) s.fixedUpdate(1 / 60, hooks);   // 120t 冷却烧完
    expect(s.facing).toBe(-1);                             // :37996-38002 回写
  });
});

describe('② AI_130 携带支朝向回写（ai[0]==1 && ai[1]==0 :69348-69357）', () => {
  it('无目标待机拍随玩家转向（弩车 134 同款已接 :69615-69623）', () => {
    const { player, hooks } = makeHooks();
    player.facing = -1;
    const s = carry(667, player, hooks);
    expect(s.facing).toBe(-1);                             // sFire=0/sCool=0 → 首拍即回写
  });
});

// ============ ③ 6176 圣殿骑士背包强制暴击掷（Projectile.cs:12962-12965） ============

describe('③ 6176 accGolemSentryBackpack：sentry/SentryShot 命中 1/10 强制暴击', () => {
  it('挂件+掷中（mock 0.05 → Next(10)=0）→ 爆炸机关 AoE crit=true、伤 ×2', () => {
    const { player, hooks } = makeHooks();
    withEq(player, { accSentryBackpack: true, accGolemSentryBackpack: true });
    const en = mkEnemy(1, player.cx - 17, player.cy + 32);
    (hooks as unknown as { enemies: () => StubEnemy[] }).enemies = () => [en];
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const s = new MinionProj(player.cx - 8, player.cy - 8, 691, 10, 1, true, 0, false, () => player);
    s.fixedUpdate(1 / 60, hooks);
    rnd.mockRestore();
    // ★BJ731 改判史（2026-10-27）：BJ723-B S02 起 crit ×2 移入 Enemy.hurt 防后
    //   （NPC.cs:82067 两步式）——调用侧传【未翻倍】DV 掷值+crit 旗。mock 0.05 →
    //   DV(10,−14 档)=9（BJ716-A R18-F2 首掷）;×2=18 由真 Enemy.hurt 承载（本
    //   stub hurt 不翻倍）。旧期望 [18]=S02 前调用侧预翻倍形,改判 [9]。
    expect(en.hurtLog).toEqual([9]);                   // dmgOf=10 → DV 掷 9,crit ×2 归 Enemy.hurt
    expect(en.critLog).toEqual([true]);
  });
  it('挂件+掷未中（mock 0.95 → 9）→ 不强制（crit=false、伤原值）', () => {
    const { player, hooks } = makeHooks();
    withEq(player, { accSentryBackpack: true, accGolemSentryBackpack: true });
    const en = mkEnemy(1, player.cx - 17, player.cy + 32);
    (hooks as unknown as { enemies: () => StubEnemy[] }).enemies = () => [en];
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.95);
    const s = new MinionProj(player.cx - 8, player.cy - 8, 691, 10, 1, true, 0, false, () => player);
    s.fixedUpdate(1 / 60, hooks);
    rnd.mockRestore();
    expect(en.hurtLog).toEqual([11]);                  // DV(10,+14 档)=11（BJ716-A R18-F2 首掷;crit=false 保持）
    expect(en.critLog).toEqual([false]);
  });
  it('未挂件 → 掷中亦不强制（:12962 accGolemSentryBackpack 门）', () => {
    const { player, hooks } = makeHooks();
    withEq(player, { accSentryBackpack: true });
    const en = mkEnemy(1, player.cx - 17, player.cy + 32);
    (hooks as unknown as { enemies: () => StubEnemy[] }).enemies = () => [en];
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const s = new MinionProj(player.cx - 8, player.cy - 8, 691, 10, 1, true, 0, false, () => player);
    s.fixedUpdate(1 / 60, hooks);
    rnd.mockRestore();
    expect(en.critLog).toEqual([false]);
  });
  it('helper 门：非 sentry 非 SentryShot（374 MinionShot）恒 false；SentryShot 644/sentry 688 过门', () => {
    const { player, hooks } = makeHooks();
    withEq(player, { accGolemSentryBackpack: true });
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.05);   // 掷中相位
    expect(rollGolemSentryCrit(hooks, 374, false)).toBe(false);   // MinionShot 不在表
    expect(rollGolemSentryCrit(hooks, 644, false)).toBe(true);    // SentryShot
    expect(rollGolemSentryCrit(hooks, 688, true)).toBe(true);     // 本体 sentry
    rnd.mockRestore();
    withEq(player, { accGolemSentryBackpack: false });            // 未挂件
    expect(rollGolemSentryCrit(hooks, 644, false)).toBe(false);   // :12962 旗门
  });
});
