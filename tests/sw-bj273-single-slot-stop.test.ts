// BJ273（2026-09-22 用户报「长按右键连取取物音越来越响」）定谳回归：
// 原版单实例槽【停旧播新】族（LegacySoundPlayer.PlaySound 各 case 对命名槽/
// 逐变体槽先 .Stop() 旧实例再 CreateInstance）在本仓 slotAction 的映射——
// 此前 Menu_Tick 等落 'none'（自由叠响），右键连取加速梯（stackDelay 7→2 拍
// =117→33ms）短于 Menu_Tick 解码时长 71.4ms → 同时在响实例数单调上升=主观
// 渐强，真偏差非原版同相（②gain 累积/③pitch 抖动均证伪：每实例独立 gain
// 恒 1×master、原版 case 12 无 Pitch 赋值本仓 PITCH_CASE['Menu_Tick']=null 同相）。
// 断言三层：
//   ① 结构锁：单槽族逐文件 slotAction==='stop'（逐变体槽=逐文件槽同构）；
//   ② 语义对照：原版本就叠响/另档的不入集（case 4 NPCKilled 覆槽不 Stop→none、
//      case 2 Item_N 维持 R26 三组、case 15 Roar/NPC_Killed_10/NPC_Hit_57=skip）；
//   ③ 行为：同文件连播→旧实例 stop() 被调；'none' 组连播互不截断；每实例
//      独立 gain（无跨实例累积）。
// 原版锚（Terarria1457/Terraria.Audio/LegacySoundPlayer.cs）：case 0 :443-449/
// case 1 :506-517/case 3 :654-674/case 5 :699-707/case 6 :709-719/case 7 :720-730/
// case 8/9 :731-752/case 10/11/12 :753-785/case 13 :786-795/case 4 :693。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Sfx, applySfxPackOverrides } from '../src/core/Sfx';

// ---------- mock AudioContext（node 环境无 WebAudio，同 sfx-first-play 桩族） ----------
let created: MockSrc[] = [];

class MockGain {
  gain = { value: 0, setTargetAtTime: () => {} };
  connect(dest: unknown) { return dest; }
  disconnect() { /* noop */ }
}

class MockSrc {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  dest: unknown = null;
  stopped = false;
  connect(dest: unknown) { this.dest = dest; return dest; }
  start() { /* 起振 */ }
  stop() { this.stopped = true; }
}

class MockAC {
  state = 'running';
  currentTime = 0;
  destination = {};
  decodeAudioData = async () => ({ duration: 0.071, length: 3144, sampleRate: 44100 } as unknown as AudioBuffer);
  createBufferSource() { const s = new MockSrc(); created.push(s); return s; }
  createGain() { return new MockGain(); }
  async resume() { this.state = 'running'; }
}

const windowBackup = (globalThis as { window?: unknown }).window;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const slotAction = (f: string): string =>
  (Sfx as unknown as { slotAction: (file: string) => string }).slotAction(f);
const stopSet = () => (Sfx as unknown as { SINGLE_SLOT_STOP: Set<string> }).SINGLE_SLOT_STOP;

beforeEach(() => {
  created = [];
  (globalThis as { window?: unknown }).window = { AudioContext: MockAC };
});
afterEach(() => {
  (globalThis as { window?: unknown }).window = windowBackup;
  vi.unstubAllGlobals();
  applySfxPackOverrides(new Map());
});

