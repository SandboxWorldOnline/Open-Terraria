/**
 * ★G1 谓词批（2026-09-04）回归锁——红队 G1 谓词审计：实体/Housing/液体域
 * "active 位族"口径修复（hasTile=active、isActive=nactive、isActuated=inActive）。
 *
 * 覆盖五域（原版锚行号见各断言）：
 *  (A) Housing 致动可住——CheckRoom/StartRoomCheck/ScoreRoom 全族 nactive 门
 *      （WorldGen.cs:6025/:6108/:5881）——已致动实心格不封房不作种子拒收理由、
 *      不作 ScoreRoom 站位候选（修复前 flags 位读把致动格当活格）。
 *  (B) 关门致动拒——城镇 NPC 开门探格 nactive（NPC.cs:54606 tileSafely5.nactive()；
 *      同 Enemy 战士族攻门 NPC.cs:60584）——已致动门格不被判"关着的门"。
 *  (C) StickyTiles 致动不粘——Collision.StickyTiles `!active()||inActive()→continue`
 *      （Collision.cs:3402-3405）——已致动蛛网/蜂蜜块不黏滞。
 *  (D) 呼吸芦苇致动下不可——Player.cs:23395 `!active()||!tileSolid[type]||
 *      tileSolidTop[type]`——已致动实心盖口不给空气（active 裸位+tileSolid 类型表读）。
 *  (E) CrackedBricks 致动顶盖——SolidTile 族含 !inActive（WorldGen.cs:70658/:70718）
 *      ——已致动顶盖不算"实心顶"，裂砖照碎。
 */
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { TownNPC } from '../src/entities/TownNPC';
import { Inventory } from '../src/items/Inventory';
import { queryRoom, scoreRoom } from '../src/world/Housing';
import { TILE_BY_KEY } from '../src/data/tiles';
import type { GameHooks } from '../src/entities/types';

const WOOD = TILE_BY_KEY['wood']!;
const DOOR_C = TILE_BY_KEY['door_closed']!;

/** 厚壳盒 + 满铺房墙（wall=4 自证宽松墙证据窗,免家具——queryRoom 用 ignoreNeeds）。
 *  内室 [hx0..hx1]×[hy0..hy1]（9×8=72 格 ≥ MIN_TILES 60 计入边界),壳体 wood。 */
function buildWalledBox(w: World, ox: number, oy: number) {
  const st = w.store;
  const outerW = 19, outerH = 20;
  const hx0 = ox + 5, hx1 = ox + 13, hy0 = oy + 6, hy1 = oy + 13;
  for (let x = ox; x < ox + outerW; x++) {
    for (let y = oy; y < oy + outerH; y++) {
      const inHollow = x >= hx0 && x <= hx1 && y >= hy0 && y <= hy1;
      if (!inHollow) st.setTileSilent(x, y, WOOD, 0, 0);
    }
  }
  for (let y = hy0; y <= hy1; y++) {
    for (let x = hx0; x <= hx1; x++) st.wall[st.idx(x, y)] = 4;
  }
  return { hx0, hx1, hy0, hy1 };
}

