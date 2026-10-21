// ★BJ701 实跑探针：史莱姆族坐骑垂直速度×2 + 史后坐骑按↓悬浮（物品通道+真实输入合成）
//  A) 粘鞍 2430（物品召唤）空中单拍下落 dy ≈ 2×vy（hyper 双趟）vs 下坐后对照 ≈ vy
//  B) 明胶女式鞍 4981（物品召唤）：
//     B1 按住 Jump（setVirtualAction 真实输入合成）→ jumpHold 段后 Flight 爬升 vy≈-5.44
//     B2 追加按住 Down → vy 钉 1e-5 悬停（y 稳定）
//     B3 松 Down 保持 Jump → 回爬升
//     B4 flyTime 耗尽 + Jump+Down → 无钳快坠（vy > maxFallSpeed/3）
import puppeteer from 'puppeteer-core';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5199';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox'],
  defaultViewport: { width: 1360, height: 860 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`${ORIGIN}/?play=small&invlayout=vanilla`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__swGame && window.__swGame.world && window.__swUI, { timeout: 280000, polling: 1000 });
await sleep(600);
await page.evaluate(() => { document.getElementById('sw-welcome-announce')?.remove(); window.__swUI.closeInventory?.(); });
await sleep(200);
await page.waitForFunction(() => window.__swGame?.player, { timeout: 120000, polling: 500 });

