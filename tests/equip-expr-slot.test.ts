// 表达式槽位提取回归（2026-08-19 booster 批）：
//   ① 数据层：vanilla-itemstats 的 wing/hs 槽位（Item.cs:31081
//      `wingSlot = (sbyte)(29 + type - 3468)` 算式族 3468-3471 月总前四翅膀 →
//      槽 29-32；:30802 `headSlot = type + 186 - 3372` → 3372/3373 Boss 面具
//      186/187——此前提取器只认字面量，四件 acc=1 无 wing、两件整体失踪）
//   ② 翅膀链：wingStatOf 29-32（WingStatsInitializer.cs:55-58）+ Player.equipStats
//   ③ 目录/装备/合成：vi_ 注册 + armorAccepts（双翅膀互斥）+ 古代操纵机配方
//   ④ 视觉表：9/29/31/32 绘制分支（PlayerDrawLayers.cs:964-969/:980-986/:1069-1104）
//   ⑤ 提取器审计（spawn --audit，extract-audit 同法）：pinned 与已提交 JSON
//      deep equal + 基数 + 两次运行输出一致（确定性；文件级 extract→patch 全链
//      两次 md5 一致已手工验证：五产物三连跑 md5 全等，见 tools 提取器头注）
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vanillaStatOfVid, statOfInternal } from '../src/data/vanillaItemStats';
import { wingStatOf } from '../src/data/vanillaWingStats';
import { wingDrawOf, stepWingFrame, FLAP_HOVER_SET, VISUAL_HOVER_SET,
  type WingFrameState, type WingFrameInput } from '../src/data/vanillaWingVisuals';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey, VANILLA_RECIPES } from '../src/data/vanillaRecipes';
import { Inventory } from '../src/items/Inventory';
import { Player } from '../src/entities/Player';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CS_PRESENT = existsSync(join(ROOT, '..', 'Terarria1457', 'Terraria', 'Item.cs'));
const _iid = (vid: number): number => ITEM_BY_KEY[vanillaItemKey(vid)!];

describe('表达式槽位数据（Item.cs:30802 / :31081）', () => {
  it('3468-3471 月总前四翅膀 → wingSlot 29/30/31/32 + acc=1（:31072-31082）', () => {
    // (sbyte)(29 + type - 3468)：日耀之翼 3468→29 / 星旋强化翼 3469→30 /
    // 星云斗篷 3470→31 / 星尘之翼 3471→32（ItemID.cs:8475-8481）
    expect(vanillaStatOfVid(3468)).toMatchObject({ acc: 1, wing: 29 });
    expect(vanillaStatOfVid(3469)).toMatchObject({ acc: 1, wing: 30 });
    expect(vanillaStatOfVid(3470)).toMatchObject({ acc: 1, wing: 31 });
    expect(vanillaStatOfVid(3471)).toMatchObject({ acc: 1, wing: 32 });
  });

  it('3372/3373 Boss 面具 → headSlot 186/187 + vanity（:30798-30808）', () => {
    // headSlot = type + 186 - 3372：拜月教邪教徒面具→186 / 月亮领主面具→187
    expect(vanillaStatOfVid(3372)).toEqual({ s: 'h', hs: 186, van: 1 });
    expect(vanillaStatOfVid(3373)).toEqual({ s: 'h', hs: 187, van: 1 });
  });
});

