// 工具类审计修复回归（2026-08-22，docs/audit/item-audit-2026-08-22.md 工具类章节）：
//   F1 35 件 def.tool 缺 speed/useTime → 工具分支 46t 双回落（梦魇/熔岩/钴/秘银/精金/
//      钯/山铜/钛/幽魂镐、Drax、镐斧、圣锤、全部 def.tool 锤斧）；
//   F2 8 件双工具副斧力失效（axePower 只挂 def.axePower、dualToolResolve 只读 tool
//      对象三力 → 镐斧/钻斧砍不动树）；
//   F3 星旋三件（2772/2773/2775）def+贴图整件缺（TEdit items.json 漏收）；
//   F4 挖掘冷却 8t 自创下限钳 → 原版 max(val,1)（Player.cs:4221-4226）；
//   E9 叶绿矿 d.pick 65→200（Player.cs:52989 `type==211 && pickPower<200 → num=0`）。
// 标杆：Terarria1456 Item.cs SetDefaults / Player.cs ItemCheck_UseMiningTools 链。
import { describe, it, expect } from 'vitest';
import { ITEM_DEFS, ITEM_BY_KEY, VANILLA_ITEM_KEY_BY_ID, VANILLA_TOOL_POWERS } from '../src/data/items';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { itemFuncOfVid } from '../src/data/vanillaItemFunc';
import { TILE_BY_KEY, TILE_DEFS } from '../src/data/tiles';
import { Game } from '../src/core/Game';
import { HitTile } from '../src/core/HitTile';
import { World } from '../src/world/World';
import vanillaItemMeta from '../public/sprites/vanilla.json';

/** def 反查（vid → 桥接批 snake 键或 vanilla.json 自动注册 Pascal 键） */
function defOfVid(vid: number) {
  const key = VANILLA_ITEM_KEY_BY_ID[vid];
  return key ? ITEM_DEFS[ITEM_BY_KEY[key]] : undefined;
}

describe('F1｜35 件 def.tool 桥入 itemCombat 节奏（speed=useAnimation / useTime）', () => {
  it('梦魇镐 103：useTime 15 / speed 20 / damage 9（Item.cs:2565-2573）', () => {
    const def = defOfVid(103)!;
    expect(def).toBeDefined();
    expect(def.tool?.useTime).toBe(15);
    expect(def.tool?.speed).toBe(20);
    expect(def.tool?.damage).toBe(9);
    expect(def.tool?.power).toBe(65);
  });
  it('圣锤 367：useTime 14 / speed 27 / hammer 80；钛金镐 1202：useTime 7 / speed 25', () => {
    const pwn = defOfVid(367)!;
    expect(pwn.tool?.useTime).toBe(14);
    expect(pwn.tool?.speed).toBe(27);
    expect(pwn.tool?.hammerPower).toBe(80);
    const ti = defOfVid(1202)!;
    expect(ti.tool?.useTime).toBe(7);
    expect(ti.tool?.speed).toBe(25);
  });
  it('全表 35 件：speed/useTime 全数就位（46t 回落根除）且与 itemCombat 逐件相等', () => {
    const ids = Object.keys(VANILLA_TOOL_POWERS).map(Number);
    expect(ids.length).toBe(35);
    const missing: number[] = [];
    for (const vid of ids) {
      const def = defOfVid(vid);
      const c = itemCombat(vid);
      if (!def?.tool || def.tool.speed === undefined || def.tool.useTime === undefined
        || def.tool.speed !== c?.useAnimation || def.tool.useTime !== c?.useTime) missing.push(vid);
    }
    expect(missing, `仍缺节奏/与 combat 不符: ${missing}`).toEqual([]);
  });
  it('血腥锤斧 4317：SetWeaponValues(30, 7f) 补提取（Item.cs:36955）', () => {
    const c = itemCombat(4317)!;
    expect(c.damage).toBe(30);
    expect(c.knockBack).toBe(7);
    expect(defOfVid(4317)!.tool?.damage).toBe(30);
  });
});

