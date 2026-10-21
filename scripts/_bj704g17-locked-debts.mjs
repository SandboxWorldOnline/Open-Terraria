// ★BJ704-G17 实跑探针：域外锁定债三件（QuickMount FailedCCed 分道端到端;5236 私有实例）。
//  P1 cced 静默:鼠 55 骑乘+Frozen+抚摸态,R 键×3 → 仍骑/不停抚摸/不清 buff/无 toast
//  P2 ok 分道:解冻后 R 键一次 → 下坐+回盒+清 buff+停抚摸
//  P3 nospace 三连:头顶封实心,R×3 → 第 3 拍强制下坐+传送（前两拍 toast×2）
import puppeteer from 'puppeteer-core';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5199';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--no-sandbox'],
  defaultViewport: { width: 1360, height: 860 },
  protocolTimeout: 600000,
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
  const { BuffType } = await import('/src/stats/Buffs.ts');
  const summonRat = async () => {
    const key = Object.keys(items).find(k => k.startsWith('vi_5525_'));
    if (!key) return false;
    inv.add(items[key], 1);
    for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i] && inv.slots[i].id === items[key]) inv.selected = i;
    g.paused = false;
    g.input.mouseDown = true;
    for (let i = 0; i < 30 && !p.ridingMount; i++) await sleep(40);
    g.input.mouseDown = false;
    await sleep(160);
    g.paused = true;
    return p.ridingMount && p.mount.type === 55;
  };
  /** R 键一拍（虚拟 action 电平 + updateUse 直驱;释放拍清 cartKeyLatch） */
  const pressR = () => {
    g.input.setVirtualAction('QuickMount', true);
    g.updateUse(1 / 60);
    g.input.setVirtualAction('QuickMount', false);
    g.updateUse(1 / 60);
  };
  let toasts = 0;
  const origToast = g.cb.onToast;
  g.cb.onToast = (t) => { toasts++; return origToast.call(g.cb, t); };

  p.maxHp = 500; p.hp = 500;

  // ---- P1 cced 静默 ----
  ok('P1a 鼠 55 召唤（物品通道 5525）', await summonRat(), `type=${p.mount.type} cced=${p.cced}`);
  ok('P1b 抚摸态置位', p.petMount() === true && p.petting.mount === true);
  const hadBuff = p.buffs.has(BuffType.RatMount);
  p.buffs.apply(BuffType.Frozen, 600);
  ok('P1c 冻结置位（cced=true）', p.cced === true);
  pressR(); pressR(); pressR();
  ok('P1d R×3 后仍骑乘（FailedCCed 静默,不入 3 连强制链）', p.ridingMount === true, `type=${p.mount.type}`);
  ok('P1e 无 toast（旧合流形=3 toast）', toasts === 0, `toasts=${toasts}`);
  ok('P1f 抚摸未停（停抚摸只在 Dismount 体内）', p.petting.isPetting === true && p.petting.mount === true);
  ok('P1g 伴生 buff 未清（ClearBuff 只在下坐拍）', hadBuff && p.buffs.has(BuffType.RatMount) === true);
  ok('P1h 盒仍 14×14（未强制下坐回盒）', p.w === 14 && p.h === 14, `${p.w}x${p.h}`);

  // ---- P2 ok 分道 ----
  p.buffs.remove(BuffType.Frozen);
  ok('P2a 解冻（cced=false）', p.cced === false);
  const y0 = p.y;
  pressR();
  ok('P2b R 一次 → 下坐', p.ridingMount === false);
  ok('P2c 回盒 20×42', p.w === 20 && p.h === 42, `${p.w}x${p.h}`);
  ok('P2d 伴生 buff 已清', p.buffs.has(BuffType.RatMount) === false);
  ok('P2e 抚摸已停（Dismount :6229-6231）', p.petting.isPetting === false);
  ok('P2f 无 toast（成功拍无尘无 toast）', toasts === 0, `toasts=${toasts}`);

  // ---- P3 nospace 三连 ----
  ok('P3a 再召唤鼠 55', await summonRat(), `type=${p.mount.type}`);
  // 头顶封实心（玩家列±4,顶上 2 行起 6 行厚 → 20×42 回盒探针必败）
  const ptx = Math.floor(p.cx / 16), pty = Math.floor((p.y + p.h) / 16);
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -8; dy <= -2; dy++) st.setTile(ptx + dx, pty + dy, 1, 0, 0);
  }
  const res0 = p.mount.canDismountWithResult(p);
  ok('P3b 探针判 nospace（夹具有效性）', res0 === 'nospace', `res=${res0}`);
  pressR(); pressR();
  ok('P3c 前两拍:toast×2+仍骑', toasts === 2 && p.ridingMount === true, `toasts=${toasts}`);
  const pyBefore = p.y;
  pressR();
  ok('P3d 第 3 拍:强制下坐+传送（PlayerNoSpaceTeleport 就近可容盒）',
    p.ridingMount === false && Math.abs(p.y - pyBefore) > 0.5, `dy=${(p.y - pyBefore).toFixed(1)}`);

  g.cb.onToast = origToast;
  res.toasts = toasts;
  return res;
});
let fails = 0;
for (const s of out.steps) { console.log(s); if (s.startsWith('FAIL')) fails++; }
console.log(`\n[G17 probe] ${out.steps.length - fails}/${out.steps.length} PASS${errs.length ? ` | pageerrors: ${errs.join('; ')}` : ''}`);
await browser.close();
process.exit(fails || errs.length ? 1 : 0);
