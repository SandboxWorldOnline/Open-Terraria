// SW-FX2 补债批（2026-09-09）：buff 域 58 缺口收尾 + 关联四键
// （docs/audit/item-audit-2026-08-22.md 预审「58 缺口清单」+「📋 登记不修」节）。
//
// 本批定谳与落点：
//   A. 缺口清单完备性——审计 59 id 全清单（轻 46 已随 buff-defs-gap 批、重 13 中
//      125/126/139/140/322/325/385/386 已随随从杖伴生泛化批、376 已随 TorchGodPotion
//      批,残余重 4 件 40/41/42/127 本批补）∪ vanilla-pets.json 全表反查（含 3855
//      勘误后的 200）∪ MINION_BUFFS/PALWORLD 表——BUFF_BY_VANILLA 反查零落空。
//   B. 真值表——10 件新条目（40/41/42/127/202/217/219/259/261/268）vanillaBuff/
//      图标/l10n/隐字表成员/buffNoSave 语义逐项对 1457。
//   C. UpdatePet/UpdatePetLight 补挂面运行时（1457 Player.cs:17414-17445 →
//      Game.updatePetSlot）——装备宠物 buff 图标显示链（本批重项消费面）。
//   D. 四键：①3857 buffType 200→202（Item.cs:34018-34021）②healBlocked 静默拒用
//      （Player.cs:52856-52858）③quickConsume 缺省 3600（:5518-5524）④5573=限时
//      buff 376 不置旗 / 5043=置旗侧（:45611-45628）+ 5/1912 TryToResetHungerToNeutral
//      （:52507/:52513,IIIII219 已接,本批锁定）。
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BuffState, BuffType, BUFF_DEFS, buffTypeByVanilla, BUFF_NO_TIME_DISPLAY,
} from '../src/stats/Buffs';
import { Game, MINION_BUFFS, PALWORLD_MINION_BUFFS } from '../src/core/Game';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { petInfoOfVid } from '../src/data/vanillaPets';
import { itemFuncOfVid } from '../src/data/vanillaItemFunc';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { ITEM_BY_KEY } from '../src/data/items';
import petsJson from '../src/data/vanilla-pets.json';
import petaiJson from '../src/data/vanilla-petai.json';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameSrc = readFileSync(join(ROOT, 'src/core/Game.ts'), 'utf8');

/** 审计「58 缺口清单」原文 59 id（轻 46+重 13=59,文档标题 58 系误计） */
const AUDIT_GAP_IDS: ReadonlyArray<number> = [
  19, 27, 40, 41, 42, 45, 49, 50, 51, 52, 53, 54, 55, 56, 57, 61, 64, 65, 66,
  81, 82, 83, 84, 85, 91, 92, 125, 126, 127, 133, 134, 135, 136, 139, 140,
  152, 154, 155, 161, 173, 176, 179, 182, 188, 190, 200, 201, 213, 214, 216,
  263, 271, 322, 325, 335, 355, 376, 385, 386,
];

/** 本批新增（重 4 + 四键① 202 + pets 表对拍 5） */
const FX2_NEW_IDS = [40, 41, 42, 127, 202, 217, 219, 259, 261, 268] as const;

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  expect(k, `vid ${vid} 应在仓`).toBeDefined();
  return ITEM_BY_KEY[k!];
};