describe('F2｜8 件双工具三力就位 + dualToolResolve 分流（Player.cs:45040-45045）', () => {
  /** dualToolResolve 原型壳直调（private 仅编译期；无 this 依赖） */
  function resolve(vid: number, targetType: number) {
    const def = defOfVid(vid)!;
    const g = Object.create(Game.prototype) as unknown as {
      dualToolResolve(t: unknown, ty: number, d?: unknown): { type: string; power: number };
    };
    return { def, dual: g.dualToolResolve(def.tool, targetType, def) };
  }
  const TREE = TILE_BY_KEY['v_5_trees'];     // sheet 5 ∈ TILE_AXE_SHEETS
  const STONE = TILE_BY_KEY['stone'];        // sheet 1（普通块）

  it('8 件双工具 def.tool 三力全量（multi 判定前提）', () => {
    for (const vid of [579, 990, 204, 217, 1305, 1507, 3525, 4317]) {
      const t = defOfVid(vid)!.tool!;
      const powers = [t.pickPower, t.axePower, t.hammerPower].filter((x) => x !== undefined);
      expect(powers.length, `vid ${vid} 力数 ${powers}`).toBeGreaterThanOrEqual(2);
      expect(t.axePower, `vid ${vid} 副斧力`).toBeDefined();
    }
  });
  it('Drax 579（pick200+axe22）：树→斧力 22（修复前 pick=砍不动树）', () => {
    const { dual } = resolve(579, TREE);
    expect(dual).toEqual({ type: 'axe', power: 22 });
  });
  it('镐斧族对普通块走镐不走锤：Drax 579 / 镐斧 990 石块→pick', () => {
    expect(resolve(579, STONE).dual).toEqual({ type: 'pick', power: 200 });
    expect(resolve(990, STONE).dual).toEqual({ type: 'pick', power: 200 });
  });
  it('熔岩锤斧 217（hammer70+axe30）：树→斧力 30 / 石块→锤力 70', () => {
    expect(resolve(217, TREE).dual).toEqual({ type: 'axe', power: 30 });
    // 锤斧对普通块保持锤路 = 原版 TryPoundingTile 只门 sItem.hammer>0
    //（Player.cs:45355-45364，IsTilePoundable 普通实心块可 pound 成半砖/坡）——
    // 锤斧即锤（wiki: "works as a hammer when used on blocks or walls"）
    expect(resolve(217, STONE).dual).toEqual({ type: 'hammer', power: 70 });
  });
  it('def.axePower 兜底：tool 对象漏带 axePower 时仍按 def 副斧力分流', () => {
    const def = defOfVid(1305)!; // The Axe：hammer100+axe35
    const bare = { ...def.tool, pickPower: undefined, axePower: undefined, hammerPower: 100 };
    const g = Object.create(Game.prototype) as unknown as {
      dualToolResolve(t: unknown, ty: number, d?: unknown): { type: string; power: number };
    };
    expect(g.dualToolResolve(bare, TILE_BY_KEY['v_5_trees'], def)).toEqual({ type: 'axe', power: 35 });
  });
});

describe('F3｜星旋三件 2772/2773/2775 注册 + 贴图', () => {
  it('三件 def 注册且 itemFuncTool 数据面就位（axe27/axe27/hammer100）', () => {
    for (const [vid, funcKey] of [[2772, 'axe'], [2773, 'axe'], [2775, 'hammer']] as const) {
      const def = defOfVid(vid);
      expect(def, `vi_${vid} def`).toBeDefined();
      const f = itemFuncOfVid(vid)!;
      expect(f[funcKey], `vi_${vid} itemfunc.${funcKey}`).toBeDefined();
      const c = itemCombat(vid)!;
      expect(c.useTime).toBeDefined();
      expect(c.useAnimation).toBeDefined();
    }
    expect(itemFuncOfVid(2772)!.axe).toBe(27);
    expect(itemFuncOfVid(2775)!.hammer).toBe(100);
  });
  it('三件图标入 vanilla.json 且 atlas 矩形在页内', () => {
    for (const vid of [2772, 2773, 2775]) {
      const e = (vanillaItemMeta as unknown as { items: Record<string, { icon: string; ix: number; iy: number; iw: number; ih: number }> }).items[String(vid)];
      expect(e, `items[${vid}]`).toBeDefined();
      expect(e.iw).toBeGreaterThan(0);
      expect(e.ih).toBeGreaterThan(0);
    }
  });
});

