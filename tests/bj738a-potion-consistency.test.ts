// ★BJ738-A issue #28（2026-10-31）：药水使用一致性审计 8 项（P01-P08）判别锁。
//
// 原版锚全部亲读 Terarria1457 重锚（issue 行号=1.4.5.8 第三方仓,已弃）：
//   P01 Player.cs:37782-37807（双锚/返程）+ :43472-43497（触发拍）+
//      PotionOfReturnGateInteractionChecker.cs:15-50 + PotionOfReturnHelper.cs:10-23
//      + ReturnGatePlayerRenderer.cs + PotionOfReturnGateHelper.cs + Main.cs:57317-57370
//   P02 Player.cs:43536 Male=!Male + :3389-3406 Male setter（AltGenderReference）+
//      PlayerVariantID.cs:11 + Item.cs:26321-26330（17/17/Item6）
//   P03 Item.cs:91/95 + Player.cs:25676-25682 + :52485-52518（AddBuff(21,tick)）
//   P04 Player.cs:25672/:25839/:29167-29181（AdjustRemainingPotionSickness）
//   P05 Player.cs:5493-5586（QuickHeal 全链：门/最佳选药/bank4）
//   P06 Player.cs:5592 门 + DebugOptions.cs:26（ManaV2=true）/:32（ManaPotionDelay=false）
//   P07 Item.cs:48040-48395（SetFoodDefaults 85 case）+ :48544-48565（animationTime 17）
//   P08 Item.cs:4195-4212（case 226/227 共享,this.type=227）
//
// 变异恰红映射（M1-M9,每项至少一刀）：
//   M1 P02 对表→自造 0↔1     M2 P03 tick→整秒取整      M3 P04 调整钩拆除
//   M4 P05 heal 路由→mana    M5 P06 满蓝门复活          M6 P07 Ale 出表
//   M7 P08 vid 归一拆门      M8 P01 双锚拆除            M9 P01 右键臂拆除
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { Game } from '../src/core/Game';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, VANILLA_VID_NORMALIZE } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { itemFuncOfVid } from '../src/data/vanillaItemFunc';
import { BuffType } from '../src/stats/Buffs';
import { defaultVoiceVariant } from '../src/player/Appearance';
import { newWiresRadialState } from '../src/stats/wiresRadial';
import { buildItemSearchPool } from '../src/ui/itemSearch';
import {
  potionOfReturnGateCenterOf, potionOfReturnGateHitbox, gateHitboxContains,
  gateHitboxClosestPoint, potionOfReturnGateFrameOf, potionOfReturnGateDustSpec,
  GATE_FW, GATE_FH,
} from '../src/render/PotionOfReturnGate';
import { withMutation, lockTargetFile, unlockTargetFile } from './mutation-guard';

const GAME = dirname(__dirname);                          // game/
const REPO = join(GAME, '..');                            // 仓根（Terarria1457 反编译锚）
const SRC = (p: string): string => readFileSync(join(GAME, 'src', p), 'utf8');
const VCS = (p: string): string => readFileSync(join(REPO, 'Terarria1457', p), 'utf8');
const GT = join(GAME, 'src', 'core', 'Game.ts');
const PT = join(GAME, 'src', 'entities', 'Player.ts');
const ICT = join(GAME, 'src', 'data', 'vanillaItemCombat.ts');
const ITM = join(GAME, 'src', 'data', 'items.ts');
const EXT_MISSING = !existsSync(join(REPO, 'Terarria1457', 'Terraria', 'Player.cs'));

const VI_ID = (vid: number): number => ITEM_BY_KEY[VANILLA_ITEM_KEY_BY_ID[vid]] ?? -1;
const GENDER = VI_ID(2756), POR = VI_ID(4870), ALE = VI_ID(353), SAKE = VI_ID(2266);
const MUSHROOM = VI_ID(5), RESTORE = VI_ID(227), HEAL188 = VI_ID(188), LESSER28 = VI_ID(28);
const SUPERHEAL = VI_ID(3544), MANA189 = VI_ID(189), STONE = VI_ID(535);
const OLD226 = ITEM_BY_KEY['vi_226_LesserRestorationPotion'];   // 存量 SW 档残面（归一后不可达,def 保留）

