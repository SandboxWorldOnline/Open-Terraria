// ★BJ699 复现探针:角色跳跃动画仍站立态——采样跳帧期 vy/onGround/playerFrameRows。
import { launchBrowser, openPage, bootstrap, createGame, pump, ledger, freezeClock } from '../tools/probe/lib/index.mjs';

const ORIGIN = process.env.SW_ORIGIN || 'http://localhost:5206';
const L = ledger();
const browser = await launchBrowser({});
const page = await openPage(browser, {});
await bootstrap(page, ORIGIN + '/');
const gen = await createGame(page, { mode: 'direct', seed: '05162020', size: 'small' });
L.chk('世界就绪', gen.ok, JSON.stringify(gen).slice(0, 80));
await freezeClock(page, { tod: 0.345 });
await pump(page, 30);

const out = await page.evaluate(async () => {
  const g = window.__swGame;
  const p = g.player;
  p.debugGod = true;
  // 空旷走廊:清出生点上空 6×12
  const st = g.world.store;
  const px0 = Math.floor(p.cx / 16), py0 = Math.floor(p.cy / 16);
  for (let dx = -4; dx <= 4; dx++) for (let dy = -14; dy <= 0; dy++) {
    if (st.inBounds(px0 + dx, py0 + dy)) st.setTileSilent?.(px0 + dx, py0 + dy, 0);
  }
  const r = g.renderer;
  const samples = [];
  let jumped = false;
  // 跳跃输入走 Input 虚拟 action 通道（Game.ts:10397 每拍用 inp.downAction 重写
  // player.inputJump——直接写 p.inputJump 会被输入合成拍覆盖,探针首版即此坑）
  const jumpKey = (on) => { g.input.setVirtualAction('Jump', on); };
  for (let t = 0; t < 90; t++) {
    if (t === 5) { jumpKey(true); jumped = true; }
    if (t === 20) jumpKey(false);   // 松键（长按会撑满 jumpHold 后自然衰减,20t 松开）
    g.fixedUpdate(1 / 60);
    if (jumped && t % 3 === 0) {
      const rows = r.playerFrameRows
        ? r.playerFrameRows(p, null, 0, null, null, p.inv.armor?.[2] ?? 0)
        : { body: -1, legs: -1 };
      samples.push({
        t, vy: Math.round(p.vy * 10) / 10, onGround: p.onGround,
        body: rows.body, legs: rows.legs,
        vyRaw: p.vy,
      });
    }
  }
  return { samples, misc: { inputJumpAfter: p.inputJump } };
}, {});
console.log('\n跳跃期采样（t=5 起跳,inputJump 单拍）:');
for (const s of out.samples) console.log(`  t=${s.t} vy=${s.vy} onGround=${s.onGround} 行=(${s.body},${s.legs})`);
const midAir = out.samples.filter((s) => !s.onGround);
L.chk('空中期有采样', midAir.length > 3, `n=${midAir.length}`);
const jumpRows = new Set(midAir.map((s) => `${s.body},${s.legs}`));
console.log(`  空中行集合: ${[...jumpRows].join(' | ')}`);
L.chk('空中行=5,5（跳跃行;0,0=站立恰红）', midAir.every((s) => s.body === 5 && s.legs === 5),
  JSON.stringify([...jumpRows]));

await browser.close();
L.print();
process.exit(L.exitCode());
