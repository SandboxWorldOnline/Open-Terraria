// ★BJ704-G20 N2 诊断探针:骑 49 岩浆免伤活体面 hp=100 异常溯源
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
  p.maxHp = 500; p.hp = 500;
  const ptx = Math.floor(p.cx / 16), pty = Math.floor((p.y + p.h) / 16);
  const mkPlatform = (cx, row) => {
    for (let dx = -12; dx <= 12; dx++) {
      st.setTile(cx + dx, row, 1, 0, 0);
      for (let dy = 1; dy <= 4; dy++) st.setTile(cx + dx, row + dy, 1, 0, 0);
      for (let dy = -10; dy <= -1; dy++) st.setTile(cx + dx, row + dy, 0, 0, 0);
    }
  };
  const placeOn = (cx, row) => { p.x = (cx + 0.5) * 16 - p.w / 2; p.y = row * 16 - p.h; p.vx = 0; p.vy = 0; p.onGround = true; };
  mkPlatform(ptx, pty);
  placeOn(ptx, pty);
  clearInputs();
  for (let i = 0; i < 10; i++) step();
  const summoned = await summonAndRelease(4828);
  res.steps.push(`summoned=${summoned} type=${p.mount?.type} hpAfterSummon=${p.hp} maxHp=${p.maxHp}`);
  const lTop = pty, lFloor = pty + 7;
  for (let dx = -9; dx <= 9; dx++) {
    st.setTile(ptx + dx, lFloor, 1, 0, 0);
    for (let y = lTop; y < lFloor; y++) st.setLiquid(ptx + dx, y, 200, 2);
  }
  for (let y = lTop; y < lFloor; y++) { st.setTile(ptx - 10, y, 1, 0, 0); st.setTile(ptx + 10, y, 1, 0, 0); }
  placeOn(ptx, lFloor - 1); p.onGround = false;
  p.hp = 500; p.lavaImmuneTicks = 0;
  // 直接观测免疫表达式分量
  res.steps.push(`pre: mount.buff=${p.mount?.buff} riding=${p.ridingMount} obsidianSkin=${p.buffs?.obsidianSkin} modLavaImmune=${p.modLavaImmune}`);
  // 包裹伤害漏斗计数
  const dmgCalls = [];
  const origDmg = g.damagePlayer.bind(g);
  g.damagePlayer = (...a) => { dmgCalls.push({ t: dmgCalls.length, dmg: a[0], src: a[1] !== undefined ? 'has-src' : '?', stack: new Error().stack?.split('\n').slice(1, 4).join(' | ') }); return origDmg(...a); };
  const hpSeq = [];
  for (let i = 0; i < 90; i++) {
    step();
    if (i < 6 || i % 15 === 0 || p.hp !== hpSeq[hpSeq.length - 1]?.hp) hpSeq.push({ i, hp: p.hp, dead: p.dead, riding: p.ridingMount, inLava: p.inLava, onFire: p.buffs?.list?.filter?.(b => b.type === 24)?.length ?? 'n/a' });
    if (p.dead) break;
  }
  g.damagePlayer = origDmg;
  res.steps.push(`dmgCalls=${dmgCalls.length} first=${JSON.stringify(dmgCalls[0] ?? null)}`);
  res.hpSeq = hpSeq.slice(0, 14);
  return res;
});
console.log(out.steps.join('\n'));
console.log('HP SEQ:', JSON.stringify(out.hpSeq));
console.log(errs.length ? `PAGE ERRORS: ${errs.join(' | ')}` : 'NO PAGE ERRORS');
await browser.close();
