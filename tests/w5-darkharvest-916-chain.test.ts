// ★清偿刀 W5（2026-10-02）：敌怪环 916 黑收成链电反序+目标面定谳落刀。
//  定谳锚（Terarria1457 亲读三证 + 词条）：
//   · WhipTagEffect_DarkHarvest.SpawnBlackLightning（:14-20）：NewProjectile(916,
//     dmg=TagDamage×SummonTagDamageMultiplier[触发弹],kb=0f) @ npcHit.Center +
//     【:18 localNPCImmunity[npcHit]=-1 源敌永免】——916 伤【永不】落回被命中敌
//     （Damage_PVE :12595 usesLocal array[i]==0 门 + 减表 :17380 只递减 >0;
//     AI_176 索敌 :45881/:45925 同门排除）。原版词条 Items.json:8299
//     "Dark energy jumps from enemies hit by summons" 同证。
//   · 916 = AI_176_EdgyLightning（:45878-45916）逐跳链电：FindTargetWithinRange(400)
//     （:45918-45936,CanBeChasedBy+immune==0,最近者胜/同距先到,严格 <400）→ 命中
//     写 immuneArray[victim]=-1（localNPCHitCooldown=-1 :8685=同敌一跳）→
//     penetrate=3（:8684）至多三跳;无目标 Kill（:45914）。
//   · 单跳伤面：kb=0（:17）/armorPenetration=50（:8686）/crit 恒 false（无类旗,
//     :12870-128 类掷不达）/banner 照跑（:13388-90）/916 非 MinionShot → 不吃 tag
//     不递归（WhipTagEffect.cs:76-87）。
//   · 位次：主命中 StrikeNPC（:13702）→ TagEffectStack.OnHit（:13711,出 916）→
//     写梯（:14175-14179）→ 916 弹体伤再后（次拍）。
//  本仓反序层（旧码必红面）：contact()（MinionProj）与 Arrow whipTagShot 的 hurtFx
//  【同步直调】伤落被命中敌且先于主 hurt——反序反噬主命中（Y2 探针实证主伤整丢）
//  +目标面反记+tag 伤双记（主命中 ModifyHit :12954 已并 TagDamage 一次）。落刀=
//  hurtFx 汇出收集,主命中受理+写梯后 darkHarvestChain 落地链电（伤落其他敌）。
//  判别力（旧码必红项）：§B1/§C1 主伤丢+双记+序面;§B2 门拒跳链电旁落;
//  §A1-A5 链面语义（若直调旧形则链面整缺）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { Arrow } from '../src/entities/Arrow';
import { MinionProj } from '../src/entities/MinionProj';
import { darkHarvestChain } from '../src/entities/WhipTag';
import type { GameHooks } from '../src/entities/types';

// ---- mock 环境（a-batch2/y2 同款） ----
const W = 200, H = 120;
function makeStore(): TileStore {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  return store;
}

/** 全局命中序日志（hurt 调用序=序面钉值载体） */
const seq: string[] = [];

