// ★BJ704-G18 — 新登记债清算六件（G17 报告新登记债 1-6;2026-10-21）。逐件判语
// （先定谳再动刀,亲读 1457 反编译 + 生产/源码双证）：
//  · 件1（销案,l10n）：「Mods.SandboxWorld.Toast.MountDismountBlocked 双侧皆缺」
//    定谳=【误登记】——键在 custom 源（zh 嵌套 Mods 对象/en）、构建产物
//    public/l10n 双语、生产快照 dist-release（bundle 消费串+语言包值）四侧全在,
//    l10n-audit 宇宙（775 键）含此键且全绿=在场的正证。误登记根因=对 JSON 结构键
//    （父对象 Mods + 叶键 SandboxWorld.Toast.X）做连续点径 grep——路径字面在文件
//    中永不连续出现 ⇒ 恒零命中 ⇒「双侧皆缺」假谳。判例:「JSON 结构键禁连续点径
//    grep 定谳,须走 resolvePackKey/flattenDeep 结构解析」（G17「禁触批登记前必核
//    盘上态」同族第三案）。刀=零改键+判别锁（§A）。
//  · 件2（修,Mounts.ts/Game.ts）：失败尘 DoFailedDismountDust（Mount.cs:6386-6437）
//    1:1——计数×20（非 10+×20：30/50→20/40）+尘型 _data.spawnDust+56 黑/61 仙灵彩
//    +Hitbox.Inflate(10,10)+逐尘后置（noGravity 半区/scale 1.3/速度掺玩家速度）。
//  · 件3（修,Mounts.ts/Game.ts）：R 键成功拍出生尘 DoSpawnDust（:6440-6635）
//    1:1——Dismount(ignoreEffect:false) 传 game 出尘（旧不传=零尘,与 buff 栏右键
//    BJ405-D1 双面不对齐）;setMount 出生面（:6366）同函数随刀转正 typed 尘。
//    三连败第 3 拍 ignoreEffect=true 保持免尘。52/62-65 特型支/矿车 gore/56-61
//    变身盒/57-60 滚轴鞋盒全量。
//  · 件4（修,Game.ts）：UpdateFailedDismount（Player.cs:6031-6037,调用位 :24922）
//    ——count>0 ∧（dead∨下坐∨失败格≠当前格）→清零;失败拍记录 FailedNoSpaceLocation
//    （:6047）。旧仓只在成功/第 3 拍清=异地两败回原点再败一次误触强制。
//  · 件5（修,Game.ts）：同型坐骑物品使用=SetMount :6263 `_type==m` 早退 no-op
//    （保持骑乘,使用面照常 useTime+UseSound——ItemCheck_StartActualUse :52315-52331
//    与早退无关;早拆门 :31935 同型亦不拆）。旧「同型下坐」近似分歧对齐 vanilla。
//  · 件6（修,纯注释）：Renderer.playerFrameRows 头注/横幅 + Player.ts 四处
//    :6219-6222——旧世代行号指进 RefreshItems 币槽逻辑,勘正为 1457 实锚
//    （:36430-36443/:36501-36560/:36590-36905/:6228-6231 等）。
//
// 变异恰红映射（/tmp/bj704g18-mutations.mjs）：
//   M1 撤 l10n 键（zh+en 源双侧删）           → A2/A3 红
//   M2 失败尘公式回 10+count×20                → B1/B3 红
//   M3 失败尘 typed 支摘除（回退恒走）          → B3 红
//   M4 doFailedDismountDust 尘型改常量 16       → B2 红（type 56≠16）
//   M5 56 黑色摘除                              → B2 红
//   M6 ok 支撤 game 透传（回零尘）              → C1/C2/G17-A5 红
//   M7 第 3 拍误传 game（尘泄入强制拍）          → C2 红
//   M8 setMount 出生面摘 doSpawnDust            → C3 红
//   M9 doSpawnDust 通用支数量 100→10            → C1/C3 红
//   M10 撤 UpdateFailedDismount 调用            → D3 红
//   M11 撤异地清零腿（位置比较删）              → D1/D3 红
//   M12 同型支回下坐（tryDismountMount 回潮）   → E1/E4 红
//   M13 同型支撤 UseSound                       → E1 红
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { MountInstance, type MountedPlayerView } from '../src/entities/Mounts';
// @ts-expect-error BJ704 卫生刀:mjs 无声明文件（运行时 vitest 正常解析）
import { collectUsedKeys, resolvePackKey, gateKeys } from '../tools/l10n-audit.mjs';
import { parseLenient, flattenDeep } from '../scripts/l10n-merge.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.join(ROOT, '..');
const gameSrc = readFileSync(path.join(ROOT, 'src/core/Game.ts'), 'utf8');
const mountsSrc = readFileSync(path.join(ROOT, 'src/entities/Mounts.ts'), 'utf8');
const playerSrc = readFileSync(path.join(ROOT, 'src/entities/Player.ts'), 'utf8');
const rendererSrc = readFileSync(path.join(ROOT, 'src/render/Renderer.ts'), 'utf8');
const vanPlayer = readFileSync(path.join(REPO, 'Terarria1457/Terraria/Player.cs'), 'utf8');
const vanMount = readFileSync(path.join(REPO, 'Terarria1457/Terraria/Mount.cs'), 'utf8');

