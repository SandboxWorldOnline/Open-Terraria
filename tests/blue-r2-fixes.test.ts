// 蓝队 R2 复核修复回归（2026-08-23）：红队 red-team-r2.md 确认项的修复闸门。
// 覆盖：R2-01/03/05 特性位数据面 / R2-06 发射侧乘区（命中侧不再乘）/
// R2-02 Colliding 视线门 + FastThenSlow 拖尾扫掠 / R2-12 转向衰减 /
// R2-13 低速 scale 收缩 Kill / R2-08 1126 ownerHitCheck 300px + usesOwnerMeleeHitCD。
// 权威 = Terarria1457（行号见各断言）。
import { describe, it, expect, vi } from 'vitest';
import { newWiresRadialState } from '../src/stats/wiresRadial';   // ★BJ662 桩族补齐（BJ626 newWiresRadialState 先例）
import { Arrow } from '../src/entities/Arrow';
import { ChloroClaymoreBlade } from '../src/entities/proj1457';
import { packGemStaffFeatures, gemDamageMultiplier } from '../src/data/vanillaGemStaff';
import { TileStore } from '../src/world/TileStore';
import type { GameHooks } from '../src/entities/types';

type HurtArgs = [number, number, number, unknown, number?, boolean?, number?, boolean?];
interface StubEnemy extends Record<string, unknown> {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  hurtLog: HurtArgs[];
}

function mkEnemy(id: number, x: number, y: number, w = 16, h = 16): StubEnemy {
  const e = { id, x, y, w, h, dead: false, hurtLog: [] as HurtArgs[] } as StubEnemy;
  e.hurt = (...a: unknown[]) => { e.hurtLog.push(a as HurtArgs); return false; };
  return e;
}

function makeHooks(enemies: StubEnemy[] = [], store?: TileStore): GameHooks {
  const hooks = {
    world: { store: store ?? new TileStore(400, 240) } as never,
    player: { equipStats: {}, cx: 800, cy: 1440, x: 790, y: 1419, w: 20, h: 42, dead: false } as never,
    enemies: () => enemies,
    critters: () => [],
    npcs: () => [],
    spawnDrop: () => null,
    damagePlayer: (): number => 0,
    addDamageNumber: () => {},
    cutTile: () => {},
    onEnemyKilled: () => {},
    spawnEnemy: () => {},
    spawnParticles: () => {},
    notifyInventoryChanged: () => {},
    playSfx: () => {},
    playSfxFiles: () => {},
    showPickupLabel: () => {},
  };
  return hooks as unknown as GameHooks;
}

function gemBolt(vid: number, x: number, y: number, vx: number, vy: number,
  gem: Record<string, boolean>, opts: { life?: number; pierce?: number; dmg?: number; kb?: number } = {}) {
  return new Arrow(x, y, vx, vy, opts.dmg ?? 100, opts.kb ?? 2, vid,
    { grav: 0, life: opts.life ?? 300, pierce: opts.pierce ?? 1, gem: gem as never });
}

describe('R2-03/R2-05 PackGemStaffFeatures 特性位（Player.cs:49990-50012 + :49783-49790）', () => {
  it('RepeatsGem：本弹与长袍同宝石才置位（121+1282 真 / 121+1285 假）', () => {
    expect(packGemStaffFeatures(121, 1282, undefined).repeatsGem).toBe(true);
    expect(packGemStaffFeatures(124, 1285, undefined).repeatsGem).toBe(true);
    expect(packGemStaffFeatures(597, 4256, undefined).repeatsGem).toBe(true);
    expect(packGemStaffFeatures(121, 1285, undefined).repeatsGem).toBeUndefined();
    expect(packGemStaffFeatures(121, undefined, undefined).repeatsGem).toBeUndefined();
  });

  it('6171 AllGems：只追加 Homing/CanBounce/AoeExplosion/FastThenSlow 四特性（:49783-49790）', () => {
    // 蓝队 R2-05 勘误：曾把 SwirlTwins/ArPenSpread/BiggerHitbox 也置上（1457 不加）
    const f = packGemStaffFeatures(126, undefined, 6171);
    expect(f.allGems).toBe(true);
    expect(f.homing).toBe(true);
    expect(f.canBounce).toBe(true);
    expect(f.aoeExplosion).toBe(true);
    expect(f.fastThenSlow).toBe(true);
    expect(f.swirlTwins).toBeUndefined();
    expect(f.arPenSpread).toBeUndefined();
    // shoot==126 的主特性 BiggerHitbox 保留（PackGemStaffFeatures 先并 shoot 臂）
    expect(f.biggerHitbox).toBe(true);
    expect(f.repeatsGem).toBeUndefined();   // :50004 if (!AllGems) 门
  });

  it('GetDamageMultiplier：AllGems 恒 1（Projectile.cs:165-169）', () => {
    expect(gemDamageMultiplier(packGemStaffFeatures(126, undefined, 6171))).toBe(1);
    expect(gemDamageMultiplier({ swirlTwins: true })).toBe(0.6);
  });
});