describe('booster 翅膀属性链（WingStatsInitializer.cs:55-58）', () => {
  it('29/32 日耀/星尘：(180t, 9 速, ×2.5 加速, 无悬浮)；30/31 星旋/星云：悬浮族 12/12', () => {
    expect(wingStatOf(29)).toMatchObject({ time: 180, accSpeed: 9, accelMult: 2.5, hover: false });
    expect(wingStatOf(32)).toMatchObject({ time: 180, accSpeed: 9, accelMult: 2.5, hover: false });
    expect(wingStatOf(30)).toMatchObject({ time: 180, accSpeed: 6.5, accelMult: 1.5, hover: true, hoverSpeed: 12, hoverAccelMult: 12 });
    expect(wingStatOf(31)).toMatchObject({ time: 180, accSpeed: 6.5, accelMult: 1.5, hover: true, hoverSpeed: 12, hoverAccelMult: 12 });
  });

  it('Player 装备链：星旋强化翼 3469 → equipStats.wing 槽 30 悬浮档；日耀 3468 → 9 速无悬浮', () => {
    const p = new Player(0, 0, new Inventory());
    p.inv.armor[3] = { id: _iid(3469), stack: 1 };
    // hidden = hideVisibleAccessory 旗（UpdateEquips :12580 隐藏翼门,2026-08-23 批新增字段）
    expect(p.equipStats.wing).toEqual({ logic: 30, slot: 30, time: 180, accSpeed: 6.5, accelMult: 1.5, hover: true, hidden: false });
    p.inv.armor[3] = { id: _iid(3468), stack: 1 };
    expect(p.equipStats.wing).toEqual({ logic: 29, slot: 29, time: 180, accSpeed: 9, accelMult: 2.5, hover: false, hidden: false });
  });

  it('悬停档集合：flag19 hover 档(Player.cs:26471)含 29/30/32；visuals canHover(:28997)含 30/31', () => {
    for (const s of [29, 30, 32]) expect(FLAP_HOVER_SET.has(s)).toBe(true);
    for (const s of [30, 31]) expect(VISUAL_HOVER_SET.has(s)).toBe(true);
    expect(FLAP_HOVER_SET.has(31)).toBe(false);
    expect(VISUAL_HOVER_SET.has(29)).toBe(false);
    expect(VISUAL_HOVER_SET.has(32)).toBe(false);
  });
});

describe('目录/装备/合成', () => {
  it('六件 vi_ 全注册（vanillaItemKey 可反查 → 可搜索/可拾取）', () => {
    for (const vid of [3372, 3373, 3468, 3469, 3470, 3471]) {
      expect(vanillaItemKey(vid), `vid ${vid}`).toBeDefined();
      expect(_iid(vid)).toBeGreaterThan(0);
    }
  });

  it('armorAccepts：翅膀入功能/社交配饰槽 + 双翅膀互斥（:3202）；面具入头/时装头槽', () => {
    const inv = new Inventory();
    expect(inv.armorAccepts(3, _iid(3468))).toBe(true);   // 功能配饰槽
    expect(inv.armorAccepts(13, _iid(3468))).toBe(true);  // 社交配饰槽
    inv.armor[3] = { id: _iid(3468), stack: 1 };          // 已穿日耀之翼
    expect(inv.armorAccepts(4, _iid(3469))).toBe(false);  // 第二只翅膀被拒（双翅膀互斥）
    inv.armor[3] = null;
    expect(inv.armorAccepts(0, _iid(3372))).toBe(true);   // 头盔槽
    expect(inv.armorAccepts(10, _iid(3372))).toBe(true);  // 时装头槽
    expect(inv.armorAccepts(1, _iid(3372))).toBe(false);  // 胸甲槽不收
  });

  it('合成：四翅膀 = 14 对应碎片 + 10 夜明锭 @ 古代操纵机（Recipe.cs:12738-12763）', () => {
    const frags = [3458, 3456, 3457, 3459];   // Solar/Vortex/Nebula/Stardust 碎片
    for (let i = 0; i < 4; i++) {
      const r = VANILLA_RECIPES.filter((x) => x.create === 3468 + i);
      expect(r, `3468+${i}`).toHaveLength(1);
      expect(r[0].tile).toBe(412);
      expect(r[0].items).toEqual([{ id: frags[i], stack: 14 }, { id: 3467, stack: 10 }]);
    }
  });
});

