// SW-BG1 2026-09-06 墙物品放置回归（用户实报「只有木墙可放置,石墙/棕榈木墙都不能」）。
// 根因：items.ts 墙物品 wallId 合并循环只按表内蛇形键 byKey[wi.key] 命中——恰被桥接批
// 预注册的 8 件（26/93/130/330/392/1723/2263/2433）蛇形=驼峰同 def 生效,其余 284 件
// 在影子 def 上挂 wallId,而玩家实持 def（掉落/合成/创造/读档全经 VANILLA_ITEM_KEY_BY_ID
// 权威反查,驼峰键）无 wallId → Game.updateUse 派发门 `heldDef?.wallId != null` 整类不进。
// 权威锚：
//   - 放置链 Player.PlaceThing_Walls（Terarria1457/Terraria/Player.cs:39911-39946）
//     + WorldGen.PlaceWall（:75727-75745,边 2 格 margin + wall==0 门）——本仓
//     Game.tryPlaceWall 已 1:1（SW-BF1 批已核）,本件只修数据面。
//   - 墙物品表 vanilla-wallitems.json（Item.cs createWall 提取,292 项,tests/
//     wallitems-parity.test.ts 三方对账）。
// 壳模式同 tests/placement-pipeline-debt.test.ts（Object.create(Game.prototype)+桩）。
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/World';
import { Game } from '../src/core/Game';
import { ITEM_BY_KEY, ITEM_DEFS } from '../src/data/items';
import { VI, VI_ID } from '../src/data/itemKeys';
import wallItemsJson from '../src/data/vanilla-wallitems.json';

const WALL_STONE_VID = 26;       // Stone Wall → wall 1（Item.cs:1675 直赋 createWall=1）
const WALL_WOOD_VID = 93;        // Wood Wall → wall 4（:2444）
const WALL_GLASS_VID = 392;      // Glass Wall → wall 21（:5985）
const WALL_PALM_VID = 2506;      // Palm Wood Wall → wall 151（:24324）——实报坏件代表
const EXPECT_WALL: Record<number, number> = {
  [WALL_STONE_VID]: 1, [WALL_WOOD_VID]: 4, [WALL_GLASS_VID]: 21, [WALL_PALM_VID]: 151,
};

interface Drop { key: string; n: number }

/** Game 壳（同 placement-pipeline-debt.test.ts shell,墙支所需桩） */
function shell(w: World, drops: Drop[], opts: { heldStack?: number } = {}) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
    world: World;
    player: Record<string, unknown> & { inv: Record<string, unknown> };
  };
  const consumed: number[] = [];
  g.world = w;
  g.chunks = { markDirtyArea: () => {} };
  g.sfx = { play: () => {} };
  g.cb = { onInventoryChanged: () => {} };
  g.spawnParticles = () => {};
  g.recLog = () => {};
  g.spawnDrop = (_x: number, _y: number, key: string, n: number) => { drops.push({ key, n }); return null; };
  g.entities = { add: () => {}, critters: [], drops: [], enemies: [], npcs: [], projectiles: [] };
  const slots: unknown[] = new Array(60).fill(null);
  g.player = {
    cx: 10 * 16 + 8, cy: 12 * 16 + 8, x: 10 * 16 + 2, y: 12 * 16 - 6, w: 12, h: 28,
    facing: 1, useTime: 0,
    buffs: { has: () => false },            // blockRange 读 Builder 增程 buff
    equipStats: { autoPaint: false },
    inv: {
      selected: 0,
      slots,
      heldItem: () => ({ id: -1, stack: opts.heldStack ?? 9 }),
      removeHeld: (n: number) => {
        consumed.push(0);
        const hs = slots[0] as { stack: number } | null;
        if (hs) hs.stack = Math.max(0, hs.stack - n);
      },
    },
  };
  // tryPlaceWall 为 Game 私有方法——调用面经 unknown 中转（同 placement-pipeline-debt 壳式）
  const placeWall = (x: number, y: number, d: (typeof ITEM_DEFS)[number]) =>
    (g as unknown as { tryPlaceWall: (x: number, y: number, d: (typeof ITEM_DEFS)[number]) => void })
      .tryPlaceWall(x, y, d);
  return { g: g as unknown as Game & Record<string, (...a: unknown[]) => void>, placeWall, consumed };
}

/** 玩家实持 def = VI 权威反查（掉落/合成/创造浏览器/读档统一入口） */
const heldDefOf = (vid: number) => ITEM_DEFS[VI_ID(vid)];

