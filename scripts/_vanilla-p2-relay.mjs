// P2 弹幕中继角色互换测试（2026-10-25）：Node 客户端（手工全帧）射 msg27 箭 →
// 浏览器观察（其 msg27 接收面已证）。浏览器看到=中继通/我方帧有恙;看不到=中继断。
import puppeteer from 'puppeteer-core';
import net from 'node:net';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-relay.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node 射手：加入→请求段→心跳→射一箭（msg27 手工帧）
function nodeArcher(name) {
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
    const ARRAYS = [[59, 20], [79, 10], [89, 5], [94, 5], [99, 40], [299, 40], [499, 1], [500, 40], [700, 40], [900, 20], [920, 10], [930, 20], [950, 10], [960, 20], [980, 10]];
    let slot = 0, spawn = [2105, 231], sentSpawn = false, joined = false, shot = 0;
    const done = (msg) => resolve(msg);
    const sock = net.connect({ port: 7781, host: '127.0.0.1' }, () => {
      sock.write(frame(1, new W().str('Terraria326')));
    });
    let acc = Buffer.alloc(0);
    const timer = setTimeout(() => done('archer-timeout(shot=' + shot + ')'), 30000);
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
          pk.push(frame(68, new W().str('00000000-0000-4000-8000-00000000000e')));
          pk.push(frame(16, new W().u8(slot).i16(100).i16(100)));
          pk.push(frame(42, new W().u8(slot).i16(20).i16(20)));
          pk.push(frame(50, new W().u8(slot).u16(0)));
          pk.push(frame(147, new W().u8(slot).u8(0).u16(0)));
          const e5 = (sid) => frame(5, new W().u8(slot).i16(sid).i16(0).u8(0).i16(0).u8(0));
          for (let i = 0; i < 59; i++) pk.push(e5(i));
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
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sock.write(frame(159, new W().i16(10 + dx).i16(1 + dy)));
          sock.write(frame(14, new W().u8(slot).u8(1)));
          const beat = setInterval(() => {
            if (sock.destroyed) { clearInterval(beat); return; }
            sock.write(frame(13, new W().u8(slot).u8(0).u8(0).u8(0).u8(0).u8(0).f32(spawn[0] * 16).f32(spawn[1] * 16)));
          }, 100);
          // 2s 后射箭（键:spawner=slot,index=1 → 非零）,开阔天空平飞
          setTimeout(() => {
            const k1 = (slot & 0xff) | (1 << 8);  // vid 1 普通箭（段门）
            const k2 = (slot & 0xff) | (2 << 8);  // vid 12 flag3（无条件全员中继）
            for (let k = 0; k < 3; k++) {
              sock.write(frame(27, new W().i32(k1).f32(spawn[0] * 16 + 100).f32(spawn[1] * 16 - 320).f32(6).f32(0).i16(1).u8(0x10).i16(15)));
              sock.write(frame(27, new W().i32(k2).f32(spawn[0] * 16 + 100).f32(spawn[1] * 16 - 400).f32(6).f32(0).i16(12).u8(0x10).i16(15)));
            }
            const k3 = (slot & 0xff) | (3 << 8);
            for (let k = 0; k < 3; k++) {
              sock.write(frame(27, new W().i32(k3).f32(100).f32(100).f32(6).f32(0).i16(1).u8(0x10).i16(15))); // 段(0,0) 落点
            }
            shot = 9;
            log(`射手已射 vid1(key=0x${k1.toString(16)})×3 + vid12(key=0x${k2.toString(16)})×3`);
          }, 2000);
          setTimeout(() => { clearInterval(beat); sock.destroy(); done('archer-done(shot=' + shot + ')'); }, 12000);
        }
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); done('archer-err ' + e.message); });
  });
}

// ---- 浏览器观察者（面板流进世界,只观察） ----
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-ry-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/?vdump=obs', { waitUntil: 'domcontentloaded' }); // vdump→桥下行帧账
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
  if (inp) { inp.value = '观察者甲'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
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
log('观察者进世界=' + entered);
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
// 仪表：直方图+键记录
await page.evaluate(() => {
  const g = globalThis.__swGame;
  globalThis.__rhist = {};
  globalThis.__r27 = [];
  const orig = g.net.handle.bind(g.net);
  g.net.handle = (id, p2) => {
    globalThis.__rhist[id] = (globalThis.__rhist[id] || 0) + 1;
    if (id === 27 && globalThis.__r27.length < 12) {
      globalThis.__r27.push(Array.from(p2.slice(0, 12)).map((b) => b.toString(16).padStart(2, '0')).join(' '));
    }
    return orig(id, p2);
  };
});
const before = await page.evaluate(() => (globalThis.__swGame['netProjPuppets'] ?? new Map()).size);
// 射手进场（并行）;观察者同时向右走 3s（msg13 位置变化→段重戳假说）
const archerP = nodeArcher('射手乙');
await page.keyboard.down('KeyD');
const archer = await Promise.race([archerP, sleep(8000).then(() => 'walk-timeout')]);
await page.keyboard.up('KeyD');
log('射手: ' + archer);
await sleep(2000);
const verdict = await page.evaluate(() => ({
  hist: globalThis.__rhist,
  msg27: globalThis.__r27,
  projPuppets: (globalThis.__swGame['netProjPuppets'] ?? new Map()).size,
}));
log('观察者直方图: ' + JSON.stringify(verdict.hist));
log('观察者 msg27: ' + JSON.stringify(verdict.msg27));
log(`弹幕傀儡 ${before} → ${verdict.projPuppets}`);
const got = (verdict.hist['27'] ?? 0) > 0 || verdict.projPuppets > before;
log(got ? '★RELAY-PASS（Node 射箭→浏览器收到 msg27=中继通）' : '✗RELAY-FAIL（中继对谁都断）');
await browser.close();
process.exit(got ? 0 : 1);
