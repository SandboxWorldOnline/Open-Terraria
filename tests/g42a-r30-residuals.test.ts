// G42-A（2026-11-02）R30 未修级清偿刀判别锁——P3-2（自然 Boss 生成门旅程滑杆关停拒）
// + P3-4（队伍平台 framed 支享并集∪3×3）。
//
// 【P3-4 定谳】原版 427 队伍平台/435-439 五色队伍平台 def.framed:true 但
// TileObjectData 记录 UsesCustomCanPlace=false（TileObjectData.cs:2141-2161 亲读——
// 与 19 同块 CopyFrom 平台记录）→ 放置路由 Player.cs:40096-40101 CustomPlace=false
// → else 支 PlaceThing_Tiles_BlockPlacementForAssortedThings = 四邻并集（:41567-41579）
// ∪ 平台 3×3 回退（:41652-41666，gate=TileID.Sets.Platforms 含 427/435-439）。
// 旧 hasSupport `if (framed) return false` 早退=空中对角续铺/邻平台被拒（严于原版，
// R30 红蓝留档 P3-4 pre-existing）。修=framed 早退对 PLATFORMS_SHEETS 豁免。
//
// 【P3-2 定谳】CanSpawnEnemiesNear（NPC.cs:345-363）旅程滑杆==0 → false；EoC
// （Main.cs:66050）/机械（:66072）/鹿角怪（:66107）三门共用。EoC 清旗仅在
// SpawnOnPlayer 后（:66053，滑杆拒=旗保留）；机械 spawnHardBoss=0 无条件（:66093，
// 滑杆拒也耗窗）；鹿角怪=当拍 roll 拒。结构锁在 eoc-pending-lifecycle（随刀更新）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { TileStore } from '../src/world/TileStore';
import { ITEM_DEFS } from '../src/data/items';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { PLATFORMS_SHEETS } from '../src/data/tiles';
import type { ItemDef } from '../src/data/items';

const TILE = 16;
const PLAT = TILE_BY_KEY['platform']!;
const DIRT = TILE_BY_KEY['dirt']!;
const TEAM_PLAT_ITEM = ITEM_DEFS.find((d) => d && d.key === 'vi_3622_TeamBlockRedPlatform') as ItemDef;
const TEAM_PLAT = TILE_BY_KEY['v_427_red_team_platform']!;
expect(TEAM_PLAT_ITEM, 'vi_3622_TeamBlockRedPlatform 在册').toBeTruthy();
expect(TEAM_PLAT, 'v_427_red_team_platform 在册').toBeTruthy();
// 前提锁：427 framed 且 platform（framed 豁免的受理面）+ 19 非 framed（不受影响面）
const d427 = TILE_DEFS[TEAM_PLAT];
expect(d427?.framed).toBe(true);
expect(d427?.platform).toBe(true);
expect(PLATFORMS_SHEETS.has(427)).toBe(true);
expect(TILE_DEFS[PLAT]?.framed).toBeFalsy();

/** 真分派 shell（sw-bj10 同式：Game.prototype 直调，外围 stub——只用到 hasSupport/
 *  tryPlace 所需面） */
function shell(w: World, o: { dirty?: number[][]; held?: ItemDef } = {}) {
  const g = Object.create(Game.prototype) as unknown as Record<string, any>;
  g.world = w;
  g.chunks = { markDirtyArea: (x0: number, y0: number, x1: number, y1: number) => { o.dirty?.push([x0, y0, x1, y1]); } };
  g.sfx = { play: () => {} };
  g.playSfxFile = () => true;
  g.cb = { onInventoryChanged: () => {} };
  g.input = {};
  g.entities = { critters: [], enemies: [], npcs: [], projectiles: [] };
  g.remotePlayerProxies = [];
  g.smartCursor = { wanted: false, showing: false, x: -1, y: -1, lockedContinuity: null, lockedDirection: null };
  g.spawnParticles = () => {};
  g.spawnDrop = () => {};
  g.achievements = { notifyTileDestroyed: () => {}, handleMining: () => {} };
  g.hitTiles = { addDamage: () => 0, clear: () => {} };
  const held = o.held ?? TEAM_PLAT_ITEM;
  const slots: Array<{ id: number; stack: number } | null> = [{ id: ITEM_DEFS.indexOf(held), stack: 99 }];
  g.player = {
    placeSpeedTileRaw: () => 1,
    isGhostPhase: () => false,
    cx: 20 * TILE + 8, cy: 33 * TILE + 8, x: 20 * TILE + 2, y: 33 * TILE, w: 12, h: 28,
    facing: 1, useTime: 0, attackSpeedMult: 1, dead: false, gfxOffY: 0,
    buffs: { has: () => false }, equipStats: {},
    inv: { selected: 0, slots, heldItem: () => slots[0], removeAt: () => {}, removeHeld: () => {} },
  } as unknown as Record<string, unknown>;
  return g;
}

