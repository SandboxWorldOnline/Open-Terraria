// ★BJ704-G18 实跑探针:新登记债清算六件端到端（5237 私有实例）。
//  P1 出生尘:召唤 55 鼠 → typed 尘 100（债3 setMount 面;旧 10 粒圆近似）
//  P1b R 成功拍:开阔地下坐 → typed 尘 100+无 toast+回盒（债3 R 键面）
//  P2 同型鞍 no-op:骑 3 史莱姆用同鞍 2430 → 保持骑乘+UseSound+零尘（债5;
//     55/56/61 骑乘=noItems 使用整链禁用（Player.cs:5757,仓 :15408 同相）——
//     同型 no-op 判别面用非 DontHoldItems 坐骑;nospace 判别面反过来须用 14×14
//     变身骑（史莱姆 42px 骑乘盒=目标盒,封顶即嵌墙）,故 P2 后先下坐再召鼠）
//  P3 失败拍:头顶封实心 R → toast=本地化串（债1 生产裸键说反证）+typed 尘 20（债2）
//  P4 异地清零:败 1 → 移动+真实 tick → 计数清零 → 再败=1 非 2 且不下坐（债4）
//  P5 成功拍:拆封 R → typed 尘 100+回盒（债3 收口）
//  ★封顶用 st.setTile（真写入口,刷碰撞可见性;setTileSilent 绕缓存=物理不可见,
//   G17 探针同款;夹具有效性以 canDismountWithResult==='nospace' 预检钉死）
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
  const ratKey = Object.keys(items).find(k => k.startsWith('vi_5525_'));
  const slimeKey = Object.keys(items).find(k => k.startsWith('vi_2430_'));
  inv.add(items[ratKey], 1);
  inv.add(items[slimeKey], 1);
  const selectItem = (key) => {
    for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i] && inv.slots[i].id === items[key]) { inv.selected = i; return true; }
    return false;
  };
  const useHeld = async (ticks = 14) => {
    g.paused = false;
    g.input.mouseDown = true;
    for (let i = 0; i < ticks; i++) await sleep(40);
    g.input.mouseDown = false;
    await sleep(120);
    g.paused = true;
  };
  const pressR = () => {
    g.input.setVirtualAction('QuickMount', true);
    g.updateUse(1 / 60);
    g.input.setVirtualAction('QuickMount', false);
    g.updateUse(1 / 60);
  };
  const dusts = [];
  const origDust = g.spawnDust.bind(g);
  g.spawnDust = (...a) => { dusts.push({ x: a[0], y: a[1], w: a[2], h: a[3], type: a[4], alpha: a[7], color: a[8] }); return origDust(...a); };
  const sfx = [];
  const origSfx = g.playSfxFile.bind(g);
  g.playSfxFile = (f, ...rest) => { sfx.push(f); return origSfx(f, ...rest); };
  const toasts = [];
  const origToast = g.cb.onToast;
  g.cb.onToast = (t) => { toasts.push(String(t)); return origToast.call(g.cb, t); };
  const cnt = () => g['mountNoSpaceCount'];

  p.maxHp = 500; p.hp = 500;
  const feetRow = Math.floor((p.y + p.h) / 16);
  const px0 = Math.floor(p.x / 16);
  const spanCols = [];
  for (let dx = -8; dx <= 8; dx++) spanCols.push(px0 + dx);
  const setCeil = (t) => {
    for (const x of spanCols) {
      for (let dy = -4; dy <= -2; dy++) st.setTile(x, feetRow + dy, t, 0, 0);
      if (t === 0) st.setTile(x, feetRow, 1, 0, 0);      // 拆封时地面行保实（防侧移坠离）
      else st.setTile(x, feetRow, 1, 0, 0);               // 封顶时地面行同保实（P4 平台）
    }
  };

  // ---- P1 出生尘（setMount 面） ----
  ok('P1a 选鞍召唤鼠 55（物品通道 5525）', selectItem(ratKey) && (await useHeld(), p.ridingMount && p.mount.type === 55), `type=${p.mount.type}`);
  const birth = dusts.filter(d => d.type === 31 && d.w === 54);
  ok('P1b 出生尘 100（DoSpawnDust :6366 isDismounting=false;旧 10 粒圆近似）', birth.length === 100, `n=${birth.length}`);

  // ---- P1b R 成功拍（开阔地） ----
  dusts.length = 0; toasts.length = 0;
  pressR();
  const dismountDust = dusts.filter(d => d.type === 31 && d.w === 54);
  ok('P1c R 成功 → typed 尘 100（旧零尘=债3 本体）', dismountDust.length === 100, `n=${dismountDust.length}`);
  ok('P1d 下坐+回盒 20×42+无 toast', p.ridingMount === false && p.w === 20 && p.h === 42 && toasts.length === 0, `${p.w}x${p.h} toasts=${toasts.length}`);

  // ---- P2 同型鞍 no-op（骑 3 史莱姆,非 DontHoldItems） ----
  dusts.length = 0; sfx.length = 0;
  ok('P2a 选粘鞍召唤史莱姆 3（物品通道 2430）', selectItem(slimeKey) && (await useHeld(), p.ridingMount && p.mount.type === 3), `type=${p.mount.type}`);
  const birth3 = dusts.filter(d => d.type === 56 && d.w === 60);
  ok('P2b 出生尘 100（mount 3 spawnDust=56,盒 w+40=60）', birth3.length === 100, `n=${birth3.length}`);
  dusts.length = 0; sfx.length = 0;
  p.useTime = 0;
  await useHeld(14);                               // 冷却后持按重触发（同窗第二次使用）
  ok('P2c 同型鞍使用 → 仍骑乘（SetMount :6263 早退 no-op;旧=下坐）', p.ridingMount === true && p.mount.type === 3, `riding=${p.ridingMount} type=${p.mount.type}`);
  ok('P2d UseSound 播放（ItemCheck_StartActualUse :52315-52331 面）', sfx.includes('Item_81'), `sfx=[${sfx.slice(0, 4).join(',')}]`);
  ok('P2e no-op 零尘（SetMount 早退无 DoSpawnDust）', dusts.length === 0, `n=${dusts.length}`);
  dusts.length = 0;
  pressR();                                        // 史莱姆下坐（开阔地,P3 前清场）
  ok('P2f 史莱姆 R 下坐 → 尘 100（56,w60）', p.ridingMount === false && dusts.filter(d => d.type === 56 && d.w === 60).length === 100, `n=${dusts.length}`);

  // ---- P3 失败拍（债2 尘公式/型 + 债1 toast 本地化;14×14 鼠） ----
  dusts.length = 0; toasts.length = 0;
  ok('P3a 再召鼠 55（nospace 判别面）', selectItem(ratKey) && (await useHeld(), p.ridingMount && p.mount.type === 55), `type=${p.mount.type}`);
  setCeil(1);
  const probe = p.mount.canDismountWithResult(p);
  ok('P3b 夹具预检 nospace（canDismountWithResult）', probe === 'nospace', `res=${probe}`);
  pressR();
  ok('P3c 失败拍计数=1+仍骑乘', cnt() === 1 && p.ridingMount === true, `count=${cnt()} riding=${p.ridingMount}`);
  const fail = dusts.filter(d => d.type === 31 && d.w === 34);
  ok('P3d 失败尘 20（计数×20;旧 10+×20=30 程序化圆）', fail.length === 20, `n=${fail.length}`);
  ok('P3e 盒=Inflate(10,10)（x-10/y-10/w+20/h+20,骑乘盒 14×14）', fail.length > 0
    && Math.abs(fail[0].x - (p.x - 10)) < 0.001 && Math.abs(fail[0].y - (p.y - 10)) < 0.001
    && fail[0].w === p.w + 20 && fail[0].h === p.h + 20,
    `${fail[0]?.x},${fail[0]?.y},${fail[0]?.w},${fail[0]?.h}`);
  ok('P3f toast=本地化串（生产裸键说反证——G17 债1 销案）', toasts[0] === '空间不足，无法上下坐骑！', `text=${toasts[0]}`);

  // ---- P4 异地清零（债4） ----
  dusts.length = 0;
  p.x += 24;                                       // 侧移 1.5 格（天花板带内,地面行已平台化）
  g.paused = false;
  await sleep(160);                                // 真实 tick × ~10（fixedUpdate 挂点）
  g.paused = true;
  ok('P4a 移动后逐拍清零（UpdateFailedDismount 位置腿）', cnt() === 0, `count=${cnt()}`);
  pressR();
  ok('P4b 移动后再败=1 非 2（旧仓不清=计数跨位移累计）', cnt() === 1, `count=${cnt()}`);
  ok('P4c 仍骑乘（未误触强制链）', p.ridingMount === true, `riding=${p.ridingMount}`);

  // ---- P5 成功拍（拆封收口） ----
  dusts.length = 0; toasts.length = 0;
  setCeil(0);
  await sleep(80);
  pressR();
  const succ = dusts.filter(d => d.type === 31 && d.w === 54);
  ok('P5a R 成功 → typed 尘 100', succ.length === 100, `n=${succ.length}`);
  ok('P5b 下坐+回盒 20×42+无 toast', p.ridingMount === false && p.w === 20 && p.h === 42 && toasts.length === 0, `${p.w}x${p.h}`);
  ok('P5c 计数终态 0', cnt() === 0, `count=${cnt()}`);
  return res;
});

let pass = 0, fail = 0;
for (const s of out.steps) { console.log(s); s.startsWith('PASS') ? pass++ : fail++; }
console.log(`\nBJ704-G18 探针: ${pass} PASS / ${fail} FAIL${errs.length ? `\npageerror: ${errs.join(' | ')}` : ''}`);
await browser.close();
process.exit(fail === 0 && errs.length === 0 ? 0 : 1);
