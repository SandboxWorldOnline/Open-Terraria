// SW-BJ72（2026-09-14）光标跟随态逐帧清空回归 —— 用户实报"开启自动暂停时:先悬停一个
// 会给光标带文字的按钮/物（游戏内世界/UI 悬停 → 光标旁出现跟随文字）,按 Esc 打开背包
// → 文字永驻光标旁跟随（跟随光标的图标同理）"。
// 取证定谳（1457 反编译锚,1458 同位零漂移）:
//   - 原版 MouseOversClear（Main.cs:47279-47289）挂 Update 头部【无条件每帧】
//     （Main.cs:17213;1458 :17213 同位）——清 _mouseTextCache.isValid/noOverride +
//     player.cursorItemIconEnabled/ID/Text/Push + signHover/signBubble,先于 :17372
//     CanPauseGame→gamePaused 门;claim 面随后重写（UpdateUIStates 暂停帧照跑 +
//     DrawMouseOver :43595 绘制相）→ 先清后 claim 每帧往复,悬停文字/图标不可能残留。
//   - 本仓 cursorItemIcon 五字段的重置曾只挂 tickCursorIcon（fixedUpdate,暂停冻结）
//     头部 → autoPause∧开背包（applyAutoPauseUI）/失焦暂停拍 claim 停摆,悬停文字/图标
//     冻结残留且 Renderer.drawCursorItemIcon（:15069 文本支/图标支）随实时 _mouseX/Y
//     逐帧重画 = 继续跟随光标（自创偏差:清零拍与 claim 拍同挂 fixedUpdate,缺原版
//     "Update 头逐帧清"半拍）。
//   - 余辉验证同理:原版 ItemIconCacheVerification 调用点 = DrawInterface_40 :45817
//     （1458 :45823）= 绘制相每【绘制】帧衰减,暂停帧照衰减;本仓曾挂 tickCursorIcon
//     → 暂停拍 cacheTime 冻结,余辉图标滞留光标旁。
// 修刀（最小,对齐原版拍位）:
//   - frame() 头（applyAutoPauseUI 后,暂停分支前）每帧 mouseOversClear()——五字段清零;
//   - frame() 尾（SuppressDraw 早退后、render 前）每绘制帧 refreshCursorIconDrawState()
//     ——余辉验证 + renderer.cursorIconCtx 重建（原 tickCursorIcon 尾段拆出）。
// 本测试双面:①行为面（最小 Game 桩逐环驱动,chester-pet 同法）②结构锁（frame() 内
// 拍位序 + ctx 单写者——变异即红）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Enemy } from '../src/entities/Enemy';   // ★先加载断活环（chester-pet 同法）
import { Game } from '../src/core/Game';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { ItemIconCache } from '../src/render/CursorItemIcon';
import { TILE } from '../src/core/constants';

// ===================== Game 最小桩（chester-pet cursorGame 同法） =====================
function bj72Game() {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown> & {
    player: Player; world: World; input: { mouseX: number; mouseY: number; uiBlocking: boolean };
    camera: { screenToWorld: (x: number, y: number) => [number, number] };
    renderer: Record<string, unknown>; itemIconCache: ItemIconCache;
  };
  g.player = new Player(50 * TILE, 90 * TILE, new Inventory());
  g.world = new World(120, 160, 30);
  g.input = { mouseX: 0, mouseY: 0, uiBlocking: true };
  g.camera = { screenToWorld: (mx: number, my: number) => [mx, my] as [number, number] };
  g.renderer = {};
  g.itemIconCache = new ItemIconCache();
  g.entities = { npcs: [], enemies: [], projectiles: [], critters: [] };   // ★FX56 补 critters 空桶（tickHoverNpcName 小动物臂）
  return g;
}