function mkWorld(): World {
  return new World(40, 40, 7, 'sw-bg1-wall-place');
}

// ============================================================
// ① 数据面闸门：292 件墙物品的【实持 def】wallId 全量生效
//    （修前 284 件缺失——本文件判别力核心）
// ============================================================
describe('① 墙物品实持 def wallId 全量闸门（vanilla-wallitems.json × VI 权威反查）', () => {
  it('292/292：VI_ID(vid) 反查 def 的 wallId 与表逐件相等', () => {
    const table = wallItemsJson as Record<string, { wall: number; key: string }>;
    const missing: string[] = [];
    for (const [idS, e] of Object.entries(table)) {
      const d = heldDefOf(Number(idS));
      if (!d || d.wallId !== e.wall) missing.push(`${idS}(wall ${e.wall})`);
    }
    expect(missing, `实持 def wallId 缺失: ${missing.slice(0, 20).join(', ')}`).toEqual([]);
  });

  it('实报四件（石墙/木墙/玻璃墙/棕榈木墙）派发门 wallId 非 null', () => {
    for (const vid of [WALL_STONE_VID, WALL_WOOD_VID, WALL_GLASS_VID, WALL_PALM_VID]) {
      expect(heldDefOf(vid)?.wallId, `vid ${vid}`).toBe(EXPECT_WALL[vid]);
    }
  });

  it('掉落闭环：WALL_DROPS 掉落物品经 VI 反查后 wallId 可回放同墙', () => {
    // 拆墙→掉墙物→再放置 全链数据面（wallDrops.ts WALL_DROPS × wallId）
    for (const [wallS, dropVid] of [[1, WALL_STONE_VID], [4, WALL_WOOD_VID], [151, WALL_PALM_VID]] as const) {
      expect(wallDropOf(Number(wallS))).toBe(dropVid);
      expect(heldDefOf(dropVid)?.wallId).toBe(Number(wallS));
    }
  });
});

// wallDrops 单源直读（避免引 Game 侧私有表；wallDrops.ts 为 SW-BF1 后唯一权威）
import { WALL_DROPS } from '../src/data/wallDrops';
function wallDropOf(wall: number): number {
  return WALL_DROPS[wall] ?? 0;
}

// ============================================================
// ② 放置行为（tryPlaceWall 1:1 面回归：本件修数据面,行为面锚定防回归）
// ============================================================
describe('② 四族墙放置（正确墙 id 落格）', () => {
  for (const vid of [WALL_STONE_VID, WALL_WOOD_VID, WALL_GLASS_VID, WALL_PALM_VID]) {
    it(`vid ${vid} → wall ${EXPECT_WALL[vid]} 落格`, () => {
      const w = mkWorld();
      const st = w.store;
      st.setTileSilent(10, 11, 1);                    // 邻接门：下方实心 tile
      const drops: Drop[] = [];
      const { placeWall, consumed } = shell(w, drops);
      placeWall(10, 10, heldDefOf(vid));
      expect(st.wall[st.idx(10, 10)]).toBe(EXPECT_WALL[vid]);
      expect(consumed.length).toBe(1);                // 主放消耗 1 件
    });
  }
});

