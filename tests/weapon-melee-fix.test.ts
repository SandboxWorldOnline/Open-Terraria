// 近战挥砍类修复批（2026-08-22 审计 ❌ 九项中的可测四项 + 结构锚）：
//   ① 挥剑起手 UseSound（Player.cs:50934-50946，天顶剑 4956/5669 UseSound=null 不播）
//   ② 泰拉刃 985 光束初速（Player.cs:48316 (num4,num5)×5f，num4/5 已含 shootSpeed
//      → 单位向×60）+ 命中 ×0.75（Projectile.cs:12700-12703）+ >8 减速分支随之激活
//   ③ 长矛延伸判定盒（Projectile.cs:43530-43571 GetExtensionHitbox：105/46/153）
//   ④ 矛/短剑/回旋镖/悠悠球 swing 身体姿势（useStyle 5/13 驱动身体行）
//   ⑤ 命中侧 per-weapon StatusNPC 表（Player.StatusToNPC :6139-6249）
//   ⑥ 村正 useTurn（Item.cs:3208-3214 → :19549 移动改向豁免）
//   ⑦ 特例持位（Player.cs:49930-50104）⑧ meleeScaleGlove ×1.1（:41919-41930）
//   ⑨ 手持层级统一 BehindFrontArm（PlayerDrawSet.cs:354）
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Game } from '../src/core/Game';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { Enemy } from '../src/entities/Enemy';
import { Arrow } from '../src/entities/Arrow';
import { SpearProj, spearExtensionHitbox } from '../src/entities/WeaponProj';
import { applyWeaponStatusSwing } from '../src/entities/projStatus';
import { itemUseSoundWav } from '../src/data/itemUseSound';
import { accFxOfInternal } from '../src/data/vanillaAccFx';
import { itemFuncOfVid } from '../src/data/vanillaItemFunc';
import { itemCombat } from '../src/data/vanillaItemCombat';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import { TILE } from '../src/core/constants';
import type { GameHooks } from '../src/entities/types';

const ROOT = join(__dirname, '..');
const srcGame = () => readFileSync(join(ROOT, 'src/core/Game.ts'), 'utf8');
const srcRenderer = () => readFileSync(join(ROOT, 'src/render/Renderer.ts'), 'utf8');

/** 原版 vid → 本仓内部 item id（未注册即抛错，防静默假绿） */
const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

function makeGame(world: World, enemies: unknown[] = []) {
  const player = new Player(30 * TILE, 40 * TILE, new Inventory());
  const cutTiles: Array<[number, number]> = [];
  const hooks: GameHooks = {
    world,
    player,
    enemies: () => enemies,
    critters: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: (x: number, y: number) => { cutTiles.push([x, y]); },
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    playSfxFile: () => {},
    showPickupLabel: () => {},
  } as unknown as GameHooks;
  return { hooks, player, cutTiles };
}