// ===================== 行为面 1：MouseOversClear 五字段清零 =====================
describe('mouseOversClear（Main.cs:47279-47289 1:1 契约）', () => {
  it('五字段全归零（enabled/ID/Push/Text/Reversed）——原版清 cursorItemIcon 四字段+本仓 Reversed 位', () => {
    const g = bj72Game();
    const p = g.player;
    // 残留态 = 悬停箱名 claim 后的冻结快照（用户实报的文字+图标残留源）
    p.cursorItemIconText = 'Chest';
    p.cursorItemIconEnabled = true;
    p.cursorItemIconID = 5098;
    p.cursorItemIconPush = 3;
    p.cursorItemIconReversed = true;
    (g as unknown as { mouseOversClear(): void }).mouseOversClear();
    expect(p.cursorItemIconText).toBe('');       // :47284 string.Empty
    expect(p.cursorItemIconEnabled).toBe(false); // :47282 false
    expect(p.cursorItemIconID).toBe(0);          // :47283 0
    expect(p.cursorItemIconPush).toBe(0);        // :47285 0
    expect(p.cursorItemIconReversed).toBe(false);
  });

  it('暂停拍管线合成：清零后绘制拍重建上下文 → 无残留可画、快照随实时输入刷新', () => {
    const g = bj72Game();
    const p = g.player;
    p.cursorItemIconText = 'Chest';
    p.cursorItemIconEnabled = true;
    p.cursorItemIconID = 5098;
    // 模拟 autoPause 暂停拍：frame() = applyAutoPauseUI → mouseOversClear →（fixedUpdate 不跑）
    // → refreshCursorIconDrawState → render
    (g as unknown as { mouseOversClear(): void }).mouseOversClear();
    (g as unknown as { refreshCursorIconDrawState(): void }).refreshCursorIconDrawState();
    expect(p.cursorItemIconText).toBe('');       // 文本支（Renderer :15069 门）不再进
    expect(p.cursorItemIconEnabled).toBe(false); // flag 支（悬停图标）不再进
    // ctx 是绘制拍重建的新快照（非冻结旧物）——uiBlocking 随实时 input
    const ctx = g.renderer.cursorIconCtx as { uiBlocking: boolean; heldVid: number };
    expect(ctx.uiBlocking).toBe(true);           // input 桩恒 true → 新快照同相
    expect(ctx.heldVid).toBe(0);                 // 空手
  });
});

// ===================== 行为面 2：余辉验证挂绘制拍（原版 :45817 同相） =====================
describe('refreshCursorIconDrawState 余辉衰减（ItemIconCacheVerification 绘制拍）', () => {
  it('暂停拍余辉随绘制拍衰减：静止不减（衰减=移动门控 :45930-45936）、小幅移动 -1 并同步 ctx.cacheTime', () => {
    const g = bj72Game();
    // 缓存键须与所选槽匹配（verify :45941 itemId!==selectedItemId → 0）——空手桩 selectedItemId=0
    g.itemIconCache.update(0, 100, 100);
    const drive = g as unknown as { refreshCursorIconDrawState(): void };
    (g.input as { mouseX: number }).mouseX = 100;
    (g.input as { mouseY: number }).mouseY = 100;
    drive.refreshCursorIconDrawState();    // 静止 1 帧 → 不衰减（原版同相：d==0 不减）
    expect(g.itemIconCache.time).toBe(10);
    expect((g.renderer.cursorIconCtx as { cacheTime: number }).cacheTime).toBe(10);
    (g.input as { mouseX: number }).mouseX = 102;   // 2px 微移
    drive.refreshCursorIconDrawState();
    expect(g.itemIconCache.time).toBe(9);           // 移动门控衰减 -1
    expect((g.renderer.cursorIconCtx as { cacheTime: number }).cacheTime).toBe(9);
  });

  it('鼠标位移 >4px → 余辉即灭（:45933-45936 同式）——暂停拍移动光标不再滞留旧图标', () => {
    const g = bj72Game();
    g.itemIconCache.update(0, 100, 100);   // 缓存键与空手桩 selectedItemId=0 匹配
    const drive = g as unknown as { refreshCursorIconDrawState(): void };
    (g.input as { mouseX: number }).mouseX = 130;   // +30px
    (g.input as { mouseY: number }).mouseY = 100;
    drive.refreshCursorIconDrawState();
    expect(g.itemIconCache.time).toBe(0);
    expect((g.renderer.cursorIconCtx as { cacheTime: number }).cacheTime).toBe(0);
  });
});

