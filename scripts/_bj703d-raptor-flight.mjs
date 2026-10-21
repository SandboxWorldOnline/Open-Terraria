// ★BJ703-D 实跑探针：迅猛龙 54 选择性飞行（物品通道 5510 + 真实输入合成）+ 耗尽臂重力场
//  A) 无翼：骑 54 按住跳 → 永不飞（flyTime 0 / 闩假 / 弧高 <12 格）
//  B) 装翼（armor[3] 直挂天使翼 493）：闩真 → flyTime=100（wingTimeMax）→ 按跳爬升
//     vy 钉 -jumpSpeed(6.01)×1.5=-9.015、帧态 3 扇翼行 16-20
//  C) 追加翱翔徽章 4989（armor[4]）：flyTime 手动归零后每拍回满（无限飞,150+ 帧钉位不坠）
//  D) 耗尽臂重力场（BJ703-D2,摘徽章后测）：地表带 vs 太空带（num6 0.25）累积比 ≈0.25
//  E) 下坐：p.mount.dismount(p,g) → 闩清
//  ★探针坑（本刀新增判例）：坐骑召唤是【toggle】——再召同型=下坐（Game.useMountItem
//    同型支）。mouseDown 必须在骑乘成立后立即松开（轮询式释放）,按满两个 useTime
//    周期（~660ms）必触发二次使用=当场下坐（首轮探针实踩:t=300ms 后 riding=false）。
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
  // ---- 地表平台 + 净空柱;太空平台（num6 下钳 0.25 档,远离地表带） ----
  // ★探针坑④:顶界钳 bordersMovement（offLimitBorderTiles 40×16=640px）——太空平台
  //   必须在行 ≥45（钳位线下）且 num6≤0.25 带（行 ≤ 60+10n5+gl/6·0.25）内取行,
  //   否则玩家被钳回 640 落不上平台（首轮 tile 28 全链落空的真身）。
  const ptx = Math.floor(p.cx / 16), pty = Math.floor((p.y + p.h) / 16);
  const gl = g.world.groundLevel;
  const n5s = (g.world.store.w / 4200) ** 2;
  const spaceTy = Math.max(45, Math.min(90, Math.floor(60 + 10 * n5s + gl / 24)));
  const buildPlatform = (ty, clear) => {
    for (let dx = -6; dx <= 30; dx++) {
      st.setTile(ptx + dx, ty, 1, 0, 0);
      for (let dy = 1; dy <= clear; dy++) st.setTile(ptx + dx, ty - dy, 0);
    }
  };
  buildPlatform(pty, 60);
  for (let i = 0; i < 90 && !p.onGround; i++) { p.fixedUpdate(1 / 60, g.hooksProxy ?? g); await sleep(6); }
  ok('立足静置', p.onGround, `pty=${pty} gl=${gl} spaceTy=${spaceTy}`);

  const summon = (id) => {
    const key = Object.keys(items).find(k => k.startsWith(`vi_${id}_`));
    if (!key) return false;
    inv.add(items[key], 1);
    for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i] && inv.slots[i].id === items[key]) inv.selected = i;
    g.input.mouseDown = true;
    return true;
  };
  // ★轮询式释放：骑乘成立即松手（toggle 召唤防二次使用下坐,见文件头注）
  const summonAndRelease = async (id) => {
    if (!summon(id)) return false;
    for (let i = 0; i < 30 && !p.ridingMount; i++) await sleep(40);
    g.input.mouseDown = false;
    await sleep(160);
    return p.ridingMount;
  };

  // ---- A) 无翼面 ----
  ok('砍杀者的神秘骷髅头 5510 召唤(toggle 防二次使用)', await summonAndRelease(5510));
  ok('A 骑乘中(type=54)', p.ridingMount === true && p.mount.type === 54, `type=${p.mount.type}`);
  g.input.setVirtualAction('Jump', false); g.input.setVirtualAction('Down', false);
  await sleep(300);
  ok('A 无翼:闩假/flyTime=0', p.mount.allowedToFly === false && p.mount.flyTime === 0,
    `latch=${p.mount.allowedToFly} fuel=${p.mount.flyTime}`);
  g.input.setVirtualAction('Jump', true);
  const yA0 = p.y; let minYA = yA0;
  for (let i = 0; i < 13; i++) { await sleep(100); minYA = Math.min(minYA, p.y); }   // 窗内逐帧采样
  const riseA = (yA0 - minYA) / 16;
  res.riseNoWingTiles = +riseA.toFixed(1);
  ok('A 无翼按跳:纯跳跃弧 <12 格(飞行=30+)', riseA < 12, `rise=${riseA.toFixed(1)}格`);
  ok('A 无翼:全程零燃料/闩假', p.mount.flyTime === 0 && p.mount.allowedToFly === false,
    `fuel=${p.mount.flyTime}`);
  g.input.setVirtualAction('Jump', false);
  await sleep(500);                                    // 落回

  // ---- B) 装翼面（armor[3] 直挂——与单元测试同口径;装备链重算即闩） ----
  inv.armor[3] = { id: items['vi_493_天使之翼'] ?? items['vi_493_AngelWings'], stack: 1 };
  await sleep(300);                                    // 装备链重算 + 闩置位
  ok('B 装翼:闩真', p.mount.allowedToFly === true, `latch=${p.mount.allowedToFly}`);
  ok('B 装翼:flyTime=wingTimeMax(100)', p.mount.flyTime === 100, `fuel=${p.mount.flyTime}`);
  g.input.setVirtualAction('Jump', true);
  await sleep(1100);                                   // 15 jumpHold + 30+ 爬升帧 → 帽
  const vyClimb = p.vy;
  res.vyClimbWing = +vyClimb.toFixed(3);
  ok('B 按跳爬升 vy 钉 -9.015（-6.01×1.5）', vyClimb <= -8.9 && vyClimb >= -9.06, `vy=${vyClimb.toFixed(3)}`);
  res.frameStateWing = p.mount.frameState; res.frameWing = p.mount.frame;
  ok('B 帧态 3(扇翼)且帧行 16-20', p.mount.frameState === 3 && p.mount.frame >= 16 && p.mount.frame <= 20,
    `state=${p.mount.frameState} frame=${p.mount.frame}`);
  ok('B 燃料消耗中(<100)', p.mount.flyTime < 100 && p.mount.flyTime > 30, `fuel=${p.mount.flyTime}`);
  // ↓追加 → 悬停钉位（Flight 余能期,BJ701 同款;燃料窗 100 拍<观测窗须补燃）
  g.input.setVirtualAction('Down', true);
  p.mount.flyTime = 100;
  await sleep(800);
  p.mount.flyTime = 100;
  const vyHover = p.vy;
  res.vyHoverWing = +vyHover.toPrecision(6);
  ok('B 跳+↓ → vy 钉 1e-5 悬停', Math.abs(vyHover - 1e-5) < 1e-6, `vy=${vyHover.toPrecision(6)}`);

  // ---- C) 翱翔徽章（armor[4] 直挂）:无限飞 = 钉位 150+ 帧不坠（无补燃） ----
  inv.armor[4] = { id: items['vi_4989_soaring_insignia'], stack: 1 };
  await sleep(300);
  ok('C 徽章入装', p.equipStats.empressBrooch === true);
  p.mount.flyTime = 0;                                 // 手动归零探回满
  await sleep(120);                                    // 一拍以上:回满 100 → Flight-1 = 99
  res.fuelAfterZero = p.mount.flyTime;
  ok('C 归零后每拍回满(99=100-1)', p.mount.flyTime === 99, `fuel=${p.mount.flyTime}`);
  await sleep(2600);                                   // 150+ 帧钉位,零补燃（无徽章 100 拍耗尽→无钳快坠）
  const vyInf = p.vy;
  res.vyInfiniteHover = +vyInf.toPrecision(6);
  ok('C 无限飞:150+ 帧仍钉位 |vy|<0.5（耗尽支=快坠判别红）', Math.abs(vyInf) < 0.5, `vy=${vyInf.toPrecision(6)}`);

  // ---- D) 耗尽臂重力场（BJ703-D2;摘徽章防每拍回满,再探两带） ----
  // ★暂停 + 手动逐拍（确定性 42 拍窗,双带同数;探针坑③:实时窗受 rAF 追赶脉冲
  //   污染——同步搭台阻塞主线程后 FrameBeat 补拍爆发,玩家位置/拍数失控）。
  inv.armor[4] = null;
  g.input.setVirtualAction('Jump', false); g.input.setVirtualAction('Down', false);
  await sleep(300);
  ok('D 摘徽章', p.equipStats.empressBrooch === false);
  const step = () => p.fixedUpdate(1 / 60, g.hooksProxy ?? g);
  const measureBand = (ty) => {
    g.paused = true;                                   // 冻结实时循环（fixedUpdate 由手动步进独占）
    buildPlatform(ty, 45);
    p.x = ptx * 16; p.y = ty * 16 - p.h - 4; p.vy = 0; p.vx = 0;
    p.onGround = false;
    p.inputJump = false; p.inputDown = false;
    let settled = false;
    for (let i = 0; i < 300 && !p.onGround; i++) step();
    if (p.onGround) settled = true;
    p.inputJump = true;                                // 手动直写输入（暂停态 Game.fixedUpdate 冻结）
    for (let i = 0; i < 36; i++) step();               // 15 jumpHold + 21 爬升拍
    p.mount.flyTime = 0; p.vy = 1;                     // 手动耗尽;vy 非零避 vy===0 回充门
    p.inputDown = true;                                // 悬停向门:不钳=纯累积
    for (let i = 0; i < 42; i++) step();               // 确定性 42 拍累积窗
    const vy = p.vy;
    p.inputJump = false; p.inputDown = false;
    g.paused = false;
    return { vy, settled };
  };
  const surf = measureBand(pty);
  const space = measureBand(spaceTy);
  res.vyExhaustedSurface = +surf.vy.toFixed(3);
  res.vyExhaustedSpace = +space.vy.toFixed(3);
  res.spaceSettled = space.settled;
  const ratio = (space.vy - 1) / Math.max(1e-6, surf.vy - 1);
  res.spaceSurfaceRatio = +ratio.toFixed(3);
  ok('D 地表带落定+耗尽累积 vy≈6.6(1+0.4/3×42)', surf.settled && surf.vy > 5.0 && surf.vy < 8.5, `vy=${surf.vy.toFixed(3)}`);
  ok('D 太空带落定+耗尽累积 vy≈2.4(1+0.1/3×42;常量版≈6.6)', space.settled && space.vy > 1.0 && space.vy < 3.5, `vy=${space.vy.toFixed(3)}`);
  ok('D 深度缩放比≈0.25(<0.6)', ratio < 0.6, `ratio=${ratio.toFixed(3)}`);

  // ---- E) 下坐清闩 ----
  p.mount.dismount?.(p, g);
  await sleep(300);
  ok('E 下坐:闩清', !p.ridingMount && p.mount.allowedToFly === false,
    `riding=${p.ridingMount} latch=${p.mount.allowedToFly}`);
  res.final = { dismounted: !p.ridingMount, wings: !!p.equipStats.wing };
  return res;
});
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: '/tmp/bj703d-raptor.png' });
console.log(JSON.stringify(out, null, 1));
console.log('pageerrors:', JSON.stringify(errs));
await browser.close();