const out = await page.evaluate(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const g = window.__swGame, st = g.world.store, p = g.player, inv = p.inv;
  const items = window.__swItems;
  const res = { steps: [] };
  const ok = (name, cond, extra) => {
    res.steps.push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra !== undefined ? ` (${extra})` : ''}`);
    return cond;
  };
  // ---- 立足平台 + 30 行净空柱 ----
  const ptx = Math.floor(p.cx / 16), pty = Math.floor((p.y + p.h) / 16);
  for (let dx = -6; dx <= 30; dx++) {
    st.setTile(ptx + dx, pty, 1, 0, 0);
    for (let dy = 1; dy <= 32; dy++) st.setTile(ptx + dx, pty - dy, 0);
  }
  for (let i = 0; i < 120 && !p.onGround; i++) { p.fixedUpdate(1 / 60, g.hooksProxy ?? g); await sleep(8); }
  ok('立足静置', p.onGround);

  const summon = (id) => {
    const key = Object.keys(items).find(k => k.startsWith(`vi_${id}_`));
    if (!key) return false;
    inv.add(items[key], 1);
    for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i] && inv.slots[i].id === items[key]) inv.selected = i;
    g.input.mouseDown = true;
    return true;
  };
  const settleFrames = async (n) => { for (let i = 0; i < n; i++) { p.fixedUpdate(1 / 60, g.hooksProxy ?? g); await sleep(4); } };

  // ---- A) 粘鞍 2430：物品通道召唤 + 单拍下落双趟 ----
  ok('粘鞍 2430 入包', summon(2430));
  await sleep(260); g.input.mouseDown = false; await sleep(140);
  ok('骑乘中(type=3)', p.ridingMount === true && p.mount.type === 3, `type=${p.mount.type}`);
  const groundY = p.y;
  // 空中单拍：直上 280px、vy=5、无输入 → 一拍 dy
  p.y = groundY - 280; p.vy = 5; p.onGround = false; p.inputJump = false;
  g.input.setVirtualAction('Jump', false); g.input.setVirtualAction('Down', false);
  await settleFrames(2);
  p.y = groundY - 280; p.vy = 5; p.onGround = false;
  const y0 = p.y;
  p.fixedUpdate(1 / 60, g.hooksProxy ?? g);
  const dyHyper = p.y - y0;
  res.dyHyperMount3 = +dyHyper.toFixed(2);
  res.vyAfterMount3 = +p.vy.toFixed(3);
  ok('A 粘鞍单拍下落 dy≈2×5.4=10.8（hyper 双趟）', dyHyper > 9.5 && dyHyper < 11.5, `dy=${dyHyper.toFixed(2)}`);
  // 下坐对照（mount.dismount(p,g)——Player.dismount 不存在,BJ167 探针同款陷阱）
  p.mount.dismount?.(p, g);
  await settleFrames(3);
  res.dismountedForControl = !p.ridingMount;
  p.y = groundY - 280; p.vy = 5; p.onGround = false;
  const y1 = p.y;
  p.fixedUpdate(1 / 60, g.hooksProxy ?? g);
  const dyCtl = p.y - y1;
  res.dyControlNoMount = +dyCtl.toFixed(2);
  ok('A 对照（步下）dy≈5.4 单趟', !p.ridingMount && dyCtl > 4.5 && dyCtl < 6.5, `dy=${dyCtl.toFixed(2)} riding=${p.ridingMount}`);

  // ---- B) 明胶女式鞍 4981：真实输入合成全链 ----
  inv.consume?.(Object.values(inv.slots).find?.(() => false));   // no-op 占位
  ok('明胶女式鞍 4981 入包', summon(4981));
  await sleep(260); g.input.mouseDown = false; await sleep(140);
  ok('B 骑乘中(type=50)', p.ridingMount === true && p.mount.type === 50, `type=${p.mount.type}`);
  // 落回平台再起飞（真实帧驱动）
  for (let i = 0; i < 300 && !p.onGround; i++) { await sleep(16); }
  ok('B 回地', p.onGround, `y=${p.y.toFixed(0)} ground=${groundY.toFixed(0)}`);
  // B1 按住 Jump：弹跳→Flight 爬升
  g.input.setVirtualAction('Jump', true);
  await sleep(700);                                  // ~42 帧：jumpHold 10 拍 + 爬升接管
  const vyClimb = p.vy;
  res.vyClimbHoldJump = +vyClimb.toFixed(3);
  ok('B1 按住跳 → Flight 爬升 vy≈-5.4375', vyClimb <= -5.3 && vyClimb >= -5.6, `vy=${vyClimb.toFixed(3)} jH=${p.jumpHold} fly=${p.mount.flyTime}`);
  // B2 追加按住 Down → 悬停钉位（★燃料 80 拍仅 1.33s——B1 已耗 ~32,必须补满再测,
  //   否则 B2 中途耗尽落入「耗尽+↓无钳快坠」支(首轮探针实踩:vy 采样 5.47)）
  g.input.setVirtualAction('Down', true);
  p.mount.flyTime = 80;
  await sleep(700);                                  // ×0.9 衰减 ~30 拍 → 钉位
  p.mount.flyTime = 80;                              // 钉位观测窗补燃（钉位本身 vy=1e-5,不耗位移）
  const vyHover = p.vy, yHover = p.y;
  res.vyHoverDown = +vyHover.toPrecision(6);
  await sleep(500);
  const dyHover = p.y - yHover;
  res.dyHoverStability = +dyHover.toFixed(3);
  ok('B2 跳+↓ → vy 钉 1e-5 悬停', Math.abs(vyHover - 1e-5) < 1e-6, `vy=${vyHover.toPrecision(6)}`);
  ok('B2 悬停 y 稳定（30 帧 |Δy|<0.01）', Math.abs(dyHover) < 0.01, `dy=${dyHover.toFixed(4)}`);
  const shot = { hoverY: p.y, hoverVy: p.vy };
  // B3 松 Down 保持 Jump → 回爬升（从钉位 1e-5 重拉：首拍 -0.5 反抽,后 -0.1/拍
  //    爬回 -5.4375 帽需 ~55 拍——观测窗须 ≥1s 且补燃（80 拍燃料 < 72 拍观测窗,
  //    首轮 500ms 采到中途 -3.4/次轮耗尽减速 -2.47 均属燃料窗伪影非行为面））
  g.input.setVirtualAction('Down', false);
  p.mount.flyTime = 80;
  await sleep(1200);
  const vyClimb2 = p.vy;
  res.vyClimbAfterDownRelease = +vyClimb2.toFixed(3);
  ok('B3 松↓ → 回爬升 vy≤-5.3', vyClimb2 <= -5.3, `vy=${vyClimb2.toFixed(3)}`);
  // B4 耗尽 + Jump+Down → 无钳快坠
  g.input.setVirtualAction('Down', true);
  p.mount.flyTime = 0;
  const yExh0 = p.y;
  await sleep(1300);                                 // ~78 帧 gravity/3 无钳累积
  const vyExh = p.vy;
  res.vyExhaustedDown = +vyExh.toFixed(3);
  ok('B4 耗尽+跳↓ → 无钳快坠 vy>3.5（钳=3.3367）', vyExh > 3.5, `vy=${vyExh.toFixed(3)} dyTotal=${(p.y - yExh0).toFixed(0)}`);
  g.input.setVirtualAction('Jump', false); g.input.setVirtualAction('Down', false);
  await sleep(300);
  res.final = { riding: p.ridingMount, type: p.mount.type, ...shot };
  return res;
});
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: '/tmp/bj701-queen-hover.png' });
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors:', JSON.stringify(errs));
await browser.close();
