// ★BJ704-G5 实跑探针：坐骑/毯域八件（物品通道召唤 + g.paused 手动逐拍,BJ703-D/G4 范式）。
//  P1 熔岩鲨 4828 骑岩浆：帧态 4（wet 分派,旧 inWater→2 不悬停）+ canHover + 持跳爬升带
//  P2 迅猛龙 5510+翼 493：落地持跳不回充（R4-P2④ releaseJump 门）→ 松跳回满 100
//  P3 飞毯 934：跳后续航 carpetFlying；松跳余油窗姿态退（燃料保留）;再按恢复;落地复位
//  P4 巫婆扫帚 4444+幻彩斗篷 5355（shimmerImmune 免形变）微光池：悬停钉位 -0.001
//  P5 扫帚水池底边沿起跳：vy=-4（G4-① 坐骑档,旧液体档 -6.01）
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
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[g5]')) console.log(t); });
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
  /** 开顶液池（G4 判例:topTy 取地表上方 pty−8） */
  const ptx = Math.floor(p.cx / 16), pty = Math.floor((p.y + p.h) / 16);
  const makePool = (type) => {
    const floorTy = pty + 25, topTy = pty - 8;
    for (let dx = -5; dx <= 12; dx++) {
      for (let y = topTy; y < floorTy; y++) st.setTile(ptx + dx, y, 0);
      st.setTile(ptx + dx, floorTy, 1, 0, 0);
      for (let y = topTy; y < floorTy; y++) st.setLiquid(ptx + dx, y, 200, type);
    }
    return { topTy, floorTy };
  };
  p.maxHp = 500; p.hp = 500;                       // 岩浆/摔伤观测窗保险

  console.log('[g5] P1 enter');
  // ---- P1 熔岩鲨 49 骑岩浆（G4-③ wet 分派 + canHover + 悬停接管） ----
  console.log('[g5] P1 pre-summon');
  const summoned = await summonAndRelease(4828);
  console.log(`[g5] P1 summoned=${summoned}`);
  g.paused = true;
  g.input.setVirtualAction('Jump', false); g.input.setVirtualAction('Down', false);
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  const lavaPool = makePool(2);
  // ★BJ704-G20：lavaImmuneTicks=1e9 观测保险退役——骑 49 免伤面已本体建模
  //  （Player.ts lavaTotalImmune ∪ mount.buff===305,R10-P1①）;旧保险=掩盖缺口的
  //  workaround（R10 判语「八波零登记的根因」）。
  p.x = (ptx + 3) * 16; p.y = (pty + 6) * 16; p.vx = 0; p.vy = 1;
  p.onGround = false;
  console.log('[g5] P1 pre-steps');
  for (let i = 0; i < 4; i++) step();
  console.log('[g5] P1 4 steps done');
  ok('P1b 岩浆湿位：inLava+帧态 4（旧 inWater 只水→2）', p.inLava === true && p.mount.frameState === 4,
    `inLava=${p.inLava} fs=${p.mount.frameState}`);
  ok('P1c canHover 成立（49 帧态 4 → 岩浆中可悬停）', p.mount.canHover(p) === true, `canHover=${p.mount.canHover(p)}`);
  p.inputJump = true; p.jumpEdgePrev = true;        // 无沿持跳（避起跳门,隔离悬停带）
  for (let i = 0; i < 25; i++) step();
  res.lavaSharkClimbVy = +p.vy.toFixed(3);
  ok('P1d 持跳悬停爬升（-0.4/t 收敛 -8 带;旧 IN_AIR→干路重力 +0.4/t 直坠）',
    p.vy <= -5, `vy=${p.vy.toFixed(3)}`);
  p.inputJump = false;
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();
  // 清岩浆→水（后续场景复用池）
  for (let dx = -5; dx <= 12; dx++) for (let y = lavaPool.topTy; y < lavaPool.floorTy; y++) st.setLiquid(ptx + dx, y, 200, 0);

  console.log('[g5] P2 enter');
  // ---- P2 迅猛龙 54 落地持跳不回充（R4-P2④ releaseJump 门） ----
  g.paused = false;
  ok('P2a 迅猛龙 5510 物品通道召唤', await summonAndRelease(5510), `type=${p.mount.type}`);
  inv.armor[3] = { id: items['vi_493_天使之翼'] ?? items['vi_493_AngelWings'], stack: 1 };
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  p.x = (ptx + 16) * 16; p.y = (pty - 4) * 16; p.vx = 0; p.vy = 0;   // 池外干地
  p.onGround = false;
  for (let i = 0; i < 40; i++) step();              // 落地稳定（松跳回充面）
  ok('P2b 装翼闩真+回满 100', p.mount.allowedToFly === true && p.mount.flyTime === 100,
    `latch=${p.mount.allowedToFly} fuel=${p.mount.flyTime}`);
  p.mount.flyTime = 0;                              // 耗尽形态
  p.inputJump = true; p.jumpEdgePrev = true;        // 持跳（无沿）
  step();
  res.raptorHeldFuel = p.mount.flyTime;
  ok('P2c 落地持跳【不】回充（旧无门=+1 拍回满 80/100 无限飞）', p.mount.flyTime === 0, `fuel=${p.mount.flyTime}`);
  p.inputJump = false;
  step();
  res.raptorReleasedFuel = p.mount.flyTime;
  ok('P2d 松跳拍回满 100', p.mount.flyTime === 100, `fuel=${p.mount.flyTime}`);
  inv.armor[3] = null;
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();

  console.log('[g5] P3 enter');
  // ---- P3 飞毯毯姿门（R4-P2② carpetFlying） ----
  g.paused = false;
  inv.armor[3] = { id: items['vi_934_FlyingCarpet'] ?? items['vi_934_FlyingCarpet2'], stack: 1 };
  await sleep(200);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  p.x = (ptx + 16) * 16; p.y = (pty - 6) * 16; p.vx = 0; p.vy = 0;
  p.onGround = false;
  for (let i = 0; i < 20; i++) step();              // 干地落地稳定
  ok('P3a 地毯装配+canCarpet 复位', p.equipStats.carpet === true && p.canCarpet === true && p.carpetTime === 0,
    `carpet=${p.equipStats.carpet} canCarpet=${p.canCarpet} fuel=${p.carpetTime}`);
  p.inputJump = true; p.jumpEdgePrev = false;       // 边沿起跳
  step();                                           // 跳拍
  p.jumpEdgePrev = true;
  for (let i = 0; i < 24; i++) step();              // 跳预算 15 拍耗尽后毯激活
  res.carpetDeployed = { flying: p.carpetFlying, fuel: p.carpetTime, vy: +p.vy.toFixed(3) };
  ok('P3b 持跳毯展开：carpetFlying=true+燃料逐拍耗', p.carpetFlying === true && p.carpetTime > 0 && p.carpetTime < 300,
    `flying=${p.carpetFlying} fuel=${p.carpetTime}`);
  const fuelAtRelease = p.carpetTime;
  p.inputJump = false;                              // 松跳（余油窗）
  for (let i = 0; i < 5; i++) step();
  res.carpetReleased = { flying: p.carpetFlying, fuel: p.carpetTime };
  ok('P3c 松跳余油窗：carpetFlying=false+燃料保留（旧渲染门→毯姿残留）',
    p.carpetFlying === false && p.carpetTime === fuelAtRelease,
    `flying=${p.carpetFlying} fuel=${p.carpetTime}/${fuelAtRelease}`);
  p.inputJump = true; p.jumpEdgePrev = true;        // 再按（余油恢复,无新激活门）
  step();
  ok('P3d 再按恢复展开（carpetTime>0∧按跳,canCarpet 无关）', p.carpetFlying === true, `flying=${p.carpetFlying}`);
  p.inputJump = false;
  let landed = false;
  for (let i = 0; i < 240 && !landed; i++) { step(); landed = p.vy === 0; }
  for (let i = 0; i < 2; i++) step();              // 落地拍后的复位读点（vy==0 在拍首）
  ok('P3e 落地复位：canCarpet=true+燃料清 0（R4-P2① vy==0 域）',
    p.canCarpet === true && p.carpetTime === 0, `canCarpet=${p.canCarpet} fuel=${p.carpetTime} landed=${landed}`);
  inv.armor[3] = null;

  console.log('[g5] P4 enter');
  // ---- P4 巫婆扫帚微光池悬停（G4-④ 骑乘路由,shimmerImmune 免形变） ----
  g.paused = false;
  p.hp = p.maxHp;
  const cloakKey = Object.keys(items).find(k => k.startsWith('vi_5355_'));
  inv.armor[3] = { id: items[cloakKey], stack: 1 };
  await sleep(200);
  res.p4Diag = { cloakKey, hp: p.hp, dead: !!p.dead, immune: p.equipStats.shimmerImmune, sel: inv.selected };
  const p4summoned = await summonAndRelease(4444);
  res.p4Diag.riding = p4summoned;
  ok('P4a 巫婆扫帚 4444 物品通道召唤', p4summoned, `type=${p.mount.type} diag=${JSON.stringify(res.p4Diag)}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  const shPool = makePool(4);
  p.x = (ptx + 3) * 16; p.y = (pty + 6) * 16; p.vx = 0; p.vy = 1;
  p.onGround = false;
  for (let i = 0; i < 6; i++) step();
  ok('P4b 微光湿位不形变（cloak shimmerImmune）:inShimmer+!shimmering+骑乘在位',
    p.inShimmer === true && p.shimmering === false && p.mount.active === true,
    `inShimmer=${p.inShimmer} shimmering=${p.shimmering} active=${p.mount.active}`);
  p.vy = 1;
  for (let i = 0; i < 12; i++) step();
  res.shimmerPinVy = +p.vy.toPrecision(6);
  ok('P4c 微光池悬停钉位 vy=-0.001（旧早退支 +0.06/t 直沉）', Math.abs(p.vy - (-0.001)) < 1e-6,
    `vy=${p.vy.toPrecision(6)}`);
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();
  // 清微光→水
  for (let dx = -5; dx <= 12; dx++) for (let y = shPool.topTy; y < shPool.floorTy; y++) st.setLiquid(ptx + dx, y, 200, 0);

  console.log('[g5] P5 enter');
  // ---- P5 扫帚水池底边沿起跳：坐骑档 -4（G4-①） ----
  g.paused = false;
  ok('P5a 巫婆扫帚 4444 再召唤', await summonAndRelease(4444), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  const pool = makePool(0);
  p.x = (ptx + 3) * 16; p.y = (pool.floorTy - 2.625) * 16;   // 池底贴齐
  p.vx = 0; p.vy = 0; p.onGround = false;
  for (let i = 0; i < 6; i++) step();
  ok('P5b 池底稳定 vy==0', p.vy === 0 && p.inWater === true, `vy=${p.vy} inWater=${p.inWater}`);
  p.inputJump = true; p.jumpEdgePrev = false;       // 边沿水中起跳
  step();
  res.broomWaterJump = { vy: +p.vy.toPrecision(6), jumpHold: p.jumpHold };
  ok('P5c 水跳=坐骑档 vy=-4/jumpHold=10（旧液体档 -6.01/30;悬停族跳拍 canHover 先达→重力让位=平值）',
    Math.abs(p.vy - (-4)) < 1e-6 && p.jumpHold === 10,
    `vy=${p.vy.toPrecision(6)} jumpHold=${p.jumpHold}`);
  p.inputJump = false;
  p.mount.dismount?.(p, g);
  return res;
});
for (const s of out.steps) console.log(s);
console.log('probe-data', JSON.stringify({
  lavaSharkClimbVy: out.lavaSharkClimbVy, raptorHeldFuel: out.raptorHeldFuel,
  raptorReleasedFuel: out.raptorReleasedFuel, carpetDeployed: out.carpetDeployed,
  carpetReleased: out.carpetReleased, shimmerPinVy: out.shimmerPinVy, broomWaterJump: out.broomWaterJump,
}));
const fails = out.steps.filter((s) => s.startsWith('FAIL')).length;
console.log(errs.length ? `PAGE-ERRORS: ${errs.join(' | ')}` : '');
console.log(fails === 0 ? `ALL ${out.steps.length} PASS` : `${fails} FAIL / ${out.steps.length}`);
await browser.close();
process.exit(fails === 0 && errs.length === 0 ? 0 : 1);
