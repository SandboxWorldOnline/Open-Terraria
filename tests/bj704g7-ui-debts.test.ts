// ★BJ704-G7（2026-10-21,R5 红蓝审查 P2 精选·UI/流程域五件）判别锁。
// 逐件定谳（先定谳再动刀,反编译亲读锚在案）：
//
// 件1 playedWorlds「尝试即记」+覆盖缺口（R5 登记债①）：
//   定谳=真差异。原版载体=地图档:HasWorldBeenPlayedByActivePlayer(UIWorldSelect.cs
//   :184-188)=WorldMap.TryGetMapPath 地图档存在;地图档【唯写时点】=玩家保存
//   (Player.InternalSavePlayer :55355 首行 InternalSaveMap :55691;autosave
//   Main.cs DoUpdate_AutoSave :19920-19946/SaveAndQuitCallBack WorldGen.cs:6618),
//   读档失败路径(playWorldCallBack loadFailed→menuMode 200/201,WorldGen.cs
//   :6703-6738)不存不记。旧位=loadWorldFlow 进 loadFromKey 之前=失败也记。
//   修=记录位迁 doSave 玩家保存链(绑定=slotMeta∨joinRoomWorldId 联机建房);
//   失败三出口+loadFromJson 假返程清 currentWorld 绑定。
//   ★quickLoad 半边=判语销案:quicksave 无槽位 id 可反解(档头 worldId=原版随
//   机数非槽位键,槽位 meta 不存;全槽位整档 worldId 扫描=重量级不可取),且
//   quickLoad 会话本就槽位分离(lastPlayed/playTimeMs 同不回写)=一致面;
//   原版无 quickload 对应面。
//   ★码入房(非建房链)不记=边界声明:原版客户端按服务器 WorldId 建图(MessageBuffer
//   .cs:488)与本机同源档地图路径重合=联机玩自家世界亦记;但本仓房间列表/码入房
//   无「该房世界=本机哪槽」的可靠绑定,不猜测(判语:建房链进房记,码入房不记)。
//
// 件2 堆叠钮商店面（R5 登记债⑥,既有非 685b 引入）：
//   定谳=classic 门缺 npcShop 半边(原版 Main.cs:42548 `chest == -1 && npcShop == 0`
//   ——亲读核语义:chest 开【或】商店开皆【藏】,注释宣称「开箱/商店不显示」但代码
//   从未落 npcShop 项)。vinv 面 pos 闭包经 layoutVanilla ctx.chestOpen
//   (=openChest∨npcShopOpen)早已双半边=正确。
//   ★R5「pos 门 none 输给 refreshAll 竞写→商店期恒显旧位」子定谳=伪影驳回:
//   vinvQuickBtn 唯一 display 写位=layoutVanilla pos 循环;classic quickStackBtn/
//   qsSmartBtn 在 vanilla 构建下被 teardownInventoryPanel 置 null(refreshAllNow
//   循环 if(!b) continue 即跳过)——两元素永不同场,零竞写面。
//
// 件3 menuToast 无去重（R5 登记债②）：定谳=真差异(观感伪影:同位叠放,先到长 ms
//   被后到盖住,后到移除后先到突然重现=闪现)。修=单槽顶替(ui.toast 同款判例,
//   BJ691 注册语义「生命周期同 ui.toast」的兑现)。
//
// 件4 cursorTooltipPos 未建 toolTipDistance（R5 登记债③）：定谳=真差异。
//   toolTipDistance=Main.cs:411 私有静态 6,【仅 :20561-20562 读】(item tooltip 支
//   专属;MouseTextInner 纯文本支 :20403-20412 不吃)。opaque 档被 padding 13≈
//   (6+8) 巧合吸收(1px 差,清偿A-F2 已声明);nobox 档文字原点恒偏右 ~7px/偏下
//   ~3px。修=公式迁 tooltipAnchor.cursorTooltipAnchor 纯函数(achTipAnchorXY
//   BJ501/mouseTextAnchor 同族第三员),toolTipDistance 显式建模。
//
// 件5 Journey/Research uiBlocking 非栈式（R5 登记债⑧/A9 域）：定谳=防御性修
//   (当前互斥不可达,声明见 uiBlockingClaim.ts 头注);修=栈律 claim/release
//   (uiBlockingClaim 模块)+closeAll 补 closeJourneyPowersPanel(Research 在收而
//   Journey 缺席=不对称遗漏,CloseAll Main.cs:43017 fancy UI 全关语义)。
//
// 销案备案（不落刀）:ThickMouse +6=默认档已在公式族建模(Main.cs:276/:2684,
//   cursorTooltipAnchor 第 2 个 +6);localeCompare('zh') vs 原版 ordinal=全仓
//   既有惯例(双 store 同参),非本窗引入。
//
// ★变异自证：M1 loadWorldFlow 回植 recordPlayedWorld → §1 恰红;M2 classic 门回植
//   纯 openChest 形状 → §2/bj685b 恰红;M3 menuToast 摘单槽顶替 → §3 恰红;
//   M4 cursorTooltipAnchor 摘 toolTipDistance(+6) → §4 nobox 恰红;
//   M5 uiBlockingClaim 回植无条件下写(非栈式) → §5 交错序恰红。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GAME = join(__dirname, '..');
const VAN = join(GAME, '..', 'Terarria1457');
const read = (p: string): string => readFileSync(p, 'utf8');
/** 函数体切片（起标记 → 下一个同缩进 `  }` 行尾;mainFlow 顶层函数统一 2 空格缩进） */
const fnBlock = (src: string, start: string): string => {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const end = src.indexOf('\n  }\n', i);
  return src.slice(i, end < 0 ? undefined : end);
};
const { cursorTooltipAnchor } = await import('../src/ui/tooltipAnchor');
const { claimUiBlocking } = await import('../src/ui/uiBlockingClaim');

