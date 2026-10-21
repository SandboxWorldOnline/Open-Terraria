// ★BJ704-G12 实跑探针：坐骑/毯域八件第二刀（物品通道召唤 + g.paused 手动逐拍,G5 范式）。
//  P1 债1 未骑乘微光（cloak 5355 免形变）：静沉 0.15/t + 池底水跳 -5.36/jumpHold 23
//  P2 债2 骑扫帚入微光（无 cloak）：buff353→shimmering 同拍强制下坐 + 0.36/t 穿落
//  P3 债3 海龟 2491 水中：液体档 0.2/t 沉降（旧干路 0.4）+ 终速钳 5.01
//  P4 债4 翼 493 池底持跳：wingTime 不回充（旧逐拍回满）;松跳回满
//  P5 债5 飞毯 934 太空带平台（num6 0.25）：毯带钉 0.1 与重力相消=高度保持（旧 0.3/t 上爬）
//  P6 债6 黑魔书 4796：能量窗持跳无升力（-0.001 静置）;耗尽重力臂 0.4/t 坠
//  P7 债7 毯展开拍 stepUpCarpet=true;extraJumps 残量拍 false（旧恒真）
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
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[g12]')) console.log(t); });
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
  const clearPool = (pool) => {
    // ★G12 判例修正：G5 探针的"清池"写的是 (200, 0)=200 单位【水】非清空——残留池
    // 把后续场景路由进湿支（P6 黑魔书实测 +0.2/t=湿档 hover 重力场,反证 G4-② 链
    // 通;真清=amount 0）。清后 P2 需空腔实体化退出微光（穿落落点检查要非实心盒）。
    for (let dx = -5; dx <= 12; dx++) for (let y = pool.topTy; y < pool.floorTy; y++) st.setLiquid(ptx + dx, y, 0, 0);
  };
  p.maxHp = 500; p.hp = 500;

  console.log('[g12] P1 enter');
  // ---- P1 债1 未骑乘微光（cloak 免形变,湿支 shimmer 档） ----
  const cloakKey = Object.keys(items).find(k => k.startsWith('vi_5355_'));
  inv.armor[3] = { id: items[cloakKey], stack: 1 };
  await sleep(200);
  g.paused = true;
  g.input.setVirtualAction('Jump', false); g.input.setVirtualAction('Down', false);
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  const shPool = makePool(4);
  p.x = (ptx + 3) * 16; p.y = (pty + 6) * 16; p.vx = 0; p.vy = 0;
  p.onGround = false;
  for (let i = 0; i < 10; i++) step();
  res.p1SinkVy = +p.vy.toFixed(4);
  ok('P1a 未骑乘微光静沉 0.15/t（旧 0.06/t;±带无 3.0 顶）', Math.abs(p.vy - 1.5) < 0.02,
    `vy=${p.vy.toFixed(4)} inShimmer=${p.inShimmer} shimmering=${p.shimmering}`);
  ok('P1b cloak 免形变（shimmering 恒假=湿支 shimmer 档可达）',
    p.inShimmer === true && p.shimmering === false, `shimmering=${p.shimmering}`);
  p.x = (ptx + 3) * 16; p.y = (shPool.floorTy - 2.625) * 16;   // 池底贴齐
  p.vx = 0; p.vy = 0; p.onGround = false;
  for (let i = 0; i < 6; i++) step();
  p.inputJump = true; p.jumpEdgePrev = false;       // 边沿水跳
  step();
  res.p1Jump = { vy: +p.vy.toPrecision(6), jumpHold: p.jumpHold };
  ok('P1c 池底水跳=shimmer 档 vy=-5.36/jumpHold=23（旧 0.62 游升无跳门）',
    Math.abs(p.vy - (-5.36)) < 0.01 && p.jumpHold === 23,
    `vy=${p.vy.toPrecision(6)} jumpHold=${p.jumpHold}`);
  p.inputJump = false;
  inv.armor[3] = null;
  clearPool(shPool);
  for (let i = 0; i < 2; i++) step();

  console.log('[g12] P2 enter');
  // ---- P2 债2 骑扫帚入微光（无 cloak）→ CCed 强制下坐 + 0.36/t 穿落 ----
  g.paused = false;
  ok('P2a 巫婆扫帚 4444 物品通道召唤', await summonAndRelease(4444), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  const shPool2 = makePool(4);
  p.x = (ptx + 3) * 16; p.y = (pty + 6) * 16; p.vx = 0; p.vy = 1;
  p.onGround = false;
  step();
  res.p2State = { shimmering: p.shimmering, mountActive: p.mount.active, vy: +p.vy.toFixed(4) };
  ok('P2b buff353→shimmering 同拍【强制下坐】（:27000-27012 CCed 臂;旧保持骑乘）',
    p.shimmering === true && p.mount.active === false,
    `shimmering=${p.shimmering} active=${p.mount.active}`);
  for (let i = 0; i < 2; i++) step();
  ok('P2c CCed 重力臂 0.36/t 穿落（vy=1+3×0.36=2.08）', Math.abs(p.vy - 2.08) < 0.02,
    `vy=${p.vy.toFixed(4)}`);
  for (let i = 0; i < 40; i++) step();
  res.p2ClampVy = +p.vy.toFixed(5);
  ok('P2d 终速钳 9.01（10×0.9+0.01;旧 9.009）', Math.abs(p.vy - 9.01) < 0.002, `vy=${p.vy.toFixed(5)}`);
  // 脱困：真清微光 + 空腔实体化退出（:11403-11419 穿落落点检查要非实心盒——
  // 真清后池体为空腔,但穿落者已在池底岩层内=实心盒会续期 buff,须先搬空腔）
  clearPool(shPool2);
  for (let dx = 8; dx <= 11; dx++) for (let dy = -3; dy <= 1; dy++) st.setTile(ptx + dx, pty + dy, 0);
  p.x = (ptx + 9) * 16; p.y = (pty - 2) * 16;
  for (let i = 0; i < 3; i++) step();
  res.p2ExitShimmering = p.shimmering;
  ok('P2e 空腔实体化退出微光（DelBuff,后续场景复位前提）', p.shimmering === false, `shimmering=${p.shimmering}`);

  console.log('[g12] P3 enter');
  // ---- P3 债3 海龟 2491 水中液体档重力 ----
  g.paused = false;
  ok('P3a 海龟 2491 物品通道召唤', await summonAndRelease(2491), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  const wPool = makePool(0);
  p.x = (ptx + 3) * 16; p.y = (pty + 8) * 16; p.vx = 0; p.vy = 0;
  p.onGround = false;
  for (let i = 0; i < 10; i++) step();
  res.p3SinkVy = +p.vy.toFixed(4);
  ok('P3b 海龟水中沉 0.2/t（旧干路 0.4）', Math.abs(p.vy - 2.0) < 0.02,
    `vy=${p.vy.toFixed(4)} inWater=${p.inWater} swimFree=${p.ridingMountSwimFree}`);
  for (let i = 0; i < 30; i++) step();
  ok('P3c 液体档终速钳 5.01（旧 10.01）', Math.abs(p.vy - 5.01) < 0.02, `vy=${p.vy.toFixed(4)}`);
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();
  clearPool(wPool);

  console.log('[g12] P4 enter');
  // ---- P4 债4 翼 493 池底持跳 wingTime 不回充 ----
  g.paused = false;
  inv.armor[3] = { id: items['vi_493_天使之翼'] ?? items['vi_493_AngelWings'], stack: 1 };
  await sleep(200);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  const wPool2 = makePool(0);
  p.x = (ptx + 3) * 16; p.y = (wPool2.floorTy - 2.625) * 16;   // 池底贴齐
  p.vx = 0; p.vy = 0; p.onGround = false;
  for (let i = 0; i < 6; i++) step();
  const wt = p.equipStats.wing?.time ?? -1;
  p.wingTime = 1;
  p.inputJump = true; p.jumpEdgePrev = true;        // 持跳（无沿）
  for (let i = 0; i < 5; i++) step();
  res.p4HeldWingTime = p.wingTime;
  ok('P4d 池底持跳翼时量【不】回充（:26978 releaseJump 门;旧逐拍回满）',
    p.wingTime === 1, `wingTime=${p.wingTime}/${wt}`);
  p.inputJump = false;                              // 松跳
  step();
  res.p4RelWingTime = p.wingTime;
  ok('P4e 松跳拍回满 wingTimeMax', p.wingTime === wt, `wingTime=${p.wingTime}/${wt}`);
  inv.armor[3] = null;
  clearPool(wPool2);
  for (let i = 0; i < 2; i++) step();

  console.log('[g12] P5 enter');
  // ---- P5+P7 债5/债7 飞毯 934 太空带平台（num6 0.25,行 ≥45 顶界钳带内） ----
  g.paused = false;
  inv.armor[3] = { id: items['vi_934_FlyingCarpet'] ?? items['vi_934_FlyingCarpet2'], stack: 1 };
  await sleep(200);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  const platTy = 76;                                // num6 钳 0.25 带（gl∈[200,400] 全域
  //  (76−70)/(gl/6)≤0.25 成立）;跳升 ~12.5 行→顶点 ~63 > 顶界钳 640px=行 40（52 版
  //  顶点 ~39.5 会撞钳=旧 P5b 伪影）;净空 rows 60-88 防浮岛地形
  for (let dx = -6; dx <= 10; dx++) {
    for (let y = platTy - 16; y < platTy + 12; y++) st.setTile(ptx + dx, y, 0);
    st.setTile(ptx + dx, platTy, 1, 0, 0);
  }
  p.x = (ptx + 2) * 16; p.y = (platTy - 2.625) * 16; p.vx = 0; p.vy = 0;
  p.onGround = false;
  for (let i = 0; i < 12; i++) step();              // 落地稳定（canCarpet=true）
  p.inputJump = true; p.jumpEdgePrev = false;       // 边沿起跳
  step();
  p.jumpEdgePrev = true;                            // 持跳
  let dep = -1;
  for (let i = 0; i < 130 && dep < 0; i++) { step(); if (p.carpetFlying) dep = i; }
  ok('P5a 太空带毯激活（跳预算尽后 carpetFlying）', dep >= 0, `deployed@${dep} num6 带 row=${platTy}`);
  let conv = false;
  for (let i = 0; i < 160 && !conv; i++) { step(); conv = p.vy > -0.05; }
  for (let i = 0; i < 5; i++) step();
  res.p5BandVy = +p.vy.toPrecision(8);
  ok('P5b 毯带=gravity 字段 0.4×0.25：钉 0.1 与重力相消 vy≈-1e-6 高度保持（旧 -0.3/t 上爬）',
    Math.abs(p.vy - (-1e-6)) < 1e-4, `vy=${p.vy.toPrecision(8)}`);
  const yBand = p.y;
  for (let i = 0; i < 20; i++) step();
  ok('P5c 20 拍高度保持 <0.001px（旧上爬 ~6px）', Math.abs(p.y - yBand) < 0.001,
    `dy=${+(p.y - yBand).toPrecision(6)}`);
  // P7 债7：展开拍 stepUpCarpet;extraJumps 残量拍 false
  ok('P7a 展开拍 stepUpCarpet=true（carpetFlying 单一真源）', p.stepUpCarpet === true,
    `stepUpCarpet=${p.stepUpCarpet} flying=${p.carpetFlying} fuel=${p.carpetTime}`);
  p.extraJumps = ['Cloud'];
  step();
  ok('P7b extraJumps 残量拍（毯块外门拒）stepUpCarpet=false（旧 carpetTime>0∧跳 恒真）',
    p.stepUpCarpet === false, `stepUpCarpet=${p.stepUpCarpet} carpetFlying=${p.carpetFlying}`);
  p.extraJumps = [];
  step();
  ok('P7c 外门复通余油续展 stepUpCarpet=true', p.stepUpCarpet === true, `stepUpCarpet=${p.stepUpCarpet}`);
  p.carpetTime = 1;                                 // 末拍燃料
  step();
  ok('P7d 末拍燃料（1→0）本拍在带内 stepUpCarpet=true（旧 carpetTime>0 已假）',
    p.carpetTime === 0 && p.stepUpCarpet === true, `fuel=${p.carpetTime} stepUp=${p.stepUpCarpet}`);
  p.inputJump = false;
  inv.armor[3] = null;

  console.log('[g12] P6 enter');
  // ---- P6 债6 黑魔书 4796：能量窗无升力;耗尽重力臂 ----
  g.paused = false;
  p.hp = p.maxHp;
  ok('P6a 黑魔书 4796 物品通道召唤', await summonAndRelease(4796), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false;
  p.x = (ptx + 2) * 16; p.y = (pty - 6) * 16; p.vx = 0; p.vy = 0;
  p.onGround = false;
  for (let i = 0; i < 20; i++) step();              // 落地稳定（flyTime 回充 320）
  p.mount.flyTime = 300;                            // 能量窗形态
  p.inputJump = true; p.jumpEdgePrev = true;        // 持跳（无沿,避起跳门）
  p.vy = 0.001; p.onGround = false;                 // 入空中帧态
  for (let i = 0; i < 6; i++) step();
  res.p6Window = { vy: +p.vy.toPrecision(8), flyTime: p.mount.flyTime };
  ok('P6b 能量窗持跳无升力：vy 钉 -0.001 静置（旧 lift 可用起爬）',
    Math.abs(p.vy - (-0.001)) < 1e-6, `vy=${p.vy.toPrecision(8)} fuel=${p.mount.flyTime}`);
  p.mount.flyTime = 0;                              // 耗尽形态（fatigueMax 0 → canLift 假）
  p.inputJump = false;
  for (let i = 0; i < 10; i++) step();
  res.p6ExhaustVy = +p.vy.toFixed(4);
  ok('P6c 耗尽重力驱动臂 vy+=0.4 带宽 4（净 +0.2/t;旧静置带永浮 -0.001）',
    Math.abs(p.vy - 4.0) < 0.05, `vy=${p.vy.toFixed(4)}`);
  p.inputDown = true;
  for (let i = 0; i < 45; i++) step();
  ok('P6d 耗尽+↓：↓臂（带宽 8）胜重力臂', Math.abs(p.vy - 8) < 0.05, `vy=${p.vy.toFixed(4)}`);
  p.inputDown = false;
  p.mount.dismount?.(p, g);
  return res;
});
for (const s of out.steps) console.log(s);
console.log('probe-data', JSON.stringify({
  p1SinkVy: out.p1SinkVy, p1Jump: out.p1Jump, p2State: out.p2State, p2ClampVy: out.p2ClampVy,
  p2ExitShimmering: out.p2ExitShimmering, p3SinkVy: out.p3SinkVy, p4HeldWingTime: out.p4HeldWingTime,
  p4RelWingTime: out.p4RelWingTime, p5BandVy: out.p5BandVy, p6Window: out.p6Window,
  p6ExhaustVy: out.p6ExhaustVy, summonDiag: out.summonDiag ?? null,
}));
const fails = out.steps.filter((s) => s.startsWith('FAIL')).length;
console.log(errs.length ? `PAGE-ERRORS: ${errs.join(' | ')}` : '');
console.log(fails === 0 ? `ALL ${out.steps.length} PASS` : `${fails} FAIL / ${out.steps.length}`);
await browser.close();
process.exit(fails === 0 && errs.length === 0 ? 0 : 1);