const mkEnemy = (cx: number, cy: number, w = 16, h = 24) => {
  const e = {
    id: 1, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, dead: false,
    hp: 1000, hits: [] as number[],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ============ ① 挥剑起手 UseSound（Player.cs:50934-50946） ============
describe('① 挥剑起手 UseSound', () => {
  it('音表：近战剑族=Item_1（3508/757/121/190），天顶剑 4956/5669 无 UseSound（Item.cs:39978）', () => {
    expect(itemUseSoundWav(3508)).toBe('Item_1');
    expect(itemUseSoundWav(757)).toBe('Item_1');
    expect(itemUseSoundWav(121)).toBe('Item_1');
    expect(itemUseSoundWav(190)).toBe('Item_1');
    expect(itemUseSoundWav(4956)).toBeNull();   // Zenith
    expect(itemUseSoundWav(5669)).toBeNull();   // 真铜短剑
  });

  it('结构锚：通用 swing 创建处补起手音，且门=音表非空（UseSound != null 语义）', () => {
    const src = srcGame();
    const i = src.indexOf('if (heldVid !== 4956 && heldVid !== 5669');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, i + 1400);
    // Player.cs:50934-50946 `if (sItem.UseSound != null) SoundEngine.PlaySound(...)`
    // ——表缺（=null）静默，兜底 'throw' 仅对表缺件生效
    expect(block).toContain('if (itemUseSoundWav(heldVid)) this.playUseSound(heldVid, \'throw\')');
  });

  it('结构锚：天顶剑分支（UseSound=null）不播起手音', () => {
    const src = srcGame();
    const z0 = src.indexOf('天顶剑族 4956 Zenith / 5669 真铜短剑');
    const z1 = src.indexOf('if (heldVid !== 4956 && heldVid !== 5669');
    expect(z0).toBeGreaterThan(-1);
    expect(z1).toBeGreaterThan(z0);
    expect(src.slice(z0, z1)).not.toContain('playUseSound');
  });
});

// ============ ② 泰拉刃 985 光束初速 + 命中 ×0.75 ============
describe('② 泰拉刃 985 光束', () => {
  it('初速 = shootSpeed×5 = 60（Player.cs:48316 (num4,num5)×5f，num4/5 已含 shootSpeed；', () => {
    const src = srcGame();
    // 旧错值 `tdx / tdl * 5`（漏乘 shootSpeed）已退役
    expect(src.includes('tdx / tdl * 5,')).toBe(false);
    expect(src).toContain('tdx / tdl * cwMelee.shootSpeed * 5, tdy / tdl * cwMelee.shootSpeed * 5');
    // 985 ∈ NoMeleeSpeedVelocityScaling（ProjectileID.cs:429——★BJ665 勘正 伪锚 :337）——不除 attackSpeedMult
    const i = src.indexOf('tdx / tdl * cwMelee.shootSpeed * 5');
    expect(src.slice(i - 400, i)).not.toContain('attackSpeedMult');
  });

  it('初速 60 → >8 减速分支激活（AI_191 :39362 velocity×0.94/t，探墙前无额外阻尼）', () => {
    const { hooks } = makeGame(new World(120, 120, 30, 'open'));
    vi.spyOn(Math, 'random').mockReturnValue(0.999);   // 避开尘/粒子随机分支
    const beam = new Arrow(60 * TILE, 60 * TILE, 60, 0, 100, 3, 985,
      { grav: 0, pierce: 3, terra: { ai0: 1, ai1: 18, ai2: 1 } });
    beam.fixedUpdate(1, hooks);
    expect(beam.vx).toBeCloseTo(60 * 0.94, 6);         // ×0.94 恰一次（空世界探墙恒通）
    expect(beam.vy).toBe(0);
  });

  it('命中伤害 ×0.75（Damage_PVE_Inner :12700-12703 case 985，暴击翻倍前）', () => {
    const { hooks } = makeGame(new World(120, 120, 30, 'open'));
    // 大盒敌（200×200）防高速弹单 update 穿越错过判定
    const e = mkEnemy(60 * TILE + 8, 60 * TILE + 8, 200, 200);
    (hooks as unknown as { enemies: () => unknown[] }).enemies = () => [e];
    vi.spyOn(Math, 'random').mockReturnValue(0.5);    // 无暴击（critChance 0.04）;★BJ716-A:DV 中性档(×1.0)
    const beam = new Arrow(e.x + 100, e.y + 100, 60, 0, 100, 3, 985,
      { grav: 0, pierce: 3, terra: { ai0: 1, ai1: 18, ai2: 1 } });
    beam.fixedUpdate(1, hooks);
    expect(e.hits).toEqual([75]);                      // 100 ×0.75（(int) 截断）
  });

  it('对照：非 985 弹不吃 ×0.75', () => {
    const { hooks } = makeGame(new World(120, 120, 30, 'open'));
    const e = mkEnemy(60 * TILE + 8, 60 * TILE + 8, 200, 200);
    (hooks as unknown as { enemies: () => unknown[] }).enemies = () => [e];
    vi.spyOn(Math, 'random').mockReturnValue(0.5);    // ★BJ716-A:DV 中性档(×1.0)
    const bolt = new Arrow(e.x + 100, e.y + 100, 8, 0, 100, 3, 14, { grav: 0, life: 600, pierce: 1 });
    bolt.fixedUpdate(1, hooks);
    expect(e.hits).toEqual([100]);
  });
});

// ============ ③ 长矛延伸判定盒（Projectile.cs:43530-43571） ============
describe('③ AI_019_Spears_GetExtensionHitbox', () => {
  it('非 105/46/153 → null（:43544 default return false）', () => {
    expect(spearExtensionHitbox(47, 1, 22, 0, 0, 1, 0)).toBeNull();
    expect(spearExtensionHitbox(49, 1, 31, 0, 0, 1, 0)).toBeNull();
  });

  it('伸出相包络：出生 num2≈0 → 相末 num2=1（dur=24：t=16 ⟺ itemAnim=8=max/3）', () => {
    // dur=24：num3=⌊24/3⌋=8，num2 = t/(24−8)；t=16 时 itemAnim=8 ≥ 24/3 浮点门恰活
    const born = spearExtensionHitbox(105, 1, 24, 100, 100, 1, 0)!;
    expect(born.w).toBeCloseTo(10 + 20 / 16, 6);
    expect(born.x + born.w / 2).toBeCloseTo(100 + 10 + 50 / 16, 6);
    const full = spearExtensionHitbox(105, 16, 24, 100, 100, 1, 0)!;
    expect(full.w).toBe(30);                                  // 10+20×1
    expect(full.x + full.w / 2).toBeCloseTo(160, 6);          // 100+10+50×1
    // 46 暗黑长枪 len 50/size 15；153 腐叉 len 40/size 10
    const d46 = spearExtensionHitbox(46, 16, 24, 0, 0, 1, 0)!;
    expect(d46.w).toBe(25);
    expect(d46.x + d46.w / 2).toBeCloseTo(60, 6);
    const d153 = spearExtensionHitbox(153, 16, 24, 0, 0, 1, 0)!;
    expect(d153.w).toBe(20);
    expect(d153.x + d153.w / 2).toBeCloseTo(50, 6);
  });

  it('缩回相（itemAnimation < max/3 浮点门）→ null：dur=24 的 t=17（itemAnim=7<8）', () => {
    expect(spearExtensionHitbox(105, 17, 24, 0, 0, 1, 0)).toBeNull();
    expect(spearExtensionHitbox(105, 16, 24, 0, 0, 1, 0)).not.toBeNull();
  });

  it('len ×= 1/meleeSpeed（:43559）——attackSpeedMult=1.25 → 距离 ×1.25', () => {
    const box = spearExtensionHitbox(105, 16, 24, 0, 0, 1, 0, 1.25)!;
    expect(box.x + box.w / 2).toBeCloseTo(10 + 50 * 1.25, 6);
  });

  it('SpearProj 集成：伸出相延伸盒命中弹体之外的敌 + CutTiles 扫延伸盒', () => {
    const world = new World(200, 120, 30, 'open');
    const sp = new SpearProj(1, 0, 5.6, 22, 61, 6.4, 105);   // 550 昆恩枪弹
    const { hooks, cutTiles } = makeGame(world);
    for (let t = 0; t < 14; t++) sp.fixedUpdate(1, hooks);
    const spCx = (sp as unknown as { cx: number }).cx;
    const spCy = (sp as unknown as { cy: number }).cy;
    // 延伸盒中心 = 弹心 + dir×(10+50×14/15≈56.7)、边 28.7——敌置盒心，弹体（±9px）之外
    const e = mkEnemy(spCx + 56.7, spCy);
    (hooks as unknown as { enemies: () => unknown[] }).enemies = () => [e];
    vi.spyOn(Math, 'random').mockReturnValue(0.999);   // 无暴击
    (sp as unknown as { t: number }).t = 13;           // 回拨一帧重走 t=14（同位置确定性重算）
    sp.fixedUpdate(1, hooks);
    expect(e.hits).toEqual([61]);                      // 延伸盒命中（此前整段漏=零命中）
    expect(cutTiles.length).toBeGreaterThan(0);        // CutTilesAt(extensionBox)（:14176-14179）
  });

  it('对照：非三型号长矛（47）无延伸盒——弹体之外不可达', () => {
    const world = new World(200, 120, 30, 'open');
    const sp = new SpearProj(1, 0, 5.6, 22, 14, 6, 47);
    const { hooks } = makeGame(world);
    for (let t = 0; t < 14; t++) sp.fixedUpdate(1, hooks);
    const spCx = (sp as unknown as { cx: number }).cx;
    const spCy = (sp as unknown as { cy: number }).cy;
    const e = mkEnemy(spCx + 56.7, spCy);
    (hooks as unknown as { enemies: () => unknown[] }).enemies = () => [e];
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    (sp as unknown as { t: number }).t = 13;
    sp.fixedUpdate(1, hooks);
    expect(e.hits).toEqual([]);
  });
});

// ============ ④ 矛/短剑/回旋镖/悠悠球 swing 身体姿势 ============
describe('④ 四族 swing 身体姿势（useStyle 5/13 驱动身体行）', () => {
  it('结构锚：useSwing 门纳入 spear/boomerang/yoyo（kind spear 覆盖短剑 AI_161）', () => {
    const src = srcGame();
    const i = src.indexOf('if (cw.kind === \'grenade\' || cw.kind === \'magic\'');
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 260)).toContain("cw.kind === 'spear' || cw.kind === 'boomerang' || cw.kind === 'yoyo'");
  });

  it('数据前提：四族 noUseGraphic（不重影）+ noMelee（近战判定盒不双算）', () => {
    // 长矛 280/274/550/277、回旋镖 284/55、悠悠球 3262/3286、短剑 802（Item.cs SetDefaults；
    // useSwing 的 noGraphic 与 updateSwingHits 的近战门都读 vanilla-itemcombat 列）
    for (const vid of [280, 274, 550, 277, 284, 55, 3262, 3286, 802]) {
      const c = itemCombat(vid);
      expect(c?.noUseGraphic, `vid ${vid} noUseGraphic`).toBe(true);
      expect(c?.noMelee, `vid ${vid} noMelee`).toBe(true);
    }
  });

  it('持姿数据：矛/悠悠球 useStyle 5、回旋镖 1（Item.cs SetDefaults；悠悠球族为提取缺口手补）', () => {
    for (const vid of [280, 274, 550, 277, 802]) {
      expect(itemFuncOfVid(vid)?.useStyle, `vid ${vid}`).toBe(5);
    }
    for (const vid of [3262, 3278, 3284, 3286, 3291, 3315, 3316, 3317]) {
      expect(itemFuncOfVid(vid)?.useStyle, `vid ${vid}`).toBe(5);   // Item.cs:3262 共享 case 块
    }
    expect(itemFuncOfVid(284)?.useStyle).toBe(1);                   // 木制回旋镖（:case 284）
    expect(itemFuncOfVid(55)?.useStyle).toBe(1);
  });
});

