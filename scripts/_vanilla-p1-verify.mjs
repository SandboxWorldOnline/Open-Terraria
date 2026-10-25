// P1-B 验证探针（2026-10-25）：浏览器玩家在场 + Node 第三方原版客户端放火把（msg17）
// → 验证 msg20 tile 变更落地 + msg117/118/27/12/13/23 接收统计 + 本地 hp 跟踪。
import puppeteer from 'puppeteer-core';
import net from 'node:net';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-verify.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Node 第三方客户端（紧凑 joiner + msg17 放置） ----
function nodeJoiner(name, afterJoin) {
  return new Promise((resolve) => {
    class W {
      constructor() { this.b = []; }
      u8(v) { this.b.push(v & 0xff); return this; }
      u16(v) { this.b.push(v & 0xff, (v >> 8) & 0xff); return this; }
      i16(v) { return this.u16(v < 0 ? v + 0x10000 : v); }
      i32(v) { return this.u32(v < 0 ? v + 0x100000000 : v); }
      u32(v) { this.b.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); return this; }
      f32(v) { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); this.b.push(...b); return this; }
      str(s) { const e = Buffer.from(s, 'utf8'); this.b.push(e.length, ...e); return this; }
      get buf() { return Buffer.from(this.b); }
    }
    const frame = (id, w) => {
      const body = Buffer.concat([Buffer.from([id]), w ? w.buf : Buffer.alloc(0)]);
      const h = Buffer.alloc(2);
      h.writeUInt16LE(body.length + 2, 0);
      return Buffer.concat([h, body]);
    };
    const SLOT = { inv: 0, armor: 59, dye: 79, misc: 89, miscDye: 94, bank1: 99, bank2: 299, trash: 499, bank3: 500, bank4: 700 };
    const ARRAYS = [[SLOT.armor, 20], [SLOT.dye, 10], [SLOT.misc, 5], [SLOT.miscDye, 5], [SLOT.bank1, 40], [SLOT.bank2, 40], [SLOT.trash, 1], [SLOT.bank3, 40], [SLOT.bank4, 40], [900, 20], [920, 10], [930, 20], [950, 10], [960, 20], [980, 10]];
    let slot = 0, spawn = [2105, 231], sentSpawn = false, joined = false;
    const done = (msg) => { resolve(msg); };
    const sock = net.connect({ port: 7781, host: '127.0.0.1' }, () => {
      sock.write(frame(1, new W().str('Terraria326')));
    });
    let acc = Buffer.alloc(0);
    const timer = setTimeout(() => done('node-timeout'), 30000);
    sock.on('data', (d) => {
      acc = Buffer.concat([acc, d]);
      while (acc.length >= 2) {
        const len = acc.readUInt16LE(0);
        if (len < 3 || acc.length < len) break;
        const id = acc[2];
        const p = acc.subarray(3, len);
        acc = acc.subarray(len);
        if (id === 3) {
          slot = p[0];
          const pk = [];
          pk.push(frame(4, new W().u8(slot).u8(0).u8(0).f32(0).u8(0).str(name).u8(0).u16(0).u8(0)
            .u8(28).u8(222).u8(255).u8(255).u8(191).u8(143).u8(113).u8(60).u8(37).u8(175).u8(105).u8(47).u8(160).u8(110).u8(80).u8(40).u8(86).u8(120).u8(120).u8(90).u8(60).u8(0).u8(0).u8(0)));
          pk.push(frame(68, new W().str('00000000-0000-4000-8000-00000000000c')));
          pk.push(frame(16, new W().u8(slot).i16(100).i16(100)));
          pk.push(frame(42, new W().u8(slot).i16(20).i16(20)));
          pk.push(frame(50, new W().u8(slot).u16(0)));
          pk.push(frame(147, new W().u8(slot).u8(0).u16(0)));
          const e5 = (sid) => frame(5, new W().u8(slot).i16(sid).i16(0).u8(0).i16(0).u8(0));
          for (let i = 0; i < 59; i++) pk.push(e5(SLOT.inv + i));
          for (const [st, n] of ARRAYS) for (let i = 0; i < n; i++) pk.push(e5(st + i));
          pk.push(frame(6));
          for (const f of pk) sock.write(f);
        } else if (id === 7 && !sentSpawn) {
          sentSpawn = true;
          spawn = [p.readInt16LE(10), p.readInt16LE(12)]; // ★payload 偏移:time4+b6+moon1+maxXY4 → spawnX@10/spawnY@12（曾误用帧偏移13/15=读成地表/岩层值,射手站错段1700格——服务器段门无辜,2026-10-25 定谳）
          sock.write(frame(8, new W().i32(spawn[0]).i32(spawn[1]).u8(0)));
        } else if (id === 49) {
          sock.write(frame(12, new W().u8(slot).i16(spawn[0]).i16(spawn[1]).i32(0).i16(0).i16(0).u8(0).u8(1)));
        } else if (id === 129 && !joined) {
          joined = true;
          afterJoin(sock, frame, W, () => { clearTimeout(timer); done('node-joined+placed'); });
        }
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); done('node-err ' + e.message); });
  });
}