describe('F4｜挖掘冷却下限钳（Player.cs:4221-4226 max(val,1)）', () => {
  it('蘑菇矿爪档 useTime=4：4t 间隔连击逐击积累（修复前 8t 窗吞半数击）', () => {
    const w = new World(40, 40, 20, 'open');
    w.store.setTileSilent(20, 20, TILE_BY_KEY['stone'], 0, 0);
    const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
    g.netCanEditTile = () => true;
    g.inTileRange = () => true;
    g.world = w;
    g.hitTiles = new HitTile();
    g.tickCount = 0;
    g.lastMineHitTick = -999;
    g.mining = null;
    g.hardnessCache = 0;
    g.player = {
      buffs: { has: () => false, wellFedTier: 0, hungerPickSpeed: 0 },
      usedAmbrosia: false,
      equipStats: { chiselSpeed: false },
      inv: { heldItem: () => null },
    };
    g.killTileBreakSound = () => {};
    g.spawnParticles = () => {};
    g.tileAboveProtected = () => false;
    // ★BJ731 补桩（2026-10-27）：BJ433 起 tryMine 尾接 IntentionGuesser.Track
    //   （:46102/:46162 节拍窗记录）——读 this.camera.screenToWorld(input.mouseX/Y)
    //   与 this.intentionGuesser.track。真 Game 恒有;桩缺=TypeError（track 吞参
    //   =对挖掘冷却断言零扰动,position 域本测不消费）。
    g.camera = { screenToWorld: (): [number, number] => [0, 0] };
    g.input = { mouseX: 0, mouseY: 0 };
    g.intentionGuesser = { track: () => {}, allowTracking: () => false };
    const broken: Array<[number, number]> = [];
    g.breakTile = (x: number, y: number) => { broken.push([x, y]); w.store.setTileSilent(x, y, 0, 0, 0); };
    const tryMine = g.tryMine as (x: number, y: number, p: number, t: 'pick' | 'axe' | 'hammer', s: number, u?: number) => void;
    // 石块 sheet1 无分档除数：dmg = power（35/击 → 3 击破，阈值 100）
    tryMine.call(g, 20, 20, 35, 'pick', 12, 4);   // t=0 击1 → 35
    g.tickCount = 4;
    tryMine.call(g, 20, 20, 35, 'pick', 12, 4);   // t=4 击2 → 70（8t 钳下被吞）
    g.tickCount = 8;
    tryMine.call(g, 20, 20, 35, 'pick', 12, 4);   // t=8 击3 → 105 ≥ 100 破坏
    expect(broken).toEqual([[20, 20]]);
  });
  it('钳位常量 = 1：冷却公式下限不再吞顶速工具击（2176 useTime 4 原版档;★重锚=BJ59 单源化把 round→floor,钳位不变）', () => {
    // 数据面锚：2176 蘑菇矿爪 useTime 4 / 2774 星旋钻头 useTime 4——
    // 修复前 Math.max(8,…) 强制 8t（慢 100%）
    expect(itemCombat(2176)!.useTime).toBe(4);
    expect(itemCombat(2774)!.useTime).toBe(4);
    // ★SW-RB9c（2026-09-09）随 SW-BJ12 pickSpeed 单源化刷新锚文本（pickSpeedMult()）：
    //   :18837 现式 `Math.max(1, Math.round((useTime ?? speed) * this.pickSpeedMult()))`
    //   ——钳位 max(1,…) 语义不变,静态锚同步（旧字面 `* pickSpeed` 已不存在=恒红假锚）
    const src = 'Math.max(1, Math.floor((useTime ?? speed) * this.pickSpeedMult()))';
    // 静态锚：tryMine 冷却表达式唯一、无 8t 残留（读源码防回归）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    const gameSrc = fs.readFileSync(new URL('../src/core/Game.ts', import.meta.url), 'utf8');
    expect(gameSrc).toContain(src);
    expect(gameSrc).not.toContain('Math.max(8, Math.round((useTime ?? speed)');
  });
});

describe('E9｜叶绿矿镐力门槛 200（Player.cs:52989）', () => {
  it('ore_chlorophyte d.pick = 200（弹幕/爆炸侧 pickPowerEnough 同源收紧）', () => {
    const d = TILE_DEFS[TILE_BY_KEY['ore_chlorophyte']];
    expect(d.pick).toBe(200);
    expect(d.vanilla?.sheet).toBe(211);
  });
});
