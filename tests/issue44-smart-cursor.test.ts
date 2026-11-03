// ★issue#44 智能光标一致性审计（9 项）定点回归 + 变异自证。
//
// 权威：1457 反编译（SmartCursorHelper.cs / TileReachCheckSettings.cs /
// TriggersSet.cs / Player.cs / WorldGen.cs / Main.cs）。issue 原文行号取
// 1.4.5.8 第三方仓，本文件注释一律重锚 1457（行号见各测试）。
//
// 判别锁编号与 issue 项一一对应：
//   I44-01 planter box 让位门（window.screenX 自由标识符）
//   I44-02 宏大蓝图蓝/绿线位（工具位 vs 线位两套位序）
//   I44-03 tileCut 权威表（TILE_CUT_SHEETS 两向偏差）
//   I44-04 GetTileRegion 基础射程（配饰/工具箱/旅程）与「先钳后加 TB」序
//   I44-05 tileBoost 首项 + placing=createTile>0 门
//   I44-06 WorldGen.CanKillTile 全式（动态拒绝面）
//   I44-07 锤：回退段归约鼠标（7a）/ gravDir==-1 端点行 +1（7b）
//   I44-08 界面内 Toggle 切换（controlSmart 无 uiBlocking 门；全屏地图清零）
//   I44-09 斧帧校正逐次重读（原生帧表不可达证明 + 世界编辑/模组可构造面）
//
// 运行：cd game && npx vitest run tests/issue44-smart-cursor.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { TileStore } from '../src/world/TileStore';
import { T, TILE_BY_KEY, TILE_DEFS, TILE_CUT_SHEETS } from '../src/data/tiles';
import type { ItemDef } from '../src/data/items';
import {
  SmartCursor, DEFAULT_SMART_CURSOR_SETTINGS, smartCursorControlSmart,
  smartCursorArrowAllowed, type SmartCursorEnv, type SmartCursorSettings,
} from '../src/player/SmartCursor';
import { canKillTileAt } from '../src/entities/Mounts';
import { tileBoostOfVid } from '../src/player/ToolCursorIcon';
import { withMutation } from './mutation-guard';

const W = 220, H = 160;
const GAME = join(__dirname, '..');
const SC = join(GAME, 'src', 'player', 'SmartCursor.ts');
const GT = join(GAME, 'src', 'core', 'Game.ts');

// ---------------- 夹具 ----------------
const actorAt = (tx: number, ty: number) => {
  const x = tx * 16, y = ty * 16;
  return { x, y, w: 20, h: 42, cx: x + 10, cy: y + 21, facing: 1 };
};
const mouseAt = (tx: number, ty: number) => ({ x: tx * 16 + 8, y: ty * 16 + 8 });
const defOf = (over: Partial<ItemDef> & { key: string }): ItemDef =>
  ({ name: '', maxStack: 1, ...over });

function mkEnv(
  st: TileStore, mouse: { x: number; y: number },
  held: { def: ItemDef | null; tool: { type: 'pick' | 'axe' | 'hammer' | 'sword'; power: number } | null },
  over: Partial<SmartCursorEnv> = {},
): SmartCursorEnv {
  return {
    st,
    mouse,
    actor: actorAt(100, 95),
    held,
    settings: { ...DEFAULT_SMART_CURSOR_SETTINGS },
    tileBoost: 0,
    wireToolMode: 0,
    occupants: [],
    controlUseItem: true,
    ...over,
  };
}

/** 跑一次 lookup 并返回目标（无目标 null） */
function run(env: SmartCursorEnv, sc = new SmartCursor()): { x: number; y: number } | null {
  sc.wanted = true;
  sc.lookup(env);
  return sc.showing ? { x: sc.x, y: sc.y } : null;
}

const pick = () => ({ def: defOf({ key: 'i44_pick' }), tool: { type: 'pick' as const, power: 35 } });
const axe = () => ({ def: defOf({ key: 'i44_axe' }), tool: { type: 'axe' as const, power: 10 } });
const hammer = () => ({ def: defOf({ key: 'i44_hammer' }), tool: { type: 'hammer' as const, power: 25 } });
const torch = () => ({ def: defOf({ key: 'i44_torch', vid: 8 }), tool: null });
const planterBox = () => ({ def: defOf({ key: 'i44_planter', vid: 3215, tile: 'v_380_planter_boxes' }), tool: null });
const multicolorWrench = () => ({ def: defOf({ key: 'i44_multiwrench', vid: 3625 }), tool: null });
const wireCutter = () => ({ def: defOf({ key: 'i44_wirecutter', vid: 510 }), tool: null });
/** 测试面 Main.tileCut 内部 id 域谓词（等价 Game.TILE_CUT；IDG-T2 只管 src 树，
 *  测试域可直读 sheet 权威表） */