describe('R2-06 伤害乘区落点（Player.cs:49813-49814 发射侧 (int) 截断）', () => {
  it('命中侧不再乘：SwirlTwins 弹 damage=13 直击结算 13（曾 round(13×0.6)=8）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（主环首掷 ×1.0）
    const e = mkEnemy(1, 505, 795);
    const g = makeHooks([e]);
    // 发射侧已乘语义：Game.fireGemStaffBolts 传 trunc(13×0.6)=7——此处直接以
    // 13 构造验证命中侧【不再】二次乘 0.6（曾 Math.round(dmg×mult) 在命中侧）
    const a = gemBolt(123, 500, 795, 8, 0, { swirlTwins: true }, { dmg: 13, pierce: 1 });
    a.fixedUpdate(1 / 60, g);
    expect(e.hurtLog).toHaveLength(1);
    expect(e.hurtLog[0][0]).toBe(13);
  });

  it('AoeExplosion 爆段仍吃 0.35/mult（Kill :77044-77048，damage 字段=发射侧终值）', () => {
    const near = mkEnemy(1, 540, 795);
    const g = makeHooks([near]);
    const a = gemBolt(122, 500, 795, 0, 0, { aoeExplosion: true, swirlTwins: true },
      { life: 1, dmg: 100, kb: 2 });
    a.fixedUpdate(1 / 60, g);
    expect(near.hurtLog[0][0]).toBe(58);   // trunc(100 × 0.35/0.6)
  });
});

describe('R2-02 Colliding（Projectile.cs:15443-15476）：视线门 + FastThenSlow 拖尾扫掠', () => {
  it('视线门：弹与敌之间有实心墙 → 不命中（曾隔墙命中）', () => {
    const st = new TileStore(400, 240);
    for (let y = 40; y < 52; y++) st.setTile(33, y, 1);   // 竖墙 x:[528,544)
    const e = mkEnemy(1, 520, 788);                       // 敌 [520,536] 贴墙另一侧
    const g = makeHooks([e], st);
    // BiggerHitbox +30：弹盒 [500,510]→[470,540] 与敌盒相交（几何上够得到），
    // 但弹心→敌心视线被墙挡 → 不命中
    const a = gemBolt(126, 500, 795, 0.01, 0, { biggerHitbox: true }, { pierce: 5 });
    for (let i = 0; i < 5; i++) a.fixedUpdate(1 / 60, g);
    expect(e.hurtLog).toHaveLength(0);
  });

  it('对照：同几何无墙 → 正常命中（门不误伤）', () => {
    const e = mkEnemy(1, 520, 788);
    const g = makeHooks([e]);
    const a = gemBolt(126, 500, 795, 0.01, 0, { biggerHitbox: true }, { pierce: 5 });
    a.fixedUpdate(1 / 60, g);
    expect(e.hurtLog).toHaveLength(1);
  });

  it('FastThenSlow 拖尾扫掠：40px/t 单帧跨越薄目标，oldPos[1] 盒补中（:15452-15466）', () => {
    // 弹 x=500 起 +40/t（×5 出速）；敌 [508,512]×4px 薄条——当前盒与上一帧盒都
    // 跨不过去，只有拖尾盒（tick1 起点 [500,510]）能相交
    const e = mkEnemy(1, 508, 795, 4, 16);
    const g = makeHooks([e]);
    const a = gemBolt(124, 500, 795, 40, 0, { fastThenSlow: true }, { life: 100, pierce: 5 });
    a.fixedUpdate(1 / 60, g);   // tick1：当前盒 [540,550] 假、拖尾只有本帧 → 不中
    expect(e.hurtLog).toHaveLength(0);
    a.fixedUpdate(1 / 60, g);   // tick2：当前盒 [~579] 假、oldPos[1]=[500,510] ∩ [508,512] → 中
    expect(e.hurtLog).toHaveLength(1);
  });

  it('对照：非 FastThenSlow 同几何不触发拖尾（扫掠仅该特性位）', () => {
    const e = mkEnemy(1, 508, 795, 4, 16);
    const g = makeHooks([e]);
    const a = gemBolt(121, 500, 795, 40, 0, {}, { life: 100, pierce: 5 });
    a.fixedUpdate(1 / 60, g);
    a.fixedUpdate(1 / 60, g);
    expect(e.hurtLog).toHaveLength(0);
  });
});