/** updateUse 可驱动的最小 Game 桩（BJ690 stubGame 同构扩展） */
function stubGame(spawn?: 'flat') {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  const player = new Player(50 * TILE, 90 * TILE, new Inventory());
  if (spawn !== 'flat') player.appearance = { skinVariant: 0, voiceVariant: 1 } as never;
  g.player = player;
  g.world = new World(120, 120, 30, 'bj738a');
  g.entities = { critters: [], npcs: [], enemies: [], projectiles: [], add: () => {} };
  let mouseWorld: [number, number] = [800, 0];
  g.input = {
    mouseDown: false, mouseHeld: false, mouseX: 700, mouseY: 300,
    rightDown: false, uiBlocking: false, downAction: () => false,
  };
  g.camera = {
    tileUnder: () => [60, 60],
    screenToWorld: () => mouseWorld,
    worldToScreen: (x: number, y: number): [number, number] => [x - 800, y],
    x: 800, y: 0,
  };
  (g as { setMouseWorld: (p: [number, number]) => void }).setMouseWorld = (p) => { mouseWorld = p; };
  g.renderer = { canvas: { width: 800, height: 600 }, fullMap: { open: false }, timeUiHover: false, weatherUiHover: false };
  g.smartCursor = { showing: false };
  g.wiresRadial = newWiresRadialState();
  g.annotateMode = false;
  g.prevSwingMouse = false;
  g.mining = null;
  g.swingHitSet = new Set<number>();
  g.swingTileCutSet = new Set<number>();
  g.achievements = { handleSpecialEvent: () => {} };
  g.spawnDrop = vi.fn();
  g.addDamageNumber = () => {};   // quickConsume 治疗飘字面（非判别域）
  g.startCameraTransitionForPlayerTeleport = vi.fn();   // P01:相机过渡面（黑幕/lerp 细节非本刀判别域）
  const sounds: string[] = [];
  g.sfx = {
    play: (n: string) => { sounds.push('sfx:' + String(n)); },
    playWav: (n: string) => { sounds.push('wav:' + String(n)); },
    playWavFile: (n: string) => { sounds.push('wavf:' + String(n)); },
    playFiles: () => {},
  };
  g.playSfxFile = (n: string) => { sounds.push('sf:' + String(n)); };
  g.playSfxWav = (n: string) => { sounds.push('sw:' + String(n)); };
  g.playSfxFiles = (n: string[]) => { sounds.push('sfs:' + n.join(',')); };
  g.playUseSound = (vid: number, fb: string) => { sounds.push(`pus:${vid}:${fb}`); };
  g.cb = { onInventoryChanged: vi.fn(), onToast: vi.fn() };
  return {
    g, player, sounds,
    inv: player.inv,
    useLeft: () => {                       // 真实左键使用链（updateUse 全链）
      player.useTime = 0;
      (g.input as { mouseDown: boolean }).mouseDown = true;
      (g as unknown as { updateUse: (dt: number) => void }).updateUse(1 / 60);
      (g.input as { mouseDown: boolean }).mouseDown = false;
    },
    rightClick: () => {                    // 右键沿（rightClickTileNpcDispatch 直驱）
      (g.input as { rightDown: boolean }).rightDown = true;
      (g as unknown as { _prevRightDown: boolean })._prevRightDown = false;
      (g as unknown as { rightClickTileNpcDispatch: (tx: number, ty: number, h: null) => boolean })
        .rightClickTileNpcDispatch(60, 60, null);
    },
  };
}

// ================================================================
// ⓪ 数据面（反编译直读锚;缺仓 skip）
// ================================================================
describe.skipIf(EXT_MISSING)('BJ738 ⓪ 数据面：反编译直读', () => {
  it('P02 PlayerVariantID.AltGenderReference 对表 =(0↔4)(1↔5)(2↔6)(3↔7)(8↔9)(10↔11)', () => {
    const cs = VCS('Terraria.ID/PlayerVariantID.cs');
    const m = /CreateIntSet\(([^)]*)\)/.exec(cs)!;
    const nums = m[1].split(',').map((s) => Number(s.trim()));
    // CreateIntSet(default, k0,v0,k1,v1,…) 对序 → 映射表
    const table: Record<number, number> = {};
    for (let i = 1; i + 1 < nums.length; i += 2) table[nums[i]] = nums[i + 1];
    expect(table).toEqual({ 0: 4, 4: 0, 1: 5, 5: 1, 2: 6, 6: 2, 3: 7, 7: 3, 8: 9, 9: 8, 10: 11, 11: 10 });
  });
  it('P02 Item.cs case 2756：useAnimation=useTime=17 + UseSound=Item6（:26321-26330）', () => {
    const body = VCS('Terraria/Item.cs').split('\n').slice(26320, 26330).join('\n');
    expect(body).toContain('case 2756:');
    expect(body).toMatch(/UseSound = SoundID\.Item6;/);
    expect(body).toMatch(/useAnimation = 17;/);
    expect(body).toMatch(/useTime = 17;/);
  });
  it('P07 DefaultToFood animationTime 缺省 17;SetFoodDefaults 85 case 零 custom（:48544/:48040-48395）', () => {
    const ics = VCS('Terraria/Item.cs');
    expect(ics).toMatch(/int animationTime = 17\)/);
    const foodBody = ics.split('\n').slice(48040, 48396).join('\n');
    expect(foodBody).not.toContain('animationTime:');   // 85 case 全走缺省 17
    expect((foodBody.match(/case \d+:/g) ?? []).length).toBeGreaterThanOrEqual(85);
  });
  it('P08 Item.cs case 226/227 共享块首行 this.type = 227 + healLife 90（:4195-4212）', () => {
    const body = VCS('Terraria/Item.cs').split('\n').slice(4194, 4212).join('\n');
    expect(body).toMatch(/case 226:\s*\n\s*case 227:\s*\n\s*this\.type = 227;/);
    expect(body).toMatch(/healLife = 90;/);
    expect(body).toMatch(/potion = true;/);
  });
  it('P06 DebugOptions：ManaV2=true / ManaPotionDelay=false（默认态满蓝门不可达）', () => {
    const body = VCS('Terraria.Testing/DebugOptions.cs');
    expect(body).toMatch(/bool ManaV2 = true;/);
    expect(body).toMatch(/bool ManaPotionDelay = false;/);
  });
});

