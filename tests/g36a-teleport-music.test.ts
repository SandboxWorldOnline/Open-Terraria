// ★G36-A（2026-10-31，BJ738/740 登记债清偿）判别锁 B：传送头段/音乐盒/盾击弹。
// 覆盖：BJ738 D4（Teleport/Spawn StopVanityActions + Teleport shimmer 清面——八传送面）、
//       BJ740 D1（佩戴音乐盒播曲）、BJ740 D2（4760 盾击弹 866 计数门）。
// 标杆：Terarria1457（Player.cs:37698-37715/:33722-33728/:37840;Main.cs:57853-57868;
//       Player.cs:13108-13114/:14335/:16111-16360/:13174-13178）。
// 变异恰红（withMutation）在同文件 M 组。
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withMutation } from './mutation-guard';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { BuffType } from '../src/stats/Buffs';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { MUSIC_BOX_STYLE_BY_VID, MUSIC_BOX_ITEM_BY_STYLE } from '../src/data/musicBoxStyles';

const _iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

const fakeHooks = (w: World, p: Player, projectiles: unknown[] = []) => ({
  world: w,
  player: p,
  enemies: () => [],
  critters: () => [],
  projectiles: () => projectiles,
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
});

afterEach(() => { vi.restoreAllMocks(); });
const DT = 1 / 60;

// ============ D4：StopVanityActions + Teleport shimmer 清面 ============

describe('G36-A D4：stopVanityActions / teleportClearShimmer', () => {
  it('三态清：坐/睡/抚摸（:33722-33728）', () => {
    const p = new Player(0, 0, new Inventory());
    p.sitting = true; p.seatOffsetX = 3; p.seatIsToilet = true; p.sitTicks = 7;
    p.sleeping = true; p.timeSleeping = 300;
    p.petting.isPetting = true;
    const hook = vi.fn();
    p.sitUpHook = hook;
    p.stopVanityActions();
    expect(p.sitting).toBe(false);
    expect(p.seatOffsetX).toBe(0);
    expect(p.seatIsToilet).toBe(false);
    expect(p.sitTicks).toBe(0);
    expect(p.sleeping).toBe(false);
    expect(p.timeSleeping).toBe(0);
    expect(p.petting.isPetting).toBe(false);
    expect(hook).toHaveBeenCalled();
  });
  it('sitUpHook 未接线兜底（远端代理/裸测四字段直清）', () => {
    const p = new Player(0, 0, new Inventory());
    p.sitting = true; p.seatOffsetY = 5;
    p.stopVanityActions();
    expect(p.sitting).toBe(false);
    expect(p.seatOffsetY).toBe(0);
  });
  it('shimmer 清面：shimmering → 三态清+摘 353（:37709-37715）', () => {
    const p = new Player(0, 0, new Inventory());
    p.shimmering = true;
    p.inShimmer = true;
    p.buffs.apply(BuffType.Shimmered, 300);
    p.teleportClearShimmer();
    expect(p.shimmering).toBe(false);
    expect(p.inShimmer).toBe(false);
    expect(p.buffs.has(BuffType.Shimmered)).toBe(false);
  });
  it('shimmerWet 单态也触发（|| 门）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inShimmer = true;
    p.buffs.apply(BuffType.Shimmered, 300);
    p.teleportClearShimmer();
    expect(p.inShimmer).toBe(false);
    expect(p.buffs.has(BuffType.Shimmered)).toBe(false);
  });
  it('无微光态零扰动（不动湿态以外的字段）', () => {
    const p = new Player(0, 0, new Inventory());
    p.inWater = true;   // 水湿非微光——不清（vanilla wet=false 由派生 getter 自承载）
    p.teleportClearShimmer();
    expect(p.inWater).toBe(true);
  });
  it('结构锁：八传送面全接线（Game×5 + Player×2 + Portal×1）', () => {
    const g = readFileSync(join(process.cwd(), 'src', 'core', 'Game.ts'), 'utf8');
    const p = readFileSync(join(process.cwd(), 'src', 'entities', 'Player.ts'), 'utf8');
    const portal = readFileSync(join(process.cwd(), 'src', 'entities', 'Portal.ts'), 'utf8');
    // Game 五面：混乱杖 style1 / 虫洞 style3 / recall 尾（spawn 门分流）/ style8（p 域 4 面）
    // + 晶塔 style9（this.player 域 1 面）
    expect(g.match(/p\.stopVanityActions\?\.\(\);/g)?.length).toBe(4);
    expect(g.match(/this\.player\.stopVanityActions\?\.\(\);/g)?.length).toBe(1);
    expect(g.match(/p\.teleportClearShimmer\?\.\(\);/g)?.length).toBe(4);
    expect(g.match(/this\.player\.teleportClearShimmer\?\.\(\);/g)?.length).toBe(1);
    // recall 尾 spawn-face 分流（Spawn :37840 只有 vanity,无 shimmer）
    expect(g).toContain("if (c.kind !== 'spawn') p.teleportClearShimmer?.();");
    // Player 两面：女王钩 style10 / 微光脱困 style12
    expect(p.match(/this\.stopVanityActions\(\);/g)?.length).toBe(2);
    // Portal 一面：style4
    expect(portal.match(/p\.stopVanityActions\?\.\(\);/g)?.length).toBe(1);
    expect(portal.match(/p\.teleportClearShimmer\?\.\(\);/g)?.length).toBe(1);
  });
});