describe('BJ273/BJ289/BJ291 单实例槽停旧播新族（slotAction 映射）', () => {
  it('①结构锁：单槽族逐文件 stop（★BJ289 T2 全表差集钉死——增删文件即爆红走重锚）', () => {
    const golden = [
      // BJ273（2026-09-22）:case 0 Dig(:443-449)/case 1 PlayerHit(:506-517)/case 3 style1-56
      // (:666-674)/case 5 PlayerKilled(:699-707)/case 6 Grass(:709-719)/case 7 Grab(:720-730)/
      // case 8/9 Door(:731-752)/case 10/11/12 Menu(:753-785)/case 13 Shatter(:786-795)
      'Menu_Tick', 'Menu_Open', 'Menu_Close',
      'Grab', 'Door_Opened', 'Door_Closed', 'Shatter', 'Grass',
      'Player_Killed', 'Player_Hit_0', 'Player_Hit_1', 'Player_Hit_2',
      'Dig_0', 'Dig_1', 'Dig_2',
      ...Array.from({ length: 56 }, (_, k) => `NPC_Hit_${k + 1}`),
      'NPC_Hit_58',
      // ★BJ289（2026-09-23 T2 全表差集落刀;1457=1458 行号）:case 43 Thunder 六变体槽
      // (:457-477)/case 21 Tink 逐变体槽(:927-939)/case 22 Unlock(:940-949)/
      // case 23 Drown(:950-960)
      ...Array.from({ length: 6 }, (_, k) => `Thunder_${k}`),
      'Tink_0', 'Tink_1', 'Tink_2',
      'Unlock', 'Drown',
      // ★BJ291（2026-09-23,U1 漏修⑥）:case 40 Camera 快门命名槽停旧播新
      // （:1366-1372 Stop→CreateInstance;1458 同构零变更;CaptureMode.ts:377 连拍面）
      'Camera',
    ];
    expect(stopSet().size).toBe(golden.length);   // 无隐藏重复键
    expect([...stopSet()].sort()).toEqual([...golden].sort());
    for (const f of golden) expect(slotAction(f), f).toBe('stop');
  });

  it('②语义对照：原版覆槽不 Stop/另档族不入集', () => {
    // case 4 NPCKilled 仅覆槽引用不 Stop（:693）→ 'none'（叠响=原版本相）
    for (const f of ['NPC_Killed_1', 'NPC_Killed_23', 'NPC_Killed_68']) {
      expect(slotAction(f), f).toBe('none');
    }
    // 在播跳过族维持 skip：case 15 Roar（:825-841）/case 4 style 10（:689-691）/
    // case 3 style 57（:654-657）/成就音
    for (const f of ['Roar_0', 'Roar_1', 'NPC_Killed_10', 'NPC_Hit_57', 'achievement_complete']) {
      expect(slotAction(f), f).toBe('skip');
    }
    // case 2 Item_N 三组槽维持 R26 面：default stop / 免停 none / 在播跳过 skip
    expect(slotAction('Item_11')).toBe('stop');
    expect(slotAction('Item_9')).toBe('none');
    expect(slotAction('Item_53')).toBe('skip');
    // NPC_Hit 逐变体：57=skip、58=stop（skip 集只吞 57 一档）
    expect(stopSet().has('NPC_Hit_57')).toBe(false);
    expect(slotAction('NPC_Hit_58')).toBe('stop');
    // ★BJ289 skip 档补：case 19 Splash 逐槽（:875-878）+ case 28 Mech（:1001-1004）
    // ——skip 语义（在播跳过）勿混入 stop 集（原版不 Stop 旧实例）
    for (const f of ['Splash_0', 'Splash_1', 'Splash_2', 'Splash_3', 'Splash_4', 'Splash_5', 'Mech_0']) {
      expect(slotAction(f), f).toBe('skip');
      expect(stopSet().has(f), f).toBe(false);
    }
    // ★BJ291 skip 档补（U1 漏修④⑤+组3.2 并入,2026-09-23）：
    // case 29 逐变体槽（:1044-1048 门对一切 style 生效）——24..104 档乘全域 + 仓内可达
    // style 6/8/9/20/105/124/125（各文件单写者=case29）;style 7 不入（case14-542 无门面
    // 共用文件,登记近似）
    const case29 = [
      ...Array.from({ length: 81 }, (_, k) => `Zombie_${k + 24}`),
      'Zombie_6', 'Zombie_8', 'Zombie_9', 'Zombie_20', 'Zombie_105', 'Zombie_124', 'Zombie_125',
    ];
    // case 45 Dolphin（:1064-1068）+ 组3.2 逐变体门并入：case 30 稀有支 Zombie_12
    // （:1110-1114,常规 10/11 无门）/case 32 逐变体（:1137-1140）/case 33（:1205-1208）/
    // case 67/68/69 逐变体（:1149-1152/:1161-1164/:1173-1176）
    const merged = ['Zombie_109', 'Zombie_12', 'Zombie_14', 'Zombie_15',
      'Zombie_16', 'Zombie_17', 'Zombie_18', 'Zombie_19',
      'Zombie_118', 'Zombie_119', 'Zombie_120', 'Zombie_126', 'Zombie_127', 'Zombie_128',
      'Zombie_129', 'Zombie_130'];
    for (const f of [...case29, ...merged]) {
      expect(slotAction(f), f).toBe('skip');
      expect(stopSet().has(f), f).toBe(false);
    }
    // ★BJ704-G10（R2-F9,2026-10-21）case 66 三重整体忙检（:1185-1195 Zombie_121/
    // 122/123 任一在播即整支 null）落模清偿——入 SINGLE_INSTANCE（自身在播跳过）
    // + GROUP_BUSY 群门（组内任一在播跳过,siblingBlocked）→ skip 档。
    for (const f of ['Zombie_121', 'Zombie_122', 'Zombie_123']) {
      expect(slotAction(f), f).toBe('skip');
      expect(stopSet().has(f), f).toBe(false);
    }
    // 整体忙检族（先查全部槽任一在播即整支 null）≠逐文件槽 → 不入 skip 集=登记近似：
    // case 46 枭(:1075-1082 查 110/111)/case 65(:1391-1401);
    // case 44 Seagull(:1054-1061)/case 31 青蛙(:1124-1134)原文本就无门
    // （★BJ730 改判史：case 66 Zombie_121 原在此 none 组——BJ704-G10 落模后迁出）
    for (const f of ['Zombie_110', 'Zombie_115', 'Zombie_106', 'Zombie_13']) {
      expect(slotAction(f), f).toBe('none');
      expect(stopSet().has(f), f).toBe(false);
    }
    // 双写者冲突档：Zombie_7（case29 style7 有门 vs case14-542 无门）不入集=登记近似
    expect(slotAction('Zombie_7')).toBe('none');
  });

  it('③行为：同文件连播先停旧实例（Menu_Tick 右键连取链/Grab 取物/Dig 挖掘逐案）', async () => {
    applySfxPackOverrides(new Map([
      ['Menu_Tick', new Uint8Array(8)], ['Grab', new Uint8Array(8)], ['Dig_0', new Uint8Array(8)],
    ]));
    for (const f of ['Menu_Tick', 'Grab', 'Dig_0']) {
      created = [];
      const sfx = new Sfx();
      expect(sfx.playWavFile(f, 1)).toBe(true);
      await flush();                              // 首调补播完成入缓存
      created = [];
      sfx.playWavFile(f, 1);                      // 第二调同步出声
      sfx.playWavFile(f, 1);                      // 第三调
      expect(created.length).toBe(2);
      expect(created[0].stopped, `${f} 第一实例被第二发截断`).toBe(true);
      expect(created[1].stopped, `${f} 末实例自然播完`).toBe(false);
    }
  });

  it('③行为：none 组连播互不截断（原版覆槽不 Stop 同相）', async () => {
    applySfxPackOverrides(new Map([['NPC_Killed_1', new Uint8Array(8)]]));
    const sfx = new Sfx();
    expect(sfx.playWavFile('NPC_Killed_1', 1)).toBe(true);
    await flush();
    created = [];
    sfx.playWavFile('NPC_Killed_1', 1);
    sfx.playWavFile('NPC_Killed_1', 1);
    expect(created.length).toBe(2);
    expect(created[0].stopped).toBe(false);       // 旧实例不被停=原版叠响
    expect(created[1].stopped).toBe(false);
  });

  it('③行为：每实例独立 gain（无跨实例累积——②假说回归面）', async () => {
    applySfxPackOverrides(new Map([['Menu_Tick', new Uint8Array(8)]]));
    const sfx = new Sfx();
    sfx.master = 1;
    expect(sfx.playWavFile('Menu_Tick', 1)).toBe(true);
    await flush();
    created = [];
    for (let i = 0; i < 4; i++) sfx.playWavFile('Menu_Tick', 1);
    expect(created.length).toBe(4);
    const gains = created.map((s) => (s.dest as MockGain).gain.value);
    for (const g of gains) expect(g).toBeCloseTo(1);   // 恒 1×master,逐实例独立节点
  });

  // ---- ★BJ289（2026-09-23 T2 全表差集落刀）行为面 ----

  it('④BJ289 行为：Tink 同槽连播先停旧（case 21 :927-939 逐变体槽 stop）', async () => {
    applySfxPackOverrides(new Map([['Tink_1', new Uint8Array(8)]]));
    const sfx = new Sfx();
    expect(sfx.playWavFile('Tink_1', 1)).toBe(true);
    await flush();                              // 首调补播完成入缓存+入槽
    created = [];
    sfx.playWavFile('Tink_1', 1);
    sfx.playWavFile('Tink_1', 1);
    expect(created.length).toBe(2);
    expect(created[0].stopped, 'Tink_1 第一实例被第二发截断').toBe(true);
    expect(created[1].stopped, '末实例自然播完').toBe(false);
  });

  it('④BJ289 行为：Splash 逐槽在播跳过 + 4/5 兄弟互斥（case 19 :875-878/:899-913）', async () => {
    applySfxPackOverrides(new Map([
      ['Splash_0', new Uint8Array(8)], ['Splash_4', new Uint8Array(8)], ['Splash_5', new Uint8Array(8)],
    ]));
    const sfx = new Sfx();
    expect(sfx.playWavFile('Splash_0', 1)).toBe(true);
    await flush();
    created = [];
    // 同槽在播 → skip 无声（实例不建）;跨槽（0↔4 无互斥）照常
    expect(sfx.playWavFile('Splash_0', 1)).toBe(false);
    expect(created.length, '同槽 skip 不建实例').toBe(0);
    expect(sfx.playWavFile('Splash_4', 1)).toBe(true);
    await flush();
    expect(created.length).toBe(1);
    // Splash_4 在播 → Splash_5 被兄弟互斥拦（原版实例建而不 Play=可观测无声;
    // 本仓 skip 不建实例,可观测面等价）
    expect(sfx.playWavFile('Splash_5', 1)).toBe(false);
    expect(created.length, '兄弟互斥无声').toBe(1);
    // 反向对称：fresh 实例上 5 在播拦 4;兄弟自然播完（onended 清槽）后恢复可播
    const sfx2 = new Sfx();
    created = [];                               // 补播在 flush 窗口内建源,先清后播
    expect(sfx2.playWavFile('Splash_5', 1)).toBe(true);
    await flush();
    expect(created.length).toBe(1);
    expect(sfx2.playWavFile('Splash_4', 1)).toBe(false);
    created[0].onended?.();                     // Splash_5 播完清槽
    expect(sfx2.playWavFile('Splash_4', 1)).toBe(true);
    expect(created.length).toBe(2);
  });

  it('④BJ289 行为：play() 在播跳过不落合成兜底（case 19/28 原版静默语义）', async () => {
    applySfxPackOverrides(new Map([['Splash_5', new Uint8Array(8)]]));
    const sfx = new Sfx();
    const synEvents: string[] = [];
    const prevHook = Sfx.onEvent;
    Sfx.onEvent = (k) => { if (k === 'syn') synEvents.push(k); };
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 掷恒 Splash_5（floor(0.99*6)=5）
    try {
      expect(sfx.playWavFile('Splash_5', 1)).toBe(true);
      await flush();
      created = [];
      sfx.play('splash', 1);   // 掷中在播的 Splash_5 → skip;若误落合成会因 mock ctx
                               // 无 createOscillator 抛错（双重判据）
      expect(synEvents.length, 'skip 不得发 syn 事件').toBe(0);
      expect(created.length, 'skip 不得建实例').toBe(0);
    } finally {
      rnd.mockRestore();
      Sfx.onEvent = prevHook;
    }
  });

  // ---- ★BJ291（2026-09-23,U1 漏修④⑤⑥）行为面 ----

  it('⑤BJ291 行为：case 29 同变体在播跳过、跨变体照常（:1044-1048 逐变体槽）', async () => {
    applySfxPackOverrides(new Map([
      ['Zombie_89', new Uint8Array(8)], ['Zombie_90', new Uint8Array(8)],
    ]));
    const sfx = new Sfx();
    expect(sfx.playWavFile('Zombie_89', 1)).toBe(true);
    await flush();                              // 首调补播完成入缓存+入槽
    const first89 = created[created.length - 1];   // Zombie_89 首实例（持槽）
    created = [];
    // 同变体在播 → skip 无声（IdleSounds 同类叠响差的主消费面）
    expect(sfx.playWavFile('Zombie_89', 1), '同变体在播=skip').toBe(false);
    expect(created.length, 'skip 不建实例').toBe(0);
    // 跨变体（89 在播时 90 照常出声=原版逐槽互斥,跨槽自由）
    expect(sfx.playWavFile('Zombie_90', 1)).toBe(true);
    await flush();
    expect(created.length).toBe(1);
    // 槽自然播完（onended 清）后恢复可播
    first89.onended?.();
    expect(sfx.playWavFile('Zombie_89', 1)).toBe(true);
    expect(created.length).toBe(2);
  });

  it('⑤BJ291 行为：case 40 Camera 停旧播新（:1366-1372 快门连拍不叠响）', async () => {
    applySfxPackOverrides(new Map([['Camera', new Uint8Array(8)]]));
    const sfx = new Sfx();
    expect(sfx.playWavFile('Camera', 1)).toBe(true);
    await flush();
    created = [];
    sfx.playWavFile('Camera', 1);               // 连拍第二张
    sfx.playWavFile('Camera', 1);               // 连拍第三张
    expect(created.length).toBe(2);
    expect(created[0].stopped, '第一声快门被第二声截断（Stop→Create）').toBe(true);
    expect(created[1].stopped, '末声自然播完').toBe(false);
  });
});
