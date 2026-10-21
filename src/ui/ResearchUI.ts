// Journey 研究献祭面板（CreativePowers ItemSacrifices 的 DOM 近似入口）。
// 原版语义：仅旅程角色开放（Main.gameModeInfo / JourneyMode UI）；研究面板按物品
// 列出 have/need，点献祭累计（ItemsSacrificedUnlocksTracker.RegisterItemSacrifice
// :115-143 幂等早退+钳 9999）。本面板列出背包内物品 + 全局进度（event 45 半数门由
// Research.checkResearchAchievement 消费）。
// 偏差登记：原版是背包内每物品的研究按钮（CreativeUIState UISacrificeDialog /
// ItemSacrificesUITab），此处为整包列表近似——献祭语义与计数 1:1，布局近似。
import type { Game } from '../core/Game';
import { Lang } from '../i18n/Lang';
import { ITEM_DEFS } from '../data/items';
import { claimUiBlocking, type UiBlockingRelease } from './uiBlockingClaim';   // ★BJ704-G7 件5

/** 内部 item id → 原版 id（UI 侧轻量版 = vid 直读;★方案 A 键前缀反解链退役） */
function vidOf(id: number): number {
  const d = ITEM_DEFS[id];
  if (!d) return -1;
  if (d.vid != null) return d.vid;
  const m = /^vi_(\d+)_/.exec(d.key);
  return m ? +m[1] : -1;
}

const CSS = `
.sw-res-panel { pointer-events:auto; position:fixed; left:50%; top:50%;
  transform:translate(-50%,-50%); width:min(420px, 90vw); max-height:80vh;
  background:rgba(33,43,79,0.9); border:2px solid #7d92d6; border-radius:6px;
  color:#e8ecf8; padding:12px; display:flex; flex-direction:column;
  box-shadow:0 0 0 2px rgba(10,14,30,0.8), 0 6px 28px rgba(0,0,0,0.65);
  font-size:13px; z-index:130; }
.sw-res-head { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.sw-res-head .sw-title { flex:1; margin-bottom:0; font-size:15px; }
.sw-res-prog { font-size:12px; color:#9fb0dd; margin-bottom:6px; }
.sw-res-list { overflow-y:auto; display:flex; flex-direction:column; gap:3px; }
.sw-res-row { display:flex; align-items:center; gap:8px; padding:4px 6px;
  background:rgba(20,26,52,0.55); border-radius:4px; }
.sw-res-row.done { border-left:3px solid #8de08d; }
.sw-res-row .nm { flex:1; min-width:0; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; }
.sw-res-row .bar { width:90px; height:8px; background:#1a1f3a; border-radius:4px;
  border:1px solid #444c7a; overflow:hidden; flex:none; }
.sw-res-row .bar .fill { height:100%; background:linear-gradient(90deg,#6a8ae0,#8ad0e0); }
.sw-res-row .num { font-size:11px; color:#9fb0dd; width:64px; text-align:right; flex:none; }
.sw-res-row button { flex:none; margin:0; padding:3px 10px; width:auto; font-size:12px;
  background:linear-gradient(#4a3a6a,#3a2a5a); color:#fff; border:1px solid #6a5a8a;
  border-radius:4px; cursor:pointer; }
`;