type P = Player;

/** 干地世界（G17 同款：ground 104-105 实心;ceil=true 头顶 101-102 实心=FailedNoSpace） */
function makeWorld(ceil: boolean, seed = 'bj704g18'): World {
  const w = new World(60, 180, 44, seed);
  w.groundLevel = 200;
  for (let x = 14; x <= 30; x++) {
    w.store.setTileSilent(x, 104, 1, 0, 0);
    w.store.setTileSilent(x, 105, 1, 0, 0);
    if (ceil) {
      w.store.setTileSilent(x, 101, 1, 0, 0);
      w.store.setTileSilent(x, 102, 1, 0, 0);
    }
  }
  return w;
}

/** 骑 mountType 坐骑的玩家（真缩盒+data） */
function makeRider(mountType: number, ceil: boolean): P {
  const p = new Player(21 * 16, 1664 - 42, new Inventory());
  (p as unknown as { lastStore: unknown }).lastStore = makeWorld(ceil).store;
  p.mount.setMount(mountType, p as unknown as Parameters<MountInstance['setMount']>[1]);
  return p;
}

const view = (over: Partial<MountedPlayerView> = {}): MountedPlayerView => ({
  x: 100, y: 100, w: 20, h: 42, vx: 0, vy: 0,
  onGround: true, inWater: false, facing: 1,
  inputX: 0, inputJump: false, inputUp: false, inputDown: false,
  prevInputJump: false, gravDir: 1, store: null, ...over,
});

/** typed 尘捕获 game 桩（spawnDust 记账;post 覆写面用 duFactory 造可变尘） */
function typedGame(duFactory?: () => Record<string, unknown>) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    game: {
      spawnDust: (...a: unknown[]) => {
        calls.push({ x: a[0], y: a[1], w: a[2], h: a[3], type: a[4],
          sx: a[5], sy: a[6], alpha: a[7], color: a[8], scale: a[9] });
        return (duFactory ? duFactory() : null) as never;
      },
      cloneDust: () => null,
      spawnParticles: () => { throw new Error('typed 面不应走回退'); },
      playSfxFiles: () => {},
    },
  };
}

/** 直调 Game.tryDismountMount（G17 fake-this 惯例;typed=true 给 spawnDust 面） */
async function pressR(p: P, count = 0, loc: { tx: number; ty: number } | null = null, typed = false) {
  const { Game } = await import('../src/core/Game');
  const proto = Game.prototype as unknown as Record<string, (this: unknown) => void>;
  const calls = { toast: 0, sfx: 0, tp: 0, typed: 0, particles: [] as number[] };
  const fake: Record<string, unknown> = {
    player: p,
    mountNoSpaceCount: count,
    mountNoSpaceLocation: loc,
    sfx: { play: () => { calls.sfx++; } },
    spawnParticles: (_x: number, _y: number, _c: string, n: number) => { calls.particles.push(n); },
    cb: { onToast: () => { calls.toast++; } },
    playerNoSpaceTeleport: () => { calls.tp++; },
  };
  if (typed) fake.spawnDust = () => { calls.typed++; return null; };
  proto.tryDismountMount.call(fake);
  return { calls, count: fake.mountNoSpaceCount as number, loc: fake.mountNoSpaceLocation as { tx: number; ty: number } | null };
}

