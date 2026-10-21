// ★BJ704-R5 探针②(2026-10-21,只读):menuToast body 级 z-index 逃逸自证。
//  合成 z22/z20 fixed 全屏层(=mainFlow holder cssText / .sw-vsel 实测值,已亲读)
//  叠在 .sw-root(z10) 之上,menuToast 后 elementFromPoint 命中=toast 即逃逸成立;
//  另验 .sw-toast 类样式已在场(transition/position)与多 toast 同位叠放形态。
//  运行:SW_ORIGIN=http://localhost:5217 node tools/run-diag.mjs scripts/_bj704r5-menutoast-zprobe.mjs
import { launchBrowser, openPage, bootstrap } from '../tools/probe/lib/index.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, process.env.SW_ORIGIN);
await wait(400);

const R = await page.evaluate(async () => {
  // 合成层叠:z22 holder(mainFlow:1549 同款 cssText) + z20 面板(.sw-vsel 同款)
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed; inset:0; z-index:22; background:rgba(30,30,60,0.9)';
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed; inset:0; z-index:20; background:rgba(10,10,20,1)';
  holder.appendChild(panel);
  document.body.appendChild(holder);
  const { menuToast } = await import('/src/ui/menuToast.ts');
  menuToast('BJ704R5 探针消息');
  await new Promise((r) => setTimeout(r, 60));
  const toasts = [...document.querySelectorAll('.sw-toast')].map((t) => ({
    parentIsBody: t.parentElement === document.body,
    zIndex: t.style.zIndex,
    computedZ: getComputedStyle(t).zIndex,
    position: getComputedStyle(t).position,
    transition: getComputedStyle(t).transition,
    pointerEvents: getComputedStyle(t).pointerEvents,
    rect: (({ left, top, width, height }) => ({ left, top, width, height }))(t.getBoundingClientRect()),
  }));
  const t = document.querySelector('.sw-toast');
  const cx = t.getBoundingClientRect().left + t.getBoundingClientRect().width / 2;
  const cy = t.getBoundingClientRect().top + t.getBoundingClientRect().height / 2;
  const hit = document.elementFromPoint(cx, cy);
  // 多 toast 同位形态(第二条不挤位)
  menuToast('第二条');
  await new Promise((r) => setTimeout(r, 60));
  const n2 = document.querySelectorAll('.sw-toast').length;
  holder.remove();
  document.querySelectorAll('.sw-toast').forEach((x) => x.remove());
  return { toasts, hitIsToast: hit === t, hitClass: hit?.className, n2 };
});
console.log(JSON.stringify(R, null, 2));
await browser.close();
