// ★BJ704-G7 件5（R5 登记债⑧/A9 域,2026-10-21）：模态面板 uiBlocking 保存/还原栈律。
//
// 旧形（A9 2026-10-14,JourneyPowersUI/ResearchUI 各持模块级 savedBlocking）：开=
// 保存现值+置 true,关=无条件下写——双面板交错开关序可丢/误置 blocking:
//   开A(存 false)→开B(存 true)→关A(下写 false:B 仍开着却解封)→关B(下写 true:
//  两面板全关却永久粘滞) ——任意交错序均有一窗错值。
//  ★不可达声明（当前防线,防御性修的主张依据）：两面板互斥不可达——(a)面板开=
//  uiBlocking=true,而 ToggleInv/ToggleCreativeMenu/MapFull 等入口全门
//  `!input.uiBlocking`(Game.ts 键盘链),背包无法再开=背包内双入口钮
//  (UI.ts 联机/旅程钮行)不可达;(b)Journey 面板的「打开研究菜单」钮先
//  closeJourneyPowersPanel 再开 Research(JourneyPowersUI 研究入口),顺序非交错。
//  本模块=防未来新增路径（热键直开/门放宽）落进交错序的栈律保险。
//
// 栈律：深度计数,首入存沿值,末出才还原;释放序任意正确。跨 Game 实例自愈：
// claim 检测 input 换对象（重进世界=新 Game.input）即弃旧栈重立;旧 token 迟到
// release 只写旧对象（已游离=无害）,不越权动新栈。释放幂等（防面板双 close 链
// 重复 release 把深度打过底）。
export interface UiBlockingInput {
  uiBlocking: boolean;
}
export type UiBlockingRelease = () => void;

let depth = 0;
let saved = false;
let boundInput: UiBlockingInput | null = null;

/** 领取 uiBlocking（面板开）。返回释放句柄（面板关时调用;幂等）。
 *  首入（depth 0→1）保存沿值并置 true;后续面板叠加只增深度。 */
export function claimUiBlocking(input: UiBlockingInput): UiBlockingRelease {
  if (input !== boundInput) {
    // 新 Game 实例（或首次）：旧栈（若滞留未释放的旧 claim）整体作废重立
    boundInput = input;
    depth = 0;
    saved = input.uiBlocking;
  }
  if (depth === 0) saved = input.uiBlocking;
  depth++;
  input.uiBlocking = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (input !== boundInput) return;   // 旧 Game 的迟到释放：新栈已立,不入账
    depth = Math.max(0, depth - 1);
    if (depth === 0) input.uiBlocking = saved;
  };
}
