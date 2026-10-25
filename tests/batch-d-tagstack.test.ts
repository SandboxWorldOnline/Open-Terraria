// 批 D：1457 鞭 tag 栈框架 + 数值大改 + 召唤师鞭 tag 配饰九件（行为回归）
//  权威：Terarria1457/Terraria.GameContent.Items/TagEffectStack.cs（:1-139）+
//  TagEffectState.cs（:1-120）+ TagDamageChanges.cs + WhipTagEffect_*.cs 十类 +
//  ItemID.cs:1313-1420 UniqueTagEffects 全表 + Player.cs :13068-13083/:14615-14739
import { describe, it, expect, vi } from 'vitest';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import {
  TagEffectStack, TAG_EFFECTS, TAG_IMMUNE_TO_WHIPS, resolveWhipTagHit,
} from '../src/entities/WhipTag';
import { WhipProj } from '../src/entities/WhipProj';
import { Arrow } from '../src/entities/Arrow';
import { ITEM_BY_KEY, ITEM_DEFS } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';
import type { GameHooks } from '../src/entities/types';

const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

// ---- mock 环境（a-batch2 同款） ----
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number; vanillaId?: number;
  realLife?: number | null; hurtFx?: (d: number) => void;
  hurt: (d: number, kx: number, ky: number, g: GameHooks) => boolean;
  hits: number[];
}
const mkEnemy = (id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy => {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy, hp: 100000, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
};
/** 城镇 NPC mock（★BJ449 巫毒窄门/索敌门判别用——hitTownNpcs 消费面） */
const mkTownNpc = (id: number, cx: number, cy: number, vanillaId: number) => ({
  id, x: cx - 8, y: cy - 12, w: 16, h: 24, dead: false, bound: false,
  vanillaId, hp: 100000, hits: [] as number[],
  hurt: function (this: { hp: number; hits: number[] }, d: number) {
    this.hp -= d; this.hits.push(d); return true;
  },
});
/** equipStats 冻结+只读 getter（Player.ts:1820/实例 getter）——实例影子覆写注入 killGuide */
const withKillGuide = (p: Player): void => {
  const frozen = p.equipStats as Record<string, unknown>;
  Object.defineProperty(p, 'equipStats', {
    configurable: true,
    get: () => ({ ...frozen, killGuide: true }),
  });
};
function makeHooks(enemies: MockEnemy[] = []) {
  const store = new TileStore(200, 120);
  for (let x = 0; x < 200; x++) for (let y = 100; y < 120; y++) store.setTile(x, y, 1);
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

/** 置 maxTagEffects 门（测试环境无配饰槽时的字段覆写;equipStats 缺省 1） */
const setMaxTags = (p: Player, n: number): void => {
  Object.defineProperty(p, 'maxTagEffects', { value: n, configurable: true });
};

// ============ 1 TagEffectStack 框架 ============
describe('TagEffectStack（TagEffectStack.cs 1:1）', () => {
  it('容量上限 MaxEffects=5（:8）;门控 maxTagEffects 缺省 1 → 新 tag 驱逐旧 tag（:131-138）', () => {
    expect(TagEffectStack.MAX_EFFECTS).toBe(5);
    const { player } = makeHooks();
    expect(player.maxTagEffects).toBe(1);       // :1187 默认 1
    expect(player.tagEffectDuration).toBe(1);   // :1189 默认 1f
    const e = mkEnemy(1, 0, 0);
    player.tagEffectStack.tryApplyTagToNPC(4672, e.id);
    expect(player.tagEffectStack.activeTypes()).toEqual([4672]);
    player.tagEffectStack.tryApplyTagToNPC(5479, e.id);   // 星鞭 480t（:1402）
    expect(player.tagEffectStack.activeTypes()).toEqual([5479]);   // 4672 被驱逐
    expect(player.tagEffectStack.isNPCTagged(4672, e.id)).toBe(false);
  });

  it('MRU 序：已存在 tag 再打 → 提到栈顶不新增（TrySetActiveEffect :42-58）', () => {
    const { player } = makeHooks();
    setMaxTags(player, 3);
    const e = mkEnemy(2, 0, 0);
    player.tagEffectStack.tryApplyTagToNPC(4672, e.id);
    player.tagEffectStack.tryApplyTagToNPC(5074, e.id);
    player.tagEffectStack.tryApplyTagToNPC(4672, e.id);   // 再打 → 提顶
    expect(player.tagEffectStack.activeTypes()).toEqual([4672, 5074]);
  });

  it('超限驱逐从栈尾（最久未用先出）;驱逐清自 buff（Deactivate → OnRemovedFromPlayer :56-60）', () => {
    const { player } = makeHooks();
    setMaxTags(player, 2);
    const e = mkEnemy(3, 0, 0);
    player.tagEffectStack.tryApplyTagToNPC(4680, e.id);   // 黑收成 buff 311
    expect(player.whipBuffs[311]).toBe(180);
    player.tagEffectStack.tryApplyTagToNPC(4913, e.id);   // 荆棘鞭 buff 314
    player.tagEffectStack.tryApplyTagToNPC(5074, e.id);   // 无 buff → 4680 出栈
    expect(player.tagEffectStack.activeTypes()).toEqual([5074, 4913]);
    expect(player.whipBuffs[311]).toBeUndefined();        // ClearBuff(PlayerBuffId)
    expect(player.whipBuffs[314]).toBe(180);
  });

  it('tag 时长 = TagDuration × tagEffectDuration（:62-66）;星鞭 5479 = 480（1457 ItemID.cs:1402 全表唯一覆写;其余缺省 240 = WhipTagEffect.cs:17-22）', () => {
    const { player } = makeHooks();
    const e = mkEnemy(4, 0, 0);
    player.tagEffectStack.tryApplyTagToNPC(5479, e.id);
    // 内部窗口经行为验证：update() 479 次后仍标记,第 480 次后失效
    for (let i = 0; i < 479; i++) player.tagEffectStack.update();
    expect(player.tagEffectStack.isNPCTagged(5479, e.id)).toBe(true);
    player.tagEffectStack.update();
    expect(player.tagEffectStack.isNPCTagged(5479, e.id)).toBe(false);
    // 普通鞭 240t
    const e2 = mkEnemy(5, 0, 0);
    player.tagEffectStack.tryApplyTagToNPC(4672, e2.id);
    for (let i = 0; i < 240; i++) player.tagEffectStack.update();
    expect(player.tagEffectStack.isNPCTagged(4672, e2.id)).toBe(false);
  });

  it('SilverBracer tagEffectDuration ×3：tag/自 buff 时长 ×3（:13068-13074 + AddTheBuff :53-60）', () => {
    const { player } = makeHooks();
    player.inv.armor[3] = { id: iid(6156), stack: 1 };   // 银护腕
    expect(player.equipStats.tagEffectDuration).toBe(3);
    expect(player.equipStats.maxTagEffects).toBe(2);     // +1 槽
    const e = mkEnemy(6, 0, 0);
    player.tagEffectStack.tryApplyTagToNPC(4913, e.id);  // 荆棘鞭自 buff 314
    expect(player.whipBuffs[314]).toBe(Math.trunc(180 * 3));   // 180→540
    for (let i = 0; i < Math.trunc(240 * 3); i++) player.tagEffectStack.update();
    expect(player.tagEffectStack.isNPCTagged(4913, e.id)).toBe(false);  // 720t 后失效
  });

  it('ImmuneToWhips 门（CanApplyTagToNPC,WhipTagEffect.cs:20-31）：11 种敌不打 tag', () => {
    expect(TAG_IMMUNE_TO_WHIPS.size).toBe(11);
    const { player } = makeHooks();
    const e = mkEnemy(7, 0, 0, 16, 24);
    e.vanillaId = 68;
    player.tagEffectStack.tryApplyTagToNPC(4672, e.id, 68);
    expect(player.tagEffectStack.isNPCTagged(4672, e.id)).toBe(false);
    expect(player.tagEffectStack.activeCount).toBe(0);   // 未激活（:80-82 先门后激活）
  });

  it('UniqueTagEffects 全表锚（1457 ItemID.cs:1313-1420）：18 项键值抽查', () => {
    expect(Object.keys(TAG_EFFECTS).length).toBe(18);
    expect(TAG_EFFECTS[4678]).toMatchObject({ kind: 'swordwhip', tagDamage: 9, playerBuffId: 308 });   // :1368-1374 SwordWhip
    expect(TAG_EFFECTS[5478]).toMatchObject({ kind: 'eel', tagDamage: 12, critChance: 5 });            // :1393-1397 ElectricEel
    expect(TAG_EFFECTS[5479]).toMatchObject({ kind: 'constellation', tagDuration: 480, tagDamage: 15, critChance: 15 }); // :1399-1405（480 = :1402 全表唯一覆写）
    expect(TAG_EFFECTS[4914]).toMatchObject({ kind: 'kaleidoscope', tagDamage: 20, critChance: 10 });  // :1406-1411
    expect(TAG_EFFECTS[5480]).toMatchObject({ kind: 'possession', tagDamage: 25, critChance: 10 });    // :1412-1417
    expect(TAG_EFFECTS[4912]).toMatchObject({ kind: 'firecracker', tagDamage: 0 });                    // :1418-1419
    expect(TAG_EFFECTS[6143]).toBeUndefined();   // Foxparks 1457 整条删除（1456 ItemID.cs:1408-1412 才有）
    expect(TAG_EFFECTS[5473]?.playerBuffAppliedManually).toBe(true);  // 365 manual（:1319-1326）
    expect(TAG_EFFECTS[4911]?.playerBuffAppliedManually).toBe(true);  // 312 manual（:1353-1360）
  });
});

// ============ 2 数值大改（1457 伤害管线 :12946-12962） ============
describe('1457 数值大改', () => {
  it('火鞭 4912 proc ×2.75（ProcDamageMultiplier 1456 1.75→1457 2.75,_Firecracker.cs:7）', () => {
    const e = mkEnemy(10, 0, 0);
    const { hooks, player } = makeHooks([e]);
    player.tagEffectStack.tryApplyTagToNPC(4912, e.id);
    player.tagEffectStack.tryEnableProcOnNPC(4912, e.id);
    const res = resolveWhipTagHit(e, 20, hooks, () => {}, 1, e.cx, e.cy, player);
    expect(res.dmg).toBe(Math.trunc(20 * 2.75));          // 乘区乘在含 tag 总伤上
    expect(player.tagEffectStack.canProcOnNPC(4912, e.id)).toBe(false);  // 恒消耗
  });

  it('★BJ449① 火鞭 918 爆炸源敌永免（_Firecracker.cs:23 localNPCImmunity[npcHit]=-1）：盒内旁邻吃爆伤,源敌不再叠', () => {
    const e = mkEnemy(20, 0, 0);              // 源敌（被 proc 命中）
    const near = mkEnemy(21, 30, 0);          // 96×96 爆炸盒内（|30| < 48+8）
    const far = mkEnemy(22, 200, 0);          // 盒外
    const { hooks, player } = makeHooks([e, near, far]);
    player.tagEffectStack.tryApplyTagToNPC(4912, e.id);
    player.tagEffectStack.tryEnableProcOnNPC(4912, e.id);
    const res = resolveWhipTagHit(e, 20, hooks, () => {}, 1, e.cx, e.cy, player);
    expect(res.dmg).toBe(Math.trunc(20 * 2.75));   // 主伤 = 55（乘区在主命中,调用侧落地）
    expect(e.hits).toEqual([]);                    // ★源敌 -1 永免——不吃爆伤（曾漏=双吃 55+55）
    expect(near.hits).toEqual([Math.trunc(20 * 2.75)]);   // 盒内旁邻 = 爆伤一跳
    expect(far.hits).toEqual([]);                  // 盒外不波及
  });

  it('★BJ449② 火鞭 918 城镇面=巫毒窄门（Damage_PVE_Inner :12618-12631）：22+killGuide 吃爆伤,门闭不吃', () => {
    const e = mkEnemy(23, 0, 0);
    const tn = mkTownNpc(24, 0, 0, 22);       // 向导贴身（爆炸盒内）
    const { hooks, player } = makeHooks([e]);
    (hooks as unknown as { npcs: () => unknown[] }).npcs = () => [tn];
    player.tagEffectStack.tryApplyTagToNPC(4912, e.id);
    player.tagEffectStack.tryEnableProcOnNPC(4912, e.id);
    resolveWhipTagHit(e, 20, hooks, () => {}, 1, e.cx, e.cy, player);
    expect(tn.hits).toEqual([]);              // 巫毒窄门闭（killGuide 缺省 false）
    withKillGuide(player);
    player.tagEffectStack.tryEnableProcOnNPC(4912, e.id);   // 重开 proc 窗
    resolveWhipTagHit(e, 20, hooks, () => {}, 1, e.cx, e.cy, player);
    expect(tn.hits).toEqual([Math.trunc(20 * 2.75)]);       // 窄门开 → 爆伤落地（kb=0 settle 面）
  });

  it('★BJ449 销案锁：电鳗链电城镇面恒不达（ElectricEel.cs:41 CanBeChasedBy → NPC.cs:91141 !friendly）', () => {
    const e = mkEnemy(25, 0, 0);
    const near = mkEnemy(26, 30, 0);
    const tn = mkTownNpc(27, 0, 0, 22);
    const { hooks, player } = makeHooks([e, near]);
    (hooks as unknown as { npcs: () => unknown[] }).npcs = () => [tn];
    withKillGuide(player);                    // 巫毒门开也无效——索敌门在窄门之前
    player.tagEffectStack.tryApplyTagToNPC(5478, e.id);
    player.tagEffectStack.tryEnableProcOnNPC(5478, e.id);
    const rvi = vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 5478 crit 5% 不触发（播种）
    resolveWhipTagHit(e, 20, hooks, () => {}, 1, e.cx, e.cy, player);
    rvi.mockRestore();
    expect(tn.hits).toEqual([]);              // 城镇不入链电靶集（原版同相=销案锚）
    expect(near.hits).toEqual([20]);          // 链电单跳 20（TryHittingNPC num6=20）
  });

  it('★BJ449③ 电鳗链电索敌门=CanBeChasedBy（ElectricEel.cs:41 字面）：immortal/chaseable=false 族不耗链位', () => {
    const e = mkEnemy(30, 0, 0);
    const dummy = mkEnemy(31, 25, 0);         // 488 训练假人（immortal,:14630）
    dummy.vanillaId = 488;
    const real = mkEnemy(32, 60, 0);          // 盒内真敌
    const { hooks, player } = makeHooks([e, dummy, real]);
    player.tagEffectStack.tryApplyTagToNPC(5478, e.id);
    player.tagEffectStack.tryEnableProcOnNPC(5478, e.id);
    const rvi = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    resolveWhipTagHit(e, 20, hooks, () => {}, 1, e.cx, e.cy, player);
    rvi.mockRestore();
    expect(dummy.hits).toEqual([]);           // 假人不入索敌（旧 playerCanHitEnemy 门会耗链位+播链电）
    expect(real.hits).toEqual([20]);          // 真敌吃链电单跳
  });

  it('星鞭 5479 星雨按 1457（Projectile.cs:14001-14007/:15013-15036）：CanProcOnNPC 门 + RemoveAllProcs、伤 ×2×0.22', () => {
    const e = mkEnemy(11, 0, 0);
    const { hooks, player, added } = makeHooks([e]);
    expect(TAG_EFFECTS[5479].tagDuration).toBe(480);   // 1457 ItemID.cs:1402 全表唯一覆写
    // 无 proc 窗口（随从未命中过）→ 鞭首命中不撒星（case 1034 CanProcOnNPC 门 :14002）
    const w = new WhipProj(player.cx, player.cy, 0, 1034, 5479, 50, 4, 30, 4, () => player);
    for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
    const pts = w.pointsAt(20, true);
    e.cx = pts[10].x; e.cy = pts[10].y; e.x = pts[10].x - 8; e.y = pts[10].y - 12;
    w.fixedUpdate(1, hooks);
    expect(added.filter((a) => a instanceof Arrow && (a as Arrow).projId === 1039).length).toBe(0);
    // 随从命中经 OnTaggedHit 启窗（_Constellation.cs:6-10）——此处直书等价态
    player.tagEffectStack.tryEnableProcOnNPC(5479, e.id);
    // 第二挥（新弹 localAI[0]=0）命中 → 撒星 + RemoveAllProcs（:14006）
    const w2 = new WhipProj(player.cx, player.cy, 0, 1034, 5479, 50, 4, 30, 4, () => player);
    for (let i = 0; i < 9; i++) w2.fixedUpdate(1, hooks);
    const pts2 = w2.pointsAt(20, true);
    e.cx = pts2[10].x; e.cy = pts2[10].y; e.x = pts2[10].x - 8; e.y = pts2[10].y - 12;
    w2.fixedUpdate(1, hooks);
    const stars = added.filter((a) => a instanceof Arrow && (a as Arrow).projId === 1039) as Arrow[];
    expect(stars.length).toBe(6);
    // 首鞭伤 50 ×falloff 0.90（:13545）→ 45;星伤 = (int)(45×2×0.22)（:14005 + :15016-15017）
    expect(stars[0].damage).toBe(Math.max(1, Math.trunc(Math.round(50 * 0.9) * 2 * 0.22)));
    // RemoveAllProcs（:14006）——proc 窗口已清
    expect(player.tagEffectStack.canProcOnNPC(5479, e.id)).toBe(false);
  });

  it('花鞭 5477 proc（1457 重做版）：(calc+bonus)×2.25 均分 3-6 瓣、瓣对目标预置免疫 30t（_ViolentDisplayOfFlower.cs:12-33 + ItemID.cs:1375-1379）', () => {
    const e = mkEnemy(12, 0, 0);
    const { hooks, player, added } = makeHooks([e]);
    player.tagEffectStack.tryApplyTagToNPC(5477, e.id);
    player.tagEffectStack.tryEnableProcOnNPC(5477, e.id);
    // 播种：Next(0,4)=3（Math.random()=0.99 → floor(0.99×4)=3 → 6 瓣）;瓣角抖动/暴击档同源
    const rvi = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const res = resolveWhipTagHit(e, 40, hooks, (el) => {
      (hooks as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles');
    }, 1, e.cx, e.cy, player, 10);   // bonusTagDamage=10（命中弹自带,:17 num=calc+bonus）
    rvi.mockRestore();
    expect(res.dmg).toBe(40 + 9 + 10);   // TagDamage 9 + bonus 10（无乘区;_ViolentDisplayOfFlower 无 ModifyProcHit）
    const petals = added.filter((a) => a instanceof Arrow && (a as Arrow).projId === 1038) as Arrow[];
    expect(petals.length).toBe(6);       // 3+Next(0,4)=3+3（:21-22 num3/num4）
    // 每瓣 = ceil((int)((40+10)×2.25)/6) = ceil(112/6) = 19（:17 num×2.25 截断 → :23 均分向上取整）
    expect(petals.every((p) => p.damage === Math.ceil(Math.trunc(50 * 2.25) / 6))).toBe(true);
    // 瓣预置 localNPCImmunity[target]=30（:29）：花瓣自目标体内出生,30t 内不得命中
    // 目标本体（Update 先递减后跑命中 → 第 30 拍起可命中）——按在目标身上驱动
    const rvi2 = vi.spyOn(Math, 'random').mockReturnValue(0.5);    // 非暴击档(15%);★BJ716-A:DV 中性档(×1.0,播种面已在 rvi 完成)
    const petal = petals[0];
    petal.vx = 0; petal.vy = 0;                    // 钉在出生点（=目标体内）不动
    for (let t = 0; t < 29; t++) petal.fixedUpdate(1, hooks);
    expect(e.hits.length).toBe(0);                 // 30t 窗口内不命中
    petal.fixedUpdate(1, hooks);
    expect(e.hits.length).toBe(1);                 // 第 30 拍（递减归零）起命中
    expect(e.hits[0]).toBe(Math.ceil(Math.trunc(50 * 2.25) / 6));
    rvi2.mockRestore();
  });

  it('多 tag 全值叠加 + 词缀 bonus 单次合成（:12949-12956）;5478 基类无 flat/proc（1456 ItemID.cs:1381-1387）', () => {
    const e = mkEnemy(13, 0, 0);
    const { hooks, player } = makeHooks([e]);
    setMaxTags(player, 3);
    player.tagEffectStack.tryApplyTagToNPC(4672, e.id, 0, 5);   // 皮革鞭 tagdmg 词缀 5
    player.tagEffectStack.tryApplyTagToNPC(5478, e.id, 0, 5);   // 电鳗鞭（同词缀取 max）
    const rvi = vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 播种:5478 crit 5% 不触发(未播种 flaky,同吸血鬼飞刀教训)
    const res = resolveWhipTagHit(e, 100, hooks, () => {}, 0.669, e.cx, e.cy, player);
    rvi.mockRestore();
    // Σtag = 4+12 = 16;+bonus 5 → (16+5)×0.669 = 14（截断）;5478 基类无 AddedFlatDamage
    expect(res.dmg).toBe(100 + Math.trunc((4 + 12 + 5) * 0.669));
  });
});

// ============ 3 召唤师鞭 tag 配饰九件（:14615-14715） ============
describe('召唤师鞭 tag 配饰九件', () => {
  const eq = (p: Player, ...vids: number[]): void => {
    vids.forEach((v, i) => { p.inv.armor[3 + i] = { id: iid(v), stack: 1 }; });
  };

  it('单件：6156 银护腕（×3 时长+1 槽）/ 6157 蛇环 / 6158 莫比乌斯（+1 槽+鞭程 10%）/ 6159 邪恶臂镯', () => {
    const a = makeHooks().player;
    eq(a, 6156);
    expect(a.equipStats.maxTagEffects).toBe(2);
    expect(a.equipStats.tagEffectDuration).toBe(3);
    const b = makeHooks().player;
    eq(b, 6157);
    expect(b.equipStats.accSnakeBand).toBe(true);
    const c = makeHooks().player;
    eq(c, 6158);
    expect(c.equipStats.maxTagEffects).toBe(2);
    expect(c.equipStats.whipRange).toBeCloseTo(0.1);
    const d = makeHooks().player;
    eq(d, 6159);
    expect(d.equipStats.maxTagEffects).toBe(2);
    expect(d.equipStats.accWickedArmlet).toBe(true);
  });

  it('组合件：6162 衔尾蛇环 = 6158+6157 / 6163 暮光之握 = 6156+6159 / 6183 白银之盾 = 6156+免击退+火焰块', () => {
    const a = makeHooks().player;
    eq(a, 6162);
    expect(a.equipStats.maxTagEffects).toBe(2);
    expect(a.equipStats.accSnakeBand).toBe(true);
    expect(a.equipStats.whipRange).toBeCloseTo(0.1);
    const b = makeHooks().player;
    eq(b, 6163);
    expect(b.equipStats.maxTagEffects).toBe(3);       // SilverBracer+WickedArmlet 各 +1
    expect(b.equipStats.tagEffectDuration).toBe(3);
    expect(b.equipStats.accWickedArmlet).toBe(true);
    const c = makeHooks().player;
    eq(c, 6183);
    expect(c.equipStats.maxTagEffects).toBe(2);
    expect(c.equipStats.tagEffectDuration).toBe(3);
    expect(c.equipStats.noKnockback).toBe(true);
    expect(c.equipStats.fireWalk).toBe(true);
  });

  it('6179 毁灭臂镯 / 6182 邪恶之爪（+近战速 12%+自动挥）/ 6186 德鲁伊蛇斗篷（蛇环+星星斗篷）', () => {
    const a = makeHooks().player;
    eq(a, 6179);
    expect(a.equipStats.maxTagEffects).toBe(2);
    expect(a.equipStats.accArmletOfRuin).toBe(true);
    const b = makeHooks().player;
    eq(b, 6182);
    expect(b.equipStats.maxTagEffects).toBe(2);
    expect(b.equipStats.autoReuseGlove).toBe(true);
    expect(b.equipStats.meleeSpeed).toBeCloseTo(0.12);
    const c = makeHooks().player;
    eq(c, 6186);
    expect(c.equipStats.accSnakeBand).toBe(true);
    expect(c.equipStats.starCloak).toBe(true);
  });

  it('满配 4 槽（6156+6158+6159 → 1+1+1+1;报告 §14）', () => {
    const p = makeHooks().player;
    eq(p, 6156, 6158, 6159);
    expect(p.equipStats.maxTagEffects).toBe(4);
    expect(p.equipStats.tagEffectDuration).toBe(3);
  });

  it('邪恶臂镯族出鞭击退 +1（ItemCheck_Shoot :49159-49163）', () => {
    const { player, hooks } = makeHooks();
    player.inv.armor[3] = { id: iid(6159), stack: 1 };
    const w = new WhipProj(player.cx, player.cy, 0, 841, 4672, 14, 1, 30, 4, () => player);
    expect(w.knockback).toBe(2);   // 1 + 1
    void hooks;
  });

  it('蛇环补挥（:43041-43063）：第 3n 次真挥动画过半 → 补挥背包下一把鞭 ×0.3 伤', () => {
    const e = mkEnemy(20, 0, 0);
    const { hooks, player, added } = makeHooks([e]);
    player.inv.armor[3] = { id: iid(6157), stack: 1 };   // 蛇环
    player.inv.slots[1] = { id: iid(4672), stack: 1 };   // 背包下一把鞭（皮革鞭）
    // 手持选中 0 号格的星鞭（5479→proj 1034）;maxTagEffects=1 → 同件补挥
    player.inv.slots[0] = { id: iid(5479), stack: 1 };
    player.inv.selected = 0;
    const w = new WhipProj(player.cx, player.cy, 0, 1034, 5479, 40, 4, 30, 4, () => player);
    player.repeatWhipSwings = 0;   // 真挥计数（Game 侧 +1 后为 0 → 0%3==0 触发）
    // 驱动到动画中点（timeToFlyOut=60,ai0 每 tick +2 → 15 tick 过半）
    for (let i = 0; i < 16 && !w.dead; i++) w.fixedUpdate(1, hooks);
    const echoes = added.filter((x) => x instanceof WhipProj) as WhipProj[];
    expect(echoes.length).toBe(1);
    // ×0.3 伤（1457 :49174 num169=0.3,(int) 截断,min 3）/×0.25 击退（num170）——
    // 蓝队 R2-09 勘误：曾把击退系数 0.25 抄给伤害
    expect(echoes[0].damage).toBe(Math.max(3, Math.trunc(40 * 0.3)));
    expect(echoes[0].knockback).toBeCloseTo(4 * 0.25);
    expect(echoes[0].isEcho).toBe(true);
  });

  it('蛇环计数门：repeatWhipSwings % 3 != 0 不补挥;补挥自身不再级联（isEcho 门）', () => {
    const { hooks, player, added } = makeHooks();
    player.inv.armor[3] = { id: iid(6157), stack: 1 };
    const w = new WhipProj(player.cx, player.cy, 0, 841, 4672, 14, 1, 30, 4, () => player);
    player.repeatWhipSwings = 1;   // 非 3 的倍数
    for (let i = 0; i < 20 && !w.dead; i++) w.fixedUpdate(1, hooks);
    expect(added.filter((x) => x instanceof WhipProj).length).toBe(0);
    // 补挥不级联
    player.repeatWhipSwings = 0;
    const w2 = new WhipProj(player.cx, player.cy, 0, 841, 4672, 14, 1, 30, 4, () => player);
    w2.isEcho = true;
    for (let i = 0; i < 20 && !w2.dead; i++) w2.fixedUpdate(1, hooks);
    expect(added.filter((x) => x instanceof WhipProj).length).toBe(0);
  });
});

// ============ 4 圣殿骑士背包 6176（哨兵 10% 强制暴击 :12963-12967,统计位） ============
describe('哨兵背包族旗标（:14670-14685）', () => {
  it('6176 圣殿骑士背包：accSentryBackpack + accGolemSentryBackpack;6177 皇家卫队背带 +免击退', () => {
    const a = makeHooks().player;
    a.inv.armor[3] = { id: iid(6176), stack: 1 };
    expect(a.equipStats.accSentryBackpack).toBe(true);
    expect(a.equipStats.accGolemSentryBackpack).toBe(true);
    const b = makeHooks().player;
    b.inv.armor[3] = { id: iid(6177), stack: 1 };
    expect(b.equipStats.accSentryBackpack).toBe(true);
    expect(b.equipStats.noKnockback).toBe(true);
    const c = makeHooks().player;
    c.inv.armor[3] = { id: iid(6172), stack: 1 };
    expect(c.equipStats.accSentryBackpack).toBe(true);
    expect(c.equipStats.accGolemSentryBackpack).toBe(false);
  });
});