// ============ ⑤ 命中侧 per-weapon StatusNPC 表（Player.StatusToNPC :6139-6249） ============
describe('⑤ applyWeaponStatusSwing（StatusToNPC type 分支）', () => {
  it('rand=0 全中：概率/时长逐条（Next(N)==0 ⟺ 1/N；tick/60=秒）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const mk = () => ({}) as Record<string, number>;
    const a = mk(); applyWeaponStatusSwing(121, a);   // 1/2 OnFire 180t
    expect(a.onFireT).toBe(3);
    const b = mk(); applyWeaponStatusSwing(122, b);   // 1/10 OnFire 180t
    expect(b.onFireT).toBe(3);
    const c = mk(); applyWeaponStatusSwing(190, c);   // 1/4 Poisoned 420t
    expect(c.poisonT).toBe(7);
    const d = mk(); applyWeaponStatusSwing(217, d);   // 1/5 OnFire 180t
    expect(d.onFireT).toBe(3);
    const e = mk(); applyWeaponStatusSwing(3823, e);  // 1/4 OnFire3 300t
    expect(e.onFire3T).toBe(5);
    const f = mk(); applyWeaponStatusSwing(5382, f);  // 1/3 OnFire3 300t
    expect(f.onFire3T).toBe(5);
    const g = mk(); applyWeaponStatusSwing(1123, g);  // 恒定 Confused 120t
    expect(g.confusedT).toBe(2);
    const h = mk(); applyWeaponStatusSwing(2330, h);  // 1/2 Confused Next(1,4)t
    expect(h.confusedT).toBe(1);
    const i2 = mk(); applyWeaponStatusSwing(3352, i2); // 恒定 Bleeding Next(4,7)t
    expect(i2.bleedT).toBe(4);
    const j = mk(); applyWeaponStatusSwing(3211, j);  // 恒定 Ichor Next(5,10)t
    expect(j.ichorT).toBe(5);
    const k = mk(); applyWeaponStatusSwing(5129, k);  // 恒定 Stinky 300t
    expect(k.stinkyT).toBe(5);
  });

  it('rand≈1：概率档全落空；恒定档仍施加且取时长上界（Next 上界=exclusive−1）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const a: Record<string, number> = {}; applyWeaponStatusSwing(121, a);
    expect(a.onFireT).toBeUndefined();
    const b: Record<string, number> = {}; applyWeaponStatusSwing(190, b);
    expect(b.poisonT).toBeUndefined();
    const c: Record<string, number> = {}; applyWeaponStatusSwing(3823, c);
    expect(c.onFire3T).toBeUndefined();
    const d: Record<string, number> = {}; applyWeaponStatusSwing(5382, d);
    expect(d.onFire3T).toBeUndefined();
    const e: Record<string, number> = {}; applyWeaponStatusSwing(2330, e);
    expect(e.confusedT).toBeUndefined();
    const f: Record<string, number> = {}; applyWeaponStatusSwing(3352, f);
    expect(f.bleedT).toBe(6);                          // 4+⌊0.999×3⌋
    const g: Record<string, number> = {}; applyWeaponStatusSwing(3211, g);
    expect(g.ichorT).toBe(9);                          // 5+⌊0.999×5⌋
    const h: Record<string, number> = {}; applyWeaponStatusSwing(1123, h);
    expect(h.confusedT).toBe(2);
  });

  it('AddBuff max 合并：已有更强存量不被覆盖', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const e = { onFireT: 8 } as Record<string, number>;
    applyWeaponStatusSwing(121, e);
    expect(e.onFireT).toBe(8);
  });

  it('村正 155 useTurn 入表（Item.cs:3208-3214）+ Game 注入消费该列（:19549 门）', () => {
    expect(itemFuncOfVid(155)?.useTurn).toBe(1);
    expect(itemFuncOfVid(155)?.autoReuse).toBe(1);
    const src = srcGame();
    expect(src).toContain('|| tf.useTurn === 1');
  });
});