// ===================== 结构锁：frame() 拍位序 + ctx 单写者 =====================
describe('结构锁（变异即红）', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/core/Game.ts'), 'utf8');

  /** frame() 方法体切片（下一起点 = scanBoulderFamilyNear） */
  function frameBody(): string {
    const s = src.indexOf('private frame(now: number) {');
    expect(s).toBeGreaterThan(0);
    const e = src.indexOf('private scanBoulderFamilyNear', s);
    expect(e).toBeGreaterThan(s);
    return src.slice(s, e);
  }

  it('拍位序：applyAutoPauseUI → mouseOversClear（暂停拍门）→（暂停分支前）→ fixedUpdate → refreshCursorIconDrawState → render', () => {
    const f = frameBody();
    const iAuto = f.indexOf('this.applyAutoPauseUI()');
    const iClear = f.indexOf('this.mouseOversClear()');
    const iSplit = f.indexOf('if (!this.paused) {');
    const iFixed = f.indexOf('this.fixedUpdate(FIXED_DT)');
    // ★X2 重锚（2026-10-01）：SuppressDraw 早退分支已退役（Game.ts 帧模式注
    //   「本分支已退役(2026-09-28 调度面修复刃)」——0 步进帧照常渲染,绘制相
    //   无早退,frame() 内已无任何 return）,旧锚 'return;   // SuppressDraw' 锚面灭。
    //   重建拍不变量同值改锚逻辑相收尾行（累计器块末 = !paused 分支尾）：
    //   refresh 仍恒在整段逻辑相之后、render 之前 = 每【绘制】帧语义不变。
    const iLogicEnd = f.indexOf('this._lastPlayerCx = this.player.cx;');
    const iRefresh = f.indexOf('this.refreshCursorIconDrawState()');
    const iRender = f.indexOf('this.render()');
    for (const [name, i] of [['autoPause', iAuto], ['clear', iClear], ['split', iSplit],
      ['fixed', iFixed], ['logicEnd', iLogicEnd], ['refresh', iRefresh], ['render', iRender]] as const) {
      expect(i, name).toBeGreaterThan(0);
    }
    // 清空拍先于暂停分支（原版 MouseOversClear :17213 先于 gamePaused 门 :17372 同位）
    expect(iClear, '清零须在暂停分支前（暂停拍也清）').toBeGreaterThan(iAuto);
    expect(iClear).toBeLessThan(iSplit);
    // 重建拍在逻辑相收尾之后、render 之前（=每【绘制】帧,原版 Verification 在 draw 内
    // 同相;SuppressDraw 抑制帧面已随分支退役归一——0 步进帧照常渲染）
    expect(iRefresh).toBeGreaterThan(iLogicEnd);
    expect(iRefresh).toBeLessThan(iRender);
  });

  it('清零/重建调用带 world 门（pre-world 帧不炸）', () => {
    const f = frameBody();
    expect(f).toContain('if (this.world) this.refreshCursorIconDrawState()');
  });

  it('renderer.cursorIconCtx 单写者：组装只存在于 refreshCursorIconDrawState（tickCursorIcon 尾段已拆出）', () => {
    expect(src.split('this.renderer.cursorIconCtx =').length - 1).toBe(1);
    const sTick = src.indexOf('private tickCursorIcon(): void {');
    const sRefresh = src.indexOf('private refreshCursorIconDrawState(): void {');
    expect(sTick).toBeGreaterThan(0);
    expect(sRefresh).toBeGreaterThan(sTick);
    // tickCursorIcon 段内不再有 verify/ctx 组装（余辉衰减曾随 fixedUpdate 冻结）
    const tickBody = src.slice(sTick, sRefresh);
    expect(tickBody).not.toContain('itemIconCache.verify');
    expect(tickBody).not.toContain('this.renderer.cursorIconCtx');
  });
});