// ================================================================
// ① P02 性别转换药水（对表翻转 + 17t + Item6）
// ================================================================
describe('BJ738① P02 性转药水 2756', () => {
  for (const [from, to] of [[0, 4], [1, 5], [2, 6], [3, 7], [4, 0], [5, 1], [6, 2], [7, 3], [8, 9], [9, 8], [10, 11], [11, 10]] as const) {
    it(`skinVariant ${from} 喝 2756 → ${to}（ALT_GENDER_REFERENCE 对表;issue 实测输入 0..9 → [1,0,2,3,...] 修前病灶）`, () => {
      const s = stubGame();
      s.player.appearance = { skinVariant: from, voiceVariant: defaultVoiceVariant(from) } as never;
      s.inv.selected = 0;
      s.inv.slots[0] = { id: GENDER, stack: 2 };
      s.useLeft();
      expect((s.player.appearance as { skinVariant: number }).skinVariant).toBe(to);
      expect(s.inv.slots[0]!.stack).toBe(1);              // 消耗 1
    });
  }
  it('冷却 17t + 起手音 Item6（playUseSound 2756:mirror;旧 30t+drink=issue 实测病灶）', () => {
    const s = stubGame();
    s.inv.selected = 0;
    s.inv.slots[0] = { id: GENDER, stack: 2 };
    s.useLeft();
    expect(s.player.useTime).toBe(17);
    expect(s.sounds).toContain('pus:2756:mirror');
    expect(s.sounds).not.toContain('sfx:drink');
  });
  it('语音 1↔2 翻转保持（:43536-43542;3 不动）', () => {
    for (const [vv, want] of [[1, 2], [2, 1], [3, 3]] as const) {
      const s = stubGame();
      s.player.appearance = { skinVariant: 0, voiceVariant: vv } as never;
      s.inv.selected = 0;
      s.inv.slots[0] = { id: GENDER, stack: 1 };
      s.useLeft();
      expect((s.player.appearance as { voiceVariant: number }).voiceVariant).toBe(want);
    }
  });
});

// ================================================================
// ② P03 药水病 tick 精度（半秒保留）
// ================================================================
describe('BJ738② P03 药水病分档 tick 精度', () => {
  const sicknessOf = (vid: number, pStone: boolean): number => {
    const s = stubGame();
    if (pStone) s.player.inv.armor[3] = { id: STONE, stack: 1 };
    void s.player.equipStats;   // 装备态先落缓存（调整钩只在翻转拍触发）
    (s.g as unknown as { applyPotionSickness: (v: number) => void }).applyPotionSickness(vid);
    return s.player.buffs.active.get(BuffType.Resistance) ?? 0;
  };
  it('戴贤者石：蘑菇 5 → 22.5s（1800×0.75=1350t）;恢复药水 227 → 33.75s（2025t）——issue 实测 23/34 修前病灶', () => {
    expect(sicknessOf(MUSHROOM, true)).toBeCloseTo(22.5, 10);
    expect(sicknessOf(RESTORE, true)).toBeCloseTo(33.75, 10);
  });
  it('不戴石三档：30s/45s/60s（1800/2700/3600t 同值控制面）', () => {
    expect(sicknessOf(MUSHROOM, false)).toBe(30);
    expect(sicknessOf(RESTORE, false)).toBe(45);
    expect(sicknessOf(HEAL188, false)).toBe(60);
  });
  it('戴石治疗药 188 → 45s（2700t 恰整=issue 控制组同值面）', () => {
    expect(sicknessOf(HEAL188, true)).toBe(45);
  });
});