interface ChainEnemy {
  id: number; x: number; y: number; w: number; h: number; cx: number; cy: number;
  dead: boolean; iframes: number; maxHp: number; hp: number;
  vanillaId: number; realLife: number; dontTakeDamage: boolean;
  vx: number; vy: number; tag: string;
  calls: Array<{ d: number; kx: number; ky: number; pen: number; crit: boolean; pierce: number }>;
  hurt(d: number, kx: number, ky: number, g: GameHooks, pen?: number, crit?: boolean,
    pierce?: number, fromPlayer?: boolean): boolean;
}
function mkEnemy(id: number, cx: number, cy: number, tag: string, w = 38, h = 38): ChainEnemy {
  const e: ChainEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy,
    dead: false, iframes: 0, maxHp: 5000, hp: 10000,
    vanillaId: 0, realLife: -1, dontTakeDamage: false, vx: 0, vy: 0, tag, calls: [],
    hurt(d, kx, ky, _g, pen = 0, crit = false, pierce = 0) {
      e.calls.push({ d, kx, ky, pen, crit, pierce });
      seq.push(e.tag);
      // Enemy.hurt :14427-14428 写梯镜像（pierce 三态）
      if (pierce === -3) e.iframes = 0;
      else if (pierce !== -2 && pierce !== 1) e.iframes = 10;
      return true;
    },
  };
  return e;
}
function makeHooks(enemies: ChainEnemy[] = []) {
  const store = makeStore();
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const hooks: GameHooks = {
    world: { store } as never,
    player: player as never,
    enemies: () => enemies,
    critters: () => [],
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
  (hooks as unknown as { entities: { add: (e: unknown, b: string) => void } }).entities = {
    add: (e: unknown) => { added.push(e); },
  };
  return { hooks, store, player, added };
}
const step = (list: unknown[], ticks: number, hooks: GameHooks): void => {
  for (let i = 0; i < ticks; i++) {
    for (const e of list) {
      const p = e as { dead: boolean; fixedUpdate: (dt: number, g: GameHooks) => void };
      if (!p.dead) p.fixedUpdate(1, hooks);
    }
  }
};
/** contact() 私有环直驱（Y2 同式:确定单发,AI 态机无关）;乌鸦 317 */
const ravenAt = (player: Player, cx: number, cy: number): MinionProj =>
  new MinionProj(cx - 14, cy - 14, 317, 30, 1.5, false, 0, false, () => player);
const contactDirect = (m: MinionProj, hooks: GameHooks, dmg = 30, cd: number | undefined = 5): boolean =>
  (m as unknown as { contact: (g: GameHooks, d: number, cd?: number) => boolean }).contact(hooks, dmg, cd);

beforeEach(() => { seq.length = 0; });

// ---- §A darkHarvestChain 链面直驱（AI_176 + Damage_PVE 受理面折算） ----
describe('W5-§A：darkHarvestChain 链面（:45878-45936/:8684-8686）', () => {
  it('A1 源敌永免（:18）+逐跳最近者胜+同敌一跳+penetrate=3 至多三跳', () => {
    const src = mkEnemy(0, 600, 600, 'SRC');
    const e1 = mkEnemy(1, 700, 600, 'E1');    // 距源 100
    const e2 = mkEnemy(2, 800, 600, 'E2');    // 距 E1 100
    const e3 = mkEnemy(3, 900, 600, 'E3');    // 距 E2 100
    const e4 = mkEnemy(4, 1000, 600, 'E4');   // 第 4 跳位——penetrate 耗尽不达
    const { hooks } = makeHooks([src, e1, e2, e3, e4]);
    darkHarvestChain(hooks, 15, 600, 600, 0);
    expect(src.calls).toEqual([]);                       // ★源敌永免（旧直调形=SRC:15 必红）
    expect(seq).toEqual(['E1', 'E2', 'E3']);             // 最近者胜逐跳;E4 不达（penetrate=3）
    expect(e1.calls.length).toBe(1);
    expect(e2.calls.length).toBe(1);
    expect(e3.calls.length).toBe(1);
    expect(e4.calls).toEqual([]);
  });

  it('A2 400px 索敌门=严格小于（:45918 maxRange/:45928 !(num<=num2)）', () => {
    {  // 距源恰 400 → 不入索敌（num=400 <= num2=400 不更新）
      const far = mkEnemy(1, 600 + 400, 600, 'FAR');
      const { hooks } = makeHooks([far]);
      darkHarvestChain(hooks, 15, 600, 600, 0);
      expect(far.calls).toEqual([]);
      expect(seq).toEqual([]);
    }
    {  // 399 → 入索敌命中
      seq.length = 0;
      const near = mkEnemy(1, 600 + 399, 600, 'NEAR');
      const { hooks } = makeHooks([near]);
      darkHarvestChain(hooks, 15, 600, 600, 0);
      expect(seq).toEqual(['NEAR']);
    }
  });

  it('A3 无目标即 Kill（:45914）：孤源零跳', () => {
    const src = mkEnemy(0, 600, 600, 'SRC');
    const { hooks } = makeHooks([src]);
    darkHarvestChain(hooks, 15, 600, 600, 0);
    expect(seq).toEqual([]);
    expect(src.calls).toEqual([]);
  });

  it('A4 跳时窗门（:12636 immune[owner]）：窗内敌跳过,次近者承接', () => {
    const win = mkEnemy(1, 700, 600, 'WIN');
    win.iframes = 10;
    const e2 = mkEnemy(2, 800, 600, 'E2');
    const { hooks } = makeHooks([win, e2]);
    darkHarvestChain(hooks, 15, 600, 600, 0);
    expect(seq).toEqual(['E2']);                         // ★窗内 WIN 跳过（瞬时模型,登记偏差）
    expect(win.calls).toEqual([]);
  });

  it('A5 canBeChasedBy 索敌门（:45925）：critter(lifeMax≤5)/friendly/dontTakeDamage 不入链', () => {
    const critter = mkEnemy(1, 650, 600, 'CRT');
    critter.maxHp = 5;
    const friendly = mkEnemy(2, 660, 600, 'FRN');
    (friendly as unknown as { def: { friendly: boolean } }).def = { friendly: true };
    const dont = mkEnemy(3, 670, 600, 'DNT');
    dont.dontTakeDamage = true;
    const e4 = mkEnemy(4, 700, 600, 'E4');
    const { hooks } = makeHooks([critter, friendly, dont, e4]);
    darkHarvestChain(hooks, 15, 600, 600, 0);
    expect(seq).toEqual(['E4']);
  });

  it('A6 单跳伤面钉值：kb=0（:17）/armorPen=50（:8686）/pierce=-3=usesLocal 主支清窗（:14177）', () => {
    const e1 = mkEnemy(1, 700, 600, 'E1');
    const { hooks } = makeHooks([e1]);
    darkHarvestChain(hooks, 15, 600, 600, 0);
    expect(e1.calls).toEqual([{ d: 15, kx: 0, ky: 0, pen: 50, crit: false, pierce: -3 }]);
    expect(e1.iframes).toBe(0);                          // -3 档清窗（非 10）
  });
});

// ---- §B 敌怪环 contact() 面（:13711 位次+目标面） ----
describe('W5-§B：contact() 敌怪环（乌鸦 317 直驱）', () => {
  it('B1 主伤+链电双落、源敌零双记、主先链后（:13702→:13711）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（R18-F2 主环首掷 ×1.0）
    const src = mkEnemy(0, 600, 600, 'SRC');
    const e1 = mkEnemy(1, 700, 600, 'E1');
    const { hooks, player } = makeHooks([src, e1]);
    player.tagEffectStack.tryApplyTagToNPC(4680, src.id, 0, 0);   // darkharvest tagDamage 15
    contactDirect(ravenAt(player, 600, 600), hooks);
    // 主命中 = 30 base + 15 tag = 45（ModifyHit :12954 单记）;链电 15 落 E1。
    // 旧同步直调形:SRC=[15(直),45(主)] 双记+E1 零伤+序 [SRC,SRC] ——三判别全红。
    expect(src.calls.map((c) => c.d)).toEqual([45]);
    expect(e1.calls.map((c) => c.d)).toEqual([15]);      // ★目标面:伤落其他敌
    expect(seq).toEqual(['SRC', 'E1']);                  // ★序面钉值:主伤先于链电
  });

  it('B2 主命中门拒（dontTakeDamage :12600 头门前置）→ 整跳：主命中尝试/tag/链电全不达（BJ475① 现役定谳形）', () => {
    const src = mkEnemy(0, 600, 600, 'SRC');
    const e1 = mkEnemy(1, 700, 600, 'E1');
    src.dontTakeDamage = true;
    const { hooks, player } = makeHooks([src, e1]);
    player.tagEffectStack.tryApplyTagToNPC(4680, src.id, 0, 0);
    contactDirect(ravenAt(player, 600, 600), hooks);
    // ★BJ493①（2026-10-04）B2 锁更新：旧 W5 提交态「主命中尝试照发 [45]（真
    //  Enemy.hurt 内部拒）」与 BJ475① 落刀的 contact 环 :12600 DTD 前置门
    //  （MinionProj.ts `if (dontTakeDamage) continue`,BJ475-tag-crit-batch3 §1a
    //  同构——门先于 Inner 全链,hurt 调用/TimerCrit/tag ModifyHit/私表 cd 消费
    //  全不可达）契约冲突=前在红。现役定谳形=整跳零 hurt 调用。
    //  变异判别力保持：①摘 :12600 前置门 → contact 照发主命中 [45]/seq=['SRC']
    //  （916 照旧被 mainGated 拦=E1 零伤）→ 三断言全红;②回退 W5 汇出收集为
    //  同步直调（须连门同摘才可达 SRC）→ src 双记 [15,45] → 本测+B1 双红。
    expect(src.calls).toEqual([]);                       // ★整跳:主命中尝试不达（旧 [45] 锁退役）
    expect(e1.calls).toEqual([]);                        // ★门拒跳无 916（判别力保持）
    expect(seq).toEqual([]);                             // ★零 hurt 调用（摘门=[45]/['SRC'] 必红）
  });

  it('B3 链靶窗态独立于源敌窗（-2 缺省族主命中置 10t 窗不拦链电）', () => {
    const src = mkEnemy(0, 600, 600, 'SRC');
    const e1 = mkEnemy(1, 700, 600, 'E1');
    const { hooks, player } = makeHooks([src, e1]);
    player.tagEffectStack.tryApplyTagToNPC(4680, src.id, 0, 0);
    contactDirect(ravenAt(player, 600, 600), hooks, 30, -2);   // CONTACT_PLAYER_WINDOW 族
    expect(src.iframes).toBe(10);                        // 主命中 pierce=0 置窗（存续面）
    expect(e1.calls.map((c) => c.d)).toEqual([15]);      // ★链靶窗态独立（源窗不外溢链电）
  });
});

