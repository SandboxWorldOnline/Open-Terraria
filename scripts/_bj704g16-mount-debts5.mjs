// ★BJ704-G16 实跑探针：坐骑域六件第五刀（物品通道召唤 + g.paused 手动逐拍,G13/G15 范式）。
//  P1 债① 干支:蝙蝠 56（物品 5597）悬停稳定→冻结→平重力下坠（旧=hover 静悬浮）;拒下坐保持
//  P2 债① 湿支:仙灵 61（物品 5662）封闭液池悬停→冻结→湿档平重力下坠（旧湿链 hover 照跑）
//  P3 债⑥ 沙暴瓶 857:瓶跳上升段横移帽 ×2（maxVx>4）;转向门锁（facing 持 1）;顶点后解锁
//  ★夹具判例（G15 沉淀沿用）:①__swItems[key] 即内部 id;②自带平台（裸地表下方可能是洞）;
//    ③封闭盆（开边水池侧漏）;④段间保持原位/清场复原。
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
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[g16]')) console.log(t); });
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
  p.maxHp = 500; p.hp = 500;
  const { BuffType } = await import('/src/stats/Buffs.ts');
  const ptx = Math.floor(p.cx / 16), pty = Math.floor((p.y + p.h) / 16);

  console.log('[g16] P1 enter');
  // ---- P1 债① 干支:蝙蝠 56 冻结下坠（自带平台+净空竖井） ----
  g.paused = false;                                    // ★G15 范式:物品通道召唤须真实 tick
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  ok('P1a 蝙蝠 5597 物品通道召唤', await summonAndRelease(5597), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  // 竖井:ptx-4..ptx+4 净空 rows pty-16..pty+2,底平台 pty+3/+4（冻结坠 8 拍 ~13px 不触底）
  for (let x = ptx - 4; x <= ptx + 4; x++) for (let y = pty - 16; y <= pty + 2; y++) st.setTile(x, y, 0);
  for (let x = ptx - 4; x <= ptx + 4; x++) { st.setTile(x, pty + 3, 1, 0, 0); st.setTile(x, pty + 4, 1, 0, 0); }
  p.x = ptx * 16; p.y = (pty - 10) * 16; p.vx = 0; p.vy = 0; p.onGround = false;
  let hovered = false;
  for (let i = 0; i < 150; i++) {
    step();
    if (p.mount.frameState === 2 && Math.abs(p.vy) < 0.01) { hovered = true; break; }
  }
  res.p1conv = { hovered, vy: +p.vy.toFixed(4), fs: p.mount.frameState };
  ok('P1b 蝙蝠悬停收敛（-0.001 静置带）', hovered, `vy=${p.vy.toFixed(4)} fs=${p.mount.frameState}`);
  p.buffs.apply(BuffType.Frozen, 10);
  for (let i = 0; i < 8; i++) step();
  res.p1 = { vy: +p.vy.toFixed(3), riding: p.ridingMount, hp: p.hp };
  ok('P1c ★冻结平重力下坠 vy≥3.0（0.4×8=3.2;旧=hover 静悬浮 -0.001;门撤变异值 ~1.8）',
    p.vy >= 3.0 && p.vy <= 3.4, `vy=${p.vy.toFixed(3)}`);
  ok('P1d 拒下坐保持（DONT_DISMOUNT_WHEN_CCED）', p.ridingMount === true && p.mount.active === true,
    `riding=${p.ridingMount} active=${p.mount.active}`);
  p.buffs.remove(BuffType.Frozen);
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();
  for (let x = ptx - 4; x <= ptx + 4; x++) for (let y = pty - 16; y <= pty + 2; y++) st.setTile(x, y, 0);

  console.log('[g16] P2 enter');
  // ---- P2 债① 湿支:仙灵 61 封闭液池冻结下坠 ----
  g.paused = false;                                    // ★同 P1:召唤须真实 tick
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  ok('P2a 仙灵 5662 物品通道召唤', await summonAndRelease(5662), `type=${p.mount.type}`);
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  // 封闭盆（G15 判例:全宽底板+双侧壁;真清=setLiquid 0）
  const floorTy = pty + 25, topTy = pty - 8;
  for (let dx = -5; dx <= 12; dx++) {
    for (let y = topTy; y < floorTy; y++) st.setTile(ptx + dx, y, 0);
    st.setTile(ptx + dx, floorTy, 1, 0, 0);
    for (let y = topTy; y < floorTy; y++) st.setLiquid(ptx + dx, y, 200, 0);
  }
  for (let y = topTy; y <= floorTy; y++) { st.setTile(ptx - 6, y, 1, 0, 0); st.setTile(ptx + 13, y, 1, 0, 0); }
  p.x = (ptx + 3) * 16; p.y = (topTy + 8) * 16; p.vx = 0; p.vy = 0; p.onGround = false;
  let wetHovered = false;
  for (let i = 0; i < 250; i++) {
    step();
    if (p.inWater && p.mount.frameState === 2 && Math.abs(p.vy) < 0.05) { wetHovered = true; break; }
  }
  res.p2conv = { wetHovered, vy: +p.vy.toFixed(4), fs: p.mount.frameState, wet: p.inWater };
  ok('P2b 仙菲水中悬停收敛（61 强切后帧态 2;悬停门 2/3/4 含 2）', wetHovered,
    `vy=${p.vy.toFixed(4)} fs=${p.mount.frameState} wet=${p.inWater}`);
  p.buffs.apply(BuffType.Frozen, 10);
  for (let i = 0; i < 10; i++) step();
  res.p2 = { vy: +p.vy.toFixed(3), riding: p.ridingMount, row: +(p.y / 16).toFixed(1) };
  ok('P2c ★湿档冻结平重力下坠 vy>0.3（lGrav 0.2×num6;旧=hover -0.001）', p.vy > 0.3, `vy=${p.vy.toFixed(3)}`);
  ok('P2d 拒下坐保持', p.ridingMount === true, `riding=${p.ridingMount}`);
  p.buffs.remove(BuffType.Frozen);
  p.mount.dismount?.(p, g);
  for (let i = 0; i < 2; i++) step();
  for (let dx = -5; dx <= 12; dx++) for (let y = topTy; y < floorTy; y++) st.setLiquid(ptx + dx, y, 0, 0);
  for (let y = topTy; y <= floorTy; y++) { st.setTile(ptx - 6, y, 0); st.setTile(ptx + 13, y, 0); }

  console.log('[g16] P3 enter');
  // ---- P3 债⑥ 沙暴瓶:上升段横移帽+转向门（安全平台域:ptx-16..ptx-8,P2 盆外） ----
  g.paused = true;
  p.inputJump = false; p.inputDown = false; p.inputUp = false; p.inputX = 0;
  const sx = ptx - 12;
  // ★宽平台（ptx-30..ptx+30）:沙暴跳上升段漂移 ~25-34 格（帽 6×上升 ~60-90 拍）,
  //   9 格窄板=跑飞裸地表（G15 判例②:下方可能是洞）;顶点清 inputX 垂直回落
  for (let x = ptx - 30; x <= ptx + 30; x++) for (let y = pty - 14; y <= pty; y++) st.setTile(x, y, 0);
  for (let x = ptx - 30; x <= ptx + 30; x++) { st.setTile(x, pty + 1, 1, 0, 0); st.setTile(x, pty + 2, 1, 0, 0); }
  const key857 = Object.keys(items).find(k => k.startsWith('vi_857_'));
  inv.armor[4] = { id: items[key857], stack: 1 };          // 沙暴瓶（__swItems[key]=id 本体）
  p.x = sx * 16; p.y = (pty + 1) * 16 - p.h; p.vx = 0; p.vy = 0; p.onGround = false;
  for (let i = 0; i < 6; i++) step();
  ok('P3a 平台立足+瓶 charge 在身', p.onGround === true && p.extraJumps.length === 1,
    `og=${p.onGround} ej=${p.extraJumps.length} opts=${JSON.stringify(p.equipStats.jumpOpts)}`);
  p.inputJump = true; p.jumpEdgePrev = false;              // 首跳
  step();
  p.inputJump = false;
  for (let i = 0; i < 40; i++) { step(); if (p.jumpHold === 0) break; }
  p.inputJump = true; p.jumpEdgePrev = false;              // 空中瓶跳沿（沙暴）
  step();
  res.p3jump = { pj: p.performingJump, ej: p.extraJumps.length, vy: +p.vy.toFixed(3) };
  ok('P3b 沙暴瓶跳成立（performingJump=Sandstorm）', p.performingJump === 'Sandstorm',
    `pj=${p.performingJump} vy=${p.vy.toFixed(3)}`);
  p.facing = 1;
  p.inputX = 1;                                             // 上升段持 →（加速窗口开）
  let maxVx = 0;
  for (let t = 0; t < 200; t++) {
    step();
    maxVx = Math.max(maxVx, p.vx);
    if (p.vy >= 0 || p.onGround) break;
  }
  p.inputX = 0;                                          // ★顶点清 →（垂直回落本平台,勿跑飞）
  res.p3run = { maxVx: +maxVx.toFixed(3), vy: +p.vy.toFixed(3) };
  ok('P3c ★上升段横移帽 ×2（maxVx>4;旧帽 ~3.04）', maxVx > 4, `maxVx=${maxVx.toFixed(3)}`);
  ok('P3c2 帽上界（<7,×2+过冲 ~6.1）', maxVx < 7, `maxVx=${maxVx.toFixed(3)}`);
  // 转向门:落地重置→再跳一轮,上升段按反向
  for (let i = 0; i < 300; i++) { step(); if (p.onGround) break; }
  p.inputX = 0; p.inputJump = false;
  for (let i = 0; i < 3; i++) step();
  ok('P3d 重置立足+瓶回充', p.onGround === true && p.extraJumps.length === 1, `og=${p.onGround} ej=${p.extraJumps.length}`);
  p.facing = 1;
  p.inputJump = true; p.jumpEdgePrev = false;
  step();
  p.inputJump = false;
  for (let i = 0; i < 40; i++) { step(); if (p.jumpHold === 0) break; }
  p.inputJump = true; p.jumpEdgePrev = false;
  step();
  p.inputX = -1;                                            // 上升段按反向（facing 应锁 1）
  for (let i = 0; i < 12; i++) step();
  res.p3face = { facing: p.facing, vy: +p.vy.toFixed(3), pj: p.performingJump };
  ok('P3e ★上升段转向门锁（facing=1 持;:19965 !sandStorm;旧=翻 -1）',
    p.facing === 1 && p.vy < 0, `facing=${p.facing} vy=${p.vy.toFixed(3)}`);
  for (let t = 0; t < 200; t++) { step(); if (p.vy >= 0) break; }
  step();
  res.p3face2 = { facing: p.facing, vy: +p.vy.toFixed(3) };
  ok('P3f 顶点后解锁（facing 翻 -1）', p.facing === -1, `facing=${p.facing}`);
  p.inputX = 0; p.inputJump = false;
  inv.armor[4] = null;
  return res;
});
const fails = out.steps.filter((s) => s.startsWith('FAIL'));
console.log(`[g16] RESULT: ${out.steps.length - fails.length}/${out.steps.length} PASS`);
for (const f of fails) console.log('[g16] ' + f);
if (errs.length) console.log('[g16] PAGE ERRORS:', errs.slice(0, 5));
await browser.close();
process.exit(fails.length || errs.length ? 1 : 0);