describe('R2-12 FastThenSlow 高速段转向衰减（:38598-38601 Remap(speed,30,40,1,0)）', () => {
  it('出速 45（×5 档）完全不拐弯（衰减因子 0；本仓减速先于转向一拍，45×0.97=43.65 仍 ≥40）', () => {
    const g = makeHooks([mkEnemy(1, 800, 400)]);   // 目标在正上方 400px < 视距 1000
    const a = gemBolt(124, 500, 800, 45, 0, { fastThenSlow: true, homing: true });
    a.fixedUpdate(1 / 60, g);
    expect(a.vy).toBe(0);                 // 高速段转向率 = 0
    expect(a.vx).toBeCloseTo(43.65, 5);   // 仅 ×0.97 减速
  });

  it('减速穿 30 后恢复转向（衰减因子 1）', () => {
    const g = makeHooks([mkEnemy(1, 800, 400)]);
    const a = gemBolt(124, 500, 800, 8, 0, { fastThenSlow: true, homing: true });
    a.fixedUpdate(1 / 60, g);
    expect(a.vy).not.toBe(0);             // 低速段满转向
  });
});

describe('R2-13 FastThenSlow 低速收缩 Kill（:38633-38641）', () => {
  it('速度 ≤0.1 后逐帧 scale −0.005、<0.1 Kill（不悬停到 timeLeft）', () => {
    const g = makeHooks();
    const a = gemBolt(124, 500, 800, 0.05, 0, { fastThenSlow: true }, { life: 3600, pierce: 1 });
    a.fixedUpdate(1 / 60, g);
    expect(a.dead).toBe(false);
    expect(a['drawScale']).toBeCloseTo(0.995, 6);   // 1 − 0.005
    for (let i = 0; i < 300 && !a.dead; i++) a.fixedUpdate(1 / 60, g);
    expect(a.dead).toBe(true);            // (1−0.1)/0.005 = 180 帧缩没
  }, 10000);

  it('对照：速度 >0.1 恒减速不缩不杀', () => {
    const g = makeHooks();
    const a = gemBolt(124, 500, 800, 8, 0, { fastThenSlow: true }, { life: 3600, pierce: 1 });
    for (let i = 0; i < 60; i++) a.fixedUpdate(1 / 60, g);
    expect(a.dead).toBe(false);
    expect(a['drawScale']).toBe(1);
  });
});

describe('R2-08 1126 usesOwnerMeleeHitCD（Projectile.cs:10556→:12596/:14343）', () => {
  it('共享命中表：表内已记的敌不结算；刃命中后回写共享表', () => {
    const e = mkEnemy(1, 795, 1435);
    const g = makeHooks([e]);
    const b = new ChloroClaymoreBlade(800, 1440, 1, 0, 95, 6, 32, 1);
    const shared = new Set<number>();
    b.sharedMeleeHits = shared;
    shared.add(1);                        // 玩家挥击弧已先结算该敌
    b.fixedUpdate(1, g);
    expect(e.hurtLog).toHaveLength(0);    // 刃跳过（同一挥击不双跳字）
    shared.delete(1);
    b.fixedUpdate(1, g);
    expect(e.hurtLog).toHaveLength(1);    // 表清后正常结算
    expect(shared.has(1)).toBe(true);     // 命中回写 → 玩家弧同帧不再结算
  });
});

// ================= Game.fireGemStaffBolts 接线（case 'magic' 尾段重构守卫） =================
import { Game } from '../src/core/Game';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { World } from '../src/world/World';
import { TILE } from '../src/core/constants';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

/** updateUse 可驱动的最小 Game 桩（手持指定 vid 法杖、可选胸槽长袍、鼠标指右） */
function casterGame(heldVid: number, robeVid?: number) {
  const g = Object.create(Game.prototype) as unknown as Record<string, unknown>;
  // ★BJ662（2026-10-12）updateUse 头 tickWiresRadial（BJ572）读 this.wiresRadial——Object.create 壳无构造器字段 → flowerUpdate(st=undefined) TypeError（存量桩族缺件,持物非 wire 工具走早退支,桩仅为通路）
  (g as unknown as { wiresRadial: unknown }).wiresRadial = newWiresRadialState();
  const player = new Player(50 * TILE, 90 * TILE, new Inventory());
  player.inv.add(iid(heldVid), 1);
  player.inv.selected = player.inv.slots.length - 1;   // add 落在首个空格，选中它
  const sel = player.inv.slots.findIndex((s) => s && s.id === iid(heldVid));
  player.inv.selected = Math.max(0, sel);
  if (robeVid) player.inv.armor[1] = { id: iid(robeVid), stack: 1 };
  const added: unknown[] = [];
  g.player = player;
  g.world = new World(120, 120, 30, 'c741');
  g.entities = { critters: [], npcs: [], enemies: [], projectiles: [], add: (e: unknown) => added.push(e) };
  g.input = { mouseDown: true, mouseHeld: true, mouseX: 700, mouseY: 300, rightDown: false, uiBlocking: false, downAction: () => false };
  g.camera = { tileUnder: () => [60, 60], screenToWorld: () => [800, 0] };
  g.renderer = { canvas: { width: 800, height: 600 }, fullMap: { open: false }, timeUiHover: false, weatherUiHover: false };
  g.smartCursor = { showing: false };
  g.annotateMode = false;
  g.prevSwingMouse = false;
  g.mining = null;
  g.swingHitSet = new Set<number>();
  g.swingTileCutSet = new Set<number>();
  g.sfx = { playWavFile: () => true, playFiles: () => true, play: () => {} };
  g.playSfxFile = () => {};
  return { g: g as unknown as GameHooks & Record<string, unknown>, player, added };
}

