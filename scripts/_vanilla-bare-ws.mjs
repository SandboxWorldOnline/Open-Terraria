// 终极最小复现：裸 WS + 手写 Hello/上传（不经 VanillaClient/parser/任何游戏代码）。
// 若停在同一点（msg49 后服务器响应批不派发）→ Chrome×ws库桥 的传输层问题;
// 若走通 → 我们 JS 层问题。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-bare-ws.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-bare-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 800, height: 600 },
});
const page = await browser.newPage();
page.on('console', (m) => log(`C ${m.text().slice(0, 140)}`));
page.on('pageerror', (e) => log(`EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/vanilla-iso.html', { waitUntil: 'domcontentloaded' });

const started = await page.evaluate(async () => {
  await import('/src/net/vanilla/VanillaClient.ts'); // ★移植变量:仅加载巨型模块图,不用

  const enc = new TextEncoder();
  const str = (s) => { const e = enc.encode(s); const o = new Uint8Array(e.length + 1); o[0] = e.length; o.set(e, 1); return o; };
  const frame = (id, ...parts) => {
    const body = new Uint8Array(1 + parts.reduce((a, p) => a + p.length, 0));
    body[0] = id; let off = 1;
    for (const p of parts) { body.set(p, off); off += p.length; }
    const out = new Uint8Array(body.length + 2);
    new DataView(out.buffer).setUint16(0, out.length, true);
    out.set(body, 2);
    return out;
  };
  const i16 = (v) => { const o = new Uint8Array(2); new DataView(o.buffer).setInt16(0, v, true); return o; };
  const i32 = (v) => { const o = new Uint8Array(4); new DataView(o.buffer).setInt32(0, v, true); return o; };
  const f32 = () => new Uint8Array(4);
  const ws = new WebSocket('ws://127.0.0.1:5290/?host=127.0.0.1&port=7781');
  ws.binaryType = 'arraybuffer';
  let slot = 0, spawned = false;
  const state = { msgs: 0, last: 0, spawned: false, done129: false };
  globalThis.__bare = state;
  ws.onopen = () => {
    console.log('bare: open → Hello');
    ws.send(frame(1, str('Terraria326')));
  };
  ws.onmessage = (e) => {
    const chunk = new Uint8Array(e.data);
    console.info('m ' + chunk.length);
    // 裸流拼帧
    if (!globalThis.__acc) globalThis.__acc = new Uint8Array(0);
    const prev = globalThis.__acc;
    const acc = new Uint8Array(prev.length + chunk.length);
    acc.set(prev); acc.set(chunk, prev.length);
    globalThis.__acc = acc;
    for (;;) {
      const a = globalThis.__acc;
      if (a.length < 2) break;
      const len = a[0] | (a[1] << 8);
      if (a.length < len) break;
      const id = a[2];
      state.msgs++; state.last = id;
      if (id === 3) {
        slot = a[3];
        console.log('bare: msg3 slot=' + slot + ' → 上传');
        const empty5 = (sid) => frame(5, new Uint8Array([slot]), i16(sid), i16(0), new Uint8Array([0]), i16(0), new Uint8Array([0]));
        // msg4 最小 + 68/16/42/50/147 + 5×350 + 6
        const pk = [];
        pk.push(frame(4, new Uint8Array([slot, 0, 0]), f32(), new Uint8Array([0]), str('玩家'), new Uint8Array([0, 0, 0]), new Uint8Array(21), new Uint8Array([0, 0, 0])));
        pk.push(frame(68, str(crypto.randomUUID())));
        pk.push(frame(16, new Uint8Array([slot]), i16(100), i16(100)));
        pk.push(frame(42, new Uint8Array([slot]), i16(20), i16(20)));
        pk.push(frame(50, new Uint8Array([slot]), i16(0)));
        pk.push(frame(147, new Uint8Array([slot, 0]), i16(0)));
        for (let i = 0; i < 59; i++) pk.push(empty5(i));
        const ranges = [[59, 20], [79, 10], [89, 5], [94, 5], [99, 40], [299, 40], [499, 1], [500, 40], [700, 40], [900, 20], [920, 10], [930, 20], [950, 10], [960, 20], [980, 10]];
        for (const [st, n] of ranges) for (let i = 0; i < n; i++) pk.push(empty5(st + i));
        pk.push(frame(6));
        for (const p of pk) ws.send(p);
        console.log('bare: 上传 ' + pk.length + ' 帧完成');
      } else if (id === 7 && !spawned) {
        spawned = true;
        // 读出生点（字段序跳到 spawnX/Y：time i32+bits u8+moon u8+4×i16）
        const dv = new DataView(a.buffer, a.byteOffset);
        const sx = dv.getInt16(3 + 4 + 1 + 1 + 4, true), sy = dv.getInt16(3 + 4 + 1 + 1 + 6, true);
        console.log('bare: msg7 spawn=(' + sx + ',' + sy + ') → msg8');
        ws.send(frame(8, i32(sx), i32(sy), new Uint8Array([0])));
      } else if (id === 49 && !state.spawned) {
        state.spawned = true;
        console.log('bare: msg49 → 回 msg12');
        // 出生点从 msg7 缓存——重读太麻烦,直接用已知 sw-rig 出生(2105,231)——读 __lastSpawn
        const s = globalThis.__lastSpawn ?? [2105, 231];
        ws.send(frame(12, new Uint8Array([slot]), i16(s[0]), i16(s[1]), i32(0), i16(0), i16(0), new Uint8Array([0, 1])));
      } else if (id === 7 && spawned && !globalThis.__lastSpawn) {
        const dv = new DataView(a.buffer, a.byteOffset);
        globalThis.__lastSpawn = [dv.getInt16(3 + 4 + 1 + 1 + 4, true), dv.getInt16(3 + 4 + 1 + 1 + 6, true)];
      } else if (id === 129) {
        state.done129 = true;
        console.log('bare: ★129 到达！');
      }
      globalThis.__acc = a.subarray(len);
    }
  };
  ws.onclose = (ev) => console.log('bare: close ' + ev.code);
  // msg7 spawn 缓存（首个 7）
  const origOnMessage = ws.onmessage;
  return 'ok';
}).catch((e) => 'err ' + e.message);
log('start: ' + started);

for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = await page.evaluate(() => globalThis.__bare).catch((e) => ({ err: String(e) }));
  log(`t+${i * 2}s ${JSON.stringify(st)}`);
  if (st?.done129) { log('★BARE-PASS:Chrome×桥传输层通,问题在 VanillaClient JS 层'); await browser.close(); process.exit(0); }
}
log('✗BARE-FAIL:裸 WS 同样停在 msg49 批 → Chrome×ws库桥传输层问题');
await browser.close();
process.exit(1);
