// ★BJ704-G20 二轮审查清偿·坐骑域七件独立骑坐探针（5239 私有实例）。
//  复用 R10 探针骨架（scripts/_bj704r10-mount-redblue2.mjs）,期望翻转=清偿后终态:
//  N1 直调换骑盒回 20×42（R10 发现面;vanilla SetMount else 支 :6329-6342）
//  N2 熔岩鲨 49 岩浆免伤（buff305 lavaImmune;真伤害漏斗 hp 观测,非 spy）
//  N3 湿支坐骑跳族（独角兽 10 池中空中再跳 hold=19≡20-1;+云瓶优先序=消费坐骑选项）
//  N4 QuickMount 冻结 R 键:不召唤不落矿车（vanilla :6068 头门;真 R 键链）
//  N5 case49 倾转消费链（骑 49 下落 → playerFullRotationOf 非 null）
//  判例遵守:unpaused 召唤（G16）/step=p.fixedUpdate(1/60)（G13）/输入直写 p.*
//  （G15）/setTile 真写/平台自带（G15）/池侧壁+全宽底板（G15）/真清 setLiquid(0,0)（G12）
//  /sleep 助手正形 new Promise(r=>setTimeout(r,ms))（R10 判例:写坏=零 tick 假跑）。
import puppeteer from 'puppeteer-core';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5239';
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
  const step = () => p.fixedUpdate(1 / 60, g.hooksProxy ?? g);
  const clearInputs = () => { p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0; };
  const summonAndRelease = async (id) => {
    const key = Object.keys(items).find(k => k.startsWith(`vi_${id}_`));
    if (!key) return false;
    inv.add(items[key], 1);
    for (let i = 0; i < inv.slots.length; i++) if (inv.slots[i] && inv.slots[i].id === items[key]) inv.selected = i;
    g.paused = false;
    g.input.mouseDown = true;
    for (let i = 0; i < 30 && !p.ridingMount; i++) await sleep(40);
    g.input.mouseDown = false;
    await sleep(160);
    g.paused = true;
    return p.ridingMount;
  };
  const pressR = () => {
    g.input.setVirtualAction('QuickMount', true);
    g.updateUse(1 / 60);
    g.input.setVirtualAction('QuickMount', false);
    g.updateUse(1 / 60);
  };
  const forceDismount = () => {
    if (p.ridingMount) {
      pressR();
      if (p.ridingMount) p.mount.dismount(p);
    }
    for (let i = 0; i < 3; i++) step();
  };
  p.maxHp = 500; p.hp = 500;

  // 安全平台域（G15 判例推广:裸地表可能下方是洞）
  const ptx = Math.floor(p.cx / 16), pty = Math.floor((p.y + p.h) / 16);
  const mkPlatform = (cx, row) => {
    for (let dx = -12; dx <= 12; dx++) {
      st.setTile(cx + dx, row, 1, 0, 0);
      for (let dy = 1; dy <= 4; dy++) st.setTile(cx + dx, row + dy, 1, 0, 0);
      for (let dy = -10; dy <= -1; dy++) st.setTile(cx + dx, row + dy, 0, 0, 0);
    }
  };
  const placeOn = (cx, row) => { p.x = (cx + 0.5) * 16 - p.w / 2; p.y = row * 16 - p.h; p.vx = 0; p.vy = 0; p.onGround = true; };

  // ---- N1 直调换骑盒回 20×42（R10 N1 发现面清偿） ----
  mkPlatform(ptx, pty);
  placeOn(ptx, pty);
  clearInputs();
  for (let i = 0; i < 10; i++) step();
  ok('N1a 召唤鼠 55（物品通道 5525）', await summonAndRelease(5525), `type=${p.mount?.type}`);
  ok('N1b 鼠骑乘盒=14×14（MOUNT_PLAYER_SIZE 缩盒）', p.w === 14 && p.h === 14, `${p.w}x${p.h}`);
  const bottomBefore = p.y + p.h;
  p.mount.setMount(3, p, g);   // 直调换骑（mod/未来通道等价入口）
  ok('N1c 直调换骑后盒回 20×42 底锚保持（vanilla else 支;旧残留 14×14=已清偿）',
    p.mount?.type === 3 && p.w === 20 && p.h === 42 && Math.abs(p.y + p.h - bottomBefore) < 0.001,
    `type=${p.mount?.type} 盒=${p.w}x${p.h} 底差=${+(p.y + p.h - bottomBefore).toFixed(3)}`);
  forceDismount();

  // ---- N2 熔岩鲨 49 岩浆免伤（真伤害漏斗 hp 观测） ----
  mkPlatform(ptx, pty);
  placeOn(ptx, pty);
  clearInputs();
  for (let i = 0; i < 10; i++) step();
  ok('N2a 召唤熔岩鲨 49（物品通道 4828）', await summonAndRelease(4828), `type=${p.mount?.type}`);
  const lTop = pty, lFloor = pty + 7;
  for (let dx = -9; dx <= 9; dx++) {
    st.setTile(ptx + dx, lFloor, 1, 0, 0);
    for (let y = lTop; y < lFloor; y++) st.setLiquid(ptx + dx, y, 200, 2);   // LAVA=2
  }
  for (let y = lTop; y < lFloor; y++) { st.setTile(ptx - 10, y, 1, 0, 0); st.setTile(ptx + 10, y, 1, 0, 0); }
  placeOn(ptx, lFloor - 1); p.onGround = false;
  // ★maxHp 是 baseMaxHp 派生 getter（无 setter,直写无效）;hp 会被生命回复钳回
  //  maxHp（=100）——须写 baseMaxHp（诊断探针实证:免疫本体 dmgCalls=0 已证,hp=100
  //  系夹具伪影非伤害）
  p.baseMaxHp = 500; p.hp = 500; p.lavaImmuneTicks = 0;
  let sharkHpMin = 500, died = false;
  for (let i = 0; i < 90; i++) {
    step();
    if (p.hp < sharkHpMin) sharkHpMin = p.hp;
    if (p.dead) { died = true; break; }
  }
  const sharkHp = p.hp;
  res.steps.push(`INFO N2b 骑鲨池中 90 拍:inLava=${p.inLava} hp=${sharkHp} hpMin=${sharkHpMin} died=${died} riding=${p.ridingMount} fs=${p.mount?.frameState} dead=${p.dead}`);
  ok('N2c 熔岩鲨骑者岩浆中不掉血（buff305 lavaImmune 清偿;旧 500→15）',
    p.inLava && sharkHp >= 500, `inLava=${p.inLava} hp=${sharkHp}`);
  // 对照:下坐后裸玩家同池应掉血（夹具有效性自证）
  pressR();
  if (!p.ridingMount) {
    placeOn(ptx, lFloor - 1); p.onGround = false;
    p.baseMaxHp = 500; p.hp = 500; p.lavaImmuneTicks = 0;
    for (let i = 0; i < 90; i++) step();
    res.steps.push(`INFO N2d 对照裸玩家同池 hp=${p.hp}（<500=池有效）`);
    ok('N2d 对照裸玩家同池掉血（夹具有效性）', p.hp < 500, `hp=${p.hp}`);
  }
  for (let dx = -9; dx <= 9; dx++) for (let y = lTop; y < lFloor; y++) st.setLiquid(ptx + dx, y, 0, 0);

  // ---- N3 湿支坐骑跳族（独角兽+云瓶:空中再跳 + 优先序） ----
  mkPlatform(ptx, pty);
  placeOn(ptx, pty);
  clearInputs();
  for (let i = 0; i < 10; i++) step();
  ok('N3a 召唤独角兽 10（物品通道 3260）', await summonAndRelease(3260), `type=${p.mount?.type}`);
  // 云瓶入包+装备（armor[4] 配饰槽）→ jumpOpts 含 Cloud
  const bottleKey = Object.keys(items).find(k => k.startsWith('vi_53_'));
  if (bottleKey) inv.armor[4] = { id: items[bottleKey], stack: 1 };
  g.paused = true;
  clearInputs();
  // 水池（6 深）
  const wTop = pty - 6, wFloor = pty + 1;
  for (let dx = -9; dx <= 9; dx++) {
    st.setTile(ptx + dx, wFloor, 1, 0, 0);
    for (let y = wTop; y < wFloor; y++) st.setLiquid(ptx + dx, y, 200, 1);   // WATER=1
  }
  for (let y = wTop; y < wFloor; y++) { st.setTile(ptx - 10, y, 1, 0, 0); st.setTile(ptx + 10, y, 1, 0, 0); }
  placeOn(ptx, wFloor - 1); p.onGround = false;
  clearInputs();
  for (let i = 0; i < 12; i++) step();
  const wetBefore = p.inWater;
  const bottlesBefore = p.extraJumps.length;
  p.inputJump = true; step(); p.inputJump = false; step();
  const wetJumpVy = p.vy;
  for (let i = 0; i < 16; i++) step();
  p.inputJump = true; step();
  const wetReJumpHold = p.jumpHold;
  const wetReJumpVy = p.vy;
  const wetPerfJump = p.performingJump;
  const bottlesAfter = p.extraJumps.length;
  p.inputJump = false;
  res.steps.push(`INFO N3b 湿=${wetBefore} 瓶=${bottlesBefore} 池底首跳 vy=${+wetJumpVy.toFixed(2)} 空中再按 hold=${wetReJumpHold} vy=${+wetReJumpVy.toFixed(2)} perf=${wetPerfJump} 瓶余=${bottlesAfter}`);
  ok('N3c ★湿支空中再跳=坐骑特殊跳（hold=19≡20-1;旧零响应 hold=0=已清偿）',
    wetBefore && wetJumpVy < 0 && wetReJumpHold === 19 && wetReJumpVy < 0,
    `hold=${wetReJumpHold} vy=${+wetReJumpVy.toFixed(2)}`);
  ok('N3d ★优先序:消费坐骑选项非瓶（vanilla selection 坐骑族在瓶族前;旧=SW 耗瓶）',
    wetPerfJump === 'Unicorn' && bottlesAfter === bottlesBefore,
    `perf=${wetPerfJump} 瓶=${bottlesBefore}→${bottlesAfter}`);
  for (let dx = -9; dx <= 9; dx++) for (let y = wTop; y < wFloor; y++) st.setLiquid(ptx + dx, y, 0, 0);
  forceDismount();

  // ---- N4 QuickMount 冻结 R 键:不召唤不落矿车（真 R 键链） ----
  mkPlatform(ptx, pty);
  placeOn(ptx, pty);
  p.hp = 500; p.maxHp = 500; p.dead = false;
  clearInputs();
  for (let i = 0; i < 10; i++) step();
  const { BuffType } = await import('/src/stats/Buffs.ts');
  p.buffs.apply(BuffType.Frozen, 300);
  // 清包（N1 鼠鞍/N2 鲨鞍残留会占 quickMount 背包扫描先位）
  for (let i = 0; i < inv.slots.length; i++) inv.slots[i] = null;
  const saddleKey = Object.keys(items).find(k => k.startsWith('vi_3260_'));
  if (saddleKey) inv.add(items[saddleKey], 1);
  const ridingBefore = p.ridingMount;
  pressR(); pressR();
  ok('N4a 冻结中 R×2:不召唤不落矿车（vanilla :6068 头门;旧=冻结可召唤）',
    !p.ridingMount && ridingBefore === false && !p.ridingCart, `riding=${p.ridingMount} cart=${p.ridingCart}`);
  p.buffs.remove(BuffType.Frozen);
  step();
  pressR();
  ok('N4b 解冻后 R:召唤成功（头门不误伤正常面）', p.ridingMount && p.mount?.type === 10, `type=${p.mount?.type}`);
  forceDismount();

  // ---- N5 case49 倾转消费链（骑 49 下落 → 消费面非 null） ----
  mkPlatform(ptx, pty);
  placeOn(ptx, pty);
  clearInputs();
  ok('N5a 召唤熔岩鲨 49（干路下落域）', await summonAndRelease(4828), `type=${p.mount?.type}`);
  g.paused = true;
  clearInputs();
  // 召唤等待期已落地 → 抬到空中再观测下落带（summon wait 真时间 ~1.2s 会先落地）
  placeOn(ptx, pty - 8); p.onGround = false; p.vy = 0;
  for (let i = 0; i < 24 && p.vy < 1; i++) step();
  const rot = p.mount.fullRotation;
  const mod = await import('/src/entities/Mounts.ts');
  const consumed = mod.playerFullRotationOf(p, p.mount);
  res.steps.push(`INFO N5b 下落 vy=${+p.vy.toFixed(2)} fullRotation=${+rot.toFixed(4)} consumed=${consumed ? JSON.stringify({ a: +consumed.angle.toFixed(4), px: +consumed.pivotX.toFixed(1), py: +consumed.pivotY.toFixed(1) }) : 'null'}`);
  ok('N5c 倾转写面+消费链通（旧=写而不读死写,恒 null）',
    rot !== 0 && consumed !== null && Math.abs(consumed.angle - rot) < 1e-9,
    `rot=${+rot.toFixed(4)} consumed=${consumed ? 'non-null' : 'null'}`);
  forceDismount();
  return res;
});
console.log(out.steps.join('\n'));
console.log(errs.length ? `PAGE ERRORS: ${errs.join(' | ')}` : 'NO PAGE ERRORS');
await browser.close();