describe('(A) Housing 致动可住（nactive 门：WorldGen.cs:6025/:6108/:5881）', () => {
  it('正控：无致动房 queryRoom 成立且 ScoreRoom 有正分站位', () => {
    const w = new World(120, 120, 11, 'g1a');
    const r = buildWalledBox(w, 40, 30);
    const q = queryRoom(w.store, r.hx0 + 2, r.hy0 + 2, { ignoreNeeds: true });
    expect(q.room).not.toBeNull();
    const s = scoreRoom(w.store, q.room!, []);
    expect(s.score).toBeGreaterThan(0);
    expect(s.hasStandingSpace).toBe(true);
    expect(s.y).toBe(r.hy1 + 1);            // 内室地板 = 壳顶行（唯一候选行）
  });

  it('种子格=已致动实心：照原版可穿,泛洪自其成立（:6025/:6108 nactive 门）', () => {
    const w = new World(120, 120, 12, 'g1a2');
    const r = buildWalledBox(w, 40, 30);
    // 致动一块【内室】实心块作种子：活实心种子必拒;致动实心种子照常泛洪成立
    // （双向哨:谓词反转（!isActive）或位读回退（flags）都会把本例打回 null）
    w.store.setTileSilent(r.hx0 + 4, r.hy0 + 2, WOOD, 0, 0);
    w.store.setActuated(r.hx0 + 4, r.hy0 + 2, true);
    const q = queryRoom(w.store, r.hx0 + 4, r.hy0 + 2, { ignoreNeeds: true });
    expect(q.reason).not.toBe('solid');     // 修复前 flags 位读 → 'solid' 误拒
    expect(q.room).not.toBeNull();          // 致动格可穿,泛洪照常成立
    expect(q.reason).toBe('ok');
  });

  it('内室已致动实心格不封房、不作 BlockingWall（:6108 nactive 门）', () => {
    const w = new World(120, 120, 13, 'g1a3');
    const r = buildWalledBox(w, 40, 30);
    w.store.setTileSilent(r.hx0 + 4, r.hy0 + 2, WOOD, 0, 0);
    w.store.setActuated(r.hx0 + 4, r.hy0 + 2, true);
    const q = queryRoom(w.store, r.hx0 + 1, r.hy0 + 2, { ignoreNeeds: true });
    expect(q.room).not.toBeNull();
    expect(q.reason).toBe('ok');
    // 致动块两侧内室连通（泛洪未把它当房界阻断）：tiles 同时含块左邻与右邻
    const st = w.store;
    expect(q.room!.tiles.has(st.idx(r.hx0 + 3, r.hy0 + 2))).toBe(true);
    expect(q.room!.tiles.has(st.idx(r.hx0 + 5, r.hy0 + 2))).toBe(true);
  });

  it('ScoreRoom：已致动地板格不作站位候选（:5881 nactive）→ 0 分无站位', () => {
    const w = new World(120, 240, 14, 'g1a4');
    const st = w.store;
    // 单列站位盒：地板行 40（列 39..41）+ 列 40 上方 36..39 空气（手工 Room——
    // 唯一候选= (40,40),避免"致动行后下移一行成新候选"的合法 vanilla 级联干扰）
    for (let x = 39; x <= 41; x++) st.setTileSilent(x, 40, WOOD, 0, 0);
    const tiles = new Set<number>();
    for (let y = 36; y <= 39; y++) tiles.add(st.idx(40, y));
    for (let x = 39; x <= 41; x++) tiles.add(st.idx(x, 40));
    const room = { standX: 40, standY: 39, tiles };
    const s1 = scoreRoom(st, room, []);
    expect(s1.score).toBeGreaterThan(0);
    expect(s1.x).toBe(40);
    expect(s1.y).toBe(40);
    // 地板三格整体致动（候选门 nactive 首支 + 左右 nactive 尾支全灭）
    for (let x = 39; x <= 41; x++) st.setActuated(x, 40, true);
    const s2 = scoreRoom(st, room, []);
    expect(s2.score).toBe(0);
    expect(s2.hasStandingSpace).toBe(false);
  });
});

describe('(B) 关门致动拒（NPC.cs:54606 nactive 探格;Enemy:60584 同族）', () => {
  const mkHooks = () => ({ playSfx: vi.fn() }) as unknown as GameHooks;

  function buildDoor(w: World, D: number, R: number) {
    const st = w.store;
    for (let dy = 0; dy < 3; dy++) st.setTileSilent(D, R + dy, DOOR_C, 0, dy * 18);
    return st;
  }

  function mkNpc(D: number, R: number): TownNPC {
    const npc = new TownNPC('guide', 0, 0);
    npc.x = D * 16 + 8 - npc.w / 2 - 15;    // n25 = D（:54515 前视 15px）
    npc.y = R * 16 + 16 - npc.h + 8;        // n26 = R+2（探行 [R, R+2] 全门列）
    const npcAny = npc as unknown as { homeFlag: boolean; closeDoor: boolean };
    npcAny.homeFlag = true;                 // 免掷必开（:54578 flag 支）
    npcAny.closeDoor = false;
    npc.facing = 1;
    return npc;
  }

  it('正控：活门 → 开门成功（closeDoor 置位、门变开态）', () => {
    const w = new World(120, 120, 21, 'g1b1');
    const st = buildDoor(w, 60, 40);
    const npc = mkNpc(60, 40);
    const opened = (npc as unknown as { tryOpenDoorAhead: (s: typeof st, g: GameHooks) => boolean })
      .tryOpenDoorAhead(st, mkHooks());
    expect(opened).toBe(true);
    expect((npc as unknown as { closeDoor: boolean }).closeDoor).toBe(true);
    expect(st.type[st.idx(60, 40)]).not.toBe(DOOR_C);   // 已翻转开态
  });

  it('已致动门格：探格不命中 → 不开门、不置 closeDoor', () => {
    const w = new World(120, 120, 22, 'g1b2');
    const st = buildDoor(w, 60, 40);
    for (let dy = 0; dy < 3; dy++) st.setActuated(60, 40 + dy, true);
    const npc = mkNpc(60, 40);
    const opened = (npc as unknown as { tryOpenDoorAhead: (s: typeof st, g: GameHooks) => boolean })
      .tryOpenDoorAhead(st, mkHooks());
    expect(opened).toBe(false);
    expect((npc as unknown as { closeDoor: boolean }).closeDoor).toBe(false);
    expect(st.type[st.idx(60, 40)]).toBe(DOOR_C);       // 门原样（修复前会被误开）
  });
});