// ---------------------------------------------------------------------------
// A. 件1 toast 键 l10n（销案：误登记定谳+判别锁——结构解析,禁连续点径 grep）
// ---------------------------------------------------------------------------
describe('BJ704-G18 A toast 键在位（G17 债1 销案：四侧全在,误登记翻正）', () => {
  const KEY = 'Mods.SandboxWorld.Toast.MountDismountBlocked';

  it('A1 l10n-audit 宇宙含此键（collectUsedKeys 命中 Game.ts 消费位）', () => {
    const used = collectUsedKeys(path.join(ROOT, 'src'));
    expect(used.has(KEY)).toBe(true);                       // M1 撤消费=宇宙失键红
    expect((used.get(KEY) ?? []).some((l: string) => l.includes('core/Game.ts'))).toBe(true);
  });

  it('A2 custom 源双侧结构解析命中（zh 嵌套 Mods 对象/en 同形——连续点径 grep 恒零命中=误登记根因）', () => {
    // 结构解析（flattenDeep：父对象 Mods + 叶键 SandboxWorld.Toast.X → 全键拼接）
    const zhFlat = flattenDeep(parseLenient(readFileSync(path.join(REPO, 'tools/l10n-custom/zh-Hans.json'), 'utf8')));
    const enFlat = flattenDeep(parseLenient(readFileSync(path.join(REPO, 'tools/l10n-custom/en-US.json'), 'utf8')));
    expect(resolvePackKey(zhFlat, KEY)).toBe('空间不足，无法上下坐骑！');
    expect(resolvePackKey(enFlat, KEY)).toBe('You cannot do that while riding a mount!');
  });

  it('A3 构建产物双语命中（public/l10n——运行时 LanguageManager cat+key 注册同源）', () => {
    const zh = JSON.parse(readFileSync(path.join(ROOT, 'public/l10n/zh-Hans.json'), 'utf8'));
    const en = JSON.parse(readFileSync(path.join(ROOT, 'public/l10n/en-US.json'), 'utf8'));
    expect(resolvePackKey(zh, KEY)).toBe('空间不足，无法上下坐骑！');
    expect(resolvePackKey(en, KEY)).toBe('You cannot do that while riding a mount!');
  });

  it('A4 审计判别力：键从双语包同摘 → gateKeys 红（「audit 全过 ⇒ 键在场」——G17 反读翻正）', () => {
    const used = collectUsedKeys(path.join(ROOT, 'src'));
    const keys = [...used.keys()];
    const zh = JSON.parse(readFileSync(path.join(ROOT, 'public/l10n/zh-Hans.json'), 'utf8'));
    const en = JSON.parse(readFileSync(path.join(ROOT, 'public/l10n/en-US.json'), 'utf8'));
    const g0 = gateKeys(keys, zh, en);
    expect(g0.red).not.toContain(KEY);                      // 基线在场
    const zh2 = JSON.parse(JSON.stringify(zh)); delete zh2.Mods['SandboxWorld.Toast.MountDismountBlocked'];
    const en2 = JSON.parse(JSON.stringify(en)); delete en2.Mods['SandboxWorld.Toast.MountDismountBlocked'];
    const g1 = gateKeys(keys, zh2, en2);
    expect(g1.red).toContain(KEY);                          // M1 双侧摘键=红（audit 有牙）
  });
});