// ============ A. 缺口清单完备性 ============
describe('A. 缺口清单完备性（BUFF_BY_VANILLA 反查零落空）', () => {
  it('审计 59 id 全清单可反查（58 缺口正式收口）', () => {
    for (const v of AUDIT_GAP_IDS) {
      const t = buffTypeByVanilla(v);
      expect(t, `vanilla buff ${v} 应映射 BuffType`).toBeDefined();
      expect(BUFF_DEFS[t!].vanillaBuff).toBe(v);      // 往返一致
    }
  });

  it('vanilla-pets.json 全表（★SW-FX48 后 83 行）buff 可反查——装备宠物图标链无静默丢失', () => {
    const buffs = new Set<number>();
    for (const [, e] of Object.entries(petsJson)) buffs.add(e.buff);
    expect(buffs.size).toBeGreaterThanOrEqual(61);    // 3855 勘误后 200/201 各有行
    for (const b of buffs) {
      const t = buffTypeByVanilla(b);
      expect(t, `pets buff ${b}`).toBeDefined();
      // 图标 + 描述语料随注册位全量在位（UI 直链/悬停文案不落空）
      expect(existsSync(join(ROOT, 'public/sprites/vanilla', `Buff_${b}.png`)), `Buff_${b}.png`).toBe(true);
    }
  });

  it('随从杖伴生两表（24+4 件）buff 可反查（维护链依赖）', () => {
    for (const { buff } of MINION_BUFFS) expect(buffTypeByVanilla(buff), `minion ${buff}`).toBeDefined();
    for (const { buff } of PALWORLD_MINION_BUFFS) expect(buffTypeByVanilla(buff), `palworld ${buff}`).toBeDefined();
  });

  it('itemfunc 有 buffType 且物品在仓的全部 vid 可反查（静默丢失面收口）', () => {
    // 豁免（剩债登记,非本批可收口）:
    //  21 = Resistance 治疗副作用位（不主动施加）
    // ★SW-FX48（2026-09-12）：原豁免 284-304（1.4.5 boss 宠 21 件）已收口——
    //  vanilla-pets.json 补行 4797-4817（Item.cs:39417-39440）+ Buffs.ts 284-304
    //  收口位（BuffType 360-380）+ petai 17 条目,本扫面不再豁免
    const exempt = new Set<number>([21]);
    for (let vid = 1; vid <= 5700; vid++) {
      if (vanillaItemKey(vid) === undefined) continue; // 只锁在仓物品
      const f = itemFuncOfVid(vid);
      if (!f || !(f.buffType && (f.buffType as number) > 0) || exempt.has(f.buffType as number)) continue;   // ★D6:原版域 json 恒数字
      expect(buffTypeByVanilla(f.buffType as number), `vid ${vid} → buff ${f.buffType}`).toBeDefined();
    }
  });
});

