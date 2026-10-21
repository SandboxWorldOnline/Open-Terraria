// ★BJ704-G4 实跑探针：坐骑水下飞行/悬停湿支 vy 链（物品通道召唤 + 真实输入合成）。
//  P1 巫婆扫帚 4444 物品通道召唤（toggle 轮询释放,BJ703-D 判例①）
//  P2 入水池：inWater + 帧态 4(SWIMMING) + 不下坐（23 不在 5/7/56 湿拍下坐族）
//  P3 静置钉位：vy=-0.001（悬停带,湿重力 0.2 不掺入——无链=+0.2/t 直坠）
//  P4 持跳爬升带 vMin=-8；P5 按下 vMax=+8（>5.01=液体钳未掺入）
//  P6 仙灵 5662 水下悬停 vMin=-dashSpeed(4.5)（61 帧态门含 4 的判别面）
//  P7 飞碟 2769 干地召唤 → 入水一拍自动下坐（C5-B1 族经真实链）
//  测量范式 BJ703-D 判例②：g.paused=true + 手动 p.fixedUpdate 逐拍（暂停态
//  Game.fixedUpdate 冻结,输入须直写 p.inputJump/p.inputDown）。
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
  // ---- 水池：玩家脚下挖 24 行水柱 + 池底（远离顶/底 offLimit 带;24 行=下潜带
  //      60 拍不触底 + 爬升带出水上界冗余） ----
  const ptx = Math.floor(p.cx / 16), pty = Math.floor((p.y + p.h) / 16);
  // ★topTy 取 pty-8（地表【上方】开顶——pty 行是出生地面砖,首版 topTy=pty+1 把池
  //   挖进地下,残留地表砖=天花板:爬升 vy 钉 0.01（撞顶反黏滞 nudge）,地形随出生点
  //   漂移=伪 FAIL（首轮 12 行池恰逢无顶地形假绿的镜像事故）
  const floorTy = pty + 25, topTy = pty - 8;
  for (let dx = -5; dx <= 12; dx++) {
    for (let y = topTy; y < floorTy; y++) st.setTile(ptx + dx, y, 0);
    st.setTile(ptx + dx, floorTy, 1, 0, 0);
    for (let y = topTy; y < floorTy; y++) st.setLiquid(ptx + dx, y, 200, 0);
  }
  const intoPool = () => {
    p.x = (ptx + 3) * 16; p.y = (pty + 6) * 16; p.vx = 0; p.vy = 1;   // vy=1 起量避 vy==0 回充门
    p.onGround = false;
  };
  const step = () => p.fixedUpdate(1 / 60, g.hooksProxy ?? g);
  const summonAndRelease = async (id) => {
    const key = Object.keys(items).find(k => k.startsWith(`vi_${id}_`));
    if (!key) return false;
    inv.add(items[key], 1);
    for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i] && inv.slots[i].id === items[key]) inv.selected = i;
    g.input.mouseDown = true;
    for (let i = 0; i < 30 && !p.ridingMount; i++) await sleep(40);
    g.input.mouseDown = false;
    await sleep(160);
    return p.ridingMount;
  };

  // ---- P1-P5 巫婆扫帚 23 ----
  ok('P1 巫婆扫帚 4444 物品通道召唤', await summonAndRelease(4444), `type=${p.mount.type}`);
  g.paused = true;
  g.input.setVirtualAction('Jump', false); g.input.setVirtualAction('Down', false);
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  intoPool();
  for (let i = 0; i < 4; i++) step();                     // 湿探测/帧态切稳
  ok('P2 入水：inWater+帧态4+不下坐', p.inWater === true && p.mount.frameState === 4 && p.mount.active === true,
    `inWater=${p.inWater} fs=${p.mount.frameState} active=${p.mount.active}`);
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  p.vy = 1;
  for (let i = 0; i < 12; i++) step();
  res.broomPinVy = +p.vy.toPrecision(6);
  ok('P3 静置钉位 vy=-0.001（无链=湿重力直坠 >1）', Math.abs(p.vy - (-0.001)) < 1e-6, `vy=${p.vy.toPrecision(6)}`);
  p.inputJump = true; p.jumpEdgePrev = true;              // 无沿持跳（避水中起跳门）
  res.climbTrace = [];
  for (let i = 0; i < 70; i++) {
    step();
    if (i % 10 === 9) res.climbTrace.push({ i, vy: +p.vy.toFixed(3), fs: p.mount.frameState, inWater: p.inWater, fuel: p.mount.flyTime, y: Math.round(p.y) });
  }
  res.broomClimbVy = +p.vy.toFixed(3);
  ok('P4 持跳爬升带 vMin=-8', p.vy <= -7.99 && p.vy >= -8.01, `vy=${p.vy.toFixed(3)}`);
  p.inputJump = false; p.inputDown = true;
  intoPool(); p.vy = -0.1;                   // 池中腰重置起量（爬升带 −8 起步 75 拍才到 +8,窗口另计）
  for (let i = 0; i < 60; i++) step();
  res.broomDescendVy = +p.vy.toFixed(3);
  ok('P5 按下 vMax=+8（液体钳 5.01 未掺入）', p.vy >= 7.99 && p.vy <= 8.01, `vy=${p.vy.toFixed(3)}`);
  p.inputDown = false;
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();
  ok('P5b 下坐扫帚', !p.ridingMount, `riding=${p.ridingMount}`);

  // ---- P6 仙灵 61 ----
  g.paused = false;
  ok('P6a 仙灵 5662 物品通道召唤', await summonAndRelease(5662), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  intoPool();
  for (let i = 0; i < 4; i++) step();
  p.vy = 1; p.inputJump = true; p.jumpEdgePrev = true;
  for (let i = 0; i < 8; i++) step();
  res.pixieFsInWater = p.mount.frameState;   // 出水前采样（8 拍上升 ~3px 仍在水内）
  ok('P6a 水下帧态=4（SWIMMING 悬停门含 4）', p.mount.frameState === 4, `fs=${p.mount.frameState}`);
  for (let i = 0; i < 40; i++) step();       // 续升至带底（可能出水→fs2,vy 带不变）
  res.pixieClimbVy = +p.vy.toFixed(3);
  ok('P6 悬停爬升带 vMin=-dashSpeed(4.5)', p.vy <= -4.49 && p.vy >= -4.51, `vy=${p.vy.toFixed(3)}`);
  p.inputJump = false;
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();

  // ---- P7 飞碟 7 入水自动下坐（C5-B1 族,真实链） ----
  g.paused = false;
  // 池外干垫（dx 16..20 = 池列 dx≤12 之外;开顶池后 pty-6 已在水柱内,首版误传送）
  for (let dx = 16; dx <= 20; dx++) {
    for (let y = pty - 5; y < pty; y++) st.setTile(ptx + dx, y, 0);
    st.setTile(ptx + dx, pty, 1, 0, 0);
    for (let y = pty - 5; y < pty; y++) st.setLiquid(ptx + dx, y, 0, 0);
  }
  p.x = (ptx + 18) * 16; p.y = (pty - 3) * 16; p.vy = 0; p.vx = 0;
  p.onGround = false;
  await sleep(400);
  ok('P7a 飞碟 2769 干地召唤', await summonAndRelease(2769), `type=${p.mount?.type}`);
  g.paused = true;
  intoPool();
  for (let i = 0; i < 2; i++) step();
  res.ufoAfterWet = { active: p.mount.active, riding: p.ridingMount, inWater: p.inWater };
  ok('P7 入水一拍自动下坐（case 7）', p.inWater === true && p.mount.active === false,
    `inWater=${p.inWater} active=${p.mount.active}`);
  g.paused = false;
  res.final = { riding: p.ridingMount };
  return res;
});
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: '/tmp/bj704g4-mount-water.png' });
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors:', JSON.stringify(errs));
await browser.close();