// ============ ⑦ 特例持位（Player.cs:49930-50104） ============
describe('⑦ 特例持位双表（Game 命中盒侧 + Renderer 绘制侧）', () => {
  it('Game.updateSwingHits：爪族 1827 独立持位 X10/8/6 Y26/24/20', () => {
    const src = srcGame();
    const i = src.indexOf('const clawSwing = swingVid === 1827');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, i + 900);
    expect(block).toContain('26 : ph === 1 ? 24 : 20');
    expect(block).toContain('10 : ph === 1 ? 8 : 6');
  });
  it('鱼族 2320/2330/2341 +8/4/4、钥匙牌 671 +12/6/8、破城刃 426 zero 偏移', () => {
    const src = srcGame();
    const i = src.indexOf('const clawSwing = swingVid === 1827');
    const block = src.slice(i, src.indexOf('const p = this.player;', i));
    expect(block).toContain('2320 || swingVid === 2330 || swingVid === 2341');
    expect(block).toContain('swingVid === 671');
    expect(block).toContain('swingVid === 426');
    expect(block).toContain('[-4, -6, 4][ph]');
    expect(block).toContain('[1, -4, -2][ph]');
  });
  it('Renderer.drawUseItem 同源双表同步（swingTier 内同四件）', () => {
    const src = srcRenderer();
    const i = src.indexOf('const swingTier = (ph: 0 | 1 | 2)');
    const block = src.slice(i, i + 2200);
    expect(block).toContain('hv === 1827');
    expect(block).toContain('hv === 2320 || hv === 2330 || hv === 2341');
    expect(block).toContain('hv === 671');
    expect(block).toContain('hv === 426');
  });
});