// ============ BJ740 D1：佩戴音乐盒播曲 ============

describe('G36-A D1（BJ740）：MUSIC_BOX_STYLE_BY_VID 逆表', () => {
  it('表互逆（style→vid→style 恒等;101 项）', () => {
    expect(MUSIC_BOX_ITEM_BY_STYLE.length).toBe(101);
    for (let s = 0; s < MUSIC_BOX_ITEM_BY_STYLE.length; s++) {
      expect(MUSIC_BOX_STYLE_BY_VID.get(MUSIC_BOX_ITEM_BY_STYLE[s])).toBe(s);
    }
  });
  it('锚点抽查：562→0/574→12/1596→13/1609→26/1610→27/5022→66/6146→100;576 空盒不在表', () => {
    expect(MUSIC_BOX_STYLE_BY_VID.get(562)).toBe(0);
    expect(MUSIC_BOX_STYLE_BY_VID.get(574)).toBe(12);
    expect(MUSIC_BOX_STYLE_BY_VID.get(1596)).toBe(13);
    expect(MUSIC_BOX_STYLE_BY_VID.get(1609)).toBe(26);
    expect(MUSIC_BOX_STYLE_BY_VID.get(1610)).toBe(27);
    expect(MUSIC_BOX_STYLE_BY_VID.get(5022)).toBe(66);
    expect(MUSIC_BOX_STYLE_BY_VID.get(6146)).toBe(100);
    expect(MUSIC_BOX_STYLE_BY_VID.has(576)).toBe(false);
  });
});

describe('G36-A D1（BJ740）：wornMusicBoxStyle 扫描（ApplyEquipVanity n=13..19）', () => {
  const mkGame = (armor: Record<number, { id: number; stack: number } | undefined>, unlocked = true) => ({
    player: {
      inv: {
        armor,
        isItemSlotUnlockedAndUsable: (_n: number) => unlocked,
      },
    },
  }) as unknown as Game;
  const wmbs = (g: Game): number | null =>
    (Game.prototype as unknown as { wornMusicBoxStyle(): number | null }).wornMusicBoxStyle.call(g);
  it('槽 15 佩戴已录盒 563 → style 1', () => {
    expect(wmbs(mkGame({ 15: { id: _iid(563), stack: 1 } }))).toBe(1);
  });
  it('后槽覆盖前槽（if-chain 直赋语义）', () => {
    expect(wmbs(mkGame({ 14: { id: _iid(563), stack: 1 }, 17: { id: _iid(566), stack: 1 } }))).toBe(4);
  });
  it('槽 12（时装配饰窗外,armor[10-12] 为甲/头）不入扫描', () => {
    expect(wmbs(mkGame({ 12: { id: _iid(563), stack: 1 } }))).toBeNull();
  });
  it('空盒 576 不播曲（不在逆表）', () => {
    expect(wmbs(mkGame({ 15: { id: _iid(576), stack: 1 } }))).toBeNull();
  });
  it('槽未解锁跳过（:13110 IsItemSlotUnlockedAndUsable 门）', () => {
    const g = mkGame({ 14: { id: _iid(563), stack: 1 }, 17: { id: _iid(566), stack: 1 } }, false);
    // 全槽锁定 → 无盒;单独锁 17 场景由 unlocked 布尔简化,直扫窗口由 M6 变异锁
    expect(wmbs(g)).toBeNull();
  });
  it('结构锁：音乐 tick 接线（玩家值覆盖地块值 + 事件曲域）', () => {
    const g = readFileSync(join(process.cwd(), 'src', 'core', 'Game.ts'), 'utf8');
    expect(g).toContain('musicBox: wornMB ?? this.scene.musicBoxStyle,');
    expect(g).toContain('|| wornMB !== null');
  });
});