// ============ B. 本批 10 件真值表 ============
describe('B. SW-FX2 新条目真值表（1457 对拍）', () => {
  const NEW_TYPES = FX2_NEW_IDS.map((v) => {
    const t = buffTypeByVanilla(v);
    expect(t, `buff ${v}`).toBeDefined();
    return t!;
  });

  it('vanillaBuff 映射 + 描述键 + 中文名（ItemCheck_ApplyPetBuffs 点名件族）', () => {
    const wants: Array<[BuffType, number, string]> = [
      [BuffType.PetBunny, 40, '宠物兔兔'],
      [BuffType.BabyPenguin, 41, '企鹅宝宝'],
      [BuffType.PetTurtle, 42, '宠物海龟'],
      [BuffType.ZephyrFish, 127, '和风鱼'],
      [BuffType.PetDD2Dragon, 202, 'Hoardagron'],
      [BuffType.UpbeatStar, 217, '埃斯蒂'],
      [BuffType.SharkPup, 219, '小鲨鱼'],
      [BuffType.FennecFox, 259, '耳廓狐'],
      [BuffType.BabyImp, 261, '小鬼宝宝'],
      [BuffType.ShadowMimic, 268, '暗影宝箱怪'],
    ];
    for (const [t, v, name] of wants) {
      expect(BUFF_DEFS[t].vanillaBuff).toBe(v);
      expect(BUFF_DEFS[t].descKey).toBe(`BuffDescription.${BuffType[t]}`);
      expect(BUFF_DEFS[t].fallbackName).toBe(name);
    }
  });

  it('图标 Buff_N.png 全在盘（UI.ts 直链）', () => {
    for (const t of NEW_TYPES) {
      expect(existsSync(join(ROOT, 'public/sprites/vanilla', `Buff_${BUFF_DEFS[t].vanillaBuff}.png`)),
        `Buff_${BUFF_DEFS[t].vanillaBuff}.png`).toBe(true);
    }
  });

  it('描述语料 zh-Hans/en-US 在键非空（原版 BuffDescription.*,零自造键）', () => {
    const zh = JSON.parse(readFileSync(join(ROOT, 'public/l10n/zh-Hans.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(ROOT, 'public/l10n/en-US.json'), 'utf8'));
    for (const t of NEW_TYPES) {
      const k = BUFF_DEFS[t].descKey.slice('BuffDescription.'.length);
      expect((zh.BuffDescription?.[k] ?? '').length).toBeGreaterThan(0);
      expect((en.BuffDescription?.[k] ?? '').length).toBeGreaterThan(0);
    }
  });

  it('隐字表成员 = Main.buffNoTimeDisplay 原位（127 唯一例外在表外）', () => {
    // Main.cs:9213-9336：40/41/42/200/201/202 在表（宠物隐倒计时）;127 和风鱼不在
    for (const v of [40, 41, 42, 200, 201, 202]) expect(BUFF_NO_TIME_DISPLAY.has(v), `隐字 ${v}`).toBe(true);
    expect(BUFF_NO_TIME_DISPLAY.has(127)).toBe(false);
  });

  it('存档语义：十件均不在 Main.buffNoSave 名单 → toSave 全部落盘', () => {
    const b = new BuffState();
    for (const t of NEW_TYPES) b.apply(t, 60);
    const saved = b.toSave().map(([v]) => v);
    for (const v of FX2_NEW_IDS) expect(saved).toContain(v);
  });

  it('数值中立性：十件不携带任何属性聚合（原版 UpdateBuffs 无 case,仅图标位）', () => {
    const b = new BuffState();
    const ms = b.moveSpeedMult, df = b.defenseBonus;
    for (const t of NEW_TYPES) b.apply(t, 60);
    expect(b.moveSpeedMult).toBe(ms);
    expect(b.defenseBonus).toBe(df);
  });
});

// ============ C. UpdatePet/UpdatePetLight 补挂面 ============
const mkStub = () => {
  const p = new Player(0, 0, new Inventory());
  p.dead = true;                       // 压制跟随体生成（want=false）——补挂面无死亡门,1:1
  const g = Object.create(Game.prototype) as unknown as {
    updatePetSlot: (slot: 0 | 1, visible: boolean, cur: null) => null;
    togglePetSlot: (slot: 0 | 1) => void;
  } & Record<string, unknown>;
  g.player = p;
  g.playUseSound = vi.fn();
  g.sfx = { play: vi.fn() };
  return { g, p, playUseSound: g.playUseSound as unknown as ReturnType<typeof vi.fn> };
};

describe('C. UpdatePet/UpdatePetLight 补挂面（Player.cs:17414-17445 → updatePetSlot）', () => {
  it('装备 753 海草 → 宠物海龟 42 补挂 60s + UseSound 一次（:17420-17422）', () => {
    const { g, p, playUseSound } = mkStub();
    p.inv.miscEquips[0] = { id: iid(753), stack: 1 };
    g.updatePetSlot(0, true, null);
    expect(p.buffs.has(BuffType.PetTurtle)).toBe(true);
    expect(p.buffs.active.get(BuffType.PetTurtle)).toBe(60);
    expect(playUseSound).toHaveBeenCalledTimes(1);
  });

  it('FindBuffIndex 门：已在栏不重挂不续期（:17420）', () => {
    const { g, p, playUseSound } = mkStub();
    p.inv.miscEquips[0] = { id: iid(753), stack: 1 };
    p.buffs.apply(BuffType.PetTurtle, 10);
    g.updatePetSlot(0, true, null);
    expect(p.buffs.active.get(BuffType.PetTurtle)).toBe(10);   // 原样保留
    expect(playUseSound).not.toHaveBeenCalled();
  });

  it('隐藏（hideMisc）不补挂（:17418 门）', () => {
    const { g, p } = mkStub();
    p.inv.miscEquips[0] = { id: iid(753), stack: 1 };
    g.updatePetSlot(0, false, null);
    expect(p.buffs.has(BuffType.PetTurtle)).toBe(false);
  });

  it('槽 1 也受理（UpdatePetLight :17427-17445）：4365 天体杖 → 埃斯蒂 217', () => {
    const { g, p } = mkStub();
    p.inv.miscEquips[1] = { id: iid(4365), stack: 1 };
    g.updatePetSlot(1, true, null);
    expect(p.buffs.has(BuffType.UpbeatStar)).toBe(true);
  });

  it('无死亡门：死亡帧照常补挂（原版 UpdatePet 不查 dead）', () => {
    const { g, p } = mkStub();
    expect(p.dead).toBe(true);
    p.inv.miscEquips[0] = { id: iid(753), stack: 1 };
    g.updatePetSlot(0, true, null);
    expect(p.buffs.has(BuffType.PetTurtle)).toBe(true);
  });

  it('TogglePet 隐藏臂 ClearBuff（:17447-17451）+ ToggleLight 仙灵三色连清（:17458-17462）', () => {
    const { g, p } = mkStub();
    p.dead = false;
    p.inv.miscEquips[0] = { id: iid(753), stack: 1 };
    p.buffs.apply(BuffType.PetTurtle, 60);
    g.togglePetSlot(0);
    expect(p.buffs.has(BuffType.PetTurtle)).toBe(false);
  });

  it('数据勘误：3855 飞翔Gato = buff200/proj703/vanity（Item.cs:34017-34022 缺省臂）', () => {
    expect(petInfoOfVid(3855)).toEqual({ buff: 200, proj: 703, light: false });
    expect(petInfoOfVid(3856)).toEqual({ buff: 201, proj: 702, light: true });   // lightPet[201]
    expect(petInfoOfVid(3857)).toEqual({ buff: 202, proj: 701, light: false });  // vanityPet[202]
    // 703 DD2PetGato = AI_144 悬停族（1456 Projectile.cs:66784 逐臂 + projFrames[703]=8）
    const e = (petaiJson as unknown as { pets: Record<string, { aiStyle: number; family: string; frames: number; frameTo?: number; snap: number; idleRate: number; moveRate: number }> }).pets['703'];
    expect(e).toBeDefined();
    expect(e.aiStyle).toBe(144);
    expect(e.family).toBe('hover');
    expect(e.frames).toBe(8);       // Main.cs:8765 projFrames[703] = 8
    expect(e.frameTo).toBe(4);      // AI_144 703 臂 num4=4 帧钳（:66784-66793）
    expect(e.snap).toBe(3);         // num = 3f（:66789）
    expect(e.idleRate).toBe(4);     // num2 = 4（:66790）
    expect(e.moveRate).toBe(2);     // num3 = 2（:66791）
  });
});

// ============ D. 关联四键 ============
describe('D. 四键（📋 登记不修 → 本批收口）', () => {
  it('① 3857 buffType = 202（Item.cs:34018-34021 内层 switch）+ DEFS 收口位', () => {
    expect(itemFuncOfVid(3857)?.buffType).toBe(202);
    expect(itemFuncOfVid(3856)?.buffType).toBe(201);
    expect(buffTypeByVanilla(202)).toBe(BuffType.PetDD2Dragon);
  });

  it('② healBlocked 拒用静默（Player.cs:52856-52858）——toast 仅剩死代码支 1 处', () => {
    expect(gameSrc.match(/Toast\.HealBlock/g)).toHaveLength(1);   // :13047 死代码支（本仓 .potion 字段 0 条）
    expect(gameSrc).toContain('ItemCheck_CheckCanUse Player.cs:52856-52858');
    // 主链拒用臂：无提示无冷却（注释体)
    const main = gameSrc.match(/if \(ff\.healLife && this\.player\.buffs\.healBlocked\) \{[\s\S]{0,420}?\} else \{/);
    expect(main).toBeTruthy();
    expect(main![0]).not.toContain('onToast');
    expect(main![0]).not.toContain('useTime = 30');
    // QuickHeal 支保持早退但不带提示/冷却（★BJ738 P05 起 quickDrinkPotion 薄路由
    // 进 quickHeal——拒用静默门=quickHeal 入口总门 :5495,移动键同享）
    const q = gameSrc.match(/if \(!p \|\| p\.buffs\.has\(BuffType\.Cursed\) \|\| p\.cced \|\| p\.dead \|\| p\.hp >= p\.maxHp \|\| p\.buffs\.healBlocked\) return;[\s\S]{0,80}?:5495/);
    expect(q).toBeTruthy();
    expect(q![0]).not.toContain('onToast');
    expect(q![0]).not.toContain('useTime = 30');
  });

  it('③ buffTime 缺省 = 3600（ItemCheck_UsePotionStuff Player.cs:5518-5524）', () => {
    expect(gameSrc).not.toContain('buffTime ?? 7200');
    // ★BJ738 P05：主链 1 处（quickDrinkPotion 旧自备链退役,QuickHeal 走 quickConsume
    // 的 `f.buffTime || 3600` 同语义式）
    expect(gameSrc.match(/buffTime \?\? 3600/g)).toHaveLength(1);   // 主链
    expect(gameSrc).toContain('ItemCheck_UsePotionStuff Player.cs:5518-5524');
  });

  it('④a 5/1912 TryToResetHungerToNeutral 在药水病分档内（:52507/:52513,IIIII219）', () => {
    expect(gameSrc).toContain('if (vid === 1912 || vid === 5) this.player.buffs.tryToResetHungerToNeutral();');
  });

  it('④b TryToResetHungerToNeutral 语义：三态全清（Player.cs:12170-12184）', () => {
    const b = new BuffState();
    b.dontStarveWorld = true;
    b.apply(BuffType.NeutralHunger, 100);
    b.apply(BuffType.Hunger, 100);
    b.apply(BuffType.Starving, 5 / 60);
    b.tryToResetHungerToNeutral();
    expect(b.has(BuffType.NeutralHunger)).toBe(false);
    expect(b.has(BuffType.Hunger)).toBe(false);
    expect(b.has(BuffType.Starving)).toBe(false);
  });

  it('④c 5573 火把神药水 = 限时 buff 376（480s）不置旗；5043 = 置旗侧（:45611-45628）', () => {
    const s5573 = gameSrc.match(/case 5573: \{[\s\S]{0,900}?break;/);
    expect(s5573).toBeTruthy();
    expect(s5573![0]).toContain('p.buffs.apply(BuffType.TorchGodPotion, 480)');   // 28800t
    expect(s5573![0]).not.toContain('this.world.flags.unlockedBiomeTorches');      // 药水不给永久旗
    const s5043 = gameSrc.match(/case 5043: \{[\s\S]{0,1600}?break;/);
    expect(s5043).toBeTruthy();
    expect(s5043![0]).toContain('this.world.flags.unlockedBiomeTorches = true');   // :45616
    expect(s5043![0]).toContain('handleSpecialEvent(24');                          // 成就 GAIN_TORCH_GODS_FAVOR
    expect(s5043![0]).toContain('registerKill(664)');                              // 图鉴 :45617-45620
    expect(s5043![0]).toContain('!this.world.flags.unlockedBiomeTorches');         // :45612 门
  });
});
