// ★BJ704-G7 探针(2026-10-21,只读):件3 menuToast 单槽顶替真 DOM 自证。
//  R5 探针②(_bj704r5-menutoast-zprobe)实测过多条同位纯叠放形态(后到盖上);
//  本探针验证刀后形态:后到顶替(单槽,先到连同淡出链作废)=闪现伪影根除。
//  ★量测域=document.body 直子(menuToast 挂 body;boot 期 ui.toast 存储预警挂
//  .sw-root 同类名 .sw-toast——body 域天然隔离,勿用全文档 querySelector)。
//  相位:①长 ms 先到+短 ms 后到 → body 恰 1 元素、先 isConnected=false(旧形态=2
//  元素叠放,后到移除后先到会突然重现);②顶替元素仍在 top:64px 居中同位(BJ691 层
//  级逃逸面不回退)。
//  运行:SW_ORIGIN=http://localhost:5221 node tools/run-diag.mjs scripts/_bj704g7-menutoast-single-slot.mjs
import { launchBrowser, openPage, bootstrap } from '../tools/probe/lib/index.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, process.env.SW_ORIGIN);
await wait(400);

const R = await page.evaluate(async () => {
  // 清场:boot 期遗留 toast(含 body 域 menuToast 与 .sw-root 域 ui.toast)全摘
  document.querySelectorAll('.sw-toast').forEach((x) => x.remove());
  const { menuToast } = await import('/src/ui/menuToast.ts');
  // ① 长先短后(R5 实报闪现形态:旧实现后到盖上,后到移除后先到重现)
  menuToast('G7 长泡', 30000);
  await new Promise((r) => setTimeout(r, 80));
  const first = document.body.querySelector('.sw-toast');
  const rect1 = first.getBoundingClientRect();
  menuToast('G7 短泡', 200);
  await new Promise((r) => setTimeout(r, 80));
  const all = [...document.body.querySelectorAll(':scope > .sw-toast')];
  const second = document.body.querySelector('.sw-toast');
  const rect2 = second.getBoundingClientRect();
  // ② 等过短泡全寿命(200ms+500ms 淡出)——单槽下全程无第二条闪现
  await new Promise((r) => setTimeout(r, 900));
  const afterFade = document.body.querySelectorAll(':scope > .sw-toast').length;
  const out = {
    firstRemovedOnReplace: !first.isConnected,
    countAfterSecond: all.length,
    secondIsNew: second !== first,
    secondText: second.textContent,
    sameSlot: Math.abs(rect1.left - rect2.left) < 0.5 && Math.abs(rect1.top - rect2.top) < 0.5,
    topAnchored64: Math.abs(rect2.top - 64) < 1,
    zIndex: second.style.zIndex,
    countAfterShortFade: afterFade,
  };
  document.querySelectorAll('.sw-toast').forEach((x) => x.remove());
  return out;
});
console.log(JSON.stringify(R, null, 2));
await browser.close();