// ===================== SW-BJ99（2026-09-16）：暂停帧绘制相悬停回填 =====================
// BJ72 偏差登记清偿——原版绘制相悬停族挂 DrawMouseOver（Main.cs:43595 → 接口层
// "Vanilla: Mouse Over" :45659-45663 → DrawInterface_39_MouseOver :45902→:45906,每
// 【绘制】帧重 claim,不受 CanPauseGame :17372/:17493 暂停门控）：本仓该族唯一已实现
// 面 = HoverOverNPCs NPC 名（:43664→:43820-43832）,claim CPU 曾只在 fixedUpdate
// （tickCursorIcon 尾）→ 暂停拍 frame 头清零后不回填 =「少显」（BJ72 登记原文）。
// 修刀 = frame() render 前 `if (this.paused && this.world) this.tickHoverNpcName();`
// （非暂停帧 fixedUpdate claim 面逐位不动;update 相族箱/手持图标暂停不回填 = 原版
// 同相;掉落物名/他玩家血名本仓无 claim 面 = 独立功能缺口另行登记）。
// ★SW-F1（2026-09-16）块条件转无条件 `if (this.world)`：三族 claim 自 tickCursorIcon
// 退役（原版 DrawMouseOver 三族全在绘制相）后,本块 = 唯一 claim 面,暂停/非暂停帧
// 每绘制帧先清后 claim 往复（0 步进帧空窗清偿）;结构锁同步（暂停门回滚即红）。
// 变异证红：删 frame() 回填行 → 结构锁红（行缺失/拍位漂移）。
describe('SW-BJ99 暂停帧绘制相悬停回填（DrawMouseOver 同相）', () => {
  const src99 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/core/Game.ts'), 'utf8');

  function frameBody99(): string {
    const s = src99.indexOf('private frame(now: number) {');
    const e = src99.indexOf('private scanBoulderFamilyNear', s);
    expect(s).toBeGreaterThan(0);
    expect(e).toBeGreaterThan(s);
    return src99.slice(s, e);
  }

  it('行为面：暂停拍 清零→回填 → NPC 名重 claim;光标离开则保持清零（先清后 claim 往复）', () => {
    const g = bj72Game();
    (g as unknown as { paused: boolean }).paused = true;
    const p = g.player;
    // 城镇 NPC 在光标下（camera 桩 = 恒等映射;renderer 无 atlas → npcHoverHit ±8px 回退盒）
    (g.entities as { npcs: unknown[] }).npcs = [{
      dead: false, vanillaId: 22, givenName: 'April', hp: 100, maxHp: 100,
      x: 90, y: 90, w: 20, h: 42,
    }];
    (g.input as { mouseX: number }).mouseX = 95;
    (g.input as { mouseY: number }).mouseY = 95;
    const drive = g as unknown as { mouseOversClear(): void; tickHoverNpcName(): void };
    drive.mouseOversClear();          // frame 头（暂停拍照清,BJ72 主修,不回退）
    expect(p.cursorItemIconText).toBe('');
    drive.tickHoverNpcName();          // render 前回填（BJ99）
    expect(p.cursorItemIconText).toBe('April: 100/100');   // :43827-43829 血量行同式
    // 光标离开 → 下一暂停帧 清零→回填无命中 → 无残留
    (g.input as { mouseX: number }).mouseX = 900;
    (g.input as { mouseY: number }).mouseY = 900;
    drive.mouseOversClear();
    drive.tickHoverNpcName();
    expect(p.cursorItemIconText).toBe('');
  });

  it('结构锁：claim 块挂 frame()（★F1 无条件）、refreshCursorIconDrawState 之后 render 之前（变异删块/回滚暂停门即红）', () => {
    const f = frameBody99();
    const iClear = f.indexOf('this.mouseOversClear()');
    const iRefresh = f.indexOf('this.refreshCursorIconDrawState()');
    // ★SW-BJ105 2026-09-16：回填行扩为回填块（三族 NPC 名/血名/掉落物名 + 绘制相
    // tickInfoAccsHover）;★SW-F1 2026-09-16：块条件转无条件 `if (this.world) {`
    // ——自 refresh 之后起找（避开 frame 头 audioAcc 同形块）
    const iReclaim = f.indexOf('if (this.world) {', iRefresh);
    const iRender = f.indexOf('this.render()');
    for (const [n, i] of [['clear', iClear], ['refresh', iRefresh], ['reclaim', iReclaim], ['render', iRender]] as const) {
      expect(i, n).toBeGreaterThan(0);
    }
    expect(iReclaim).toBeGreaterThan(iRefresh);
    expect(iReclaim).toBeLessThan(iRender);
    expect(f.slice(iReclaim)).toContain('this.tickHoverNpcName();');
  });
});

