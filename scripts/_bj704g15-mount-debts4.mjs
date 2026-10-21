// ★BJ704-G15 实跑探针：坐骑域五件第四刀（物品通道召唤 + g.paused 手动逐拍,G13 范式）。
//  P1 债① 钉鞋贴墙滑（976 tier2 驻停）按跳——反踢 vx=-3 离壁（:20950-20953）
//  P2 债③ 弹跳杆 43（constantJump）池底持跳——免松键连跳环 ≥3 起（:20845 autoJump 臂）
//  P3 债④ 持 Space 落地→召唤钻头 8→按 W 起飞（upEdgePrev 通道;旧读跳键沿=不触发）
//  P4 债⑤ updateFrame 55/56/61 帧态强切臂（frameState 写面+组选择）
//  P5 债⑦ CCed 尾视觉复位（冻结拍 performingJump/isDownDashing 清,干湿两支）
//  ★夹具判例（本探针沉淀）:①__swItems[key] 本身就是内部物品 id（Record<string,number>,
//    勿取 .id）;②起跳夹具落点必须自带平台——裸地表可能下方是洞,33 格坠落=致死
//    （hp 负 → dead 相早退,后续段全数失能）;③持跳落地后召唤前保持原位（P2 池挖空区
//    不可再作 P3/P5 落点）。
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
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[g15]')) console.log(t); });
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
  const items = window.__swItems;                      // Record<viKey, 内部物品 id（数字本体）
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
  p.maxHp = 500; p.hp = 500;
  const { BuffType } = await import('/src/stats/Buffs.ts');
  const ptx = Math.floor(p.cx / 16), pty = Math.floor((p.y + p.h) / 16);

  console.log('[g15] P1 enter');
  // ---- P1 债① 干支蹬墙跳反踢（自带平台+立柱,短坠安全域） ----
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  const wcol = ptx + 6;
  for (let x = wcol - 4; x <= wcol + 1; x++) for (let y = pty - 14; y <= pty + 2; y++) st.setTile(x, y, 0);
  for (let y = pty - 12; y <= pty + 2; y++) st.setTile(wcol, y, 1, 0, 0);          // 立柱（探针域 2 格冗余）
  for (let x = wcol - 4; x <= wcol + 1; x++) { st.setTile(x, pty + 3, 1, 0, 0); st.setTile(x, pty + 4, 1, 0, 0); }   // 落点平台
  const key976 = Object.keys(items).find(k => k.startsWith('vi_976_'));
  inv.armor[3] = { id: items[key976], stack: 1 };          // 钉鞋 2（__swItems[key]=id 本体）
  p.x = wcol * 16 - p.w; p.y = (pty - 8) * 16; p.vx = 0; p.vy = 0;
  p.onGround = false;
  p.inputX = 1;                                             // 按向墙（=撞向）
  let clung = false;
  for (let i = 0; i < 40; i++) { step(); if (p.wallCling) { clung = true; break; } }
  ok('P1a 钉鞋 tier2 驻停挂壁', clung, `cling=${p.wallCling} vy=${p.vy.toFixed(3)} og=${p.onGround}`);
  ok('P1b slideDir 配对写（挂壁向=按向 +1）', p.slideDir === 1, `slideDir=${p.slideDir}`);
  p.inputJump = true; p.jumpEdgePrev = false;              // 跳键沿（挂壁中未按过）
  step();
  res.p1 = { vy: +p.vy.toFixed(3), vx: +p.vx.toFixed(3), cling: p.wallCling };
  ok('P1c 蹬墙跳 vy<0', p.vy < -3, `vy=${p.vy.toFixed(3)}`);
  ok('P1d ★反踢 vx=-3（3*-slideDir :20950;旧=0 贴壁直上）', p.vx === -3, `vx=${p.vx}`);
  ok('P1e 起跳拍离壁（vy<0 → 头门出）', p.wallCling === false, `cling=${p.wallCling}`);
  p.inputJump = false; p.inputX = 0;
  inv.armor[3] = null;
  for (let y = pty - 12; y <= pty + 2; y++) st.setTile(wcol, y, 0);
  for (let i = 0; i < 2; i++) step();

  console.log('[g15] P2 enter');
  // ---- P2 债③ 弹跳杆 43 池底持跳连跳环 ----
  g.paused = false;
  ok('P2a 弹跳杆 4791 物品通道召唤', await summonAndRelease(4791), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  // 开顶液池（G13 判例:真清=amount 0）+封闭侧壁
  const floorTy = pty + 25, topTy = pty - 8;
  for (let dx = -5; dx <= 12; dx++) {
    for (let y = topTy; y < floorTy; y++) st.setTile(ptx + dx, y, 0);
    st.setTile(ptx + dx, floorTy, 1, 0, 0);
    for (let y = topTy; y < floorTy; y++) st.setLiquid(ptx + dx, y, 200, 0);
  }
  for (let y = topTy; y <= floorTy; y++) { st.setTile(ptx - 6, y, 1, 0, 0); st.setTile(ptx + 13, y, 1, 0, 0); }
  p.x = (ptx + 3) * 16; p.y = floorTy * 16 - p.h;        // 池底贴齐（feet flush）
  p.vx = 0; p.vy = 0; p.onGround = false;
  for (let i = 0; i < 8; i++) step();
  res.p2settle = { vy: +p.vy.toFixed(3), wet: p.inWater, og: p.onGround };
  ok('P2b 池底稳定 vy=0（湿态）', p.vy === 0 && p.inWater, `vy=${p.vy} wet=${p.inWater}`);
  p.inputJump = true;
  let events = 0, prevHold = 0;
  for (let t = 0; t < 260; t++) {
    step();
    if (p.jumpHold > prevHold && prevHold === 0) events++;
    prevHold = p.jumpHold;
    if (events >= 3) break;
  }
  res.p2 = { events };
  ok('P2c ★持跳免松键连跳环 ≥3 起（autoJump 臂 :20845;旧=1 起后钉死）', events >= 3, `events=${events}`);
  p.inputJump = false;
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();
  for (let dx = -5; dx <= 12; dx++) for (let y = topTy; y < floorTy; y++) st.setLiquid(ptx + dx, y, 0, 0);

  console.log('[g15] P3 enter');
  // ---- P3 债④ 持 Space 落地→召唤钻头→按 W 起飞（安全平台域:ptx-16..ptx-8,P2 池外） ----
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  const sx = ptx - 12;
  for (let x = ptx - 16; x <= ptx - 8; x++) for (let y = pty - 10; y <= pty; y++) st.setTile(x, y, 0);
  for (let x = ptx - 16; x <= ptx - 8; x++) { st.setTile(x, pty + 1, 1, 0, 0); st.setTile(x, pty + 2, 1, 0, 0); }
  p.x = sx * 16; p.y = (pty + 1) * 16 - p.h;             // 站平台顶
  p.vx = 0; p.vy = 0; p.onGround = false;
  for (let i = 0; i < 5; i++) step();
  ok('P3a0 平台立足', p.onGround === true && p.vy === 0, `og=${p.onGround} vy=${p.vy}`);
  p.inputJump = true;                                     // tick0 沿跳一次（未骑乘）,此后持跳不跳
  let landed = false;
  for (let i = 0; i < 150; i++) {
    step();
    if (i > 10 && p.onGround && p.vy === 0) { landed = true; break; }
  }
  res.p3land = { landed, jumpEdgePrev: p.jumpEdgePrev, upEdgePrev: p.upEdgePrev };
  ok('P3a 持跳落地（vy=0;jumpEdgePrev 真=Space 持有）', landed && p.vy === 0 && p.jumpEdgePrev === true,
    `landed=${landed} vy=${p.vy} jEP=${p.jumpEdgePrev}`);
  p.mount.setMount(8, p);                                 // 持跳中召唤钻头（无 constantJump=不跳）
  for (let i = 0; i < 3; i++) step();
  ok('P3b 持跳零跳（无沿无 autoJump）+ vy=0 保持', p.vy === 0 && p.jumpHold === 0, `vy=${p.vy} hold=${p.jumpHold}`);
  p.inputUp = true;                                       // ★按 W（upEdgePrev=false）
  step();
  const expectImpulse = -((0.16 + 0.4 + 0.001) + 0.16);   // 冲量+同拍升力臂（G13 P5 两笔叠加）
  res.p3impulse = { vy: +p.vy.toPrecision(6), expect: +expectImpulse.toPrecision(6), upEP: p.upEdgePrev };
  ok('P3c ★按 W 起飞（upEdgePrev 通道;旧读跳键沿=Space 持有不触发 vy 恒 0）',
    Math.abs(p.vy - expectImpulse) < 1e-3, `vy=${p.vy.toPrecision(6)} expect=${expectImpulse.toPrecision(6)}`);
  p.inputUp = false; p.inputJump = false;
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();

  console.log('[g15] P4 enter');
  // ---- P4 债⑤ updateFrame 55/56/61 帧态强切臂（直驱 updateFrame=生产同码路径） ----
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  const m61 = p.mount; m61.setMount(61, p);
  m61.frameState = 0; m61.frameCounter = 0; m61.frame = 0;
  m61.updateFrame(p, 4, 0, -1);                       // 游泳分派
  res.p4a = { fs: m61.frameState, frame: m61.frame };
  ok('P4a 仙灵 61 分派 4 → frameState=2（强切臂;旧滞 4）', m61.frameState === 2, `fs=${m61.frameState}`);
  m61.dismount?.(p, g);
  const m55 = p.mount; m55.setMount(55, p);
  m55.frameState = 0; m55.frameCounter = 0; m55.frame = 0;
  p.wallCling = true;                                  // sliding 承载位
  m55.updateFrame(p, 2, 0, -1);                       // 空中分派 + 爬墙中
  res.p4b = { fs: m55.frameState, frame: m55.frame };
  ok('P4b 老鼠 55 爬墙中（sliding）→ frameState=1 跑动组帧 4-10（旧=空中组 12+）',
    m55.frameState === 1 && m55.frame >= 4 && m55.frame < 11, `fs=${m55.frameState} frame=${m55.frame}`);
  p.wallCling = false;
  m55.frameState = 0; m55.frameCounter = 0; m55.frame = 0;
  m55.updateFrame(p, 1, 5, 0);                        // 跑动分派 |vx|>4
  ok('P4c 老鼠 55 跑动 |vx|>4 → frameState=5 冲刺组', m55.frameState === 5, `fs=${m55.frameState}`);
  m55.dismount?.(p, g);
  const m56 = p.mount; m56.setMount(56, p);
  m56.frameState = 0; m56.frameCounter = 0; m56.frame = 0;
  p.dashLatched = 6; p.dashDelay = -1;                 // 冲刺中
  m56.updateFrame(p, 1, 4, 0);
  res.p4d = { fs: m56.frameState, frame: m56.frame };
  ok('P4d 蝙蝠 56 dash>0∧delay<0 → frameState=5 冲刺组 9+（旧=分派原样）',
    m56.frameState === 5 && m56.frame >= 9, `fs=${m56.frameState} frame=${m56.frame}`);
  p.dashLatched = 0; p.dashDelay = 20;
  m56.frameState = 0; m56.frameCounter = 0; m56.frame = 0;
  m56.updateFrame(p, 4, 0, -1);                       // 游泳分派
  ok('P4e 蝙蝠 56 分派 4 → 归一 frameState=2', m56.frameState === 2, `fs=${m56.frameState}`);
  m56.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();

  console.log('[g15] P5 enter');
  // ---- P5 债⑦ CCed 尾视觉复位（干支:安全平台上空） ----
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  p.x = sx * 16; p.y = (pty - 4) * 16; p.vx = 0; p.vy = -3;
  p.onGround = false;
  p.performingJump = 'Cloud';
  p.isDownDashing = true;
  p.buffs.apply(BuffType.Frozen, 30);
  step();
  res.p5 = { pj: p.performingJump, dd: p.isDownDashing, dead: p.dead, cced: p.cced };
  ok('P5a ★冻结拍 performingJump 清（CancelAllJumpVisualEffects :36932 承载;旧=跨冻结滞留）',
    p.performingJump === null, `pj=${p.performingJump}`);
  ok('P5b 冻结拍 isDownDashing 清（includeDownDash 位）', p.isDownDashing === false, `dd=${p.isDownDashing}`);
  p.buffs.remove(BuffType.Frozen);
  // 湿支（P2 池已清液——原池盆内重注小池,盆壁/池底沿用）
  for (let dx = -4; dx <= 10; dx++) for (let y = topTy; y < floorTy; y++) st.setLiquid(ptx + dx, y, 200, 0);
  p.x = (ptx + 3) * 16; p.y = (topTy + 2) * 16; p.vx = 0; p.vy = -3;
  p.onGround = false;
  p.performingJump = 'Sandstorm';
  p.isDownDashing = true;
  p.buffs.apply(BuffType.Frozen, 30);
  step();
  ok('P5c 湿支同款双笔（冻结拍清）', p.performingJump === null && p.isDownDashing === false,
    `pj=${p.performingJump} dd=${p.isDownDashing} wet=${p.inWater}`);
  p.buffs.remove(BuffType.Frozen);
  for (let dx = -4; dx <= 10; dx++) for (let y = topTy; y < floorTy; y++) st.setLiquid(ptx + dx, y, 0, 0);
  return res;
});
for (const s of out.steps) console.log(s);
console.log('p1', JSON.stringify(out.p1), 'p2settle', JSON.stringify(out.p2settle), 'p2', JSON.stringify(out.p2));
console.log('p3land', JSON.stringify(out.p3land), 'p3impulse', JSON.stringify(out.p3impulse));
console.log('p4a', JSON.stringify(out.p4a), 'p4b', JSON.stringify(out.p4b), 'p4d', JSON.stringify(out.p4d));
console.log('p5', JSON.stringify(out.p5));
const fails = out.steps.filter(s => s.startsWith('FAIL'));
console.log(fails.length === 0 ? `\n=== G15 probe ALL PASS (${out.steps.length}) ===` : `\n=== G15 probe ${fails.length} FAIL ===`);
if (errs.length) { console.log('pageerrors:', errs.slice(0, 5)); }
await browser.close();
process.exit(fails.length === 0 && errs.length === 0 ? 0 : 1);