// ============ ⑧ meleeScaleGlove ×1.1（Player.cs:14749-14762/:41919-41930） ============
describe('⑧ meleeScaleGlove ×1.1', () => {
  it('置位五件：泰坦 536/力量 897/机械 936/火焰 1343/狂战士 3992；猛爪 211 不置', () => {
    for (const vid of [536, 897, 936, 1343, 3992]) {
      expect(accFxOfInternal(iid(vid))?.meleeScaleGlove, `vid ${vid}`).toBe(1);
    }
    expect(accFxOfInternal(iid(211))?.meleeScaleGlove).toBeUndefined();
  });

  it('equipStats 链：装备 897 → meleeScaleGlove=true（裸装 false）', () => {
    const p = new Player(100, 100, new Inventory());
    expect(p.equipStats.meleeScaleGlove).toBe(false);
    p.inv.armor[3] = { id: iid(897), stack: 1 };
    expect(p.equipStats.meleeScaleGlove).toBe(true);
    const q = new Player(100, 100, new Inventory());
    q.inv.armor[3] = { id: iid(211), stack: 1 };
    expect(q.equipStats.meleeScaleGlove).toBe(false);   // 猛爪手套无放大（:14559-14562）
  });

  it('消费侧：Game 命中盒 ×1.1（:44509-44511 (int) 截断）+ Renderer 贴图 ×1.1（DrawData scale）', () => {
    const g = srcGame();
    expect(g).toContain('eq.meleeScaleGlove && swingCombat?.melee');   // ★IIIII250:updateSwingHits 函数级快照 eq(冻结对象,语义同直读)
    expect(g).toContain('Math.trunc(bw * 1.1)');
    expect(srcRenderer()).toContain('ctx.scale(1.1, 1.1)');
    // 旧"泰坦手套未实装"注释已退役
    expect(g).not.toContain('泰坦手套未实装');
  });
});

// ============ ⑨ 手持层级统一（PlayerDrawSet.cs:354 BehindFrontArm） ============
describe('⑨ 手持层级统一 BehindFrontArm', () => {
  it('工具与武器挥舞同层（身体后图层、noGraphic 门），旧"非工具画身体前"分支退役', () => {
    const src = srcRenderer();
    expect(src).toContain('if (swing && swing.item >= 0 && !swing.noGraphic) {');
    // 旧双层分裂：非工具段 C 画身前（!tool && !noGraphic）已删
    expect(src.includes('!ITEM_DEFS[swing.item]?.tool && !swing.noGraphic')).toBe(false);
    expect(src).toContain('PlayerDrawSet.cs:354');
  });
});

// ============ Enemy 侧 stinky(120) 存量（5129 苍蝇美食） ============
describe('Enemy.stinkyT 存量倒数', () => {
  it('施加后逐秒衰减（AI 侧转向 GAP 登记见字段注）', () => {
    const { hooks } = makeGame(new World(60, 60, 30, 'open'));
    const e = new Enemy('zombie', 10 * TILE, 10 * TILE);
    e.stinkyT = 5;
    e.fixedUpdate(1, hooks);
    expect(e.stinkyT).toBe(4);
  });
});