// ================================================================
// ③ P04 装备翻转当场调整现役药水病
// ================================================================
describe('BJ738③ P04 贤者石穿卸缩放现役 buff21', () => {
  it('剩 40s 装石 → 30s（×0.75）;卸下 → 40s（÷0.75 反向;AdjustRemainingPotionSickness :29167-29181）', () => {
    const s = stubGame();
    const p = s.player;
    void p.equipStats;                                   // 首算（无前态,不调整）
    expect(p.equipStats.pStone).toBe(false);
    p.buffs.apply(BuffType.Resistance, 40);              // 2400t
    p.inv.armor[3] = { id: STONE, stack: 1 };            // 穿石（equipStats 重算拍=翻转拍）
    expect(p.equipStats.pStone).toBe(true);
    expect(p.buffs.active.get(BuffType.Resistance)).toBeCloseTo(30, 10);   // 1800t
    p.inv.armor[3] = null;                               // 卸石
    expect(p.equipStats.pStone).toBe(false);
    expect(p.buffs.active.get(BuffType.Resistance)).toBeCloseTo(40, 10);   // 2400t 回放
  });
  it('截断语义：1001t 装石 → trunc(750.75)=750t=12.5s（(int) 截断非四舍五入,round=751 即红）', () => {
    const s = stubGame();
    const p = s.player;
    void p.equipStats;                                   // 首算（无石）
    p.buffs.apply(BuffType.Resistance, 1001 / 60);       // 1001t（非 4 倍数 → ×0.75 带小数）
    p.inv.armor[3] = { id: STONE, stack: 1 };
    void p.equipStats;                                   // 翻转拍 → ×0.75 截断
    expect(p.buffs.active.get(BuffType.Resistance)).toBeCloseTo(12.5, 10);
  });
  it('无 buff21 时穿卸零副作用（FindBuffIndex -1 早退）', () => {
    const s = stubGame();
    const p = s.player;
    void p.equipStats;
    p.inv.armor[3] = { id: STONE, stack: 1 };
    void p.equipStats;
    expect(p.buffs.active.has(BuffType.Resistance)).toBe(false);
  });
});

// ================================================================
// ④ P05 移动治疗键路由 QuickHeal + ⑤ P06 满蓝 QuickMana
// ================================================================
describe('BJ738④ P05 移动治疗键 = QuickHeal 同链', () => {
  it('400 上限/250HP,先 50 药后 200 药 → 选 200（最佳欠量）、HP 钳 400、50 药保留（issue 实测 300/首瓶=修前病灶）', () => {
    const s = stubGame();
    const p = s.player;
    p.hp = 250; p.baseMaxHp = 400;
    p.inv.slots[0] = { id: LESSER28, stack: 1 };
    p.inv.slots[1] = { id: SUPERHEAL, stack: 1 };
    (s.g as unknown as { quickDrinkPotion: (k: 'heal') => void }).quickDrinkPotion('heal');
    expect(p.hp).toBe(400);                              // 250+200 → 钳 400
    expect(p.inv.slots[0]).toEqual({ id: LESSER28, stack: 1 });   // 50 药不动
    expect(p.inv.slots[1]).toBeNull();                   // 200 药消耗
  });
  it('满血按移动键 → 静默不消耗（QuickHeal :5495 总门;issue 实测首瓶白耗+挂药水病=修前病灶）', () => {
    const s = stubGame();
    const p = s.player;
    p.hp = 400; p.baseMaxHp = 400;
    p.inv.slots[0] = { id: LESSER28, stack: 1 };
    (s.g as unknown as { quickDrinkPotion: (k: 'heal') => void }).quickDrinkPotion('heal');
    expect(p.inv.slots[0]).toEqual({ id: LESSER28, stack: 1 });
    expect(p.buffs.active.has(BuffType.Resistance)).toBe(false);
  });
  it('死亡拒用（:5495 dead 门）', () => {
    const s = stubGame();
    const p = s.player;
    p.hp = 10; p.baseMaxHp = 400; p.dead = true;
    p.inv.slots[0] = { id: LESSER28, stack: 1 };
    (s.g as unknown as { quickDrinkPotion: (k: 'heal') => void }).quickDrinkPotion('heal');
    expect(p.inv.slots[0]!.stack).toBe(1);
  });
});