// ===================== SW-BJ320（2026-09-24）：清零拍位归一（0 步进帧频闪清偿） =====================
// 用户实报：悬停门/宝箱等交互物,光标处交互图标频闪。取证定谳（1457 反编译锚）：
//   - 原版不变量 = MouseOversClear 挂 Update 头部但在 accumulator 门【之后】
//     （Main.cs:17182-17213：Off/Subtle 档 0 步进帧 :17184 提前 return【不进清零】;
//     On 档 IsFixedTimeStep 60Hz 锁步无 0 步进帧）→ 清与 claim 恒同 tick 耦合,
//     "清后无回填"的绘制帧不存在:Off 档 0 步进帧照画上一 tick claim（图标恒亮）,
//     Subtle 档 SuppressDraw 画布保留。
//   - 本仓曾把清零挂 frame() 头【每绘制帧】+ claim 留 fixedUpdate → 非暂停 0 步进帧
//     清后无回填;悬停门/箱族原版【永不】调 ItemIconCacheUpdate（Player.cs 全文仅 4
//     站点 :43954/:46010/:46717/:47165 全在手持支）→ cacheTime 桥接对悬停族整缺 =
//     Off/On 档（旧档 frameSkip 迁移落在 off/on）静止悬停即隔帧频闪（探针 256 帧
//     133 次翻转;subtle 档被 SuppressDraw 掩蔽故默认档不显）。BJ320 修刀 = 清零拆两拍:
//     ①fixedUpdate 头每逻辑 tick 清（同 tick claim 耦合）②frame() 头仅暂停拍清
//     （BJ72 残留防线保留）。非暂停 0 步进帧不清 → 画上一 tick claim 态 = 原版同相。
// 测试法：BJ72 同法 Game 原型桩 + 真 tileInteractionsMouseOver claim 面 +
//   [0,2,1] 步序 N 帧可见性恒定断言 + 源文本结构锁（变异即红）。
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';

type AnyGame = Record<string, any>;

