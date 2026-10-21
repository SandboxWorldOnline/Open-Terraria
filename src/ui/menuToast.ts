/** ★BJ691（2026-10-17 用户明令「导入后不要 alert，直接通过消息提示显示」）：菜单层 toast。
 *  ui.toast 落 .sw-root（z-index:10，UI.ts CSS）会被选择面板覆盖层（holder z22 /
 *  .sw-vsel z20）盖住 → 本助手直挂 document.body + inline z-index:1000 逃逸全部
 *  菜单层叠；样式类复用 UI.ts .sw-toast（UI 构造期已注入 <style>，菜单流程恒在场）。
 *  生命周期同 ui.toast（2500ms 后 0.4s 淡出移除）。node 测试域无 document=静默跳过。
 *
 *  ★BJ704-G7 件3（R5 登记债②清偿,2026-10-21）：单槽顶替语义同款化（ui.toast 判例
 *  =toastEl.remove 先清+计时器复位,UI.ts toast()）。旧实现多条同位（.sw-toast
 *  top:64px 居中）纯叠放：后到 DOM 序盖上先到;先到 ms 较长时被后到短泡盖住淡出
 *  不可见,后到移除后先到突然重现（闪现伪影）;同位零错位设计下并存=纯伪影无信息
 *  增量。修=后到顶替（模块级单槽:新到先移除旧元素+清双段计时器,先到连同淡出链
 *  一并作废）。 */
let toastEl: HTMLElement | null = null;
let toastTimer = 0;
let toastFadeTimer = 0;

export function menuToast(msg: string, ms = 2500): void {
  if (typeof document === 'undefined') return;
  if (toastEl) toastEl.remove();   // 单槽顶替：后到即先清（ui.toast 同款）
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = 0; }
  if (toastFadeTimer) { clearTimeout(toastFadeTimer); toastFadeTimer = 0; }
  const t = document.createElement('div');
  t.className = 'sw-toast';
  t.style.zIndex = '1000';
  t.textContent = msg;
  document.body.appendChild(t);
  toastEl = t;
  toastTimer = window.setTimeout(() => {
    toastTimer = 0;
    t.style.opacity = '0';
    toastFadeTimer = window.setTimeout(() => {
      toastFadeTimer = 0;
      t.remove();
      if (toastEl === t) toastEl = null;
    }, 500);
  }, ms);
}