describe('(C) StickyTiles 致动不粘（Collision.cs:3402-3405 `!active||inActive→continue`）', () => {
  const mkHooks = (w: World) => ({
    world: w, spawnDrop: () => null, addDamageNumber: () => {}, playSfx: () => {},
    spawnParticles: () => {}, onInventoryChanged: () => {},
  });

  it('正控：活蛛网阻尼 + 禁跳', () => {
    const w = new World(40, 40, 31, 'g1c1');
    const WEB = TILE_BY_KEY['v_51_cobweb']!;
    for (let y = 18; y <= 21; y++) w.store.setTileSilent(20, y, WEB);
    const p = new Player(20 * 16, 17 * 16, new Inventory());
    p.vy = 8; p.vx = 3; p.jumpHold = 10;
    p.fixedUpdate(1 / 60, mkHooks(w) as never);
    expect(p.vy).toBeLessThanOrEqual(1 * 0.3 + 0.36);   // 下落阻尼面（松键拍）
    // ★BJ705-G23:禁跳面判别迁持键位——松键 release-clear（:21201-08）与网内清零
    // （:8483）同产 0=松键态掩蔽;持键态网内清零是唯一 0 源
    p.inputJump = true; p.jumpHold = 10; p.vy = 0.5;
    p.fixedUpdate(1 / 60, mkHooks(w) as never);
    expect(p.jumpHold).toBe(0);             // 网内禁跳清零（L22676——持键态）
  });

  it('已致动蛛网：不黏滞（正常重力下落,跳不禁）', () => {
    const w = new World(40, 40, 32, 'g1c2');
    const WEB = TILE_BY_KEY['v_51_cobweb']!;
    for (let y = 18; y <= 21; y++) {
      w.store.setTileSilent(20, y, WEB);
      w.store.setActuated(20, y, true);
    }
    const p = new Player(20 * 16, 17 * 16, new Inventory());
    p.vy = 8; p.vx = 3; p.jumpHold = 10;
    p.fixedUpdate(1 / 60, mkHooks(w) as never);
    expect(p.vy).toBeGreaterThan(4);        // 未阻尼（修复前 flags 位读 → 误黏滞）
    expect(p.jumpHold).toBe(0);             // ★BJ705-G23:松键即清（:21201-08——无键态预算不存活,非网清）
    // 禁跳面判别（★BJ705-G23 迁移,对照 Test1 持键位）:持键态无网清=正常流逝
    p.inputJump = true; p.jumpHold = 10; p.vy = 0.5;
    p.fixedUpdate(1 / 60, mkHooks(w) as never);
    expect(p.jumpHold).toBe(9);             // 未清零（致动=网外语义;活网持键=0 对照）
  });
});