describe('② 拒放/替换/消耗语义（Player.cs:39911-39946 逐门）', () => {
  it('非邻接面拒放：四邻无 tile 无墙 → 不落格不消耗（:39918-39919 邻接门）', () => {
    const w = mkWorld();
    const st = w.store;
    const drops: Drop[] = [];
    const { placeWall, consumed } = shell(w, drops);
    placeWall(10, 10, heldDefOf(WALL_STONE_VID));
    expect(st.wall[st.idx(10, 10)]).toBe(0);
    expect(consumed).toEqual([]);
  });

  it('邻接门认墙：四邻有墙无 tile 也放（原版 active()||wall>0）', () => {
    const w = mkWorld();
    const st = w.store;
    st.setWallSilent(9, 10, 4);                       // 左邻木墙（无 tile）
    const drops: Drop[] = [];
    const { placeWall } = shell(w, drops);
    placeWall(10, 10, heldDefOf(WALL_STONE_VID));
    expect(st.wall[st.idx(10, 10)]).toBe(1);
  });

  it('同墙 no-op：目标已是本墙 → 不消耗（:39920 `wall==createWall` 门）', () => {
    const w = mkWorld();
    const st = w.store;
    st.setWallSilent(10, 10, 1);                      // 已是石墙
    st.setTileSilent(11, 10, 1);                      // 邻接门过（排除邻接假拒）
    const drops: Drop[] = [];
    const { placeWall, consumed } = shell(w, drops);
    placeWall(10, 10, heldDefOf(WALL_STONE_VID));
    expect(consumed).toEqual([]);
  });

  it('ReplaceWall：石墙物品替换木墙 → 换墙+掉旧墙物+消耗（:39925-39928 TryReplacingWalls）', () => {
    const w = mkWorld();
    const st = w.store;
    st.setWallSilent(10, 10, 4);                      // 旧木墙
    st.setWallSilent(11, 10, 4);                      // 邻接门
    const drops: Drop[] = [];
    const { placeWall, consumed } = shell(w, drops);
    placeWall(10, 10, heldDefOf(WALL_STONE_VID));
    expect(st.wall[st.idx(10, 10)]).toBe(1);          // 换成石墙
    // ★BJ730 改判史：旧断言 toContain(VI(WALL_WOOD_VID))——id 双域统一后
    //  VANILLA_ITEM_KEY_BY_ID[93] 指驼峰别名 vi_93_WoodWall（items.ts 别名支
    //  byKey[ik]=existingIdx+VID 反查指 ik）,而掉落路径读 ITEM_DEFS[vid].key=
    //  蛇形主键 vi_93_wood_wall——同 def 双拼写,字符串精确比对脆弱（拼写域错域
    //  判例）。改 vid 域断言：键解析 vid 匹配 + 掉落键必须注册（防幻影键）。
    const keyVid = (k: string): number => Number(/^vi_(\d+)_/.exec(k)?.[1] ?? -1);
    expect(drops.map((d) => keyVid(d.key))).toContain(WALL_WOOD_VID);   // 掉旧木墙物（vid 域）
    expect(drops.every((d) => ITEM_BY_KEY[d.key] !== undefined)).toBe(true);   // 键全注册
    expect(consumed.length).toBe(1);                  // 换墙照消耗
  });

  it('消耗走 removeHeld 且 FillEmptySpace 补铺逐格扣（:39939 FillEmptySpace）', () => {
    const w = mkWorld();
    const st = w.store;
    // 目标 (10,10) 右邻 (11,10) 被 (9,9)/(9,11)/(8,10) 木墙三面围 → 主放后补铺
    st.setWallSilent(8, 10, 4);
    st.setWallSilent(9, 9, 4);
    st.setWallSilent(9, 11, 4);
    st.setWallSilent(11, 10, 4);                      // 兼作目标邻接门
    const drops: Drop[] = [];
    const { placeWall, consumed } = shell(w, drops, { heldStack: 5 });
    placeWall(10, 10, heldDefOf(WALL_WOOD_VID));
    expect(st.wall[st.idx(10, 10)]).toBe(4);
    expect(st.wall[st.idx(9, 10)]).toBe(4);           // 补铺格落墙
    expect(consumed.length).toBe(2);                  // 主放+补铺两耗
  });

  it('世界边 2 格 margin 拒放（PlaceWall :75728-75731）', () => {
    const w = mkWorld();
    const st = w.store;
    st.setTileSilent(1, 1, 1);                        // 邻接门可过
    const drops: Drop[] = [];
    const { placeWall, consumed } = shell(w, drops);
    placeWall(1, 1, heldDefOf(WALL_STONE_VID));  // i<=1 → 静默 no-op
    expect(st.wall[st.idx(1, 1)]).toBe(0);
    expect(consumed).toEqual([]);
  });
});

// ============================================================
// ③ 键面卫生：VI 权威反查与表内蛇形键双面都带 wallId（影子件保留不动,
//    legacyItemIndex 快照解码链依赖蛇形键存在——本闸门防"清理影子件"回归）
// ============================================================
describe('③ 双键面卫生（items.ts SW-BG1 合并循环两臂）', () => {
  it('表内蛇形键仍全量注册且带 wallId（wallitems-parity F 面不变）', () => {
    const table = wallItemsJson as Record<string, { wall: number; key: string }>;
    for (const [idS, e] of Object.entries(table)) {
      const idx = (ITEM_BY_KEY as Record<string, number>)[e.key];
      expect(idx, `items.ts 未注册 ${e.key}`).toBeDefined();
      expect((ITEM_DEFS[idx] as { wallId?: number }).wallId, `item ${idS} 蛇形面`).toBe(e.wall);
    }
  });
});
