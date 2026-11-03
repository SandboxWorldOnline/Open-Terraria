// ★BJ280（2026-09-22）页面卸载拦截纯核：dirty 判定 + beforeunload 处理器 +
// visibilitychange 隐藏兜底判定。逻辑独立成模块以便 vitest 直测（mainFlow 依赖
// 全量 DOM/资产装配,不可在 node 环境 boot）;装配面（监听器安装/标志位生命周期:
// enterGame 置位 / 手动保存·保存并退出·回标题清除）在 mainFlow.createFlow,
// 由 tests/bj280-unload-guard.test.ts 结构锁锚定。

/** 卸载拦截面判定（纯函数）：会话 dirty（进世界后未走【用户确认的】保存链）且
 *  非退出保存中 → 拦。标题态 dirty 恒 false 永不拦;SaveAndQuit 保存屏（quitting）
 *  自带确认,不二次拦截（BJ280 任务处方;保存屏期 reload 撕在途退出档=BJ144 已
 *  登记残面,本刀不扩权）。 */
export function unloadGuardShouldBlock(dirty: boolean, quitting: boolean): boolean {
  return dirty && !quitting;
}

/** beforeunload 处理器工厂：拦截面命中时按现代浏览器标准两行触发原生确认
 *  （preventDefault + returnValue='';浏览器不允许自定义文案,SW 侧如实转述提示,
 *  不自造弹层——原生框是唯一可靠拦截面）。mainFlow.createFlow 以闭包
 *  () => ({ dirty: worldDirty, quitting }) 装配;工厂独立导出供单测直驱断言
 *  preventDefault/returnValue。 */
export function makeBeforeUnloadHandler(
  getGuardState: () => { dirty: boolean; quitting: boolean },
): (e: BeforeUnloadEvent) => void {
  return (e) => {
    if (!unloadGuardShouldBlock(getGuardState().dirty, getGuardState().quitting)) return;
    e.preventDefault();
    e.returnValue = '';
  };
}

/** visibilitychange hidden 兜底判定（纯函数）：仅会话 dirty 且有游戏实例且无在途
 *  保存时触发静默自动保存（与 onAutoSave 同 silent 档;静默保存非用户确认存档点,
 *  不清 dirty——宁多拦不漏拦）。quitting 时 SaveAndQuit 链持有保存权,不并发第二链
 *  （BJ144 互斥）;saveInFlight 防隐藏/回前台抖动期双链重叠。
 *  ★2026-11-02 用户实报「关闭自动保存后关 tab 仍触发兜底保存」改判：本门原不读
 *  Options.autoSave——autoSave 关闭只压制周期档（Game.ts 两消费位 :9466/:9642）,
 *  兜底面旁路。原版 autoSave（1457 Main.cs:1214 默认 true,1456 :1196）只门周期档
 *  （DoUpdate_AutoSave 1457 :19920/1456 :19589 的 `(autoSave || netMode==2)` 600000ms）
 *  ——原版无卸载兜底面（桌面环境）;本兜底=BJ280 浏览器环境补面。改判依据：
 *  autoSave 关闭=用户明示「不要任何自动存档点」（save-scum/存档点自控）,兜底随关;
 *  卸载拦截（beforeunload 原生确认）不受本门影响（dirty 门独立）,桌面关 tab 仍有
 *  确认保护。移动端 OS 级杀页无确认框,autoSave 关闭即接受丢档风险=设置语义自洽。
 *  ★同刀同族第二缺口（mpClient 门）：「联机加入」也置 dirty（mainFlow :503 五路
 *  全覆盖）,而 doSave 无 MP 客户端守卫——MP 会话切后台兜底会拿【同步快照】写本地
 *  档。周期档有 `!mpClient` 门（Game.ts :9465/:9641,理由=同步快照覆盖单人档）,
 *  兜底补同门;原版 netMode==1 客户端永不存世界（DoUpdate_AutoSave :19922 分支只
 *  saveToonWhilePlaying 存玩家,且 SW 房间制玩家态实时上报 host=客户端零存档面）。
 *  房主（isHost）世界权威在本地,兜底照常。谓词单源债：mpClient 三处平行构形
 *  （Game.ts ×2+此处）,登记待收编（R31 P-1 同族）。 */
export function hiddenBackstopShouldSave(s: {
  dirty: boolean; quitting: boolean; hasGame: boolean; saveInFlight: boolean;
  autoSaveEnabled: boolean; mpClient: boolean;
}): boolean {
  return s.autoSaveEnabled && !s.mpClient && s.dirty && !s.quitting && s.hasGame && !s.saveInFlight;
}
