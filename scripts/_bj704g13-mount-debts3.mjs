// ★BJ704-G13 实跑探针：坐骑/毯域五件第三刀（物品通道召唤 + g.paused 手动逐拍,G12 范式）。
//  P1 债1 火烈鸟 4716 水中：非 swimFree（旧干路由）+liqFactor 0.5+浮液上浮 −0.2/t 净
//  P2 债2 CCed 双闸：扫帚 4444 冰冻→下坐;鼠 5525 冰冻→拒下坐保骑（DontDismountWhenCCed）
//  P3 债3 海龟 2491 液中悬空泳跃（buff 131 授 accFlipper;旧 flipperJump 不可达）
//  P4 债4 黑魔书 4796：空中分派恒走跑动组（frame 推进;旧空中组钉 0）+静止半速循环
//  P5 债5 slowFall 贴地拍召唤 UFO（物理后 updateUse 同款序）→起飞冲量读无符号 fresh
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
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[g13]')) console.log(t); });
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
    if (!p.ridingMount) {
      res.summonDiag = res.summonDiag || [];
      res.summonDiag.push({ id, key: !!key, dead: p.dead, hp: p.hp, sel: inv.selected,
        selItem: inv.slots[inv.selected]?.id === items[key], anim: p.itemAnimTicks, cced: p.cced,
        shimmering: p.shimmering, yT: Math.round(p.y / 16), onG: p.onGround });
    }
    return p.ridingMount;
  };
  /** 开顶液池（G4 判例:topTy 取地表上方 pty−8;真清=amount 0——G12 判例） */
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
  const clearPool = (pool) => {
    for (let dx = -5; dx <= 12; dx++) for (let y = pool.topTy; y < pool.floorTy; y++) st.setLiquid(ptx + dx, y, 0, 0);
  };
  p.maxHp = 500; p.hp = 500;

  console.log('[g13] P1 enter');
  // ---- P1 债1 火烈鸟 4716：非 swimFree + 湿路由 + 浮液上浮 ----
  g.paused = false;
  ok('P1a 火烈鸟 4716 物品通道召唤', await summonAndRelease(4716), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  ok('P1b 火烈鸟非 swimFree（:9982-9986 canFloatInWater 非 ignoreWater;旧表误含 265）',
    p.ridingMountSwimFree === false, `swimFree=${p.ridingMountSwimFree}`);
  const fPool = makePool(0);
  p.x = (ptx + 3) * 16; p.y = (pty + 8) * 16; p.vx = 0; p.vy = 0;
  p.onGround = false;
  for (let i = 0; i < 10; i++) step();
  res.p1Rise = { vy: +p.vy.toFixed(4), liqF: p.liqFactor };
  ok('P1c 中池上浮 vy≈−2.0（浮液 −0.4+湿重力 +0.2 净 −0.2/t;旧 swimFree 干路由直沉 +2）',
    p.vy < -1.5, `vy=${p.vy.toFixed(4)} inWater=${p.inWater} liqF=${p.liqFactor}`);
  ok('P1d liqFactor 0.5（:28309 num110 湿档;旧 ignoreWater=1）', p.liqFactor === 0.5, `liqF=${p.liqFactor}`);
  // 液面漂：近面 60 拍稳定在液面带
  p.y = (fPool.topTy + 4) * 16; p.vy = 0; p.onGround = false;
  for (let i = 0; i < 60; i++) step();
  const linePx = (fPool.topTy + 1) * 16 - 12;   // GetWaterLine :1536-38 同式
  res.p1Bob = { cy: +p.cy.toFixed(1), linePx };
  ok('P1e 液面漂稳态（心位 ∈ 液面 ±22px;旧直沉池底）', Math.abs(p.cy - (linePx - 2)) <= 22,
    `cy=${p.cy.toFixed(1)} line=${linePx} vy=${p.vy.toFixed(3)}`);
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();
  clearPool(fPool);

  console.log('[g13] P2 enter');
  // ---- P2 债2 CCed 双闸 ----
  const { BuffType } = await import('/src/stats/Buffs.ts');
  g.paused = false;
  ok('P2a 巫婆扫帚 4444 物品通道召唤', await summonAndRelease(4444), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  p.buffs.apply(BuffType.Frozen, 5);
  step();
  res.p2Broom = { active: p.mount.active, riding: p.ridingMount };
  ok('P2b 扫帚冰冻→TryDismount 通过（非豁免集+开阔地 20×42 探针过）→下坐',
    p.mount.active === false && p.ridingMount === false, `active=${p.mount.active}`);
  p.buffs.remove(BuffType.Frozen);   // CCed 阻塞 ItemCheck（:42924-42930）=召唤通道死,先解控
  step();
  g.paused = false;
  ok('P2c 大鼠 5525 物品通道召唤', await summonAndRelease(5525), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  p.buffs.apply(BuffType.Frozen, 5);
  step();
  res.p2Rat = { active: p.mount.active, riding: p.ridingMount, w: p.w, h: p.h };
  ok('P2d 鼠 55 冰冻→DontDismountWhenCCed 拒下坐（FailedCCed;旧直调 dismount 必下）',
    p.mount.active === true && p.ridingMount === true,
    `active=${p.mount.active} riding=${p.ridingMount} box=${p.w}x${p.h}`);
  step();
  ok('P2e 拒下坐骑者持续保骑（CCed 期每拍重判不累积下坐）',
    p.mount.active === true && p.ridingMount === true, `active=${p.mount.active}`);
  p.buffs.remove(BuffType.Frozen);
  step();
  ok('P2f 解控后维护链恢复（CCed 期 upkeep 照跑=帧态机存活,解控即可操控）',
    p.mount.active === true, `active=${p.mount.active}`);
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();

  console.log('[g13] P3 enter');
  // ---- P3 债3 海龟液中悬空泳跃（accFlipper 面） ----
  g.paused = false;
  ok('P3a 海龟 2491 物品通道召唤', await summonAndRelease(2491), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  const tPool = makePool(0);
  p.x = (ptx + 3) * 16; p.y = (pty + 8) * 16; p.vx = 0; p.vy = 1;   // 悬空下沉中
  p.onGround = false;
  for (let i = 0; i < 4; i++) step();
  ok('P3b 对照:无跳键拍持续下沉（vy>0）', p.vy > 0, `vy=${p.vy.toFixed(3)}`);
  p.inputJump = true; p.jumpEdgePrev = false;   // 跳键沿（液中悬空）
  step();
  res.p3Swim = { vy: +p.vy.toPrecision(6), jumpHold: p.jumpHold, swimTime: p.swimTime };
  ok('P3c 悬空泳跃起跳（flag2 :20795 坐骑 buff 授 accFlipper;旧 flipperJump 恒假不可达）',
    p.vy < 0 && p.jumpHold > 0, `vy=${p.vy.toPrecision(6)} jumpHold=${p.jumpHold}`);
  ok('P3d flag4 置 swimTime（:20859-20862 置 30 同拍递减 29）', p.swimTime === 29, `swimTime=${p.swimTime}`);
  p.inputJump = false;
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();
  clearPool(tPool);

  console.log('[g13] P4 enter');
  // ---- P4 债4 黑魔书 4796：动画组恒走跑动组 ----
  g.paused = false;
  ok('P4a 黑魔书 4796 物品通道召唤', await summonAndRelease(4796), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  // 空中下落（分派态 2）：跑动组速率 Max(0.5,|v|×0.125),vy 大 → frame 推进
  p.x = (ptx + 3) * 16; p.y = (pty - 6) * 16; p.vx = 0; p.vy = -8;   // 上升段（vy≠0=空中分派）
  p.onGround = false;
  const f0 = p.mount.frame;
  for (let i = 0; i < 20; i++) step();
  res.p4 = { f0, f20: p.mount.frame, state: p.mount.frameState };
  ok('P4b 空中分派帧态 2 恒在（组覆写不改 frameState）', p.mount.frameState === 2, `state=${p.mount.frameState}`);
  ok('P4c 空中动画推进 frame 0→2（跑动组 1/t,rFD=8;旧空中组钉 0）',
    p.mount.frame >= 2 && p.mount.frame <= 5, `frame ${f0}→${p.mount.frame}`);
  // 静止半速循环（直驱 updateFrame=生产同码路径,避 48 耗尽坠落物理耦合）：
  // 空中分派 state 2 + vx=vy=0 → case 48 组覆写后跑动组 rate=Max(0.5,0)=0.5
  p.mount.frameCounter = 0;
  const fA0 = p.mount.frame;
  for (let i = 0; i < 30; i++) p.mount.updateFrame(p, 2, 0, 0);
  res.p4d = { fA0, fA30: p.mount.frame, c30: +p.mount.frameCounter.toFixed(2) };
  ok('P4d 静止空中分派半速循环（0.5/t,rFD8 → 30 拍推进 1 帧至组内）',
    p.mount.frame === ((fA0 + 1) % 6) && Math.abs(p.mount.frameCounter - 7) < 0.01,
    `frame ${fA0}→${p.mount.frame} counter=${p.mount.frameCounter.toFixed(2)}`);
  // 贴地分派 state 0（站立意图）同走跑动组（组覆写不分派态）
  p.mount.frameCounter = 0; p.mount.frame = 0;
  for (let i = 0; i < 18; i++) p.mount.updateFrame(p, 0, 0, 0);
  ok('P4e 站立分派（state 0）同样走跑动组（case 48 无条件覆写;18 拍 0.5×18=9>rFD8 → 推进 1）',
    p.mount.frame === 1, `frame=${p.mount.frame} counter=${p.mount.frameCounter.toFixed(2)}`);
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();

  console.log('[g13] P5 enter');
  // ---- P5 债5 slowFall 贴地拍召唤 UFO → 起飞冲量读 fresh 无符号 ----
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  p.buffs.apply(BuffType.Featherfall, 60);
  // P1 池挖空了 ptx-5..ptx+12 列——P5 落点移出（ptx-10 平台,防 140 拍缓降未及落地）
  const gx = ptx - 10;
  for (let dx = -1; dx <= 1; dx++) { st.setTile(gx + dx, pty + 2, 0); st.setTile(gx + dx, pty + 3, 1, 0, 0); }
  p.x = gx * 16; p.y = (pty - 4) * 16; p.vx = 0; p.vy = 0;
  p.onGround = false;
  let landed = false;
  for (let i = 0; i < 120; i++) {
    step();
    if (p.onGround && p.vy === 0) { landed = true; break; }
  }
  ok('P5a slowFall 缓降落地（触发门 vy==0 前提）', landed, `landed=${landed} vy=${p.vy}`);
  res.p5stale = { gField: +p.gField.toFixed(5), fresh: +p.gFieldUnsigned.toFixed(5) };
  ok('P5b 债面存在性：gField=带符号 /3 陈值 vs gFieldUnsigned=fresh（两通道分叉）',
    Math.abs(p.gField - p.gFieldUnsigned / 3) < 1e-4 && p.gFieldUnsigned > p.gField,
    `gField=${p.gField.toFixed(5)} fresh=${p.gFieldUnsigned.toFixed(5)}`);
  // 同款序召唤（Game.fixedUpdate:物理→updateUse;paused 下直调 setMount 等价）
  p.mount.setMount(7, p);                    // UFO（usesHover,canHover 无帧态门）
  p.inputUp = true; p.jumpEdgePrev = false;  // ↑沿
  step();                                    // 次拍:upkeep tryStartHover + 物理链
  // 期望 = 冲量 −(accel+fresh+0.001)（:26941）+ 同拍 Hover 升力臂再 −accel（:3452
  // `num6 -= acceleration`——controlUp∧canLift 恒达;vanilla 同拍序两笔叠加）
  const expectImpulse = -(0.16 + p.gFieldUnsigned + 0.001) - 0.16;
  res.p5impulse = { vy: +p.vy.toPrecision(6), expect: +expectImpulse.toPrecision(6) };
  ok('P5c 起飞冲量 fresh 值（冲量+升力臂;旧读带符号 /3 陈值=−0.454）',
    Math.abs(p.vy - expectImpulse) < 1e-4, `vy=${p.vy.toPrecision(6)} expect=${expectImpulse.toPrecision(6)}`);
  p.inputUp = false;
  p.mount.dismount?.(p, g);
  return res;
});
for (const s of out.steps) console.log(s);
if (out.summonDiag) console.log('summonDiag:', JSON.stringify(out.summonDiag));
console.log('p1Rise', JSON.stringify(out.p1Rise), 'p1Bob', JSON.stringify(out.p1Bob));
console.log('p2Broom', JSON.stringify(out.p2Broom), 'p2Rat', JSON.stringify(out.p2Rat));
console.log('p3Swim', JSON.stringify(out.p3Swim));
console.log('p4', JSON.stringify(out.p4));
console.log('p5stale', JSON.stringify(out.p5stale), 'p5impulse', JSON.stringify(out.p5impulse));
const fails = out.steps.filter(s => s.startsWith('FAIL'));
console.log(fails.length === 0 ? `\n=== G13 probe ALL PASS (${out.steps.length}) ===` : `\n=== G13 probe ${fails.length} FAIL ===`);
if (errs.length) { console.log('pageerrors:', errs.slice(0, 5)); }
await browser.close();
process.exit(fails.length === 0 && errs.length === 0 ? 0 : 1);
