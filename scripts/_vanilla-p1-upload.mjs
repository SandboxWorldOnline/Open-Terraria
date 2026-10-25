// P1-B 上报闭环验证（2026-10-25）：浏览器玩家引擎 API 挖格 → netReporter → msg17 →
// 服务器受理+中继 → Node 在场客户端收到 msg17（+msg21 掉落物）= 服务器侧真实落地。
import puppeteer from 'puppeteer-core';
import net from 'node:net';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-upload.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node 听众客户端：加入并保持在线,记录收到的 msg17/21 载荷
function nodeListener(name) {
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
    let slot = 0, spawn = [2105, 231], sentSpawn = false, joined = false;
    const events = [];
    const hist = {};
    const done = () => resolve({ events, sock, hist });
    const sock = net.connect({ port: 7781, host: '127.0.0.1' }, () => {
      sock.write(frame(1, new W().str('Terraria326')));
    });
    let acc = Buffer.alloc(0);
    const timer = setTimeout(done, 13000); // 13s 固定窗口（race 由外层控制改为直取）
    sock.on('data', (d) => {
      acc = Buffer.concat([acc, d]);
      while (acc.length >= 2) {
        const len = acc.readUInt16LE(0);
        if (len < 3 || acc.length < len) break;
        const id = acc[2];
        const p = acc.subarray(3, len);
        acc = acc.subarray(len);
        if (joined) hist[id] = (hist[id] || 0) + 1;
        if (id === 3) {
          slot = p[0];
          const pk = [];
          pk.push(frame(4, new W().u8(slot).u8(0).u8(0).f32(0).u8(0).str(name).u8(0).u16(0).u8(0)
            .u8(28).u8(222).u8(255).u8(255).u8(191).u8(143).u8(113).u8(60).u8(37).u8(175).u8(105).u8(47).u8(160).u8(110).u8(80).u8(40).u8(86).u8(120).u8(120).u8(90).u8(60).u8(0).u8(0).u8(0)));
          pk.push(frame(68, new W().str('00000000-0000-4000-8000-00000000000d')));
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
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sock.write(frame(159, new W().i16(10 + dx).i16(1 + dy))); // 3×3 段（真实客户端同款覆盖）
          log('听众已加入(129)+请求段');
        } else if (joined && (id === 17 || id === 21 || id === 5 || id === 27)) {
          events.push({ id, hex: Array.from(p.subarray(0, 14)).map((b) => b.toString(16).padStart(2, '0')).join(' ') });
          if (id === 5 && events.filter((e) => e.id === 5 && !e.hex.split(' ').slice(0, 5).every((h, i) => h === (['00','00','00','00','00'][i]))).length >= 3) { clearTimeout(timer); done(); }
          if (events.length >= 200) { clearTimeout(timer); done(); }
        }
      }
    });
    sock.on('error', (e) => { log('node-err ' + e.message); clearTimeout(timer); done(); });
  });
}

// ---- 浏览器玩家（面板流,同 verify 探针） ----
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-up-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGE-EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/', { waitUntil: 'domcontentloaded' });
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
  if (inp) { inp.value = '挖掘者甲'; inp.dispatchEvent(new Event('input', { bubbles: true })); }
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
await sleep(6000);
{
  const wb = await page.evaluate(() => {
    const btn = document.getElementById('sw-welcome-announce')?.querySelector('button');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (wb) { await page.mouse.click(wb.x, wb.y); await sleep(1500); }
}
// 听众进场
const listener = nodeListener('听众乙');
await sleep(4000);
// 生成一支箭（走引擎弹幕批处理器 → sendProjectileBatch → msg27）
const shot = await page.evaluate(async () => {
  const g = globalThis.__swGame;
  // 仪表:批处理器调用探针
  globalThis.__pb = [];
  const ob = g['netProjBroadcast'].bind(g);
  g['netProjBroadcast'] = () => { try { return ob(); } catch (e) { globalThis.__pb.push('THROW:' + String(e).slice(0, 120)); } };
  const oc = g['netChestPoll']?.bind(g);
  if (oc) g['netChestPoll'] = () => { try { return oc(); } catch (e) { globalThis.__pb.push('CHEST-THROW:' + String(e).slice(0, 120)); } };
  const orig = g.net.sendProjectileBatch.bind(g.net);
  g.net.sendProjectileBatch = (sn) => { globalThis.__pb.push('batch' + sn.length); return orig(sn); };
  const { Arrow } = await import('/src/entities/Arrow.ts');
  const a = new Arrow(g.player.x, g.player.y - 320, 6, 0, 15, 0, 1); // 树冠上方 20 格开阔天空平飞:无可撞物,活满 TTL 过多个扫描窗
  g.entities.add(a, 'projectiles');
  return 'arrow spawned';
});
log(shot);
// 本地起始包检查 + 等听众收装备中继
const kit = await page.evaluate(() => {
  const g = globalThis.__swGame;
  return {
    inv0to3: g.player.inv.slots.slice(0, 4).map((s) => s ? { id: s.id, vid: (globalThis.constructor, s.id), stack: s.stack } : null),
  };
});
log('本地起始包: ' + JSON.stringify(kit));
await sleep(2500);
const st = await page.evaluate(() => {
  const g = globalThis.__swGame;
  const list = g.entities.projectiles;
  return {
    n: list.length,
    items: list.slice(0, 8).map((e) => ({
      cls: e.constructor.name, dead: e.dead, puppet: !!e.netPuppet,
      x: Math.round(e.x), vx: Math.round(e.vx), dmg: e.damage, projId: e.projId,
    })),
  };
});
log('弹幕列表: ' + JSON.stringify(st));
const ourSlot = await page.evaluate(() => globalThis.__swGame.net.mySlot);
const result = await listener;
log('我方槽位: ' + ourSlot);
const itemEvts = result.events.filter((e) => e.id === 5);
log('msg27 全量: ' + JSON.stringify(result.events.filter((e) => e.id === 27).map((e) => { const b = e.hex.split(' ').map((h) => parseInt(h, 16)); const key = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24); return { key: '0x' + key.toString(16), spawner: key & 0xff, x: b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24) }; })));
log('批处理调用: ' + JSON.stringify(await page.evaluate(() => (globalThis.__pb ?? []).slice(0, 6))));
log('听众 msg5 数: ' + itemEvts.length);
// 解析 vid 非空的条目（[u8 plr][i16 slotId LE][i16 stack][u8 prefix][i16 vid][u8 bits]）
const nonEmpty = itemEvts.map((e) => {
  const b = e.hex.split(' ').map((h) => parseInt(h, 16));
  const vid = b[6] | (b[7] << 8);
  const stack = b[3] | (b[4] << 8);
  return { vid, stack };
}).filter((x) => x.vid !== 0);
log('非空物品条目: ' + JSON.stringify(nonEmpty));
const mine = result.events.filter((e) => e.id === 27 && (() => { const b = e.hex.split(' ').map((h) => parseInt(h, 16)); const key = b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24); return (key & 0xff) === ourSlot; })());
log('听众直方图: ' + JSON.stringify(result.hist));
log('我方键 msg27 数: ' + mine.length);
log(mine.length >= 1 ? '★PROJ-PASS（自家弹幕上传→服务器中继）' : '✗PROJ-FAIL');
try { result.sock?.destroy(); } catch { /* noop */ }
await browser.close();
process.exit(mine.length >= 1 ? 0 : 1);
