// BJ734-A .wld 尾注段:战争迷雾随 .wld 导出导入携行（2026-10-27 用户令,尾注方案）。
// 病根:原版 .wld 本体不含探索数据（探索按玩家目录存 <世界>.map 伴档,MapHelper.cs
// :3055 亲读;旧注「.twld」系误记）——SW↔SW round-trip 后迷雾全丢。
// 方案:WldExport 尾部追加 'SWEXT1'+u32 len+JSON{v,w,h,ex}（ex=SaveData.explored
// 同源 b64 RLE,读侧零新编解码器）;WldImport 自尾反扫魔数+精确到尾判据+尺寸校验。
// 互通安全定谳:原版 LoadWorld_Version2 逐段+Footer 后即 Ok,无 EOF 校验——尾注被
// 真客户端忽略（WF:1767-1859/:3003-3018 亲读）。
// 夹具:sw-fx43 同式 48×16 世界（mkSave/stubPlayer/repoChain 复刻）。
import { describe, it, expect } from 'vitest';
import { exportWld } from '../src/wld/WldExport';
import { parseWldToSave } from '../src/wld/WldImport';
import {
  loadSaveData, saveGame, bytesToB64, rleTiles, rlePairs,
  type SaveData,
} from '../src/save/SaveFile';
import { TILE_BY_KEY, TILE_STABLE_OF_INTERNAL } from '../src/data/tiles';

const W = 48, H = 16;
const MAGIC = 'SWEXT1';

function mkSave(over?: Partial<SaveData>): SaveData {
  const n = W * H;
  const type = new Uint16Array(n);
  const frameX = new Uint16Array(n);
  const frameY = new Uint16Array(n);
  return {
    format: 'sandboxworld.save', version: 5,
    header: {
      name: 'BJ734A', seed: 7, width: W, height: H,
      spawn: [8, 6], groundLevel: 6, rockLevel: 9,
      crimson: false, dungeonX: 2, dungeonY: 5,
      treeX: [12, 24, 36], treeStyle: [1, 2, 3, 4],
      caveBackX: [13, 25, 37],
      worldId: 777123456,
      created: 1700000000000, playTimeMs: 0, moonType: 3, difficulty: 0,
      bgStyles: { cave: [1, 2, 3, 0], ice: 1, jungle: 2, hell: 3, mushroom: 1, underworld: 3, bg10: 0, bg11: 0, bg12: 0, forest: [2, 3, 4], desert: 2, ocean: 5, corrupt: 2, snow: 3, hallow: 1, crimson: 4, jungleBG: 5 },
    },
    clock: { timeOfDay: 0.25, dayCount: 1, moonPhase: 0, bloodMoon: false, eclipse: false },
    invasion: { type: 0, size: 0, sizeStart: 0, x: 0, delay: 0 },
    events: { partyManual: false, lanternManual: false, lanternGenuine: false, lanternNext: false, lanternCooldown: 0 },
    player: { hp: 100, x: 0, y: 0, inventory: [], selected: 0 },
    tiles: bytesToB64(rleTiles({ type, frameX, frameY }, TILE_STABLE_OF_INTERNAL)),
    walls: bytesToB64(rlePairs(new Uint16Array(n))),
    liquid: bytesToB64(rlePairs(new Uint16Array(n))),
    liquidType: bytesToB64(rlePairs(new Uint8Array(n))),
    wire: bytesToB64(rlePairs(new Uint16Array(n))),
    blocks: bytesToB64(rlePairs(new Uint8Array(n))),
    paint: bytesToB64(rlePairs(new Uint8Array(n))),
    paintWall: bytesToB64(rlePairs(new Uint8Array(n))),
    coat: bytesToB64(rlePairs(new Uint8Array(n))),
    chests: [], signs: [], npcs: [], flags: {},
    ...over,
  } as unknown as SaveData;
}

function stubPlayer(): Parameters<typeof saveGame>[1] {
  return {
    hp: 100, x: 0, y: 0, baseMaxHp: 100, baseMaxMana: 20, mana: 40,
    inv: { slots: Array(40).fill(null), selected: 0, armor: [], dye: [], trash: null, miscEquips: [], miscDyes: [], loadouts: [], currentLoadout: 0, extraAccessory: false },
    buffs: { toSave: () => [] },
    taxMoney: 0, golferScoreAccumulated: 0, anglerQuestsFinished: 0,
    deathsPve: 0, deathsPvp: 0, team: 0, dead: false, respawnTimer: 0,
    hairDye: 0, hbLocked: false, enabledSuperCart: true,
    builderAccStatus: new Array(12).fill(0),
    usedAegisCrystal: false, usedAegisFruit: false, usedArcaneCrystal: false,
    usedGummyWorm: false, usedAmbrosia: false, luckState: { usedGalaxyPearl: false },
  } as unknown as Parameters<typeof saveGame>[1];
}

/** 探索迷雾测试图:长游程+散点+全 1 尾段(三形态全覆盖),经 loadSaveData→saveGame
 *  生产链产出 b64(与 SaveData.explored 同源同编解码器) */