describe('BJ738⑤ P06 满蓝 QuickMana（ManaV2=true 默认不拒）', () => {
  it('满蓝 + 背包 189 → 照选照耗（蓝溢出浪费=原版本相;issue 实测零反应=修前病灶）', () => {
    const s = stubGame();
    const p = s.player;
    p.mana = 200; p.baseMaxMana = 200;
    p.inv.slots[0] = { id: MANA189, stack: 1 };
    (s.g as unknown as { quickDrinkPotion: (k: 'mana') => void }).quickDrinkPotion('mana');
    expect(p.inv.slots[0]).toBeNull();                   // 消耗
    expect(p.mana).toBe(200);                            // 满蓝回蓝=浪费（原版同相）
    expect(p.buffs.active.has(BuffType.ManaSickness)).toBe(true);
  });
});

// ================================================================
// ⑥ P07 Ale 353 食物族时序（SetFoodDefaults 提取缺口）
// ================================================================
describe('BJ738⑥ P07 Ale/Sake 手喝动画', () => {
  it('数据面：itemCombat(353)={17,17}（族缺口补;Sake 2266 对照同值）', () => {
    expect(itemCombat(353)).toMatchObject({ useTime: 17, useAnimation: 17 });
    expect(itemCombat(2266)).toMatchObject({ useTime: 17, useAnimation: 17 });
  });
  it('行为面：手喝 Ale → 冷却 17t + 挥动窗 17（旧动画兜底 30=issue 实测病灶）+ Tipsy 120s', () => {
    const s = stubGame();
    s.inv.selected = 0;
    s.inv.slots[0] = { id: ALE, stack: 2 };
    s.useLeft();
    expect(s.player.useTime).toBe(17);
    expect((s.g as unknown as { swing: { dur: number } | null }).swing!.dur).toBe(17);
    expect(s.player.buffs.active.get(BuffType.Tipsy)).toBe(120);   // 7200t
    expect(s.inv.slots[0]!.stack).toBe(1);
  });
});

// ================================================================
// ⑦ P08 旧 ID 226 归一化
// ================================================================
describe('BJ738⑦ P08 SetDefaults(226)→227 归一', () => {
  it('vid 反查表：VANILLA_ITEM_KEY_BY_ID[226] ≡ [227]（wld 导入/掉落/授予全链同源）', () => {
    expect(VANILLA_ITEM_KEY_BY_ID[226]).toBe(VANILLA_ITEM_KEY_BY_ID[227]);
    expect(VANILLA_ITEM_KEY_BY_ID[226]).toContain('vi_227_');
    expect(VANILLA_VID_NORMALIZE).toEqual({ 226: 227 });
  });
  it('功能面：itemFuncOfVid(226) = 227 全量（healLife 90/potion;存量 SW 档残面纵深防御）', () => {
    expect(itemFuncOfVid(226)).toEqual(itemFuncOfVid(227));
    expect(itemFuncOfVid(226)?.healLife).toBe(90);
  });
  it('搜索池：vi_226 退位不入池、vi_227 在池（旧名空功能件不可再被搜出）', () => {
    const pool = buildItemSearchPool({ nameOf: () => 'x' });
    expect(pool.some((e) => e.vid === 226)).toBe(false);
    expect(pool.some((e) => e.vid === 227)).toBe(true);
  });
  it('使用面：存量 vi_226 条目手喝 → 回 90 HP + 药水病 45s（issue「不能通过药水功能入口使用」修后）', () => {
    const s = stubGame();
    const p = s.player;
    p.hp = 100; p.baseMaxHp = 400;
    s.inv.selected = 0;
    s.inv.slots[0] = { id: OLD226!, stack: 1 };
    (s.g as unknown as { addDamageNumber: () => void }).addDamageNumber = () => {};
    s.useLeft();
    expect(p.hp).toBe(190);
    expect(p.buffs.active.get(BuffType.Resistance)).toBe(45);   // restorationDelay 2700t
    expect(s.inv.slots[0]).toBeNull();
  });
});