describe('翅膀绘制表（PlayerDrawLayers.cs generic 尾段分支）', () => {
  it('9/29 烈焰/日耀：4 帧 generic 锚 + mainGlow c250a100sq（:964-969 Color(250³,100)×s²）', () => {
    for (const s of [9, 29]) {
      expect(wingDrawOf(s).frames).toBe(4);
      expect(wingDrawOf(s).anchor).toEqual([-9, -19]);
      expect(wingDrawOf(s).mainGlow).toBe('c250a100sq');
      expect(wingDrawOf(s).alwaysAir).toBeFalsy();       // generic 尾段无空中门
    }
    // 29 独有叠画：自身切片 ×1.06 纯加色（:1069-1074，Color(255³,0)·s²×0.5）
    expect(wingDrawOf(29).overlay).toMatchObject({ kind: 'selfAdd', scale: 1.06, stealthSq: true, alpha: 127.5 });
    expect(wingDrawOf(9).overlay).toBeUndefined();
  });

  it('31 星云：lit 族 + litAlpha 220（:980-982）+ nebula 脉冲叠画；32 星尘：litAlpha 127（:984-986）+ Glow_183 ×1.06', () => {
    expect(wingDrawOf(31)).toMatchObject({ frames: 4, litAlpha: 220 });
    expect(wingDrawOf(31).mainGlow).toBeUndefined();     // 基色仍 colorArmorBody（lit）
    expect(wingDrawOf(31).overlay).toMatchObject({ kind: 'nebula' });
    expect(wingDrawOf(32)).toMatchObject({ frames: 4, litAlpha: 127 });
    expect(wingDrawOf(32).overlay).toMatchObject({ kind: 'glowAdd', file: 'Glow_183.png', scale: 1.06 });
    expect(wingDrawOf(30).overlay).toMatchObject({ kind: 'plain', file: 'Glow_181.png', alpha: 127 });  // :1038-1043 原有
  });

  it('帧状态机：32 推进档 3 / 下落帧 3（Player.cs:29993-30000）；29/31 默认档 4 / 下落 1', () => {
    const st = (): WingFrameState => ({ frame: 0, counter: 0 });
    const inp = (over: Partial<WingFrameInput> = {}): WingFrameInput => ({
      flap: false, jump: false, vy: 0, controlJump: false, controlLR: false,
      hoverDown: false, hoverUp: false, wingTime: 100, glide: false,
      downDash: false, waterFloat: false, shouldDraw: true, ...over,
    });
    // 32：flap rate 3 → 每 4 tick 推一帧（counter > num35=3）
    const s32 = st();
    for (let t = 0; t < 3; t++) stepWingFrame(32, s32, inp({ flap: true }));
    expect(s32.frame).toBe(0);
    stepWingFrame(32, s32, inp({ flap: true }));
    expect(s32.frame).toBe(1);
    // 32：下落帧 3（默认族是 1）
    const f32 = st();
    stepWingFrame(32, f32, inp({ vy: 5 }));
    expect(f32.frame).toBe(3);
    // 29/31：默认 rate 4（第 5 tick 推帧）+ 下落帧 1
    const s29 = st();
    for (let t = 0; t < 4; t++) stepWingFrame(29, s29, inp({ flap: true }));
    expect(s29.frame).toBe(0);
    stepWingFrame(29, s29, inp({ flap: true }));
    expect(s29.frame).toBe(1);
    for (const s of [29, 31]) {
      const f = st();
      stepWingFrame(s, f, inp({ vy: 5 }));
      expect(f.frame).toBe(1);
    }
  });
});

// 审计层：C# 反编译源不存在（其他环境）时 warn 跳过，不阻塞
(CS_PRESENT ? describe : describe.skip)('提取器审计（spawn --audit）', () => {
  const run = () => {
    const r = spawnSync('node', [join(ROOT, 'tools', 'extract-equip-prefix.mjs'), '--audit'], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    });
    return { stdout: r.stdout ?? '', status: r.status };
  };

  it('pinned 表达式槽位件与已提交 JSON 一致 + 基数（itemstats 1129 / wing 51 / head 273;★BJ183 1457 基准重计）', () => {
    const { stdout, status } = run();
    const j = JSON.parse(stdout.trim().split('\n').pop()!);
    // ★BJ183 2026-09-20 基准 1456→1457:1457 新配饰 6156-6195 族入表(31 件)+贯穿组
    // 归属修复,基数 983→1014/head 270→273/body 199→201/legs 167→169/acc 340→371
    // ★BJ744 改判史：BJ740 ACC15/16（itemstats −5 手机族误资格键 +120 音乐盒101/
    //  变声15/巨柱4 helper 内置位 {acc:0,van:1}）→ itemstats 1014→1129 / acc 371→486。
    expect(j.counts).toEqual({ itemstats: 1129, head: 273, body: 201, legs: 169, acc: 486, wing: 51 });
    // 翅膀四件：提取器输出 = 已提交条目（无 van，无差异）
    for (const vid of [3468, 3469, 3470, 3471]) {
      expect(j.pinned[String(vid)]).toEqual(vanillaStatOfVid(vid));
    }
    // 面具两件：提取器输出是 patch-vanity 之前（无 van；van 由 patch 链补）
    expect(j.pinned['3372']).toEqual({ s: 'h', hs: 186 });
    expect(j.pinned['3373']).toEqual({ s: 'h', hs: 187 });
    void status;
  });

  it('两次运行输出逐字节一致（提取确定性——文件级全链两次 md5 一致的运行时面）', () => {
    const a = run();
    const b = run();
    expect(a.stdout).toBe(b.stdout);
  });
});