// ---- §C Arrow whipTagShot 面（塔射/随从弹 tag 通道） ----
describe('W5-§C：Arrow whipTagShot 命中区（374 MinionShot 载体）', () => {
  it('C1 主伤+tag 单记于被命中敌、链电落其他敌、主先链后', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    const src = mkEnemy(0, 600, 600, 'SRC');
    const e1 = mkEnemy(1, 700, 600, 'E1');
    const { hooks, player } = makeHooks([src, e1]);
    player.tagEffectStack.tryApplyTagToNPC(4680, src.id, 0, 0);
    const arrow = new Arrow(src.x - 60, src.y + 4, 8, 0, 10, 1, 374, { grav: 0, life: 60 });
    arrow.whipTagShot = true;   // 374 ∈ MinionShot（ProjectileID.cs:197）
    step([arrow], 20, hooks);
    // 主命中 = 10 base + 15 tag = 25（单记）;旧同步直调形=SRC[15,25] 双记+E1 零伤。
    expect(src.calls.map((c) => c.d)).toEqual([25]);
    expect(e1.calls.map((c) => c.d)).toEqual([15]);      // ★目标面
    expect(seq).toEqual(['SRC', 'E1']);                  // ★序面钉值
  });

  it('C2 非 whipTagShot 弹零 tag 零链（通道整门）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档
    const src = mkEnemy(0, 600, 600, 'SRC');
    const e1 = mkEnemy(1, 700, 600, 'E1');
    const { hooks, player } = makeHooks([src, e1]);
    player.tagEffectStack.tryApplyTagToNPC(4680, src.id, 0, 0);
    const arrow = new Arrow(src.x - 60, src.y + 4, 8, 0, 10, 1, 374, { grav: 0, life: 60 });
    step([arrow], 20, hooks);
    expect(src.calls.map((c) => c.d)).toEqual([10]);     // 裸 base（无 tag 加伤）
    expect(e1.calls).toEqual([]);                        // 无链电
    expect(seq).toEqual(['SRC']);
  });
});