// ============ BJ740 D2：4760 盾击弹 866 计数门 ============

describe('G36-A D2（BJ740）：ownedProjectileCounts[866] 计数门', () => {
  it('fixedUpdate 维护快照：866 在飞 true / 亡体或他弹 false', () => {
    const w = new World(60, 60, 42, 'g36a-866snap');
    const p = new Player(20 * 16, 27 * 16, new Inventory());
    p.fixedUpdate(DT, fakeHooks(w, p, [{ projId: 866, dead: false }]) as never);
    expect((p as unknown as { heldShield866InFlight: boolean }).heldShield866InFlight).toBe(true);
    p.fixedUpdate(DT, fakeHooks(w, p, [{ projId: 866, dead: true }]) as never);
    expect((p as unknown as { heldShield866InFlight: boolean }).heldShield866InFlight).toBe(false);
    p.fixedUpdate(DT, fakeHooks(w, p, [{ projId: 908, dead: false }]) as never);
    expect((p as unknown as { heldShield866InFlight: boolean }).heldShield866InFlight).toBe(false);
  });
  it('shouldGuard 门：手持 4760 + 866 在飞 = 无举盾资格（:13174-13178 <1 门）', () => {
    const w = new World(60, 60, 42, 'g36a-866guard');
    const mk = () => {
      const p = new Player(20 * 16, 27 * 16, new Inventory());
      p.inv.slots[0] = { id: _iid(4760), stack: 1 };
      p.inv.selected = 0;
      p.baseMaxHp = 400;
      p.hp = 400;
      p.inputUseTile = true;
      return p;
    };
    const a = mk();
    (a as unknown as { heldShield866InFlight: boolean }).heldShield866InFlight = true;
    a.damage(5, a.x + 10, a.y);
    expect(a.shieldRaised).toBe(false);   // 盾掷出期间不可举盾
    const b = mk();
    b.damage(5, b.x + 10, b.y);
    expect(b.shieldRaised).toBe(true);    // 866 不在场 → 资格恢复
  });
});

// ============ 变异恰红 ============

const spawnVitest = (filter: string) => spawnSync(
  'npx', ['vitest', 'run', 'tests/g36a-teleport-music.test.ts', '--no-file-parallelism', '-t', filter], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, SW_G36A_MUT: '1' },
  },
);
const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
  withMutation(file, trigger, replacement, () => {
    const r = spawnVitest(filter);
    expect(r.status, `变异须证红: ${replacement.slice(0, 60)}`).not.toBe(0);
    expect(r.stdout).toContain(filter);
  }, { label: `G36-A teleport-music ${filter}` });
};

describe('G36-A 变异恰红（传送/音乐/盾面）', () => {
  it('M6 D1：扫描窗窄化 13..19 → 13..15 → 后槽覆盖夹具红', () => {
    mutate(join(process.cwd(), 'src', 'core', 'Game.ts'),
      'for (let n = 13; n < 20; n++) {',
      'for (let n = 13; n < 15; n++) {',
      'wornMusicBoxStyle 扫描');
  });
  it('M7 D2：摘 866 计数门 → 在飞夹具红', () => {
    mutate(join(process.cwd(), 'src', 'entities', 'Player.ts'),
      '|| (heldShieldVid === 4760 && !this.heldShield866InFlight);',
      '|| heldShieldVid === 4760;',
      'shouldGuard 门');
  });
  it('M8 D4：摘 recall 尾 vanity 清面 → 结构锁红', () => {
    mutate(join(process.cwd(), 'src', 'core', 'Game.ts'),
      'p.stopVanityActions?.();\n    if (c.kind !== \'spawn\') p.teleportClearShimmer?.();',
      'if (c.kind !== \'spawn\') p.teleportClearShimmer?.();',
      '八传送面全接线');
  });
});