// ================================================================
// ⑧ P01 回归药水 4870 双锚 + 返程门
// ================================================================
describe('BJ738⑧ P01 纯算面（PotionOfReturnGateHelper/PotionOfReturnHelper 1:1）', () => {
  it('门命中盒：home+(0,−21) 心、24×40（TryGetGateHitbox :15-23）', () => {
    const hb = potionOfReturnGateHitbox({ x: 1000, y: 2000 });
    expect(hb).toEqual({ cx: 1000, cy: 1979, hw: 12, hh: 20 });
    expect(gateHitboxContains(hb, 1000, 1979)).toBe(true);
    expect(gateHitboxContains(hb, 1000 - 12, 1979)).toBe(true);      // 左闭
    expect(gateHitboxContains(hb, 1000 + 12, 1979)).toBe(false);     // 右开（XNA Contains 半开）
    expect(gateHitboxContains(hb, 1000, 1979 - 20)).toBe(true);
    expect(gateHitboxContains(hb, 1000, 1979 + 20)).toBe(false);
  });
  it('closest point 钳盒内（Rectangle.ClosestPointInRect）', () => {
    const hb = potionOfReturnGateHitbox({ x: 0, y: 0 });
    expect(gateHitboxClosestPoint(hb, -500, 3)).toEqual([-12, -1]);    // y 钳上沿（盒 y∈[-41,-1)）
    expect(gateHitboxClosestPoint(hb, 500, -500)).toEqual([12, -41]);  // 钳右下角
    expect(gateHitboxClosestPoint(hb, 1, -30)).toEqual([1, -30]);      // 盒内原样
  });
  it('门贴图心 = 锚+(0,−23)（+(0,−21) 再 ctor Y−2）;帧 = (tick+X+Y)%40/5,Exit 反序 7−n', () => {
    expect(potionOfReturnGateCenterOf({ x: 500, y: 900 })).toEqual([500, 877]);
    expect(GATE_FW).toBe(36); expect(GATE_FH).toBe(46);   // 36×368=8 帧
    expect(potionOfReturnGateFrameOf(0, 500, 877, false)).toBe(3);      // (0+1377)%40=17 → ⌊17/5⌋
    expect(potionOfReturnGateFrameOf(0, 500, 877, true)).toBe(4);       // 7−3
    expect(potionOfReturnGateFrameOf(0, 500, 878, false)).toBe(3);      // (1378)%40=18 → 3（同帧带）
    expect(potionOfReturnGateFrameOf(0, 500, 883, false)).toBe(4);      // (1383)%40=23 → 4（含坐标错相）
  });
  it('尘 spec 三支：Entry-A 86/88 反向 / Entry-B 240 / Exit 86/88 无反转（SpawnReturnPortalDust :40-97）', () => {
    // Entry-A：掷序 gate(0)/branch(0)/dir(0)/type(0.4<0.5→86)/r(0.5)/scale(0.5)
    const a = potionOfReturnGateDustSpec(100, 200, true, (() => { let i = 0; return () => [0, 0, 0, 0.4, 0.5, 0.5][i++]; })())!;
    expect(a.type).toBe(86);
    expect(a.noLightEmittance).toBe(true); expect(a.noLight).toBe(false);
    // Entry-B：Next(2)=1 → 尘 240 + noLight
    const b = potionOfReturnGateDustSpec(100, 200, true, (() => { let i = 0; return () => [0, 1, 0, 0.5, 0.5][i++]; })())!;
    expect(b.type).toBe(240);
    expect(b.noLight).toBe(true); expect(b.noLightEmittance).toBe(false);
    // Exit：双支同型 86/88,无速度反转
    const e = potionOfReturnGateDustSpec(100, 200, false, (() => { let i = 0; return () => [0, 0, 0, 0.4, 0.5][i++]; })())!;
    expect(e.type).toBe(86);
    expect(e.noLightEmittance).toBe(true);
    // 门掷失败（Next(3)≠0）→ null
    expect(potionOfReturnGateDustSpec(0, 0, true, () => 0.5)).toBeNull();
  });
});