let cssInjected = false;
function ensureCss(): void {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

let panel: HTMLElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

/** 献祭音（UICreativeInfiniteItemsDisplay.cs:354/:372 + LegacySoundPlayer.cs:483-505）：
 *  研究完成拍（sacrifice 返回 true=刚跨过 need 线,_newlyUnlocked 语义）→ Research_0
 *  （cue64,case :496-505）；推进未满 → Research_1..3 随机（cue63 case :483-495,
 *  Main.rand.Next(1,4)，播前 Stop 旧实例的槽语义不建模）。两 case 均无 Pitch 档。
 *  ★Game.ts 自动链不接声（队友代捐 onJourneyUnlock → research.sacrifice 等）：原版
 *  RegisterItemSacrifice 的网络/成就路径无音效，献祭声只在创意 UI 手动动画帧出——差异已登记 */
function playResearchSfx(game: Game, completed: boolean): void {
  if (completed) game.sfx.playWavFile('Research_0');
  else game.sfx.playFiles(['Research_1', 'Research_2', 'Research_3'], 1);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** ★A9(2026-10-14)→★BJ704-G7 件5(2026-10-21)：uiBlocking 保存/还原迁栈律单源
 *  (uiBlockingClaim——旧模块级 researchSavedBlocking 非栈式已退役;交错开关序防御,
 *  不可达声明见 uiBlockingClaim.ts 头注) */
let researchBlockingRelease: UiBlockingRelease | null = null;

export function openResearchPanel(game: Game): void {
  ensureCss();
  if (panel) { closeResearchPanel(); return; }
  researchBlockingRelease = claimUiBlocking(game.input);   // 面板打开封游戏输入（摇杆/世界触摸）
  const r = game.research;
  const inv = game.player.inv;

  panel = el('div', 'sw-res-panel');
  const head = el('div', 'sw-res-head');
  // ★SW-RB14b:标签订正——LegacyInterface.112 原版 zh-Hans=「你必须先设置边框」
  //   (1457 zh-Hans.Legacy.json,非研究面),误用致标题错文案;直取自有键(研究/Research)
  head.appendChild(el('div', 'sw-title', Lang.text('Mods.SandboxWorld.Research.Title')));   // Journey UI 研究
  const closeBtn = el('button', 'sw-btn', '✕');
  closeBtn.style.cssText = 'margin:0; padding:4px 10px; width:auto; font-size:12px; flex:none;';
  closeBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); closeResearchPanel(); });
  head.appendChild(closeBtn);
  panel.appendChild(head);

  const prog = el('div', 'sw-res-prog');
  panel.appendChild(prog);
  const list = el('div', 'sw-res-list');
  panel.appendChild(list);

  const render = () => {
    // 全局进度（CountFullyResearchedItems）
    const done = r.completedCount();
    const total = r.totalItems();
    prog.textContent = `${Lang.text('Mods.SandboxWorld.Research.Progress')} ${done} / ${total}`;
    list.textContent = '';
    // 背包内可研究物品（去重聚堆）
    const seen = new Map<number, number>();
    for (const s of inv.slots) {
      if (!s) continue;
      const vid = vidOf(s.id);
      if (vid <= 0 || !r.tryGetSacrificeNumbers(vid)) continue;
      seen.set(vid, (seen.get(vid) ?? 0) + s.stack);
    }
    if (!seen.size) {
      list.appendChild(el('div', '', Lang.text('Mods.SandboxWorld.Research.Empty')));
      return;
    }
    for (const [vid, stack] of seen) {
      const info = r.tryGetSacrificeNumbers(vid)!;
      const doneItem = info.have >= info.need;
      const row = el('div', 'sw-res-row' + (doneItem ? ' done' : ''));
      const nm = el('div', 'nm', Lang.itemName(vid) ?? `#${vid}`);
      row.appendChild(nm);
      const bar = el('div', 'bar');
      const fill = el('div', 'fill');
      fill.style.width = `${Math.min(100, Math.round((info.have / info.need) * 100))}%`;
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('div', 'num', doneItem ? '✓' : `${Math.min(info.have, info.need)}/${info.need}`));
      if (!doneItem) {
        // 背包按原版 id 扣除（Player.ConsumeItem 顺序扫描语义的 UI 侧等价）：
        // 从 slots 找到首个匹配 vid 的堆扣 1，返回是否成功
        const consumeOne = (): boolean => {
          for (let i = 0; i < inv.slots.length; i++) {
            const s = inv.slots[i];
            if (s && vidOf(s.id) === vid) {
              s.stack--;
              if (s.stack <= 0) inv.slots[i] = null;
              return true;
            }
          }
          return false;
        };
        const b1 = el('button', '', Lang.text('Mods.SandboxWorld.Research.Sacrifice'));
        b1.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          // RegisterItemSacrifice：扣 1 + 计数（幂等早退在内核侧）
          if (consumeOne()) {
            playResearchSfx(game, r.sacrifice(vid, 1));
            // M9 研究上报（CreativeUI.SacrificeItem :308：本地注册 + 发服务器中继）
            game.net?.sendJourneyUnlock(vid, 1);
            game.cb.onInventoryChanged?.();
          }
          render();
        });
        const bAll = el('button', '', Lang.text('Mods.SandboxWorld.Research.SacrificeAll'));
        bAll.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          // CreativeUI.SacrificeItem :297-314：消耗量 = min(need-have, stack)——
          // 永不超扣（曾整堆扣光：计数满了物品还在被吃）。音效按【末件】判定播一声
          // （原版单次 SacrificeItem 一段动画一声；逐件循环只取最后一次返回值）
          const remaining = info.need - info.have;
          let n = 0;
          let justCompleted = false;
          while (n < stack && n < remaining && consumeOne()) { justCompleted = r.sacrifice(vid, 1); n++; }
          if (n > 0) {
            playResearchSfx(game, justCompleted);
            // M9：整包上报（原版按 SacrificeItem 单帧 num2——本 UI 逐件扣，合计上报）
            game.net?.sendJourneyUnlock(vid, n);
            game.cb.onInventoryChanged?.();
          }
          render();
        });
        row.appendChild(b1);
        row.appendChild(bAll);
      }
      list.appendChild(row);
    }
  };
  render();

  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  (document.querySelector('.sw-root') ?? document.body).appendChild(panel);
  escHandler = (e) => { if (e.code === 'Escape') closeResearchPanel(); };
  window.addEventListener('keydown', escHandler);
  game.sfx.play('menuTick', 1);
}

/** ★SW-AY1 R5：Main.CreativeMenu.IsShowingResearchMenu() 等价探针（ItemSlot.cs:631
 *  消费——Shift+点背包格 context 0 = 研究献祭特化支的路由判别）。面板为模块级单例，
 *  UI 层无法经实例访问，故走本导出 */
export function isResearchPanelOpen(): boolean {
  return panel !== null;
}

export function closeResearchPanel(): void {
  researchBlockingRelease?.();   // ★BJ704-G7 件5:栈律还原(末出才下写;闭包持开启拍的 input,免 __swGame 重查拍错代实例)
  researchBlockingRelease = null;
  panel?.remove();
  panel = null;
  if (escHandler) { window.removeEventListener('keydown', escHandler); escHandler = null; }
}