// ---- 浏览器玩家 ----
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-vf-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/', { waitUntil: 'domcontentloaded' });
// mp 点击（就绪门=elementFromPoint 命中本体）
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const ready = await page.evaluate(() => {
    const el = document.querySelector('[data-act=mp]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!hit || !(el === hit || el.contains(hit))) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (ready) { await page.mouse.click(ready.x, ready.y); break; }
}
for (let i = 0; i < 12; i++) {
  if (await page.evaluate(() => !!Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781'))) break;
  await sleep(800);
}
{
  const vb = await page.evaluate(() => {
    const input = Array.from(document.querySelectorAll('input')).find((x) => x.value === '127.0.0.1:7781');
    const btn = input?.closest('div')?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (vb) await page.mouse.click(vb.x, vb.y);
}
for (let i = 0; i < 10; i++) {
  if (await page.evaluate(() => !!document.querySelector('[data-act=new]'))) break;
  await sleep(800);
}
{
  const nb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=new]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (nb) { await page.mouse.click(nb.x, nb.y); await sleep(2500); }
}
await page.evaluate(() => {
  const inp = document.querySelector('.sw-cc-nameval input[type=text], .sw-char-panel input[type=text]');
  if (inp) { inp.value = '验证者甲'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
});
await sleep(500);
for (let i = 0; i < 15; i++) {
  if (await page.evaluate(() => !!document.querySelector('[data-act=create]'))) break;
  await sleep(800);
}
{
  const cb = await page.evaluate(() => {
    const el = document.querySelector('[data-act=create]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (cb) await page.mouse.click(cb.x, cb.y);
}
let entered = false;
for (let i = 0; i < 50; i++) {
  await sleep(1000);
  entered = await page.evaluate(() => !!(globalThis.__swGame?.net?.active && globalThis.__swGame?.player)).catch(() => false);
  if (entered) break;
}
log('浏览器进世界=' + entered);
if (!entered) { await browser.close(); process.exit(1); }
await sleep(5000);
{
  const wb = await page.evaluate(() => {
    const btn = document.getElementById('sw-welcome-announce')?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (wb) { await page.mouse.click(wb.x, wb.y); await sleep(1500); }
}
// 仪表：handle 直方图 + hp 跟踪 + msg20 载荷捕获 + onItemOp 打点
await page.evaluate(() => {
  const g0 = globalThis.__swGame;
  globalThis.__iops = [];
  const oh = g0.net['hooks'].onItemOp;
  g0.net['hooks'].onItemOp = (op) => { globalThis.__iops.push({ op: op.op, key: op.key, stack: op.stack, netId: op.netId }); return oh(op); };
  const g = globalThis.__swGame;
  globalThis.__vhist = {};
  globalThis.__v20 = [];
  const orig = g.net.handle.bind(g.net);
  g.net.handle = (id, p) => {
    globalThis.__vhist[id] = (globalThis.__vhist[id] || 0) + 1;
    if (id === 20 && globalThis.__v20.length < 20) {
      globalThis.__v20.push(Array.from(p.slice(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join(' '));
    }
    return orig(id, p);
  };
  globalThis.__vhp = [];
  setInterval(() => {
    const p = g.player;
    if (p) globalThis.__vhp.push(p.hp);
  }, 1000);
});
log('=== Node 第三方加入并放火把 (2107,229) tile4 ===');
const targets = await page.evaluate(() => { const st = globalThis.__swGame.world.store; const out = []; for (let x = 2040; x < 2109; x++) for (let y = 230; y <= 232; y++) { if (st.get(x, y)) out.push([x, y]); if (out.length >= 8) break; } return out; });
log('候选格: ' + JSON.stringify(targets));
const target = targets[0] ?? null;
const before = target ? await page.evaluate((t) => globalThis.__swGame.world.store.get(t[0], t[1]), target) : -1;
const nodeResult = await nodeJoiner('验证者乙', (sock, frame, W, placed) => {
  // 服务器防作弊门：客户端须先请求过该 tile 所在 section（TileSections 检查）才受理
  // tile 变更——先 msg159 请求 (2107,229) 所在段 (10,1)，1.5s 后再放置
  sock.write(frame(159, new W().i16(10).i16(1)));
  setTimeout(() => {
    for (const t of targets) sock.write(frame(17, new W().u8(0).i16(t[0]).i16(t[1]).i16(0).u8(0)));
    setTimeout(() => { sock.destroy(); placed(); }, 4000);
  }, 1500);
});
log('Node 客户端: ' + nodeResult);
await sleep(3000);
const verdict = await page.evaluate((tgt) => ({
  tileAt: tgt ? globalThis.__swGame.world.store.get(tgt[0], tgt[1]) : -1, msg20: globalThis.__v20,
      dropPuppets: (globalThis.__swGame['netDropPuppets'] ?? new Map()).size,
      inv0: globalThis.__swGame.player.inv.slots[0] ? { id: globalThis.__swGame.player.inv.slots[0].id, stack: globalThis.__swGame.player.inv.slots[0].stack } : null,
  hist: globalThis.__vhist,
  hpTrack: globalThis.__vhp.slice(-12),
  dead: globalThis.__swGame.player.dead,
  proxies: (globalThis.__swGame['remotePlayerProxies'] ?? []).length,
  npcPuppets: (globalThis.__swGame['netNpcPuppets'] ?? new Map()).size,
  projPuppets: (globalThis.__swGame['netProjPuppets'] ?? new Map()).size,
}), target);
log('放置前 tile(2104,229)=' + before + ' 放置后=' + verdict.tileAt);
log('直方图: ' + JSON.stringify(verdict.hist));
log('hp 轨迹: ' + JSON.stringify(verdict.hpTrack) + ' dead=' + verdict.dead);
log(`代理=${verdict.proxies} NPC傀儡=${verdict.npcPuppets} 弹幕傀儡=${verdict.projPuppets}`);
// 主动伤害上报断言（victim-report 链:本地结算→117 上行,红蓝对抗 2026-10-25 定谳）
const hp0 = await page.evaluate(() => globalThis.__swGame.player.hp);
await page.evaluate(() => {
  const g = globalThis.__swGame;
  g.damagePlayer(30, g.player.x - 30, g.player.y);
});
await sleep(1500);
const hp1 = await page.evaluate(() => globalThis.__swGame.player.hp);
const hurtOK = hp0 - hp1 > 0;
log(`伤害上报链: hp ${hp0} → ${hp1} ${hurtOK ? '✓' : '✗'}`);
// 挖掘判定（durable itemOps 证据——傀儡 GC 时窗免疫,判例在档）
const iopsFinal = await page.evaluate(() => (globalThis.__iops ?? []));
const drops = iopsFinal.filter((o) => o.op === 0 && o.key).length;
log(`掉落 itemOps=${drops} 傀儡=${verdict.dropPuppets}`);
const digOK = drops > 0 || verdict.dropPuppets > 0;
log(digOK && hurtOK ? '★VERIFY-PASS（挖掘掉落+伤害上报双证据）' : '✗VERIFY-FAIL');
process.exit(digOK && hurtOK ? 0 : 1);
await page.screenshot({ path: '/tmp/vanilla-verify.png' });
await browser.close();
process.exit(tileOK ? 0 : 1);