describe('BJ738⑧ P01 行为面（双锚建立/返程/右键门交互）', () => {
  it('4870 引导触发 → 双锚建立（original=传送前 Bottom,home=落位 Bottom;DoPotionOfReturn…SetTheComebackPoint :37782-37794）', () => {
    const s = stubGame();
    const p = s.player;
    p.x = 60 * TILE; p.y = 90 * TILE;                    // 远离出生点
    const oldBottom = { x: p.x + p.w / 2, y: p.y + p.h };
    (s.g as unknown as { fireRecallTeleport: (c: unknown) => void }).fireRecallTeleport(
      { vid: 4870, kind: 'spawn', triggerAt: 20, consume: true });
    expect(p.potionOfReturnOriginalUsePosition).toEqual(oldBottom);
    expect(p.potionOfReturnHomePosition).toEqual({ x: p.x + p.w / 2, y: p.y + p.h });
    expect(p.potionOfReturnHomePosition!.y).not.toBe(oldBottom.y);   // 确已传送（落点≠饮用点）
  });
  it('非 4870 传送（2350 回忆）不建锚', () => {
    const s = stubGame();
    (s.g as unknown as { fireRecallTeleport: (c: unknown) => void }).fireRecallTeleport(
      { vid: 2350, kind: 'spawn', triggerAt: 20, consume: true });
    expect(s.player.potionOfReturnOriginalUsePosition).toBeNull();
    expect(s.player.potionOfReturnHomePosition).toBeNull();
  });
  it('返程腿：Bottom 恰回饮用点 + 双锚清空 + Item6 双端音（Teleport(newPos,8) :37796-37807）', () => {
    const s = stubGame();
    const p = s.player;
    p.x = 60 * TILE; p.y = 90 * TILE;
    p.potionOfReturnOriginalUsePosition = { x: 30 * TILE, y: 80 * TILE };
    p.potionOfReturnHomePosition = { x: p.x + p.w / 2, y: p.y + p.h };
    (s.g as unknown as { potionOfReturnReturnToOriginalUsePosition: () => void })
      .potionOfReturnReturnToOriginalUsePosition();
    expect(p.x + p.w / 2).toBeCloseTo(30 * TILE, 6);     // 落位后 Bottom=原锚（+Size×(−0.5,−1)）
    expect(p.y + p.h).toBeCloseTo(80 * TILE, 6);
    expect(p.potionOfReturnOriginalUsePosition).toBeNull();
    expect(p.potionOfReturnHomePosition).toBeNull();
    expect(s.sounds.filter((n) => n === 'sfx:mirror').length).toBe(2);   // style 8 双端音
  });
  it('右键门交互：悬停命中盒+射程内右键 → 返程 + rightDown 消费 + tileInteractHappened 置旗（AttemptInteraction :44-50）', () => {
    const s = stubGame();
    const p = s.player;
    p.x = 60 * TILE; p.y = 60 * TILE;
    p.potionOfReturnOriginalUsePosition = { x: 30 * TILE, y: 80 * TILE };
    p.potionOfReturnHomePosition = { x: p.x + p.w / 2, y: p.y + p.h };
    (s.g as unknown as { setMouseWorld: (pt: [number, number]) => void }).setMouseWorld(
      [p.potionOfReturnHomePosition!.x, p.potionOfReturnHomePosition!.y - 21]);   // 命中盒心
    s.rightClick();
    expect(p.x + p.w / 2).toBeCloseTo(30 * TILE, 6);     // 已返程
    expect((s.g as unknown as { tileInteractHappened: boolean }).tileInteractHappened).toBe(true);
    expect((s.g as unknown as { input: { rightDown: boolean } }).input.rightDown).toBe(false);
  });
  it('右键在命中盒【外】→ 无返程（不消费）', () => {
    const s = stubGame();
    const p = s.player;
    p.x = 60 * TILE; p.y = 60 * TILE;
    p.potionOfReturnOriginalUsePosition = { x: 30 * TILE, y: 80 * TILE };
    p.potionOfReturnHomePosition = { x: p.x + p.w / 2, y: p.y + p.h };
    (s.g as unknown as { setMouseWorld: (pt: [number, number]) => void }).setMouseWorld(
      [p.potionOfReturnHomePosition!.x + 200, p.potionOfReturnHomePosition!.y - 21]);
    s.rightClick();
    expect(p.potionOfReturnOriginalUsePosition).not.toBeNull();   // 未返程
    expect((s.g as unknown as { input: { rightDown: boolean } }).input.rightDown).toBe(true);
  });
  it('悬停图标：门命中盒内 → cursorItemIcon 4870（DoHoverEffect :25-28;经 tickCursorIcon 尾位）', () => {
    const s = stubGame();
    const p = s.player;
    p.x = 60 * TILE; p.y = 60 * TILE;
    p.potionOfReturnOriginalUsePosition = { x: 30 * TILE, y: 80 * TILE };
    p.potionOfReturnHomePosition = { x: p.x + p.w / 2, y: p.y + p.h };
    (s.g as unknown as { setMouseWorld: (pt: [number, number]) => void }).setMouseWorld(
      [p.potionOfReturnHomePosition!.x, p.potionOfReturnHomePosition!.y - 21]);
    (s.g as unknown as { tickCursorIcon: () => void }).tickCursorIcon();
    expect(p.cursorItemIconEnabled).toBe(true);
    expect(p.cursorItemIconID).toBe(4870);
  });
});