describe('(D) 呼吸芦苇：已致动实心盖口不给空气（Player.cs:23395）', () => {
  const mkHooks = (w: World) => ({
    world: w, spawnDrop: () => null, addDamageNumber: () => {}, playSfx: () => {},
    spawnParticles: () => {}, onInventoryChanged: () => {}, askSpectateExit: () => {},
    damagePlayer: () => 0, cutTile: () => {}, spawnEnemy: () => {}, onEnemyKilled: () => {},
    notifyInventoryChanged: () => {}, showPickupLabel: () => {}, spawnDust: () => {},
  });

  /** 头浸水 + 管口格（头顶 44px、前偏 6px 列）由 cover 控制的水下场景。
   *  玩家站底（行 46 顶,y=694）：口点=(648,650)→格 (40,40)=M 行;
   *  水柱 (40, 42..45) 盖头部盒——口行在水面之上。 */
  function buildUnderwater(w: World, C: number, M: number, cover: number) {
    const st = w.store;
    for (let y = M + 2; y <= M + 5; y++) {
      const i = st.idx(C, y);
      st.liquid[i] = 255; st.liquidType[i] = 0;
    }
    for (let x = C - 4; x <= C + 4; x++) {
      st.setTileSilent(x, M + 6, TILE_BY_KEY['stone'] ?? TILE_BY_KEY['wood']!, 0, 0);
      st.setTileSilent(x, M + 7, TILE_BY_KEY['stone'] ?? TILE_BY_KEY['wood']!, 0, 0);
    }
    if (cover) st.setTileSilent(C, M, cover, 0, 0);
    const p = new Player(C * 16 - 8, (M + 6) * 16 - 42, new Inventory());
    Object.defineProperty(p, 'hasBreathingReed', { value: true });  // 芦苇管在手
    p.itemAnimTicks = 0;
    return p;
  }

  it('管口开敞 → 给空气（breath 不掉）', () => {
    const w = new World(80, 240, 41, 'g1d1');
    const p = buildUnderwater(w, 40, 40, 0);
    for (let t = 0; t < 120; t++) p.fixedUpdate(1 / 60, mkHooks(w) as never);
    expect(p.breath).toBe(p.breathMax);
  });

  it('管口被已致动实心盖住 → 不给空气（breath 掉）', () => {
    const w = new World(80, 240, 42, 'g1d2');
    const p = buildUnderwater(w, 40, 40, TILE_BY_KEY['stone'] ?? TILE_BY_KEY['wood']!);
    w.store.setActuated(40, 40, true);
    for (let t = 0; t < 120; t++) p.fixedUpdate(1 / 60, mkHooks(w) as never);
    expect(p.breath).toBeLessThan(p.breathMax);   // 修复前 isSolid 排致动 → 误给空气
  });

  it('管口被活实心盖住 → 同样不给空气（对照,原文本义）', () => {
    const w = new World(80, 240, 43, 'g1d3');
    const p = buildUnderwater(w, 40, 40, TILE_BY_KEY['stone'] ?? TILE_BY_KEY['wood']!);
    for (let t = 0; t < 120; t++) p.fixedUpdate(1 / 60, mkHooks(w) as never);
    expect(p.breath).toBeLessThan(p.breathMax);
  });
});

describe('(E) CrackedBricks：已致动顶盖不算实心顶（WorldGen.cs:70658 SolidTile !inActive）', () => {
  const CRACK = () => TILE_BY_KEY['v_482_cracked_green_brick']!;
  const DIRT = TILE_BY_KEY['dirt']!;
  const mkHooks = (w: World, breakTile?: (x: number, y: number) => void) => ({
    world: w, spawnDrop: () => null, spawnParticles: vi.fn(), playSfx: vi.fn(),
    addDamageNumber: vi.fn(), onInventoryChanged: vi.fn(), breakTile,
  }) as unknown as GameHooks;

  it('裂砖上方盖已致动泥土：顶盖不护砖 → 照碎', () => {
    const w = new World(60, 120, 51, 'g1e1');
    const broke: Array<[number, number]> = [];
    for (let x = 24; x <= 32; x++) w.store.setTileSilent(x, 30, CRACK());
    // (26,29)/(27,29) 盖已致动泥土——原版 SolidTile 含 !inActive → 非实心顶
    w.store.setTileSilent(26, 29, DIRT, 0, 0);
    w.store.setTileSilent(27, 29, DIRT, 0, 0);
    w.store.setActuated(26, 29, true);
    w.store.setActuated(27, 29, true);
    const p = new Player(26 * 16, 438, new Inventory());
    p.vy = 12;
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      (p as unknown as { checkCrackedBrickBreak: (g: GameHooks) => void })
        .checkCrackedBrickBreak(mkHooks(w, (x, y) => broke.push([x, y])));
      expect(broke).toContainEqual([26, 30]);   // 致动盖下裂砖被碎（修复前被护住）
      expect(broke).toContainEqual([27, 30]);
    } finally {
      rnd.mockRestore();
    }
  });

  it('对照：裂砖上方活泥土（实心顶）→ 护砖不碎', () => {
    const w = new World(60, 120, 52, 'g1e2');
    const broke: Array<[number, number]> = [];
    for (let x = 24; x <= 32; x++) w.store.setTileSilent(x, 30, CRACK());
    w.store.setTileSilent(26, 29, DIRT, 0, 0);
    w.store.setTileSilent(27, 29, DIRT, 0, 0);
    const p = new Player(26 * 16, 438, new Inventory());
    p.vy = 12;
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      (p as unknown as { checkCrackedBrickBreak: (g: GameHooks) => void })
        .checkCrackedBrickBreak(mkHooks(w, (x, y) => broke.push([x, y])));
      expect(broke).not.toContainEqual([26, 30]);
      expect(broke).not.toContainEqual([27, 30]);
    } finally {
      rnd.mockRestore();
    }
  });
});
