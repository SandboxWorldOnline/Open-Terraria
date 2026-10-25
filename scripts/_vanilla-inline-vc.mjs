// 终极置换：内联 VC——用 vanilla 模块构件（VWriter/VReader/VanillaFrameParser/
// decodeVanillaSection/TileStore）+ 内联状态机，不用 VanillaClient 类。
// 活 → 类有毒;死 → 模块构件有毒。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOG = fs.openSync('/tmp/vanilla-inline.log', 'w');
const log = (t) => { fs.writeSync(LOG, t + '\n'); console.log(t); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  userDataDir: '/tmp/vanilla-inl-' + (Date.now() % 100000),
  args: ['--no-proxy-server'], defaultViewport: { width: 800, height: 600 },
});
const page = await browser.newPage();
page.on('console', (m) => log(`C ${m.text().slice(0, 130)}`));
page.on('pageerror', (e) => log(`EXC ${String(e).slice(0, 200)}`));
await page.goto('http://localhost:5204/vanilla-iso.html', { waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 800));

const started = await page.evaluate(async () => {
  const codec = await import('/src/net/vanilla/codec.ts');
  const sec = await import('/src/net/vanilla/sections.ts');
  const ts = await import('/src/world/TileStore.ts');
  const { VWriter, VReader, VanillaFrameParser, MsgId } = codec;
  const state = { msgs: 0, sections: 0, done129: false, spawn: [0, 0] };
  globalThis.__inl = state;

  const parser = new VanillaFrameParser();
  let ws;
  const send = (f) => { if (ws.readyState === 1) ws.send(f); };
  let slot = 0;
  const store = new ts.TileStore(4200, 1200);

  const upload = () => {
    const pk = [];
    const W = VWriter.prototype;
    const w4 = new VWriter().u8(slot).u8(0).u8(0).f32(0).u8(0).str('玩家').u8(0).u16(0).u8(0)
      .u8n(28, 222, 255).u8n(255, 191, 143).u8n(113, 60, 37).u8n(175, 105, 47)
      .u8n(160, 110, 80).u8n(40, 86, 120).u8n(120, 90, 60).u8(0).u8(0).u8(0);
    pk.push(w4.finish(MsgId.SyncPlayer));
    pk.push(new VWriter().str(crypto.randomUUID()).finish(MsgId.ClientUuid));
    pk.push(new VWriter().u8(slot).i16(100).i16(100).finish(MsgId.PlayerLifeMana));
    pk.push(new VWriter().u8(slot).i16(20).i16(20).finish(MsgId.PlayerMana));
    pk.push(new VWriter().u8(slot).u16(0).finish(MsgId.PlayerBuffs));
    pk.push(new VWriter().u8(slot).u8(0).u16(0).finish(MsgId.SyncLoadout));
    const empty5 = (sid) => new VWriter().u8(slot).i16(sid).i16(0).u8(0).i16(0).u8(0).finish(MsgId.SyncEquipment);
    for (let i = 0; i < 59; i++) pk.push(empty5(i));
    const ranges = [[59, 20], [79, 10], [89, 5], [94, 5], [99, 40], [299, 40], [499, 1], [500, 40], [700, 40], [900, 20], [920, 10], [930, 20], [950, 10], [960, 20], [980, 10]];
    for (const [st, n] of ranges) for (let i = 0; i < n; i++) pk.push(empty5(st + i));
    pk.push(new VWriter().finish(MsgId.RequestWorldData));
    for (const p of pk) send(p);
  };

  ws = new WebSocket('ws://127.0.0.1:5290/?host=127.0.0.1&port=7781');
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => send(new VWriter().str('Terraria' + 326).finish(MsgId.Hello));
  ws.onmessage = (e) => {
    parser.feed(new Uint8Array(e.data));
    parser.drain((id, payload) => {
      state.msgs++;
      const r = new VReader(payload);
      if (id === MsgId.PlayerInfo) { slot = r.u8(); r.u8(); upload(); }
      else if (id === MsgId.WorldData) {
        // 字段序：time i32 + b6 u8 + moon u8 + maxTilesX/Y i16×2 → spawnX/Y
        r.i32(); r.u8(); r.u8(); r.i16(); r.i16();
        const sx = r.i16() , sy = r.i16();
        if (!state.spawn[0]) state.spawn = [sx, sy];
        send(new VWriter().i32(sx).i32(sy).u8(0).finish(MsgId.SpawnTileData));
      } else if (id === MsgId.TileSection) {
        sec.decodeVanillaSection(store, payload);
        state.sections++;
      } else if (id === MsgId.ExtraSpawnSectionLoaded) {
        send(new VWriter().u8(slot).i16(state.spawn[0]).i16(state.spawn[1])
          .i32(0).i16(0).i16(0).u8(0).u8(1).finish(MsgId.PlayerSpawn));
      } else if (id === MsgId.FinishedConnectingToServer) {
        state.done129 = true;
        console.log('inl: ★129!');
      }
    });
  };
  return 'ok';
}).catch((e) => 'err ' + e.message);
log('start: ' + started);

for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const st = await page.evaluate(() => globalThis.__inl).catch((e) => ({ err: String(e) }));
  log(`t+${i * 2}s ${JSON.stringify(st)}`);
  if (st?.done129) { log('★INL-PASS:类有毒(VanillaClient 类结构是元凶)'); await browser.close(); process.exit(0); }
}
log('✗INL-FAIL:模块构件有毒(内联也停)');
await browser.close();
process.exit(1);