function fogPatternB64(): { b64: string; bits: Uint8Array } {
  const bits = new Uint8Array(W * H);
  for (let i = 0; i < 100; i++) bits[i] = 1;                  // 前段游程
  for (let i = 200; i < 260; i += 3) bits[i] = 1;             // 散点
  for (let i = W * H - 50; i < W * H; i++) bits[i] = 1;       // 尾段
  return { b64: ((): string => {
    const save = mkSave();
    const { world } = loadSaveData(save);
    world.explored = bits;
    const json = saveGame(world, stubPlayer(), 0);
    return (JSON.parse(json) as SaveData).explored as string;
  })(), bits };
}

const hasMagic = (b: Uint8Array): boolean => {
  outer: for (let i = 0; i + 6 <= b.length; i++) {
    for (let j = 0; j < 6; j++) if (b[i + j] !== MAGIC.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
};

describe('BJ734-A .wld 尾注段:迷雾携行', () => {
  it('① round-trip:带探索图导出→导入,explored b64 逐字节回传', () => {
    const { b64 } = fogPatternB64();
    const save = mkSave({ explored: b64 } as Partial<SaveData>);
    const bytes = exportWld(save);
    expect(hasMagic(bytes), '导出应含 SWEXT1 尾注').toBe(true);
    const back = parseWldToSave(bytes).save;
    expect(back.explored).toBe(b64);
  });

  it('② 无探索(explored 缺省):不追加尾注,字节零尾注,导入=undefined(旧行为)', () => {
    const save = mkSave();
    const bytes = exportWld(save);
    expect(hasMagic(bytes), '无迷雾不得追加尾注(与旧版逐位同)').toBe(false);
    expect(parseWldToSave(bytes).save.explored).toBeUndefined();
  });

  it('②b 全零迷雾(saveGame 恒写段形态):不追加尾注——新世界导出字节与旧版逐位同', () => {
    // 生产链:全新世界 saveGame 恒写 explored 段(全零 1 游程)——不得因段存在就挂尾注
    const { world } = loadSaveData(mkSave());
    world.explored = new Uint8Array(W * H);   // 显式全零
    const json = saveGame(world, stubPlayer(), 0);
    const saveAllZero = JSON.parse(json) as SaveData;
    expect(saveAllZero.explored, '生产链全零世界确实写段(前提成立)').toBeTruthy();
    const bytes = exportWld(saveAllZero);
    expect(hasMagic(bytes), '全零迷雾不追加尾注').toBe(false);
    expect(parseWldToSave(bytes).save.explored).toBeUndefined();
  });

  it('③ 坏尾注容错:截断 payload / 坏 JSON → 导入照常,迷雾 undefined', () => {
    const { b64 } = fogPatternB64();
    const good = exportWld(mkSave({ explored: b64 } as Partial<SaveData>));
    // 截断:砍掉最后 8 字节(魔数在但 payload 不完整→精确到尾判据失败)
    const cut = good.subarray(0, good.length - 8);
    expect(parseWldToSave(new Uint8Array(cut)).save.explored).toBeUndefined();
    // 坏 JSON:魔数+len 齐但 payload 非法(手拼)
    const junk = new Uint8Array(10 + 4);
    for (let j = 0; j < 6; j++) junk[j] = MAGIC.charCodeAt(j);
    new DataView(junk.buffer).setUint32(6, 4, true);
    junk.set(new TextEncoder().encode('xxxx'), 10);
    const vanilla = exportWld(mkSave());
    const glued = new Uint8Array(vanilla.length + junk.length);
    glued.set(vanilla, 0); glued.set(junk, vanilla.length);
    expect(parseWldToSave(glued).save.explored).toBeUndefined();
  });

  it('④ 尺寸错配尾注:魔数/payload 合法但 w/h 与世界不符 → 忽略', () => {
    const { b64 } = fogPatternB64();
    const good = exportWld(mkSave({ explored: b64 } as Partial<SaveData>));
    const pos = (() => { for (let i = good.length - 10 - 1; i >= 0; i--) {
      let ok = true; for (let j = 0; j < 6; j++) if (good[i + j] !== MAGIC.charCodeAt(j)) { ok = false; break; }
      if (ok) return i;
    } return -1; })();
    expect(pos).toBeGreaterThanOrEqual(0);
    const len = new DataView(good.buffer, good.byteOffset).getUint32(pos + 6, true);
    const o = JSON.parse(new TextDecoder().decode(good.subarray(pos + 10, pos + 10 + len))) as { w: number; h: number; ex: string };
    const badPayload = new TextEncoder().encode(JSON.stringify({ ...o, w: 999, h: 999 }));
    const bad = new Uint8Array(pos + 10 + badPayload.length);
    bad.set(good.subarray(0, pos + 6), 0);
    new DataView(bad.buffer).setUint32(pos + 6, badPayload.length, true);
    bad.set(badPayload, pos + 10);
    expect(parseWldToSave(bad).save.explored).toBeUndefined();
  });

  it('⑤ 结构锁:vanilla 前缀不被尾注污染——尾注恰为最后 10+len 字节,前缀=无尾注导出', () => {
    const { b64 } = fogPatternB64();
    const withTail = exportWld(mkSave({ explored: b64 } as Partial<SaveData>));
    const noTail = exportWld(mkSave());
    // 尾注长 ≥16(魔数+len+最小 payload);前缀逐位等于无尾注导出
    const tailLen = withTail.length - noTail.length;
    expect(tailLen).toBeGreaterThanOrEqual(16);
    expect(withTail.subarray(0, noTail.length)).toEqual(noTail);
  });
});
