// ★BJ704-R4 蓝职独立自证探针 v2（红蓝对抗·Player/Mounts 域）——暂停态逐拍确定性习语
// （BJ703-D D-face 同款:g.paused=true + p.fixedUpdate 手动步进 + p.inputJump 直写;
//   实时 50ms 轮询漏拍/步行跳需 Game 级输入合成的双坑在 v1 实踩,判例见 BJ699 探针注）：
//  A) BJ699 干支毯面：装毯 934 落地 → carpetTime===0（清零非回满）+ canCarpet 开；
//     持跳腾空 → 激活拍授予 carpetTime===300;松跳落地 → 再清零
//  B) BJ699 无毯门：摘毯落地 → canCarpet===false
//  C) BJ699 湿支毯面：挖坑注水沉底（逐拍捕捉 vy===0 湿路由）→ carpetTime===0
//  D) 燃料补燃坑（ResetFlightTime 位点差=登记债运行时形状）：坐骑 50 持跳烧油后
//     不松手落地,落地拍 flyTime 即回满 80（原版须 releaseJump 才回充）
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
  // ---- 平台 + 暂停 + 手动步进（确定性） ----
  const ptx = Math.floor(p.cx / 16), pty = Math.floor((p.y + p.h) / 16);
  for (let dx = -8; dx <= 30; dx++) {
    st.setTile(ptx + dx, pty, 1, 0, 0);
    for (let dy = 1; dy <= 45; dy++) st.setTile(ptx + dx, pty - dy, 0);
  }
  g.paused = true;
  const step = () => p.fixedUpdate(1 / 60, g.hooksProxy ?? g);
  for (let i = 0; i < 120 && !p.onGround; i++) step();
  ok('立足静置', p.onGround, `pty=${pty}`);

  // ---- A) 干支毯面（逐拍采样） ----
  const carpetKey = Object.keys(items).find(k => k.startsWith('vi_934_'));
  inv.armor[3] = { id: items[carpetKey], stack: 1 };
  for (let i = 0; i < 5; i++) step();
  ok('A 毯入装(eq.carpet)', p.equipStats.carpet === true);
  ok('A 落地:canCarpet 开+carpetTime===0(清零非 300)',
    p.canCarpet === true && p.carpetTime === 0, `can=${p.canCarpet} fuel=${p.carpetTime}`);
  p.inputJump = true;                                   // 手动直写（暂停态合成冻结,BJ703-D D-face 同款）
  let actTick = -1, maxAirFuel = 0, airborne = false, landTick = -1, landFuel = -1;
  const aTrail = [];
  for (let t = 0; t < 260; t++) {
    step();
    if (!p.onGround) airborne = true;
    if (airborne && !p.onGround) maxAirFuel = Math.max(maxAirFuel, p.carpetTime);
    if (actTick < 0 && !p.onGround && p.carpetTime === 300) actTick = t;
    if (t < 40 && p.carpetTime > 0) aTrail.push(`t${t}:fuel${p.carpetTime},og${p.onGround}`);
    if (airborne && p.onGround && p.carpetTime === 0) { landTick = t; break; }
  }
  res.aTrail = aTrail.slice(0, 6); res.actTick = actTick; res.maxAirFuel = maxAirFuel; res.landTick = landTick;
  // 激活拍 carpetTime=300 同拍即被滑翔消耗 −1 → 采样首见 299;断言 ≥299(=300 曾存在)
  ok('A 持跳腾空:激活拍授予 300(首见 299=300−1)', maxAirFuel >= 299, `actTick=${actTick} maxAirFuel=${maxAirFuel}`);
  p.inputJump = false;
  if (landTick < 0) { for (let t = 0; t < 400 && landTick < 0; t++) { step(); if (p.onGround) { landTick = t; landFuel = p.carpetTime; } } }
  else landFuel = p.carpetTime;
  // 落地拍本体复位在下一拍跑(onGround 由本拍碰撞置位,毯复位段在拍头):+3 拍沉降再采样
  for (let i = 0; i < 3; i++) step();
  res.landFuel = landFuel; res.landSettledFuel = p.carpetTime; res.landSettledCan = p.canCarpet;
  ok('A 落地(松跳):再清零+门复开(+3 拍)',
    p.onGround === true && p.carpetTime === 0 && p.canCarpet === true,
    `atLand=${landFuel} fuel=${p.carpetTime} can=${p.canCarpet} og=${p.onGround}`);

  // ---- B) 无毯门 ----
  inv.armor[3] = null;
  for (let i = 0; i < 10; i++) step();
  ok('B 摘毯落地:canCarpet===false(配饰门)',
    p.equipStats.carpet === false && p.canCarpet === false && p.carpetTime === 0,
    `can=${p.canCarpet} fuel=${p.carpetTime}`);

  // ---- C) 湿支毯面：坑+水,逐拍捕捉 vy===0 ----
  inv.armor[3] = { id: items[carpetKey], stack: 1 };
  for (let i = 0; i < 5; i++) step();
  const pitX = ptx + 18;
  for (let dy = 0; dy <= 3; dy++) st.setTile(pitX, pty - dy, 0);      // 4 深竖坑
  for (let dy = 0; dy <= 2; dy++) st.setLiquid(pitX, pty - dy, 255, 1); // 3 格水
  p.x = pitX * 16 + 2; p.y = (pty - 2) * 16; p.vx = 0; p.vy = 0; p.onGround = false;
  p.inputJump = false;
  let wetTick = -1, lastVy = -1;
  for (let t = 0; t < 600 && wetTick < 0; t++) {
    step();
    lastVy = p.vy;
    if (p.inWater && p.vy === 0) wetTick = t;
  }
  res.wetTick = wetTick; res.wetLastVy = +lastVy.toFixed(4); res.wetY = Math.round(p.y);
  res.wetFuel = p.carpetTime; res.wetCan = p.canCarpet;
  ok('C 入水沉底逐拍捕捉 vy===0(湿路由可达)', wetTick >= 0,
    `inWater=${p.inWater} lastVy=${res.wetLastVy} y=${res.wetY}`);
  if (wetTick >= 0) {
    ok('C 湿态踩底:carpetTime===0+canCarpet 开(清零非 300)',
      p.carpetTime === 0 && p.canCarpet === true, `fuel=${p.carpetTime} can=${p.canCarpet}`);
  }
  // 出水归位
  p.x = ptx * 16; p.y = (pty - 3) * 16; p.vy = 0;
  for (let i = 0; i < 200 && !p.onGround; i++) step();

  // ---- D) 燃料补燃坑(登记债形状):召唤在实时态完成,再暂停逐拍 ----
  g.paused = false;
  const qsKey = Object.keys(items).find(k => k.startsWith('vi_4981_'));
  inv.add(items[qsKey], 1);
  for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i] && inv.slots[i].id === items[qsKey]) inv.selected = i;
  g.input.mouseDown = true;
  for (let i = 0; i < 30 && !p.ridingMount; i++) await sleep(40);
  g.input.mouseDown = false; await sleep(160);
  ok('D 骑乘 50', p.ridingMount === true && p.mount.type === 50, `type=${p.mount?.type}`);
  g.paused = true;
  for (let i = 0; i < 400 && !p.onGround; i++) step();
  ok('D 回地满油', p.onGround === true && p.mount.flyTime === 80, `fuel=${p.mount.flyTime}`);
  // 持跳起飞烧油(<60)后仍按住,逐拍等落地,断言落地拍回满 80
  p.inputJump = true;
  let burnedTick = -1, landHoldTick = -1, fuelAtLandHold = -1;
  for (let t = 0; t < 3000 && landHoldTick < 0; t++) {
    step();
    if (burnedTick < 0 && !p.onGround && p.mount.flyTime < 60) burnedTick = t;
    if (p.onGround) { landHoldTick = t; fuelAtLandHold = p.mount.flyTime; }
  }
  res.dBurnedTick = burnedTick; res.dLandHoldTick = landHoldTick; res.dFuelAtLandHold = fuelAtLandHold;
  ok('D 持跳烧油(<60)后落地', burnedTick >= 0 && landHoldTick >= 0,
    `burnT=${burnedTick} landT=${landHoldTick}`);
  // 落地拍本体 fuel 仍 0(upkeep 在下一拍头跑);+1 拍 upkeep(onGround||vy===0 无
  // releaseJump 门)即回满——原版须松跳才回充=位点差登记债的运行时形状
  let fuelNextTick = -1;
  if (landHoldTick >= 0) { step(); fuelNextTick = p.mount.flyTime; }
  res.dFuelNextTick = fuelNextTick;
  ok('D 持跳不松手:落地+1 拍即回满 80(原版须松跳=位点差登记债形状)', fuelNextTick === 80,
    `atLand=${fuelAtLandHold} next=${fuelNextTick}`);
  p.inputJump = false;
  for (let i = 0; i < 10; i++) step();
  ok('D 松跳落地满油(原版路径同回满)', p.mount.flyTime === 80, `fuel=${p.mount.flyTime}`);
  g.paused = false;
  res.final = { riding: p.ridingMount, fuel: p.mount.flyTime };
  return res;
});
await new Promise(r => setTimeout(r, 300));
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors:', JSON.stringify(errs));
await browser.close();