// ================================================================
// ⑨ 变异恰红（withMutation 三层守卫+sha256 还原对拍）
// ================================================================
describe.skipIf(process.env.SW_BJ738A_MUT)('BJ738⑨ 变异自证（九发恰红+逐字节还原）', () => {
  const spawnVitest = (filter: string) => spawnSync(
    'npx', ['vitest', 'run', 'tests/bj738a-potion-consistency.test.ts', '--no-file-parallelism', '-t', filter], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
      env: { ...process.env, SW_BJ738A_MUT: '1' },
    });
  const mutate = (file: string, trigger: string, replacement: string, filter: string): void => {
    let pristineSha = '';
    withMutation(file, trigger, replacement, () => {
      const r = spawnVitest(filter);
      expect(r.status, `变异须证红: ${filter}\n${r.stdout}`).not.toBe(0);
      expect(r.stdout).toContain(filter);
    }, {
      label: `BJ738A ${filter}`,
      onPristine: (p) => { pristineSha = createHash('sha256').update(p).digest('hex'); },
    });
    lockTargetFile(file, `BJ738A 还原对拍 ${filter}`);
    try {
      const post = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(post, `还原对拍 ${file}`).toBe(pristineSha);
    } finally {
      unlockTargetFile(file);
    }
  };

  it('M1 P02 对表→自造 0↔1（skinVariant 0 喝出 1=修前病灶复活） → ①红', () => {
    mutate(GT,
      'p.appearance.skinVariant = ALT_GENDER_REFERENCE[v] ?? v;',
      'p.appearance.skinVariant = v === 0 ? 1 : 0;',
      'skinVariant 0 喝 2756');
  });
  it('M2 P03 tick→整秒取整（22.5→23=issue 实测病灶） → ②红', () => {
    mutate(GT,
      'this.player.buffs.apply(BuffType.Resistance, ticks / 60);',
      'this.player.buffs.apply(BuffType.Resistance, Math.round(ticks / 60));',
      '戴贤者石：蘑菇 5');
  });
  it('M3 P04 调整钩拆除（40s 穿石不缩） → ③红', () => {
    mutate(PT,
      'if (this._equipStatsCache !== null && this._equipStatsCache.pStone !== stats.pStone) {\n      this.adjustRemainingPotionSickness(stats.pStone);\n    }',
      'if (false) {\n      this.adjustRemainingPotionSickness(stats.pStone);\n    }',
      '剩 40s 装石');
  });
  it('M4 P05 heal 路由错接 mana（移动键选药失效） → ④红', () => {
    mutate(GT,
      "if (kind === 'heal') this.quickHeal();",
      "if (kind === 'heal') this.quickMana();",
      '400 上限/250HP');
  });
  it('M5 P06 满蓝门复活（ManaV2 默认态被违） → ⑤红', () => {
    mutate(GT,
      "if (!p || p.buffs.has(BuffType.Cursed) || p.cced || p.dead) return;   // :5592（ManaV2=true 默认态）",
      "if (!p || p.buffs.has(BuffType.Cursed) || p.cced || p.dead || p.mana >= p.maxMana) return;   // :5592（ManaV2=true 默认态）",
      '照选照耗');
  });
  it('M6 P07 Ale 出表（提取缺口复辟,动画兜底 30） → ⑥数据面红', () => {
    mutate(ICT,
      '    353, 357, 967, 969, 1787, 1911, 1919, 1920, 2267, 2268, 2425, 2426, 2427, 3195,',
      '    357, 967, 969, 1787, 1911, 1919, 1920, 2267, 2268, 2425, 2426, 2427, 3195,',
      'Sake 2266 对照同值');
  });
  it('M7 P08 vid 归一拆门（226 回落旧名空功能件） → ⑦反查表红', () => {
    mutate(ITM,
      'if (toKey !== undefined) VANILLA_ITEM_KEY_BY_ID[Number(fromVid)] = toKey;',
      'if (false) VANILLA_ITEM_KEY_BY_ID[Number(fromVid)] = toKey;',
      'wld 导入/掉落/授予全链同源');
  });
  it('M8 P01 双锚拆除（4870 只回家无回程门） → ⑧双锚红', () => {
    mutate(GT,
      'const porOriginalBJ738 = c.vid === 4870 ? { x: p.x + p.w / 2, y: p.y + p.h } : null;',
      'const porOriginalBJ738 = null;',
      '4870 引导触发');
  });
  it('M9 P01 右键臂拆除（点门无返程） → ⑧右键红', () => {
    mutate(GT,
      'this.potionOfReturnReturnToOriginalUsePosition();\n            this.input.rightDown = false;        // releaseUseTile=false（:48）',
      ';this.input.rightDown = false;        // releaseUseTile=false（:48）',
      '右键门交互：悬停命中盒');
  });
});