describe('Game case magic 尾段接线（蓝队 R2 重构守卫）', () => {
  it('非宝石魔法弹（花火 112→15）照常发射——重构不得让魔法系哑火', () => {
    const { g, added } = casterGame(112);
    (g as unknown as { updateUse: (dt: number) => void }).updateUse(1 / 60);
    const arrows = added.filter((x) => x instanceof Arrow) as Arrow[];
    expect(arrows.length).toBeGreaterThanOrEqual(1);
    expect((arrows[0] as unknown as { projId: number }).projId).toBe(15);
    expect((arrows[0] as unknown as { gem: unknown }).gem ?? null).toBeNull();
  });

  it('R2-01：蓝晶杖 741 双弹——主弹相位 0、孪生弹相位 1（:49897-49904）', () => {
    const { g, added } = casterGame(741);
    (g as unknown as { updateUse: (dt: number) => void }).updateUse(1 / 60);
    const arrows = added.filter((x) => x instanceof Arrow) as Arrow[];
    expect(arrows).toHaveLength(2);
    expect((arrows[0] as unknown as { gemPhase: number }).gemPhase ?? 0).toBe(0);
    expect((arrows[1] as unknown as { gemPhase: number }).gemPhase).toBe(1);
  });

  it('R2-03+R2-06：蓝晶杖+蓝晶袍成套 → 发射侧 trunc(dmg×0.6)+4', () => {
    // 741 基伤 18 → trunc(18×0.6)=10 + RepeatsGem 4 = 14（两弹同伤）
    const { g, added } = casterGame(741, 1284);
    (g as unknown as { updateUse: (dt: number) => void }).updateUse(1 / 60);
    const arrows = added.filter((x) => x instanceof Arrow) as Arrow[];
    expect(arrows).toHaveLength(2);
    expect((arrows[0] as unknown as { damage: number }).damage).toBe(Math.trunc(18 * 0.6) + 4);
    expect((arrows[1] as unknown as { damage: number }).damage).toBe(Math.trunc(18 * 0.6) + 4);
  });

  it('对照：蓝晶杖无袍 → trunc(18×0.6)=10，无成套奖励', () => {
    const { g, added } = casterGame(741);
    (g as unknown as { updateUse: (dt: number) => void }).updateUse(1 / 60);
    const arrows = added.filter((x) => x instanceof Arrow) as Arrow[];
    expect((arrows[0] as unknown as { damage: number }).damage).toBe(Math.trunc(18 * 0.6));
  });

  it('R2-04：红晶杖 741→743 半动画补挥——t 过 dur/2 恰一帧补发第二弹（:43033-43041）', () => {
    const { g, player, added } = casterGame(743);
    const heldId = iid(743);
    // 手动起挥：dur=28（useAnimation），t=15 → updateSwingHits 先自减到 14 = floor(28/2)
    (g as unknown as { swing: unknown }).swing = { t: 15, dur: 28, item: heldId, useStyle: 5 };
    const before = (player as unknown as { useTime: number }).useTime;
    (g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    const arrows = added.filter((x) => x instanceof Arrow) as Arrow[];
    expect(arrows).toHaveLength(1);
    expect((arrows[0] as unknown as { projId: number }).projId).toBe(125);
    expect((arrows[0] as unknown as { damage: number }).damage).toBe(Math.trunc(18 * 0.5)); // ArPenSpread 0.5，无袍无成套
    // withAudioVisualFeedback:false → 不重置 itemTime（useTime 不动）
    expect((player as unknown as { useTime: number }).useTime).toBe(before);
  });

  it('R2-04 对照：非中点帧不补挥', () => {
    const { g, added } = casterGame(743);
    const heldId = iid(743);
    (g as unknown as { swing: unknown }).swing = { t: 20, dur: 28, item: heldId, useStyle: 5 };
    (g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(added.filter((x) => x instanceof Arrow)).toHaveLength(0);
  });
});