function mkWorld(): { w: World; st: TileStore } {
  const w = new World(64, 64, 42, 'g42a');
  return { w, st: w.store as TileStore };
}

// ═══════════════ P3-4 行为面：hasSupport 平台族 framed 豁免 ═══════════════

describe('G42-A P3-4：队伍平台 framed 支享并集∪3×3（TileObjectData.cs:2141-2161 uccp=false → AssortedThings 路）', () => {
  it('★回归主案：427 对角仅角接触（左上台）→ 可放（旧 framed 早退拒=R30 P3-4 病灶）', () => {
    const { w, st } = mkWorld();
    st.setTileSilent(19, 29, PLAT, 0, 0);            // 唯一支撑=左上对角（3×3 回退臂）
    const g = shell(w);
    expect((g as unknown as { hasSupport: (...a: unknown[]) => boolean })
      .hasSupport(20, 30, 1, 1, true, false, 427)).toBe(true);
    g.tryPlace(20, 30, TEAM_PLAT_ITEM!);
    expect(st.type[st.idx(20, 30)]).toBe(TEAM_PLAT);
    expect(st.flags[st.idx(20, 30)]).toBe(1);
  });

  it('427 四对角方向全开（3×3 回退对称）', () => {
    for (const [dx, dy] of [[1, -1], [-1, 1], [1, 1]] as const) {
      const { w, st } = mkWorld();
      st.setTileSilent(20 + dx, 30 + dy, PLAT, 0, 0);
      const g = shell(w);
      expect((g as unknown as { hasSupport: (...a: unknown[]) => boolean })
        .hasSupport(20, 30, 1, 1, true, false, 427)).toBe(true);
    }
  });

  it('427 正交邻实心 → 四邻并集臂命中（Player.cs:41567-41579）', () => {
    const { w, st } = mkWorld();
    st.setTileSilent(21, 30, DIRT, 0, 0);            // 右邻实心
    const g = shell(w);
    expect((g as unknown as { hasSupport: (...a: unknown[]) => boolean })
      .hasSupport(20, 30, 1, 1, true, false, 427)).toBe(true);
  });

  it('435-439 五色同享（PLATFORMS_SHEETS 全员 framed 豁免）', () => {
    for (const sheet of [435, 436, 437, 438, 439]) {
      const { w, st } = mkWorld();
      st.setTileSilent(19, 29, PLAT, 0, 0);
      const g = shell(w);
      expect((g as unknown as { hasSupport: (...a: unknown[]) => boolean })
        .hasSupport(20, 30, 1, 1, true, false, sheet)).toBe(true);
    }
  });

  it('负控①：427 四邻全空且无 3×3 → 仍拒（悬空不可达=与 19 同相）', () => {
    const { w } = mkWorld();
    const g = shell(w);
    expect((g as unknown as { hasSupport: (...a: unknown[]) => boolean })
      .hasSupport(20, 30, 1, 1, true, false, 427)).toBe(false);
  });

  it('负控②：非平台 framed 家具仍走早退（对角接触不放=豁免未误扩）', () => {
    const { w, st } = mkWorld();
    st.setTileSilent(19, 29, PLAT, 0, 0);            // 对角平台对非平台 framed 仍不算支撑
    const g = shell(w);
    // 33=工作台族 sheet（framed 非平台）——framed 早退保持
    expect((g as unknown as { hasSupport: (...a: unknown[]) => boolean })
      .hasSupport(20, 30, 1, 1, true, false, 33)).toBe(false);
  });
});

// ═══════════════ P3-4 结构锁：源文本锚（防静默回退） ═══════════════

describe('G42-A P3-4 结构锁', () => {
  const src = readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
  it('framed 早退带 PLATFORMS_SHEETS 豁免（摘除即红）', () => {
    expect(src).toMatch(/if \(framed && !PLATFORMS_SHEETS\.has\(sheet\)\) return false;/);
  });
  it('3×3 回退臂仍以 PLATFORMS_SHEETS 为门（427/435-439 自动入臂）', () => {
    expect(src).toMatch(/if \(PLATFORMS_SHEETS\.has\(sheet\)\) \{\s*\n\s*for \(let dy = -1; dy <= 1; dy\+\+\)/);
  });
});
