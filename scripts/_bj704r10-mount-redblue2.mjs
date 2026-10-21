// ★BJ704-R10 红蓝对抗·第二轮 Player/Mounts 域独立骑坐探针（5242 私有实例）。
//  N1 变身→普通换骑盒残留（红队新发现候选:rat 55 → slime 3,盒应回 20×42）
//  N2 熔岩鲨 49 岩浆伤害（红队新发现候选:buff305 lavaImmune 应免伤）
//  N3 湿支坐骑跳族缺位（独角兽 10:干支对照有二段跳/湿支疑无）
//  N4 CCed 悬停让位独立复证（G16 债①:61 冰冻中下坠非静悬浮）
//  N5 QuickMount FailedCCed 静默独立复证（G17 件1:冰冻 R 无 toast 无尘仍骑）
//  判例遵守:unpaused 召唤（G16）/step=p.fixedUpdate(1/60)（G13）/输入直写 p.*（G15）
//  /setTile 真写/平台自带（G15 推广）/池侧壁+全宽底板（G15）/真清 setLiquid(0,0)（G12）。
import puppeteer from 'puppeteer-core';
const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5242';
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
    if (!p.ridingMount) {
      res.summonDiag = res.summonDiag || [];
      res.summonDiag.push({ id, key: !!key, dead: p.dead, hp: p.hp, cced: p.cced, yT: Math.round(p.y / 16) });
    }
    return p.ridingMount;
  };
  const { BuffType } = await import('/src/stats/Buffs.ts');
  const toasts = [];
  const origToast = g.cb.onToast;
  g.cb.onToast = (t) => { toasts.push(String(t)); return origToast.call(g.cb, t); };
  const dusts = [];
  const origDust = g.spawnDust.bind(g);
  g.spawnDust = (...a) => { dusts.push({ type: a[4], w: a[2], h: a[3] }); return origDust(...a); };
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

  // ---- N1 变身→普通换骑盒残留 ----
  mkPlatform(ptx, pty);
  placeOn(ptx, pty);
  clearInputs();
  for (let i = 0; i < 10; i++) step();
  ok('N1a 召唤鼠 55（物品通道 5525）', await summonAndRelease(5525), `type=${p.mount?.type}`);
  ok('N1b 鼠骑乘盒=14×14（MOUNT_PLAYER_SIZE 缩盒）', p.w === 14 && p.h === 14, `${p.w}x${p.h}`);
  // 骑鼠状态再用史莱姆鞍:DontHoldItems{55,56,61} 物品整链禁用（vanilla :5757 同相）
  // —— 物品通道换骑被拦（type 仍 55）=与 vanilla 平价面
  ok('N1c 骑鼠中用史莱姆鞍 2430 被禁（DontHoldItems;仍骑鼠）',
    (await summonAndRelease(2430)) && p.mount?.type === 55, `type=${p.mount?.type}`);
  // 直调 setMount（未来换骑通道/mod 面的等价入口）暴露潜伏盒残留:
  p.mount.setMount(3, p, g);
  res.steps.push(`INFO N1d 直调 setMount(3) 后:type=${p.mount?.type} 盒=${p.w}x${p.h}（vanilla SetMount :6329-6342 else 支+ResizeHitbox :29439-29451 持保=20×42;残留 14×14=潜伏缺口坐实）`);
  ok('N1d 直调换骑后盒回 20×42（vanilla 语义;残留=发现坐实）', p.w === 20 && p.h === 42, `${p.w}x${p.h}`);
  forceDismount();
  ok('N1e 下坐回盒 20×42', !p.ridingMount && p.w === 20 && p.h === 42, `${p.w}x${p.h} riding=${p.ridingMount}`);

  // ---- N2 熔岩鲨 49 岩浆伤害 ----
  mkPlatform(ptx, pty);
  placeOn(ptx, pty);
  clearInputs();
  for (let i = 0; i < 10; i++) step();
  ok('N2a 召唤熔岩鲨 49（物品通道 4828）', await summonAndRelease(4828), `type=${p.mount?.type}`);
  // 岩浆池:地表行起 6 深、19 宽（全宽底板+双侧壁,判例）
  const lTop = pty, lFloor = pty + 7;
  for (let dx = -9; dx <= 9; dx++) {
    st.setTile(ptx + dx, lFloor, 1, 0, 0);
    for (let y = lTop; y < lFloor; y++) st.setLiquid(ptx + dx, y, 200, 2);   // LAVA=2
  }
  for (let y = lTop; y < lFloor; y++) { st.setTile(ptx - 10, y, 1, 0, 0); st.setTile(ptx + 10, y, 1, 0, 0); }
  placeOn(ptx, lFloor - 1); p.onGround = false;
  p.hp = 500; p.lavaImmuneTicks = 0;
  for (let i = 0; i < 90; i++) step();
  const sharkInLava = p.inLava, sharkHp = p.hp;
  res.steps.push(`INFO N2b 骑鲨池中 90 拍:inLava=${sharkInLava} hp=${sharkHp} fs=${p.mount?.frameState}`);
  ok('N2c 熔岩鲨骑者岩浆中不掉血（vanilla buff305 lavaImmune;掉血=红队发现坐实）',
    sharkInLava && sharkHp >= 500, `inLava=${sharkInLava} hp=${sharkHp}`);
  // 对照:下坐后裸玩家同池应掉血（夹具有效性自证）
  pressR();
  if (!p.ridingMount) {
    placeOn(ptx, lFloor - 1); p.onGround = false;
    p.hp = 500; p.lavaImmuneTicks = 0;
    for (let i = 0; i < 90; i++) step();
    res.steps.push(`INFO N2d 对照裸玩家同池 hp=${p.hp}（<500=池有效）`);
    ok('N2d 对照裸玩家同池掉血（夹具有效性）', p.hp < 500, `hp=${p.hp}`);
  }
  for (let dx = -9; dx <= 9; dx++) for (let y = lTop; y < lFloor; y++) st.setLiquid(ptx + dx, y, 0, 0);

  // ---- N3 湿支坐骑跳族缺位（独角兽 10:干支对照 + 湿支主测）----
  mkPlatform(ptx, pty);
  placeOn(ptx, pty);
  clearInputs();
  for (let i = 0; i < 10; i++) step();
  ok('N3a 召唤独角兽 10（物品通道 3260）', await summonAndRelease(3260), `type=${p.mount?.type}`);
  // 干支对照:地面跳 → 空中再按跳 → mountJump 二段跳（dry :7571 分支存在）
  clearInputs();
  p.inputJump = true; step(); p.inputJump = false; step();
  const dryJumpVy = p.vy;
  for (let i = 0; i < 14; i++) step();   // 首跳预算（jumpHeight 10）耗尽仍空中
  const dryMidVy = p.vy;
  p.inputJump = true; step();
  const dryReJumpHold = p.jumpHold;
  const dryReJumpVy = p.vy;
  p.inputJump = false;
  for (let i = 0; i < 24; i++) step();
  ok('N3b 干支对照:首跳 vy<0 且 14 拍后仍空中', dryJumpVy < 0 && dryMidVy !== 0, `vy0=${dryJumpVy} vy14=${dryMidVy}`);
  ok('N3c 干支对照:空中再跳 mountJump 二段（jumpHold=jumpHeight×2=20）',
    dryReJumpHold === 20 && dryReJumpVy < 0, `hold=${dryReJumpHold} vy=${dryReJumpVy}`);
  // 湿支主测:水池（6 深）+池底首跳+空中再按
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
  p.inputJump = true; step(); p.inputJump = false; step();
  const wetJumpVy = p.vy;
  for (let i = 0; i < 14; i++) step();
  const wetMidVy = p.vy;
  p.inputJump = true; step();
  const wetReJumpHold = p.jumpHold;
  const wetReJumpVy = p.vy;
  p.inputJump = false;
  res.steps.push(`INFO N3d 湿=${wetBefore} 池底首跳 vy=${wetJumpVy} 14 拍后 vy=${wetMidVy} 空中再按 hold=${wetReJumpHold} vy=${wetReJumpVy}`);
  ok('N3e ★湿支空中再跳无响应（vanilla outer gate canJumpAgain_Unicorn 放行=二段跳;SW 湿支无 mountJump 分支=发现坐实）',
    wetBefore && wetJumpVy < 0 && wetMidVy !== 0 && wetReJumpHold === 0, `wet=${wetBefore} hold=${wetReJumpHold}`);
  // ---- N4 CCed 悬停让位独立复证（G16 债①,mount 61）----
  for (let dx = -9; dx <= 9; dx++) for (let y = wTop; y < wFloor; y++) st.setLiquid(ptx + dx, y, 0, 0);
  forceDismount();
  mkPlatform(ptx, pty);
  placeOn(ptx, pty);
  p.hp = 500; p.maxHp = 500; p.dead = false;
  clearInputs();
  for (let i = 0; i < 10; i++) step();
  ok('N4a 召唤仙灵 61（物品通道 5662）', await summonAndRelease(5662) && p.mount?.type === 61, `type=${p.mount?.type}`);
  // 升空悬停:↑ 起飞+爬升 60 拍（抬高冻结带离地,免落地截断）
  p.inputUp = true;
  for (let i = 0; i < 60; i++) step();
  p.inputUp = false;
  for (let i = 0; i < 20; i++) step();
  const hoverVy = +p.vy.toFixed(4), hoverY = p.y;
  res.steps.push(`INFO N4b 悬停稳态 vy=${hoverVy} y=${+hoverY.toFixed(1)}(平台顶=${pty * 16}) fs=${p.mount?.frameState}`);
  // 冻结 10 拍纯重力带（G16 判例:悬停对冲判别阈;0.4/t 累积）
  p.buffs.apply(BuffType.Frozen, 300);
  const vyFrozen = [];
  for (let i = 0; i < 10; i++) { step(); vyFrozen.push(+p.vy.toFixed(2)); }
  res.steps.push(`INFO N4c 冻结拍 cced=${p.cced} vy=${vyFrozen.join(',')} stillRiding=${p.ridingMount}`);
  ok('N4d 冻结中 vy 纯重力累积（≥2.0 持续;静悬浮 ≈-0.001 = G16 修复失效）',
    vyFrozen.length === 10 && vyFrozen[4] >= 2.0 && vyFrozen[6] >= 2.0, `seq=${vyFrozen.join(',')}`);
  ok('N4e 冻结中拒下坐仍骑乘（DONT_DISMOUNT_WHEN_CCED 61）', p.ridingMount && p.mount?.type === 61, `riding=${p.ridingMount}`);

  // ---- N5 QuickMount FailedCCed 静默（G17 件1）----
  toasts.length = 0; dusts.length = 0;
  pressR(); pressR(); pressR();
  ok('N5a 冰冻 R×3:仍骑乘（FailedCCed 静默）', p.ridingMount && p.mount?.type === 61, `riding=${p.ridingMount}`);
  ok('N5b 冰冻 R×3:零 toast 零尘', toasts.length === 0 && dusts.length === 0, `toasts=${toasts.length} dusts=${dusts.length}`);
  p.buffs.remove(BuffType.Frozen);
  step();
  const dg = { cced: p.cced, dead: p.dead, hp: p.hp, box: `${p.w}x${p.h}`, pos: `${+p.x.toFixed(0)},${+p.y.toFixed(0)}`, feetRow: Math.floor((p.y + p.h) / 16), res: p.mount?.canDismountWithResult?.(p) };
  dusts.length = 0;
  pressR();
  res.steps.push(`INFO N5c 解冻诊断 ${JSON.stringify(dg)} dusts=${dusts.length}`);
  ok('N5c 解冻后 R:一次下坐+出生尘', !p.ridingMount && dusts.length > 0, `riding=${p.ridingMount} dusts=${dusts.length}`);
  return res;
});
console.log(out.steps.join('\n'));
if (out.summonDiag) console.log('SUMMON DIAG:', JSON.stringify(out.summonDiag));
console.log(errs.length ? `PAGE ERRORS: ${errs.join(' | ')}` : 'NO PAGE ERRORS');
await browser.close();