const cutPred = (t: number): boolean => TILE_CUT_SHEETS.has(TILE_DEFS[t]?.vanilla?.sheet ?? -1);

// ★issue#44-2：工具位（WiresUI.MultiToolMode 与本仓 wiringToolBits.ts 同值）
const TOOL_GREEN = 2, TOOL_BLUE = 4;

describe('issue#44 智能光标一致性审计', () => {
  // ================= 1. 种植盆让位门（:431-435） =================
  describe('I44-01 种植盆让位（SmartCursorHelper.cs:431-435）', () => {
    const scene = () => {
      const st = new TileStore(W, H);
      const box = TILE_BY_KEY['v_380_planter_boxes'];
      expect(box).toBeGreaterThan(0);
      for (let x = 43; x <= 47; x++) st.setTile(x, 90, box);   // 连排盆 43..47
      return st;
    };

    it('I44-01A 鼠标悬停已有盆 → 让位（showing=false；修前 window.screenX 门恒假→跳到 48,90）', () => {
      const st = scene();
      // 原版 :445 `tile.active() && tile.type == 380` → flag=true → 整支不产目标
      const env = mkEnv(st, mouseAt(46, 90), planterBox(), { actor: actorAt(49, 91) });
      expect(run(env)).toBeNull();
    });

    it('I44-01B 负控：鼠标在盆旁空格 → 正常续放该空位（让位门只认盆本身）', () => {
      const st = scene();
      const env = mkEnv(st, mouseAt(48, 90), planterBox(), { actor: actorAt(49, 91) });
      expect(run(env)).toEqual({ x: 48, y: 90 });
    });
  });

  // ================= 2. 宏大蓝图蓝/绿线位 =================
  describe('I44-02 多彩扳手蓝/绿线位（WiresUI.cs:13-21 / SmartCursorHelper.cs:1743-1768）', () => {
    it('I44-02A 绿模式 + 绿线 → 延伸绿线端点（修前查 WIRE_BLUE=2 → 找不到）', () => {
      const st = new TileStore(W, H);
      st.setWireSilent(104, 95, TileStore.WIRE_GREEN);
      const env = mkEnv(st, mouseAt(105, 95), multicolorWrench(), { wireToolMode: TOOL_GREEN });
      expect(run(env)).toEqual({ x: 105, y: 95 });
    });

    it('I44-02B 负控：蓝模式 + 世界无蓝线 → 无目标（修前把绿线当蓝线选中）', () => {
      const st = new TileStore(W, H);
      st.setWireSilent(104, 95, TileStore.WIRE_GREEN);
      const env = mkEnv(st, mouseAt(105, 95), multicolorWrench(), { wireToolMode: TOOL_BLUE });
      expect(run(env)).toBeNull();
    });

    it('I44-02C 鼠标格线组合 == 工具模式（去 Cutter）→ 让位（修前绿线被映射成工具 Blue 位）', () => {
      const st = new TileStore(W, H);
      st.setWireSilent(104, 95, TileStore.WIRE_GREEN);   // 鼠标格
      st.setWireSilent(107, 95, TileStore.WIRE_BLUE);    // 修前会在这里找蓝线目标
      const env = mkEnv(st, mouseAt(104, 95), multicolorWrench(), { wireToolMode: TOOL_GREEN });
      expect(run(env)).toBeNull();
    });
  });

  // ================= 3. tileCut 权威表 =================
  describe('I44-03 Main.tileCut 权威表（Main.cs:7502-10388 全 41 条）', () => {
    it('I44-03A decor 但非 tileCut（绳 213）→ 火把不放（修前 decor 代读→放进绳格）', () => {
      const st = new TileStore(W, H);
      st.setTile(104, 98, T.STONE);                        // 唯一支撑位在地板下方
      st.setTile(104, 97, TILE_BY_KEY['v_213_rope']);
      st.setWallSilent(104, 97, 7);
      const env = mkEnv(st, mouseAt(104, 97), torch(),
        { actor: actorAt(100, 95), tileCut: cutPred });
      // 判别 = 不得选中绳格本身（地板侧邻 (103,98) 是合法锚位,故不要求 null）；
      // 修前 decor 代读会让 (104,97) 以距离 0 胜出。
      expect(run(env)).not.toEqual({ x: 104, y: 97 });
    });

    it('I44-03B tileCut 但非 decor（蛛网 51）→ 火把可落（修前 decor=false 当障碍跳过）', () => {
      const st = new TileStore(W, H);
      st.setTile(104, 97, TILE_BY_KEY['v_51_cobweb']);
      st.setWallSilent(104, 97, 7);
      const env = mkEnv(st, mouseAt(104, 97), torch(),
        { actor: actorAt(100, 95), tileCut: cutPred });
      expect(run(env)).toEqual({ x: 104, y: 97 });
    });

    it('I44-03C 箭头门走同一 tileCut 域：草丛 true / 树苗 sheet20 false（原版 Player.cs:40068-40075）', () => {
      const st = new TileStore(W, H);
      st.setTile(110, 100, TILE_BY_KEY['tallgrass']!);            // sheet3 ∈ tileCut
      st.setTile(110, 103, TILE_BY_KEY['acorn_sapling']!);        // sheet20 decor 但 ∉ tileCut/BWP
      expect(smartCursorArrowAllowed(st, 109, 100, { x: 1, y: 0 }, cutPred)).toBe(true);
      expect(smartCursorArrowAllowed(st, 109, 103, { x: 1, y: 0 }, cutPred)).toBe(false);
    });
  });

  // ================= 4. GetTileRegion 基础射程 =================
  describe('I44-04 可达区基础射程（TileReachCheckSettings.cs:28-62）', () => {
    it('I44-04A reachX=18（射程配饰/旅程）→ 16 格外目标可及（修前恒 5 → 只到 105）', () => {
      const st = new TileStore(W, H);
      for (let x = 95; x <= 125; x++) st.setTile(x, 98, T.STONE);
      const env = mkEnv(st, mouseAt(116, 97), torch(), { actor: actorAt(100, 95), reachX: 18 });
      expect(run(env)).toEqual({ x: 116, y: 97 });
    });

    it('I44-04B 负控：缺省 5 → 目标缩到可达区边缘（证明 A 的差异由 reachX 驱动）', () => {
      const st = new TileStore(W, H);
      for (let x = 95; x <= 125; x++) st.setTile(x, 98, T.STONE);
      const env = mkEnv(st, mouseAt(116, 97), torch(), { actor: actorAt(100, 95) });
      const t = run(env);
      expect(t).not.toBeNull();
      // 缺省 GetRanges X=5：玩家列 100..101 → x1 = ceil(102.25)-1+5 = 106
      expect(t!.x).toBeLessThanOrEqual(106);
    });

    it('I44-04D tb 在 y 轴同样生效（GetTileRegion :53-57 x/y 都 +=TB）', () => {
      const st = new TileStore(W, H);
      st.setTile(100, 84, T.STONE);                        // 支撑，上方 (100,83) 为火把锚位
      // reachY=10 + tb=2 → y=12 → y0=95-12=83（目标恰在上界）
      const withTb = mkEnv(st, mouseAt(100, 83), torch(), { actor: actorAt(100, 95), reachY: 10, tileBoost: 2 });
      expect(run(withTb)).toEqual({ x: 100, y: 83 });
      // 负控：同 reachY 但 tb=0 → y0=85，目标不可及（证差异由 y 轴 tb 驱动）
      const noTb = mkEnv(st, mouseAt(100, 83), torch(), { actor: actorAt(100, 95), reachY: 10 });
      expect(run(noTb)).toBeNull();
    });

    it('I44-04C reachY=10（竖向射程）→ 9 格上方锚位可及；缺省 3 → 无目标', () => {
      const st = new TileStore(W, H);
      st.setTile(100, 87, T.STONE);                        // 孤立支撑，上方 (100,86) 为火把锚位
      const far = mkEnv(st, mouseAt(100, 86), torch(), { actor: actorAt(100, 95), reachY: 10 });
      expect(run(far)).toEqual({ x: 100, y: 86 });
      const near = mkEnv(st, mouseAt(100, 86), torch(), { actor: actorAt(100, 95) });
      expect(run(near)).toBeNull();
    });
  });

  // ================= 5. tileBoost 首项 + createTile>0 门 =================
  describe('I44-05 tileBoost（SmartCursorHelper.cs:94-99）', () => {
    it('I44-05A 手持剪线钳 tb=20 → 9 格外导线可及（修前 tb=blockRange=0 → 不可及）', () => {
      const st = new TileStore(W, H);
      st.setWireSilent(109, 95, TileStore.WIRE_RED);
      const env = mkEnv(st, mouseAt(109, 95), wireCutter(), { actor: actorAt(100, 95), tileBoost: 20 });
      expect(run(env)).toEqual({ x: 109, y: 95 });
      const noTb = mkEnv(st, mouseAt(109, 95), wireCutter(), { actor: actorAt(100, 95), tileBoost: 0 });
      expect(run(noTb)).toBeNull();
    });

    it('I44-05B tileBoost 表锚（Item.cs SetDefaults；仓内单源 ToolCursorIcon.ts:70-107）', () => {
      expect(tileBoostOfVid(1294)).toBe(1);      // 锯刃镐 :16005
      expect(tileBoostOfVid(510)).toBe(20);      // 剪线钳 :7457
      expect(tileBoostOfVid(3612)).toBe(20);     // 黄扳手 :32539
      expect(tileBoostOfVid(3625)).toBe(20);     // 多彩扳手 :32680
      expect(tileBoostOfVid(387)).toBe(-1);      // 链锯族尾修 :48902-48914
      expect(tileBoostOfVid(2340)).toBe(5);      // 矿车轨道 :23515
    });
  });

  // ================= 6. WorldGen.CanKillTile 全式 =================
  describe('I44-06 WorldGen.CanKillTile 全式（WorldGen.cs:62716-62832）', () => {
    it('I44-06A 目标格正上方是宝箱 → 候选被剔除（修前按类型 pick>=0 → 钉死挖不动的格）', () => {
      const st = new TileStore(W, H);
      st.setTile(106, 95, T.DIRT);
      st.setTile(106, 94, T.CHEST);                        // 上方承载位 → CanKillTile=false
      expect(canKillTileAt(st, 106, 95)).toBe(false);
      // issue 原报场景同锚：上邻是树干（异型 + frameY<198 非树顶豁免）→ 同样拒
      const stTree = new TileStore(W, H);
      stTree.setTile(106, 95, T.DIRT);
      stTree.setTile(106, 94, T.TREE);
      expect(canKillTileAt(stTree, 106, 95)).toBe(false);
      const env = mkEnv(st, mouseAt(106, 95), pick(), { actor: actorAt(101, 95) });
      expect(run(env)).toBeNull();
      // 负控：撤掉宝箱后同一格恢复可挖（差异由动态拒绝面驱动，不是场景伪影）
      const st2 = new TileStore(W, H);
      st2.setTile(106, 95, T.DIRT);
      expect(canKillTileAt(st2, 106, 95)).toBe(true);
      expect(run(mkEnv(st2, mouseAt(106, 95), pick(), { actor: actorAt(101, 95) }))).toEqual({ x: 106, y: 95 });
    });

    it('I44-06C ForceCursor 消费点（:2259）同样走坐标全式（旧版此处只按类型判）', () => {
      const st = new TileStore(W, H);
      // 非实心、非平台、且不在「让位集」（:92 DISABLE_SMART_CURSOR_SHEETS）里的
      // 可割植物 → ForceCursor 的类型门会放行，唯一拦截面是 CanKillTile。
      // （火把 4 在让位集内 → 整段 lookup 早退，不能用作本测试夹具。）
      st.setTile(106, 95, TILE_BY_KEY['tallgrass']!);
      // 正控：注入 true → 钉住鼠标格
      expect(run(mkEnv(st, mouseAt(106, 95), pick(), { actor: actorAt(101, 95) })))
        .toEqual({ x: 106, y: 95 });
      // 负控：注入 false → 被剔除（若 ForceCursor 回退成 pick>=0 类型判，本行必红）
      expect(run(mkEnv(st, mouseAt(106, 95), pick(), {
        actor: actorAt(101, 95), canKillTile: () => false,
      }))).toBeNull();
    });

    it('I44-06B Game 注入的 canKillTile（含 ctx）优先于回退实现', () => {
      const st = new TileStore(W, H);
      st.setTile(106, 95, T.STONE);                        // 类型面可挖
      const env = mkEnv(st, mouseAt(106, 95), pick(), {
        actor: actorAt(101, 95),
        canKillTile: () => false,                          // Game.canKillTile 全式说不可挖
      });
      expect(run(env)).toBeNull();
    });
  });

  // ================= 7. 锤子两档 =================
  describe('I44-07 锤回退择近与 gravDir 档（SmartCursorHelper.cs:1555-1564 / :1608-1611 / :1716）', () => {
    it('I44-07A 回退段用 3:1 归约后的鼠标择近（修前原始 mouse.y → 选 50,102）', () => {
      const st = new TileStore(W, H);
      st.setWallSilent(50, 95, 7);
      st.setWallSilent(50, 102, 7);
      const actor = { x: 736, y: 1558, w: 20, h: 42, cx: 746, cy: 1579, facing: 1 };
      // 原始鼠标 (904,1590.4)：dist 114.5 vs 108.1 → 旧实现选 (50,102)；
      // 归约后 mouse=(904,1579)：108.7 vs 113.7 → 原版选 (50,95)。
      const env = mkEnv(st, { x: 904, y: 1590.4 }, hammer(), { actor });
      expect(run(env)).toEqual({ x: 50, y: 95 });
    });

    it('I44-07B gravDir=-1 且纯水平 → 端点行 +1（修前缺档，落到 47,98 而非 50,101）', () => {
      const st = new TileStore(W, H);
      st.setWallSilent(47, 98, 7);                         // 仅 gravDir=1 路径可达（近玩家中心）
      st.setWallSilent(50, 101, 7);                        // 仅 gravDir=-1 的 +1 端点行可达
      const actor = { x: 736, y: 1584, w: 20, h: 42, cx: 746, cy: 1605, facing: 1 };
      const mouse = { x: 806, y: 1610 };
      const up = mkEnv(st, mouse, hammer(), { actor, gravDir: -1 });
      expect(run(up)).toEqual({ x: 50, y: 101 });
      // 负控：gravDir=1 时无 +1 支 → 走另一条射线（证差异由该档驱动）
      const down = mkEnv(st, mouse, hammer(), { actor, gravDir: 1 });
      expect(run(down)).toEqual({ x: 47, y: 98 });
    });
  });

  // ================= 8. 界面内 Toggle 切换 =================
  describe('I44-08 controlSmart 界面门（TriggersSet.cs:783-796 / Player.cs:24998/:25056-25079）', () => {
    it('I44-08A 裸键电平补 uiBlocking 缺口；无模式门（Toggle/Hold 同读）；全屏地图清零', () => {
      // downAction 被 uiBlocking 压成 false，裸键电平补上
      expect(smartCursorControlSmart(false, true, false)).toBe(true);
      // 正常帧 downAction 已真
      expect(smartCursorControlSmart(true, false, false)).toBe(true);
      // ★红队勘正：原版 controlSmart 无 Toggle/Hold 门（:29042-29071 两档读同一电平）
      // ——旧实现把裸键限定在 toggleMode，Hold 档在模态内永远切不了（欠接线）。
      // 本函数不再接收 mode 参数本身即结构锁：任何 mode 门都无处安放。
      expect(smartCursorControlSmart(false, true, false)).toBe(true);
      // 全屏地图：原版 controlSmart=false（Player.cs:24998）
      expect(smartCursorControlSmart(true, true, true)).toBe(false);
      // 负控：两个来源都 false → false（证裸键支是承重面而非恒真）
      expect(smartCursorControlSmart(false, false, false)).toBe(false);
    });

    it('I44-08B overUi 门：门关时 wanted 冻结、prevSmart 仍跟随（原版整段不调用）', () => {
      const sc = new SmartCursor();
      const S: SmartCursorSettings = { ...DEFAULT_SMART_CURSOR_SETTINGS, toggleMode: true };
      expect(sc.wanted).toBe(false);
      // 门关（光标悬停 UI）+ 按住 Ctrl：原版 TryToToggleSmartCursor 整段不执行
      expect(sc.updateWanted(true, false, S, false)).toBe(false);
      expect(sc.wanted).toBe(false);
      // 鼠标移出 UI、Ctrl 仍按住 → 门开。原版 releaseSmart 已在门外被清成 false
      // （Player.cs:25072-25079），故此刻 controlSmart&&releaseSmart=false → 不补沿。
      expect(sc.updateWanted(true, false, S, true)).toBe(false);
      expect(sc.wanted).toBe(false);
      // 真正松开再按 → 切换
      expect(sc.updateWanted(false, false, S, true)).toBe(false);
      expect(sc.updateWanted(true, false, S, true)).toBe(true);
      expect(sc.wanted).toBe(true);
      // 负控对照：若 prevSmart 也随门冻结（错误实现），上式第三次会补出一个沿
      // → wanted 直接为 true 而第四次返回 false。上面的序列已排除该实现。
    });

    it('I44-08C overUi 门：Hold 档同样冻结（原版两档共用同一调用点）', () => {
      const sc = new SmartCursor();
      const H: SmartCursorSettings = { ...DEFAULT_SMART_CURSOR_SETTINGS, toggleMode: false };
      expect(sc.updateWanted(true, false, H, true)).toBe(true);
      expect(sc.wanted).toBe(true);
      // 门关期间的松开不作用 → wanted 保持
      expect(sc.updateWanted(false, false, H, false)).toBe(false);
      expect(sc.wanted).toBe(true);
      // 门开后电平仍 false → 松开归零（Hold 缺省档 wanted=false）
      sc.updateWanted(false, false, H, true);
      expect(sc.wanted).toBe(false);
    });
  });

  // ================= 9. 斧帧校正逐次重读 =================
  describe('I44-09 斧帧校正索引（SmartCursorHelper.cs:2623-2651）', () => {
    it('I44-09A 首支推进后次支读新格（修前缓存首索引 → 目标停在 51,100）', () => {
      // 树帧签名（WorldGen.cs:27676-27706 / IsTileATreeBranch :30010-30019）交叉构造：
      //  (50,100) 左枝 A 签名 frameX44/frameY198 → 原版 num2++ 到 51；
      //  (51,100) 左枝 B 签名 frameX66/frameY0   → 原版【重读新格】再 ++ 到 52；
      //  (52,100) 普通干帧。旧实现三判读同一 i2 → 停在 51。
      const st = new TileStore(W, H);
      st.setTile(50, 100, T.TREE, 44, 198);
      st.setTile(51, 100, T.TREE, 66, 0);
      st.setTile(52, 100, T.TREE, 0, 0);
      const env = mkEnv(st, mouseAt(51, 100), axe(), { actor: actorAt(46, 100) });
      expect(run(env)).toEqual({ x: 52, y: 100 });
    });

    it('I44-09B 仙人掌支（:2659-2679）同样逐次重读：54 → 108/36 两连推进', () => {
      // 鼠标压在最左候选上：若第一支后不重读，(50,100) 只推进到 51，且 51 比 52
      // 更近鼠标 → 目标停在 51（红）。正确实现 (50,100)/(51,100) 均落到主干 52。
      const st = new TileStore(W, H);
      const C = TILE_BY_KEY['v_80_cactus']!;
      st.setTile(50, 100, C, 54, 0);       // 左探针命中 → num2=51
      st.setTile(51, 100, C, 108, 36);     // 重读新格再命中 → num2=52
      st.setTile(52, 100, C, 0, 0);        // 主干
      const env = mkEnv(st, mouseAt(50, 100), axe(), { actor: actorAt(46, 100) });
      expect(run(env)).toEqual({ x: 52, y: 100 });
    });

    it('I44-09C 结构锁：树干/仙人掌共 6 处第二次索引重取（缓存首索引即退 3 处）', () => {
      // 行为测只覆盖首支（I44-09A）与仙人掌首支（I44-09B）；原版 :2623-2651 +
      // :2659-2679 逐 if 重读共 6 处，任一被改回缓存首索引时须有断言接住。
      const src = readFileSync(SC, 'utf8');
      const rereads = src.match(/^\s*i2 = st\.idx\(num2, k\);$/gm) ?? [];
      expect(rereads.length).toBe(6);
    });
  });

  // ================= 源文本结构锁（Game 侧实参接线；Game.ts 禁变异） =================
  describe('I44-00 Game.ts 实参接线结构锁', () => {
    const segment = (): string => {
      const src = readFileSync(GT, 'utf8');
      const a = src.indexOf('private updateSmartCursor()');
      const b = src.indexOf('private updateSmartSelect()', a);
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(a);
      return src.slice(a, b);
    };

    /** ★E5 红队补强（2026-11-03）：`toContain` 会被**后写的重复键**绕过
     *  （同一对象字面量里再补一行 `tileBoost: 0,` 覆盖前者，子串仍在）。改为
     *  「键在行首出现且**恰好一次**」——对象字面量里重复键本身即缺陷。 */
    const keyCount = (seg: string, key: string): number =>
      (seg.match(new RegExp(`^\\s*${key}:`, 'gm')) ?? []).length;

    it('I44-00A updateSmartCursor 段含 3/4/5/6/8 五项接线（防静默回退/重复键覆盖）', () => {
      const seg = segment();
      expect(seg).toContain('smartCursorControlSmart(');                    // #8
      expect(seg).toContain("bindsOf('SmartCursor').some((c) => inp.keys?.has(c) || inp.touchKeys?.has(c))"); // #8 裸键
      expect(seg).toContain('rawSmartDown');                                 // #8
      // ★红队勘正 #8：悬停门（mouseInterface 等价面）必须参与裸键支
      expect(seg).toContain('const overUi = this.inpOverDomUi() || this.renderer.timeUiHover || this.renderer.weatherUiHover;');
      expect(seg).toContain('!overUi');                                      // #8 门参与
      expect(seg).toContain('sc.updateWanted(controlSmart, controlUseItem, s, !overUi)'); // #8 冻结语义
      expect(seg).toContain('tileBoostOfVid(heldDef?.vid ?? -1)');           // #5
      expect(seg).toContain('createTileSheet > 0');                          // #5 placing 门
      expect(seg).toContain('const reach0 = this.tileReach(0);');            // #4
      expect(keyCount(seg, 'tileBoost')).toBe(1);                            // #5 唯一
      expect(keyCount(seg, 'reachX')).toBe(1);                               // #4 唯一
      expect(keyCount(seg, 'reachY')).toBe(1);                               // #4 唯一
      expect(keyCount(seg, 'canKillTile')).toBe(1);                          // #6 唯一
      expect(keyCount(seg, 'tileCut')).toBe(1);                              // #3 唯一
      expect(seg).toContain('reachX: reach0.x');                             // #4
      expect(seg).toContain('reachY: reach0.y');                             // #4
      expect(seg).toContain('canKillTile: (x, y) => this.canKillTile(x, y)'); // #6
      expect(seg).toContain('tileCut: (t) => TILE_CUT.has(t)');               // #3
    });
  });
});

