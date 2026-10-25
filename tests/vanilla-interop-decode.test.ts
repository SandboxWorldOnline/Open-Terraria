// vanilla interop 离线解码回放（P0-B 守卫，2026-10-24）。
// 回放物 = rig-vanilla-1458/captures/（probe-join.mjs 对本地 vanilla 1.4.5.8 服实弹
// 捕获：24 段 msg10 + msg7×2）。守卫面：
//   ① msg7 全 63 字段零残余（含 ★1458 dungeonX/Y 增量锁）；
//   ② 段解码器全量消费 inflate 流（teCount=0 时 consumed===长度——编码语义自证）；
//   ③ 24 段尽数落地 TileStore + 结构统计合理（active/wall/liquid/framed 计数）；
//   ④ 帧装配器碎片喂入逐字节回环。
// rig 未跑过则跳过（防伪红；产捕获物：node ../rig-vanilla-1458/probe-join.mjs）。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'fflate';
import { VReader, VanillaFrameParser, VWriter, MsgId } from '../src/net/vanilla/codec';
import { decodeVanillaSection } from '../src/net/vanilla/sections';
import { VanillaClient } from '../src/net/vanilla/VanillaClient';
import { TileStore } from '../src/world/TileStore';

const CAP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'rig-vanilla-1458', 'captures');
const sectionFiles = fs.existsSync(CAP)
  ? fs.readdirSync(CAP).filter((f) => f.startsWith('section-') && f.endsWith('.bin')).sort()
  : [];
const hasCaps = sectionFiles.length >= 24;

describe('vanilla interop 离线解码回放（rig 实弹捕获物）', () => {
  it.skipIf(!hasCaps)('msg7 WorldData 全 63 字段零残余（1458 含 dungeonX/Y 增量）', () => {
    const payload = new Uint8Array(fs.readFileSync(path.join(CAP, 'worlddata-first.bin')));
    const vc = new VanillaClient({}, { onWorldReady: () => {} }) as unknown as {
      parseWorldData(r: VReader): {
        dungeonX: number; dungeonY: number; maxTilesX: number;
        spawnX: number; worldName: string;
      };
    };
    const r = new VReader(payload);
    const d = vc.parseWorldData(r);
    expect(r.remaining).toBe(0); // ★编码语义自证：一字节不多不少
    expect(d.maxTilesX).toBe(4200);
    expect(d.dungeonX).toBe(3397); // ★1458 增量锁（rig 世界 sw-rig 实测值）
    expect(d.dungeonY).toBe(252);
    expect(d.worldName).toBe('sw-rig');
  });

  it.skipIf(!hasCaps)('24 段全量落地 + 消费自证 + 结构统计', () => {
    const store = new TileStore(4200, 1200);
    let chests = 0;
    const rects: Array<{ x0: number; y0: number }> = [];
    for (const f of sectionFiles) {
      const payload = new Uint8Array(fs.readFileSync(path.join(CAP, f)));
      const sec = decodeVanillaSection(store, payload);
      expect(sec, f).not.toBeNull();
      rects.push(sec!.rect);
      chests += sec!.chests.length;
      if (sec!.teCount === 0) {
        const inflated = inflateSync(payload);
        expect(sec!.consumed, `${f} 消费 ${sec!.consumed}/${inflated.length}`).toBe(inflated.length);
      }
    }
    let active = 0, wallN = 0, liqN = 0, framed = 0;
    for (let i = 0; i < store.type.length; i++) {
      if (store.flags[i] & 1) active++;
      if (store.wall[i] !== 0) wallN++;
      if (store.liquid[i] > 0) liqN++;
      if (store.frameX[i] !== 0 || store.frameY[i] !== 0) framed++;
    }
    // 出生 5×3+扩展 24 段 ≈ 720k 格（200×150×24），地下为主
    expect(rects.length).toBe(24);
    expect(active).toBeGreaterThan(300_000);
    expect(wallN).toBeGreaterThan(50_000);
    expect(liqN).toBeGreaterThan(0);
    expect(framed).toBeGreaterThan(1_000); // 家具/树等 framed 帧落地
    // 类型多样性 sanity：出生 24 段应见 >30 种非空 tile（泥土/石/草/树/矿…）;
    // 出生点嵌墙是原版常态（ForceClearArea 属出生时行为,不断言出生格空气）
    const types = new Set<number>();
    for (let i = 0; i < store.type.length; i++) if (store.flags[i] & 1) types.add(store.type[i]);
    expect(types.size).toBeGreaterThan(30);
    expect(chests).toBeGreaterThan(0); // 出生段箱记账（sw-rig 世界含箱）
  });

  it('帧装配器：捕获载荷重封装逐字节回环（7B 碎片压测）', () => {
    if (!hasCaps) return;
    const payload = new Uint8Array(fs.readFileSync(path.join(CAP, 'worlddata-first.bin')));
    const framed = new VWriter().raw(payload).finish(MsgId.WorldData);
    const parser = new VanillaFrameParser();
    for (let i = 0; i < framed.length; i += 7) parser.feed(framed.subarray(i, i + 7));
    const got: Array<[number, Uint8Array]> = [];
    parser.drain((id, p) => got.push([id, p]));
    expect(got.length).toBe(1);
    expect(got[0][0]).toBe(MsgId.WorldData);
    expect(Buffer.from(got[0][1]).equals(Buffer.from(payload))).toBe(true);
    expect(parser.pending).toBe(0);
  });
});