// ============================================================
// §1 件1 playedWorlds：记录位=玩家保存链（原版地图档唯写时点）
// ============================================================
describe('§1 件1 playedWorlds 记录位（doSave 玩家保存拍,非尝试拍）', () => {
  const flow = read(join(GAME, 'src', 'mainFlow.ts'));
  it('写入位唯一=doSave charWrite 段,绑定=slotMeta ∨ joinRoomWorldId', () => {
    const doSave = fnBlock(flow, 'function doSave(silent = false)');
    expect(doSave).toContain('const playedWorldId = slotMeta?.id ?? joinRoomWorldId;');
    expect(doSave).toContain('void charStore.recordPlayedWorld(cid, playedWorldId)');
    // 全文件唯一调用位（防旧位复活+新位并联双写）
    expect((flow.match(/charStore\.recordPlayedWorld\(/g) ?? []).length).toBe(1);
  });
  it('M1 位：loadWorldFlow/createWorldFlow 零直写（尝试拍不记——锁拒/缺失/OOM 失败零记）', () => {
    expect(fnBlock(flow, 'async function loadWorldFlow')).not.toContain('recordPlayedWorld');
    expect(fnBlock(flow, 'async function createWorldFlow')).not.toContain('recordPlayedWorld');
  });
  it('失败路径绑定清零：loadFromKey 三出口 + loadFromJson 三调用点假返程（防后续 quickLoad 会话误写该槽）', () => {
    const lfk = fnBlock(flow, 'async function loadFromKey');
    // 6 清零位 = 锁拒/missing/catch 三出口 + fs-backup/ls-fallback/idb 三调用点
    expect((lfk.match(/currentWorld = null;/g) ?? []).length).toBe(6);
    expect((lfk.match(/if \(!\(await loadFromJson\(resolved\.text\)\)\) currentWorld = null;/g) ?? []).length).toBe(3);
    // loadFromJson 返程契约:worker 支/主线程支 true,catch false
    const lfj = fnBlock(flow, 'async function loadFromJson');
    expect(lfj).toContain('return true;');
    expect(lfj).toContain('return false;');
  });
  it('联机建房绑定：onPlay 链下传 meta.id → 进房 onJoinRoom 重置;单人读档/退出清零', () => {
    expect(flow).toContain('then(json ?? \'\', meta.name, meta.id);');
    expect(flow).toContain('joinRoomWorldId = worldId ?? null;');
    expect(flow).toContain('joinRoomWorldId = null;   // ★BJ704-G7 件1：进房失败=未游玩,绑定作废');
    // loadFromKey 入口清（单人新会话作废联机绑定）+ quitToMenu 清
    expect(fnBlock(flow, 'async function loadFromKey')).toContain('joinRoomWorldId = null;');
    const mp = read(join(GAME, 'src', 'ui', 'MultiplayerSelect.ts'));
    expect(mp).toContain('onJoinRoom(url, this.hostToken, worldId)');
  });
  it('反编译锚：地图档=玩家保存时点（InternalSavePlayer 首行 InternalSaveMap,先图后 .plr）', () => {
    const plr = read(join(VAN, 'Terraria', 'Player.cs'));
    const i = plr.indexOf('private static void InternalSavePlayer(PlayerFileData playerFile, bool skipMapSave)');
    expect(i).toBeGreaterThan(-1);
    const block = plr.slice(i, i + 700);
    expect(block).toContain('InternalSaveMap(playerFile.IsCloudSave);');
    expect(block.indexOf('InternalSaveMap(')).toBeLessThan(block.indexOf('InternalSavePlayerFile('));
  });
  it('反编译锚：HasWorldBeenPlayedByActivePlayer=TryGetMapPath 地图档存在（UIWorldSelect.cs:184-188）', () => {
    const ws = read(join(VAN, 'Terraria.GameContent.UI.States', 'UIWorldSelect.cs'));
    const i = ws.indexOf('private static bool HasWorldBeenPlayedByActivePlayer');
    expect(i).toBeGreaterThan(-1);
    expect(ws.slice(i, i + 220)).toContain('WorldMap.TryGetMapPath(Main.ActivePlayerFileData, file, out mapPath)');
  });
});

// ============================================================
// §2 件2 堆叠钮商店面：classic 门 npcShop 半边（vinv 面已正确）
// ============================================================
describe('§2 件2 堆叠钮商店面（Main.cs:42548 chest==-1 ∧ npcShop==0）', () => {
  const uiSrc = read(join(GAME, 'src', 'ui', 'UI.ts'));
  it('classic 簇门双半边：(openChest ∨ npcShopOpen) ∧ ¬craftMenu 才藏（M2 位）', () => {
    expect(uiSrc).toMatch(/b\.style\.display = \(this\.openChest \|\| this\.game\.npcShopOpen\) && !\(this\.vinvModernCraftOpen \|\| this\.vinvPipsUseGrid\) \? 'none' : '';/);
  });
  it('vinv 面（既有正确,零改动验证）:ctx.chestOpen 折 npcShopOpen + 三态位入签名', () => {
    expect(uiSrc).toContain('const chestOpen = !!this.openChest || this.game.npcShopOpen;');
    expect(uiSrc).toMatch(/pos\(b, \(\) => quickStackXY\(\!\!this\.vinvLayoutCtx\?\.chestOpen, this\.vinvModernCraftOpen \|\| this\.vinvPipsUseGrid\)\)/);
    expect(uiSrc).toMatch(/\$\{chestOpen \? 1 : 0\}/);
  });
  it('竞写伪影驳回的结构证据：vinvQuickBtn 唯一写位=pos 循环（refreshAllNow classic 循环对 null 跳过）', () => {
    expect(uiSrc).toContain('if (!b) continue;');
    // classic 钮在 vanilla 构建下被 teardown 置 null（永不同场）
    expect(uiSrc).toMatch(/this\.quickStackBtn = null as unknown as HTMLButtonElement;/);
  });
  it('反编译锚：:42548 门原文（chest 开或商店开皆藏——「皆显」读法证伪）', () => {
    const mc = read(join(VAN, 'Terraria', 'Main.cs'));
    const i = mc.indexOf('if (player[myPlayer].chest == -1 && npcShop == 0)');
    expect(i).toBeGreaterThan(-1);
    // 门内首段=QuickStackAllChests 绘制/点击（42551 起 ChestStack 贴图族）
    expect(mc.slice(i, i + 900)).toContain('QuickStackAllChests');
  });
});

// ============================================================
// §3 件3 menuToast 单槽顶替（行为面,DOM 桩）
// ============================================================
describe('§3 件3 menuToast 单槽顶替（ui.toast 同款判例）', () => {
  interface FakeEl { className: string; style: Record<string, string>; textContent: string; removed: boolean; remove(): void }
  let bodyChildren: FakeEl[];
  beforeEach(() => {
    bodyChildren = [];
    const mk = (): FakeEl => {
      const e: FakeEl = {
        className: '', style: {}, textContent: '', removed: false,
        remove() { e.removed = true; const i = bodyChildren.indexOf(e); if (i >= 0) bodyChildren.splice(i, 1); },
      };
      return e;
    };
    vi.stubGlobal('document', {
      createElement: () => mk(),
      body: { appendChild: (e: FakeEl) => { bodyChildren.push(e); } },
    });
    vi.stubGlobal('window', { setTimeout: () => 1, clearTimeout: () => { } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('后到顶替：二连发 body 恰一元素,先到同步移除（M3 位）', async () => {
    const { menuToast } = await import('../src/ui/menuToast');
    menuToast('第一条');
    menuToast('第二条');
    expect(bodyChildren.length).toBe(1);
    expect(bodyChildren[0].textContent).toBe('第二条');
  });
  it('闪现伪影根除：长 ms 先到被短 ms 后到顶替后,先到元素已离场（淡出后再现不可达）', async () => {
    const { menuToast } = await import('../src/ui/menuToast');
    menuToast('长的', 99999);
    const first = bodyChildren[0];
    menuToast('短的', 100);
    expect(first.removed).toBe(true);
    expect(bodyChildren.length).toBe(1);
  });
  it('层级逃逸锚保持（BJ691 §2 锁面不回退）+ ui.toast 单槽判例源锚', () => {
    const src = read(join(GAME, 'src', 'ui', 'menuToast.ts'));
    expect(src).toContain("t.style.zIndex = '1000'");
    expect(src).toContain('document.body.appendChild(t)');
    const uiSrc = read(join(GAME, 'src', 'ui', 'UI.ts'));
    expect(uiSrc).toMatch(/toast\(msg: string\) \{\s*\n\s*if \(this\.toastEl\) this\.toastEl\.remove\(\);/);
  });
});

// ============================================================
// §4 件4 cursorTooltipAnchor：toolTipDistance 建模（纯函数+族平价）
// ============================================================
describe('§4 件4 cursorTooltipAnchor（Main.cs:20378-20392+:20561-20579）', () => {
  // 元素 padding 9/13（UI.ts .sw-tooltip）——文字原点=元素缘+padding
  const PAD_X = 13, PAD_Y = 9;
  it('opaque 档元素原点=盒几何（mx+20/my+19,盒左/顶与原版 DrawInvBG 盒逐像素合位）', () => {
    const p = cursorTooltipAnchor(100, 200, false, true, 160, 100, 1920, 1080);
    expect(p.left).toBe(100 + 20);   // 14+6+6+8−14（=原版盒左 mouseX+34−14）
    expect(p.top).toBe(200 + 19);    // 14+6+6+2−9（=原版盒顶 mouseY+28−9;旧值 +20 的 1px 竖差随本刀合位）
    // DOM 文字原点（元素+padding）vs 原版文字原点 mx+34/my+28（:20561-20567）:
    // 纵向精确合位;横向 −1px=已声明差族（.sw-tooltip padding 13 ≠ 原版盒内文字距 14）
    expect(p.top + PAD_Y).toBe(200 + 28);
    expect(p.left + PAD_X).toBe(100 + 34 - 1);
  });
  it('nobox 档文字原点=原版 +26/+26（toolTipDistance 修正主面:旧 +33/+29 偏右7/偏下3）', () => {
    const p = cursorTooltipAnchor(100, 200, false, false, 160, 100, 1920, 1080);
    expect(p.left).toBe(100 + 13);   // 14+6+6−13（M4 位:摘 toolTipDistance → +7 恰红）
    expect(p.top).toBe(200 + 17);    // 14+6+6−9
    expect(p.left + PAD_X).toBe(100 + 26);
    expect(p.top + PAD_Y).toBe(200 + 26);
  });
  it('光标持物 +34（:20390-20392）×两档', () => {
    expect(cursorTooltipAnchor(100, 200, true, true, 160, 100, 1920, 1080).left).toBe(100 + 20 + 34);
    expect(cursorTooltipAnchor(100, 200, true, false, 160, 100, 1920, 1080).left).toBe(100 + 13 + 34);
  });
  it('钳制=文字缘 num4（opaque 18/nobox 4）→ 元素缘换算 pad（opaque(6,9)/nobox(−9,−5)）', () => {
    // opaque：文字右缘收 sw−18 ⇔ 元素缘 left+tw ≤ sw−6
    const po = cursorTooltipAnchor(1900, 1070, false, true, 160, 100, 1920, 1080);
    expect(po.left).toBe(1920 - 160 - 6);
    expect(po.top).toBe(1080 - 100 - 9);
    // nobox：文字右缘收 sw−4 ⇔ 元素缘 left+tw ≤ sw+9（不可见 padding 越屏,文字缘仍收 4）
    const pn = cursorTooltipAnchor(1900, 1070, false, false, 160, 100, 1920, 1080);
    expect(pn.left).toBe(1920 - 160 + 9);
    expect(pn.top).toBe(1080 - 100 + 5);
  });
  it('族平价（BJ501 achTipAnchorXY 同公式源文本形状）+ UI.cursorTooltipPos 委托接线', () => {
    const ta = read(join(GAME, 'src', 'ui', 'tooltipAnchor.ts'));
    expect(ta).toContain('mouseX + 14 + 6 + (heldOnCursor ? 34 : 0) + 6 + (opaque ? 8 : 0)');
    const ach = read(join(GAME, 'src', 'ui', 'AchievementsUI.ts'));
    expect(ach).toContain('mx + 14 + 6 + (cursorHeld ? 34 : 0) + 6 + (box ? 8 : 0)');
    const uiSrc = read(join(GAME, 'src', 'ui', 'UI.ts'));
    expect(uiSrc).toMatch(/private cursorTooltipPos\(tw: number, th: number\): \{ left: number; top: number \} \{\s*\n\s*return cursorTooltipAnchor\(this\.mouseX, this\.mouseY, !!this\.heldStack,/);
  });
  it('反编译锚：toolTipDistance :411 定义,仅 :20561-20562 消费（item tooltip 支专属）', () => {
    const mc = read(join(VAN, 'Terraria', 'Main.cs'));
    expect(mc).toContain('private static int toolTipDistance = 6;');
    const hits = mc.match(/toolTipDistance/g) ?? [];
    expect(hits.length).toBe(3);   // 定义 + 两读（X/Y 各一）
    const i = mc.indexOf('X += toolTipDistance;');
    expect(mc.slice(i - 200, i + 400)).toContain('settingsEnabled_OpaqueBoxBehindTooltips');
    expect(mc.slice(i - 200, i + 400)).toContain('X += 8');
    expect(mc.slice(i - 200, i + 400)).toContain('Y += 2');
  });
});

// ============================================================
// §5 件5 uiBlockingClaim 栈律（行为面,纯逻辑）
// ============================================================
describe('§5 件5 uiBlockingClaim 栈律（防御性修,不可达声明见模块头注）', () => {
  const mkInput = (v = false) => ({ uiBlocking: v });
  it('交错序任意正确：开A→开B→关A→关B 终态还原（M5 位:非栈式下写在此序终态粘滞 true）', () => {
    const inp = mkInput(false);
    const a = claimUiBlocking(inp);
    const b = claimUiBlocking(inp);
    expect(inp.uiBlocking).toBe(true);
    a();   // 关 A（B 仍在）
    expect(inp.uiBlocking, 'B 仍开着不得解封').toBe(true);
    b();   // 关 B（末出）
    expect(inp.uiBlocking, '末出才还原沿值').toBe(false);
  });
  it('反向交错：开A→开B→关B→关A 同样正确', () => {
    const inp = mkInput(false);
    const a = claimUiBlocking(inp);
    const b = claimUiBlocking(inp);
    b();
    expect(inp.uiBlocking).toBe(true);
    a();
    expect(inp.uiBlocking).toBe(false);
  });
  it('沿值=true（下层模态已封）不被首入覆写,末出还原 true', () => {
    const inp = mkInput(true);
    const a = claimUiBlocking(inp);
    const b = claimUiBlocking(inp);
    a(); b();
    expect(inp.uiBlocking).toBe(true);
  });
  it('释放幂等 + 跨 Game 实例自愈（重进世界新 input=新栈;旧 token 迟到释放不越权）', () => {
    const inp1 = mkInput(false);
    const a1 = claimUiBlocking(inp1);          // 旧局滞留未释放
    const inp2 = mkInput(false);
    const a2 = claimUiBlocking(inp2);          // 新局新栈
    expect(inp2.uiBlocking).toBe(true);
    a1(); a1();                                // 旧 token 迟到+重复释放:不入新账
    expect(inp2.uiBlocking).toBe(true);
    a2();
    expect(inp2.uiBlocking).toBe(false);       // 新栈自洽还原
  });
  it('接线：双面板迁 claimUiBlocking（旧模块级 savedBlocking 零残留）+ closeAll 双收口', () => {
    const jp = read(join(GAME, 'src', 'ui', 'JourneyPowersUI.ts'));
    const rs = read(join(GAME, 'src', 'ui', 'ResearchUI.ts'));
    expect(jp).toContain('journeyBlockingRelease = claimUiBlocking(game.input);');
    expect(rs).toContain('researchBlockingRelease = claimUiBlocking(game.input);');
    expect(jp).not.toMatch(/journeySavedBlocking\s*=/);   // 旧保存形零残留（头注改判史提及除外）
    expect(rs).not.toMatch(/researchSavedBlocking\s*=/);
    // 旧还原臂（close 时经 window.__swGame 重查全局=可拍错代实例）退役
    expect(jp).not.toMatch(/\(window as unknown as \{ __swGame/);
    expect(rs).not.toMatch(/\(window as unknown as \{ __swGame/);
    const uiSrc = read(join(GAME, 'src', 'ui', 'UI.ts'));
    const i = uiSrc.indexOf('closeResearchPanel();');
    expect(uiSrc.slice(i, i + 400)).toContain('closeJourneyPowersPanel();');
  });
});