// ---------------------------------------------------------------------------
// B. 件2 失败尘公式/形态（DoFailedDismountDust :6386-6437 1:1）
// ---------------------------------------------------------------------------
describe('BJ704-G18 B 失败尘（计数×20 + 尘型/色/盒 typed 1:1）', () => {
  it('B1 回退档公式：失败 1/2 拍 spawnParticles 数量=20/40（旧 10+×20=30/50 禁回潮）', async () => {
    const p = makeRider(55, true);                          // ceil → nospace
    const r1 = await pressR(p, 0);
    expect(r1.calls.particles).toEqual([20]);                     // M2 回旧公式 → [30]=红
    const r2 = await pressR(p, 1);
    expect(r2.calls.particles).toEqual([40]);
  });

  it('B2 typed 面：尘型=_data.spawnDust/盒=Inflate(10,10)/56=黑/61=仙灵彩（NewDust 实参逐值）', () => {
    // mount 3（spawnDust=56）：40 尘,盒=(x-10,y-10,w+20,h+20),color=null（Transparent）
    const m3 = new MountInstance();
    m3.setMount(3, view());
    const t3 = typedGame();
    m3.doFailedDismountDust(view({ x: 300, y: 400, w: 20, h: 42 }), t3.game, 40);
    expect(t3.calls.length).toBe(40);
    for (const c of t3.calls) {
      expect(c).toMatchObject({ x: 290, y: 390, w: 40, h: 62, type: 56, sx: 0, sy: 0, alpha: 0, color: null, scale: 1 });
    }
    // mount 56 蝙蝠：黑 Color.Black
    const m56 = new MountInstance();
    m56.setMount(56, view());
    const t56 = typedGame();
    m56.doFailedDismountDust(view({ x: 300, y: 400 }), t56.game, 20);
    expect(t56.calls.length).toBe(20);
    expect(t56.calls[0]!.type).toBe(31);                    // M4 尘型错 → 红
    expect(t56.calls[0]!.color).toEqual({ r: 0, g: 0, b: 0, a: 255 });   // M5 撤黑 → 红
    // mount 61 仙灵彩：GetFairyQueenWeaponsColorFull(0.27,1,0.15,1,0.7) 通名支独立复算
    const m61 = new MountInstance();
    m61.setMount(61, view());
    const t61 = typedGame();
    m61.doFailedDismountDust(view({ x: 300, y: 400 }), t61.game, 20);
    expect(t61.calls[0]!.color).toEqual({ r: 206, g: 125, b: 255, a: 255 });
  });

  it('B3 逐尘后置（ng 档确定性面）：mount 7（spawnDustNoGravity）noGravity 恒置+速度掺玩家速度×0.8', () => {
    const m7 = new MountInstance();
    m7.setMount(7, view());
    const made: Array<Record<string, unknown>> = [];
    const t7 = typedGame(() => { const d = { scale: 1, vx: 0, vy: 0, noGravity: false }; made.push(d); return d; });
    m7.doFailedDismountDust(view({ x: 300, y: 400, vx: 1, vy: 0.5 }), t7.game, 10);
    expect(made.length).toBe(10);
    for (const d of made) {
      expect(d.noGravity).toBe(true);                       // ng=true 档跳过随机半区=确定性
      expect(d.vx).toBeCloseTo(0.8);                        // 0 + p.vx×0.8（无类型特型）
      expect(d.vy).toBeCloseTo(0.4);
      expect(d.scale as number).toBeGreaterThanOrEqual(0.9);   // jitter ±0.2 界内
      expect(d.scale as number).toBeLessThanOrEqual(1.2);
    }
  });

  it('B4 Game 链 typed 直通：失败拍 doFailedDismountDust(this, 计数×20)（spawnDust 面）', async () => {
    const p = makeRider(55, true);
    const r1 = await pressR(p, 0, null, true);
    expect(r1.calls.typed).toBe(20);                              // M3 typed 支摘除 → 0=红
    expect(r1.calls.particles).toEqual([]);                       // 回退不并联
    const r2 = await pressR(p, 1, r1.loc, true);
    expect(r2.calls.typed).toBe(40);
  });

  it('B5 反编译锚：DoFailedDismountDust 尘型/Inflate/56 黑臂', () => {
    const i = vanMount.indexOf('public void DoFailedDismountDust(Player mountedPlayer, int dustAmount)');
    expect(i).toBeGreaterThan(-1);
    const body = vanMount.slice(i, i + 1600);
    expect(body).toContain('hitbox.Inflate(10, 10)');
    expect(body).toContain('int spawnDust = _data.spawnDust;');
    expect(body).toContain('if (_type == 56)');
    expect(body).toContain('GetFairyQueenWeaponsColorFull');
    // 消费位：QuickMount 计数×20（Player.cs:6052）
    const j = vanPlayer.indexOf('mount.DoFailedDismountDust(this, FailedNoSpaceCount * 20)');
    expect(j).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// C. 件3 R 键成功拍出生尘（DoSpawnDust :6440-6635 1:1;dismount/setMount 双消费）
// ---------------------------------------------------------------------------
describe('BJ704-G18 C 出生尘（成功拍/setMount 出生面/特型支）', () => {
  it('C1 R 键成功拍：dismount(p, this) 出尘 100（mount 55 通用支;旧零尘=债3 本体）', async () => {
    const p = makeRider(55, false);                         // 开阔地 → ok 支
    const r = await pressR(p, 0, null, true);
    expect(r.calls.typed).toBe(100);                              // M6 撤 game 透传 → 0=红;M9 数量错=红
    expect(p.ridingMount).toBe(false);
  });

  it('C2 三连败链尘面：失败 20+40,第 3 拍强制 0（ignoreEffect:true 免尘）+传送', async () => {
    const p = makeRider(55, true);
    const r1 = await pressR(p, 0, null, true);
    const r2 = await pressR(p, r1.count, r1.loc, true);
    const r3 = await pressR(p, r2.count, r2.loc, true);
    expect(r3.calls.typed).toBe(0);                               // M7 第 3 拍误传 game → 100=红
    expect(r3.calls.tp).toBe(1);
    expect(p.ridingMount).toBe(false);
  });

  it('C3 setMount 出生面：100 尘×_data.spawnDust,盒=(x-20,y,w+40,h)（:6366/:6508）', () => {
    const p = makeRider(3, false);
    const before = p.x;
    const t = typedGame();
    p.mount.setMount(49, p as never, t.game);               // 49 猪鲨（spawnDust=35,通用支）
    expect(t.calls.length).toBe(100);                       // M8 撤出生面 → 0=红
    expect(t.calls[0]).toMatchObject({ x: before - 20, y: p.y, w: p.w + 40, h: p.h, type: 35, alpha: 0, scale: 1 });
  });

  it('C4 特型支：52 狼=100×尘267 紫微光 α60;62-65 帕鲁=100×尘306 青光 α60 scale2', () => {
    const t52 = typedGame();
    new MountInstance().setMount(52, view(), t52.game);
    expect(t52.calls.length).toBe(100);
    expect(t52.calls[0]).toMatchObject({ type: 267, alpha: 60, color: { r: 130, g: 60, b: 255, a: 70 }, scale: 1 });
    const t64 = typedGame();
    new MountInstance().setMount(64, view(), t64.game);
    expect(t64.calls.length).toBe(100);
    expect(t64.calls[0]).toMatchObject({ type: 306, alpha: 60, color: { r: 100, g: 227, b: 255, a: 127 }, scale: 2 });
  });

  it('C5 变身骑 61 下坐盒：底锚 DefaultSize(20,42)+Inflate10（:6509-6521）+抽稀门计数∈[1,99]', () => {
    const p = makeRider(61, false);                         // 缩盒 20×18
    const t = typedGame();
    expect(p.mount.tryDismount(p, t.game)).toBe(true);
    const bx = Math.trunc(p.x + p.w / 2), by = Math.trunc(p.y + p.h);
    expect(t.calls.length).toBeGreaterThanOrEqual(1);       // 61 抽稀（isDismounting 半跳）
    expect(t.calls.length).toBeLessThanOrEqual(99);
    for (const c of t.calls) {
      expect(c).toMatchObject({ x: bx - 20, y: by - 52, w: 40, h: 62, type: 43 });   // 61 spawnDust=43 ng
    }
  });

  it('C6 滚轴鞋 57：num=40+脚底带盒（:6504-6507/:6522-6528）+noLightEmittance 后置', () => {
    const made: Array<Record<string, unknown>> = [];
    const t = typedGame(() => { const d = { scale: 1, vx: 0, vy: 0, noGravity: false, noLightEmittance: false }; made.push(d); return d; });
    const m = new MountInstance();
    m.setMount(57, view({ x: 300, y: 400, w: 20, h: 42 }), t.game);
    expect(t.calls.length).toBe(40);                        // 通用支 100 → M9 红
    expect(t.calls[0]).toMatchObject({ x: 300 - 10, y: 400 + 42 - 10, w: 30, h: 10, type: 31 });
    expect(made.length).toBe(40);
    for (const d of made) expect(d.noLightEmittance).toBe(true);   // :6571 滚轴鞋专用
  });

  it('C7 反编译锚：DoSpawnDust 消费位（Dismount !ignoreEffect/SetMount 尾）+52/62-65 特型', () => {
    const i = vanMount.indexOf('private void DoSpawnDust(Player mountedPlayer, bool isDismounting)');
    expect(i).toBeGreaterThan(-1);
    const body = vanMount.slice(i, i + 2200);
    expect(body).toContain('_type == 52');
    expect(body).toContain('IsRollerSkates[_type]');
    const d = vanMount.indexOf('DoSpawnDust(mountedPlayer, isDismounting: true)');
    expect(d).toBeGreaterThan(-1);
    const s = vanMount.indexOf('DoSpawnDust(mountedPlayer, isDismounting: false)');
    expect(s).toBeGreaterThan(d);                           // SetMount :6366 在 Dismount :6234 后
  });
});

// ---------------------------------------------------------------------------
// D. 件4 UpdateFailedDismount（Player.cs:6031-6037/:24922）
// ---------------------------------------------------------------------------
describe('BJ704-G18 D 下坐失败计数逐拍清零（异地/死亡/下坐三腿）', () => {
  /** 直调 Game.updateFailedDismount（fake-this 三面） */
  async function tickDismount(p: P, count: number, loc: { tx: number; ty: number } | null) {
    const { Game } = await import('../src/core/Game');
    const proto = Game.prototype as unknown as Record<string, (this: unknown) => void>;
    const fake = { player: p, mountNoSpaceCount: count, mountNoSpaceLocation: loc };
    proto.updateFailedDismount.call(fake);
    return (fake as { mountNoSpaceCount: number }).mountNoSpaceCount;
  }

  it('D1 三腿判别：同格保持/异格清零/死亡清零/下坐清零', async () => {
    const p = makeRider(55, true);
    const loc = { tx: Math.trunc(p.x / 16), ty: Math.trunc(p.y / 16) };
    expect(await tickDismount(p, 2, loc)).toBe(2);          // 同格保持
    p.x += 16;                                              // 移一格
    expect(await tickDismount(p, 2, loc)).toBe(0);          // M11 撤位置腿 → 2=红
    p.dead = true;
    expect(await tickDismount(p, 2, loc)).toBe(0);          // dead 腿
    p.dead = false;
    p.mount.reset();                                        // 下坐（!active）
    expect(await tickDismount(p, 2, loc)).toBe(0);          // !mount.Active 腿
  });

  it('D2 失败拍记录 FailedNoSpaceLocation（:6047 ToTileCoordinates 截断格）', async () => {
    const p = makeRider(55, true);
    const r = await pressR(p, 0);
    expect(r.loc).toEqual({ tx: Math.trunc(p.x / 16), ty: Math.trunc(p.y / 16) });
  });

  it('D3 端到端：异地清零后计数重启——异地两败+回原点再败一次≠第 3 拍（vanilla 已清）', async () => {
    const p = makeRider(55, true);
    // 败 1 @A
    let r = await pressR(p, 0, null, true);
    expect(r.count).toBe(1);
    // 移动一格 + 逐拍清零（vanilla UpdateFailedDismount）
    p.x += 16;
    const cnt = await tickDismount(p, r.count, r.loc);
    expect(cnt).toBe(0);                                    // M10 撤调用 → 1=红
    // 回原点再败三次（无移动）:1→2→3 强制
    p.x -= 16;
    r = await pressR(p, cnt, { tx: Math.trunc(p.x / 16), ty: Math.trunc(p.y / 16) }, true);
    expect(r.count).toBe(1);                                // 旧仓不清=此处 2=提前强制的根
    r = await pressR(p, r.count, r.loc, true);
    expect(r.count).toBe(2);
    expect(r.calls.tp).toBe(0);                                   // 第 2 拍不强制
    r = await pressR(p, r.count, r.loc, true);
    expect(r.count).toBe(3 - 3);                            // 第 3 拍强制清零
    expect(r.calls.tp).toBe(1);
    expect(p.ridingMount).toBe(false);
  });

  it('D4 结构锁：fixedUpdate 挂点 + 失败拍记录/typed 尘/ok 支 game 透传', () => {
    const fx = gameSrc.indexOf('private fixedUpdate(dt: number)');
    const call = gameSrc.indexOf('this.updateFailedDismount();', fx);
    expect(call).toBeGreaterThan(fx);                       // M10 撤调用=锚失红
    const body = gameSrc.slice(
      gameSrc.indexOf('private tryDismountMount(): void {'),
      gameSrc.indexOf('private updateFailedDismount(): void {'));
    expect(body).toContain('p.mount.dismount(p, this);');                     // M6
    expect(body).toContain('this.mountNoSpaceLocation = { tx: Math.trunc(p.x / 16), ty: Math.trunc(p.y / 16) };');
    expect(body).toContain('p.mount.doFailedDismountDust(p, this, this.mountNoSpaceCount * 20);');
    expect(body).not.toContain('10 + this.mountNoSpaceCount * 20');           // M2 旧公式禁回潮
    // 第 3 拍强制支不传 game（ignoreEffect:true——调用行尾注,窗取注释前 300 字）
    const forced = body.indexOf('Dismount(ignoreEffect:true)');
    expect(forced).toBeGreaterThan(-1);
    expect(body.slice(Math.max(0, forced - 300), forced)).toContain('p.mount.dismount(p);');   // M7 误传 game=形变红
  });
});

// ---------------------------------------------------------------------------
// E. 件5 同型坐骑物品使用 no-op（SetMount :6263 早退）
// ---------------------------------------------------------------------------
describe('BJ704-G18 E 同型鞍使用=无操作（物品路径 :43099;R 键/buff 栏才是下坐入口）', () => {
  /** 直调 Game.useMountItem（fake-this：player+playSfxFile） */
  async function useSaddle(p: P, vid: number) {
    const { Game } = await import('../src/core/Game');
    const proto = Game.prototype as unknown as Record<string, (this: unknown, v: number) => boolean>;
    const tracks: Array<[string, number]> = [];
    const fake = {
      player: p,
      playSfxFile: (f: string, vol: number) => { tracks.push([f, vol]); },
    };
    const ok = proto.useMountItem.call(fake, vid);
    return { ok, tracks };
  }

  it('E1 同型：保持骑乘+useTime 20+UseSound（旧「同型下坐」分歧对齐 vanilla）', async () => {
    const p = makeRider(3, false);                          // 骑史莱姆 3
    p.useTime = 0;
    const { ok, tracks } = await useSaddle(p, 2430);        // 粘鞍 2430 → mount 3
    expect(ok).toBe(true);
    expect(p.ridingMount).toBe(true);                       // M12 回下坐 → false=红
    expect(p.mount.type).toBe(3);
    expect(p.useTime).toBe(20);
    expect(tracks).toEqual([['Item_81', 0.8]]);             // M13 撤 UseSound → []=红
  });

  it('E2 异型换骑照常（SetMount active 支）+R 键下坐入口不受影响', async () => {
    const p = makeRider(3, false);
    const { ok, tracks } = await useSaddle(p, 2428);        // 绒毛胡萝卜 → mount 1
    expect(ok).toBe(true);
    expect(p.mount.type).toBe(1);                           // 换骑
    expect(tracks).toEqual([['Item_79', 0.8]]);
    // R 键（QuickMount 骑乘支）仍下坐——下坐唯一主动入口
    const r = await pressR(p, 0);
    expect(p.ridingMount).toBe(false);
    expect(r.calls.tp).toBe(0);
  });

  it('E3 反编译锚：:43099 SetMount 物品支 + :6263 _type==m 早退 + :31935 早拆门同型豁免', () => {
    const i = vanPlayer.indexOf('mount.SetMount(item.mountType, this);');
    expect(i).toBeGreaterThan(-1);
    const j = vanMount.indexOf('if (_type == m || m <= -1 || m >= MountID.Count');
    expect(j).toBeGreaterThan(-1);
    expect(vanMount.slice(j, j + 220)).toContain('return;');   // 条件行下一行早退
    const g = vanPlayer.indexOf('if (TryingToUseItem() && mount.Active && Mount.DismountsOnItemUse(mount.Type) && HeldItem.mountType != mount.Type)');
    expect(g).toBeGreaterThan(-1);                          // 同型豁免（55/56/61 亦不早拆）
  });

  it('E4 结构锁：useMountItem 同型支 no-op 形（tryDismountMount 禁回潮,限域）', () => {
    const s = gameSrc.indexOf('private useMountItem(vanillaItemId: number): boolean {');
    const body = gameSrc.slice(s, gameSrc.indexOf('private tryDismountMount', s));
    const sameType = body.slice(body.indexOf('if (p.mount.type === mountId) {'), body.indexOf('if (p.ridingCart)'));
    expect(sameType).toContain('return true;');
    expect(sameType).not.toContain('tryDismountMount');     // M12 同型下坐回潮=红
    expect(body).toContain('mountSfx(mountId);');           // UseSound 共用单源
  });
});

// ---------------------------------------------------------------------------
// F. 件6 注释锚勘正（Renderer.playerFrameRows + Player.ts 四处 :6219-6222）
// ---------------------------------------------------------------------------
describe('BJ704-G18 F 旧世代注释锚勘正（纯注释,行为零改动）', () => {
  it('F1 Player.ts：:6219-6222 全清 → :6228-6231/:6229-6231（1457 实锚）', () => {
    expect(playerSrc).not.toContain(':6219-6222');          // 旧世代锚清零
    expect(playerSrc).toContain('Mount.Dismount :6228-6231');
    expect(playerSrc).toContain('Mount.Dismount :6229-6231');
  });

  it('F2 Renderer.playerFrameRows：腿链/身体链锚换 1457 实锚+G18 勘误注', () => {
    // （旧锚串仍现于 G18 勘误注引文内=预期;判别力由下方正向锚承担——回退即失）
    expect(rendererSrc).toContain(':36430-36443 坐骑钉行');   // G17 销案注同锚
    expect(rendererSrc).toContain(':36501-36560 循环族');
    expect(rendererSrc).toContain('身体链 :36590-36905');
    expect(rendererSrc).toContain('BJ704-G18 锚勘误');
    expect(rendererSrc).toContain(':36570-36589 覆写族');
  });

  it('F3 vanilla 实证：legs==140/217 真身在 PlayerFrame 尾（旧锚 :36195/:36202 指进 RefreshItems 域）', () => {
    const mountPin = vanPlayer.indexOf('legFrame.Y = legFrame.Height * 6');
    const legs140 = vanPlayer.indexOf('if (legs == 140)', mountPin);   // 首现 :36172 在 PlayerFrame 外,fromIndex 限定
    const legs217 = vanPlayer.indexOf('if (legs == 217 && (sitting.isSitting || sleeping.isSleeping))');
    expect(mountPin).toBeGreaterThan(-1);
    expect(legs140).toBeGreaterThan(mountPin);              // 140 特殊行在腿链循环族之后
    expect(legs217).toBeGreaterThan(legs140);
    expect(rendererSrc).toContain(':36907-36919');          // 勘正后锚
    expect(rendererSrc).toContain(':36921-36925');
  });

  it('F4 Mounts.ts 尘面结构锁：MountDustGame 视图 + doFailed/doSpawn 双方法在位', () => {
    expect(mountsSrc).toContain('export interface MountDustGame');
    expect(mountsSrc).toContain('doFailedDismountDust(p: MountedPlayerView, game: MountDustGame | undefined, dustAmount: number)');
    expect(mountsSrc).toContain('doSpawnDust(p: MountedPlayerView, game: MountDustGame | undefined, isDismounting: boolean)');
    expect(mountsSrc).toContain('fairyQueenDustColor()');
  });
});