// =====================================================================
// 变异自证（withMutation 只打 src/player/SmartCursor.ts；Game.ts 禁触）
// 过滤串 = 目标测试名独有片段、零正则元字符。
// =====================================================================
// ★红队卫生项 F11：`SW_ISSUE44_MUT` 此前只设不读（死变量）。改为真守卫——
// 变异子进程即使因过滤串碰撞进入本块，也不会再嵌套 withMutation（D-BJ755-4 同款）。
describe.skipIf(process.env.SW_ISSUE44_MUT)('issue#44 变异自证', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/issue44-smart-cursor.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_ISSUE44_MUT: '1' },
    });

  const mutate = (
    trigger: string, replacement: string, filter: string,
    opts: { label?: string; mutate?: (src: string) => string } = {},
  ): void => {
    let pristineSha = '';
    withMutation(SC, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, {
      label: opts.label ?? `issue44 ${filter}`,
      ...(opts.mutate ? { mutate: opts.mutate } : {}),
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    // 还原逐字节对拍（BJ662 判例：锁内重读）
    expect(createHash('sha256').update(readFileSync(SC)).digest('hex'), `还原对拍 ${filter}`)
      .toBe(pristineSha);
  };

  it('M1 种植盆让位门 → 调用点回 0,0', () => {
    mutate('this.stepPlanterBox(env, sem, reach, screenX, screenY,',
      'this.stepPlanterBox(env, sem, reach, 0, 0,', 'I44-01A', { label: 'issue44 M1' });
  });

  it('M2 宏大蓝图蓝/绿映射 → 回退旧工具位当线位', () => {
    mutate('[(toolMode & 4) !== 0, TS.WIRE_BLUE]', '[(toolMode & 4) !== 0, TS.WIRE_GREEN]', 'I44-02',
      {
        label: 'issue44 M2',
        mutate: (src) => src
          .replace('[(toolMode & 4) !== 0, TS.WIRE_BLUE]', '[(toolMode & 4) !== 0, TS.WIRE_GREEN]')
          .replace('[(toolMode & 2) !== 0, TS.WIRE_GREEN]', '[(toolMode & 2) !== 0, TS.WIRE_BLUE]')
          .replace('if (hoverWire & TS.WIRE_BLUE) mouseMode |= 4;', 'if (hoverWire & TS.WIRE_BLUE) mouseMode |= 2;')
          .replace('if (hoverWire & TS.WIRE_GREEN) mouseMode |= 2;', 'if (hoverWire & TS.WIRE_GREEN) mouseMode |= 4;'),
      });
  });

  it('M3 tileCut 谓词 → 回退 decor 代读（忽略 env.tileCut 注入）', () => {
    mutate('env.tileCut ? env.tileCut(t) : !!TILE_DEFS[t]?.decor', '!!TILE_DEFS[t]?.decor',
      'I44-03A', { label: 'issue44 M3' });
  });

  it('M4 reachX → 回退硬编码 5', () => {
    mutate('const x = Math.min(20, baseX) + tb;', 'const x = Math.min(20, 5) + tb;', 'I44-04A',
      { label: 'issue44 M4' });
  });

  it('M5 tileBoost 项 → 回退丢弃（射线区不加 tb）', () => {
    mutate('const x = Math.min(20, baseX) + tb;', 'const x = Math.min(20, baseX);', 'I44-05A',
      { label: 'issue44 M5' });
  });

  it('M6 CanKillTile 全式 → 回退类型 pick>=0', () => {
    mutate('const killable = targets.filter((t) => canKillTileAtEnv(env, t.x, t.y));',
      'const killable = targets.filter((t) => ((TILE_DEFS[st.get(t.x, t.y)]?.pick ?? -1) >= 0));',
      'I44-06A', { label: 'issue44 M6' });
  });

  it('M7a 锤回退择近 → 回退未归约 env.mouse', () => {
    mutate('const pick2 = pickNonAltar(st, targets2, (t) => toWorld(t), mouse);',
      'const pick2 = pickNonAltar(st, targets2, (t) => toWorld(t), env.mouse);',
      'I44-07A', { label: 'issue44 M7a' });
  });

  it('M7b gravDir=-1 端点行 → 摘除该档', () => {
    // 该行与 stepMineSolids 的同形行共存：连后一行 clamp 作触发串保证唯一
    // （落在 stepHammers 而非 MineSolids）。
    mutate('if (gravDir === -1 && signY === 0) num9++;\n    num9 = Math.max(10, Math.min(num9, st.h - 10));',
      'num9 = Math.max(10, Math.min(num9, st.h - 10));',
      'I44-07B', { label: 'issue44 M7b' });
  });

  it('M8 界面裸键 → 只认 downAction', () => {
    mutate('return downAction || rawKeyDown;', 'return downAction;',
      'I44-08A', { label: 'issue44 M8' });
  });

  it('M8b overUi 门冻结 → 摘除 gateOpen 早退（门关时照样切换）', () => {
    mutate('if (!gateOpen) return false;', '',
      'I44-08B', { label: 'issue44 M8b' });
  });

  it('M9 斧帧校正 → 摘除第二次索引重取（复现缓存首索引）', () => {
    mutate('i2 = st.idx(num2, k);\n          if (st.frameX[i2] === 66 && st.frameY[i2] <= 44) num2++;',
      'if (st.frameX[i2] === 66 && st.frameY[i2] <= 44) num2++;',
      'I44-09A', { label: 'issue44 M9' });
  });

  it('M9b 仙人掌支 → 摘除第二支的索引重取', () => {
    mutate('i2 = st.idx(num2, k);\n          if (st.frameX[i2] === 108 && st.frameY[i2] === 36) num2++;',
      'if (st.frameX[i2] === 108 && st.frameY[i2] === 36) num2++;',
      'I44-09B', { label: 'issue44 M9b' });
  });

  it('M10 ForceCursor 消费点 → 回退类型 pick>=0', () => {
    mutate('let flag = hasTileAt(st, x, y) && canKillTileAtEnv(env, x, y)',
      'let flag = hasTileAt(st, x, y) && ((TILE_DEFS[t]?.pick ?? -1) >= 0)',
      'I44-06C', { label: 'issue44 M10' });
  });

  it('M11 tileRegion 竖程 → 摘除 y 轴 tb', () => {
    mutate('const y = Math.min(20, baseY) + tb;', 'const y = Math.min(20, baseY);',
      'I44-04D', { label: 'issue44 M11' });
  });
});