describe('SW-BJ320 清零拍位归一（0 步进帧图标可见性恒定）', () => {
  const DOOR_TILE = (TILE_BY_KEY as Record<string, number>)['door_closed'] ?? -1;

  /** bj72Game 桩 + 门(60,90..92) + 玩家邻接站位 → tileInteractionsMouseOver 真 claim 面 */
  function bj320Game() {
    const g = bj72Game() as AnyGame & { world: World; player: Player };
    const st = (g.world as unknown as { store: { setTileSilent: (x: number, y: number, t: number, fx: number, fy: number) => void } }).store;
    for (let j = 0; j < 3; j++) st.setTileSilent(60, 90 + j, DOOR_TILE, 0, j * 54);
    (g.player as unknown as { x: number; y: number; vx: number; vy: number }).x = 58 * TILE;
    (g.player as unknown as { x: number; y: number; vx: number; vy: number }).y = 92 * TILE - (g.player as unknown as { h: number }).h;
    (g.player as unknown as { vx: number; vy: number }).vx = 0;
    (g.player as unknown as { vx: number; vy: number }).vy = 0;
    return g;
  }

  /** 真 claim 面：门中格 (60,91) 悬停扫描（tickCursorIcon 内同参调用） */
  function claimDoor(g: AnyGame): void {
    (g as unknown as { tileInteractionsMouseOver(tx: number, ty: number, p: Player): void })
      .tileInteractionsMouseOver(60, 91, g.player as Player);
  }

  /** 绘制门（Renderer.drawCursorItemIcon flag 支同式）：enabled && ID≠0 → 图标进 */
  function iconVisible(g: AnyGame): boolean {
    const p = g.player as unknown as { cursorItemIconEnabled: boolean; cursorItemIconID: number };
    return p.cursorItemIconEnabled && p.cursorItemIconID !== 0;
  }

  it('claim 面自洁核查：门中格悬停 → enabled+ID 置位（木门 vid>0）', () => {
    const g = bj320Game();
    expect(DOOR_TILE).toBeGreaterThan(0);
    claimDoor(g);
    const p = g.player as unknown as { cursorItemIconEnabled: boolean; cursorItemIconID: number };
    expect(p.cursorItemIconEnabled).toBe(true);
    expect(p.cursorItemIconID).toBeGreaterThan(0);   // styleDropVidOfFrames(10,0,·) 表值
    expect(TILE_DEFS[DOOR_TILE]?.vanilla?.sheet).toBe(10);
  });

  it('★判别面：[0,2,1] 步序 × 8 循环,off 档悬停图标可见性恒定（变异回滚逐帧清即红）', () => {
    const g = bj320Game();
    const drive = g as unknown as { mouseOversClear(): void; refreshCursorIconDrawState(): void };
    // 预置=悬停已稳态（真实序列前置若干逻辑 tick 的 claim;否则首帧无 claim 非频闪语义）
    drive.mouseOversClear();
    claimDoor(g);
    const seq = [0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1];
    const vis: boolean[] = [];
    for (const steps of seq) {
      // frame() 头：仅暂停拍清（非暂停 0 步进帧不清 = 原版 accumulator 门同相）
      const paused = false;
      if (paused) drive.mouseOversClear();
      // fixedUpdate：每逻辑 tick 头清 + 真 claim 面（0 步进帧整段不跑）
      for (let s = 0; s < steps; s++) {
        drive.mouseOversClear();
        claimDoor(g);
      }
      drive.refreshCursorIconDrawState();   // 绘制拍：余辉验证+ctx（不清零）
      vis.push(iconVisible(g));
    }
    expect(vis.length).toBe(seq.length);
    expect(vis.every((v) => v === true), `可见性翻转序列=${vis.map((v) => (v ? 1 : 0)).join('')}`).toBe(true);
  });

  it('变异判别：0 步进帧若被逐帧清（回滚 BJ72 旧拍位）→ 可见性翻转（本测试钉死该回归）', () => {
    // 反相证明：同一序列,若把清零挪回每绘制帧（旧偏差拍位）,0 步进帧必翻红
    const g = bj320Game();
    const drive = g as unknown as { mouseOversClear(): void; refreshCursorIconDrawState(): void };
    const seq = [0, 2, 1];
    const vis: boolean[] = [];
    for (const steps of seq) {
      drive.mouseOversClear();               // 旧拍位：每绘制帧无条件清（偏差形态）
      for (let s = 0; s < steps; s++) { claimDoor(g); }
      drive.refreshCursorIconDrawState();
      vis.push(iconVisible(g));
    }
    expect(vis).toEqual([false, true, true]);   // 0 步进帧=空窗（用户实报频闪的一帧）
  });

  it('暂停拍残留防线保留（BJ72 主修不回退）：暂停帧逐绘制帧清 → 无残留可画', () => {
    const g = bj320Game();
    claimDoor(g);                              // 暂停前 claim 残留
    const p = g.player as unknown as { cursorItemIconEnabled: boolean; cursorItemIconID: number };
    expect(iconVisible(g)).toBe(true);
    (g as unknown as { mouseOversClear(): void }).mouseOversClear();   // frame() 头暂停拍门（paused=true 时逐帧走）
    expect(p.cursorItemIconEnabled).toBe(false);
    expect(p.cursorItemIconID).toBe(0);
    (g as unknown as { refreshCursorIconDrawState(): void }).refreshCursorIconDrawState();
    expect(iconVisible(g)).toBe(false);        // 暂停期 update 相 claim 停摆 → 图标不显（原版同相）
  });

  it('结构锁：fixedUpdate 头每 tick 清（tickCount 前）+ frame() 头清零带暂停拍门（回滚无条件清即红）', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/core/Game.ts'), 'utf8');
    const sF = src.indexOf('private frame(now: number) {');
    const sScan = src.indexOf('private scanBoulderFamilyNear', sF);
    const f = src.slice(sF, sScan);
    // frame() 头清零 = 暂停拍门形态（非暂停 0 步进帧不清）
    const iClear = f.indexOf('this.mouseOversClear()');
    expect(iClear, 'frame() 头须有 mouseOversClear（暂停拍）').toBeGreaterThan(0);
    expect(f.slice(Math.max(0, iClear - 40), iClear)).toContain('this.paused && this.world');
    // 旧偏差形态禁入 frame() 体：无条件每绘制帧清
    expect(f).not.toContain('if (this.world) this.mouseOversClear()');
    // fixedUpdate 头：world 门内清零先于 tickCount++（每逻辑 tick,与 claim 同拍耦合）
    const sFu = src.indexOf('private fixedUpdate(dt: number) {');
    expect(sFu).toBeGreaterThan(0);
    // ★BJ730 改判史：窗口旧 600——interp 快照块（2026-10-14,?interp=1 相机/玩家
    //  上步末态快照）合法插在 BJ320 清零行前,清零行现偏移 650;窗口随文本放宽
    //  （BJ710-G35 发射位增重破窗判例同族）,锁语义不变（清零先于 tickCount++）。
    const fuHead = src.slice(sFu, sFu + 1200);
    const iFuClear = fuHead.indexOf('if (this.world) this.mouseOversClear()');
    const iTick = fuHead.indexOf('this.tickCount++');
    expect(iFuClear, 'fixedUpdate 头须有 world 门内清零').toBeGreaterThan(0);
    expect(iTick).toBeGreaterThan(iFuClear);
  });
});
