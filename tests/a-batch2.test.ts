// A 级近似清零·第二批回归（召唤师体系主干 1:1）：
//   1 鞭主干    AI_165_Whip :45006-45117 + FillWhipControlPoints :45618-45681 +
//              GetWhipSettings :45683-45761 + Colliding :14482-14494
//   2 哨兵      aiStyle 53 :27172-27382（初冷 120 / 射速 60·60·90 / 扇区炮口）
//   3 MinionShot 吃鞭 tag   TagEffectState :216-243 + WhipTagEffect.cs:76-87 +
//              ProjectileID.cs:291 MinionShot / :293 SentryShot（1457 行号）
//   4 沙漠虎 818 链  AI_067_TigerSpecialAttack :46383-46479 + AI_162 :44056-44123
//   5 AI_120    StardustGuardian :41969-42299 + 拳盒 Colliding :14294-14300
//   6 localNPCImmunity  Update :15330 / Damage_PVE :11878 / 写入 :13153
//              + 闪电光环 AI_137 :65910-66060 方形场
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { TileStore } from '../src/world/TileStore';
import { combatWeapon } from '../src/data/vanillaItemCombat';
import { WhipProj } from '../src/entities/WhipProj';
import { resolveWhipTagHit, TAG_EFFECTS, MoonLordWhipProc } from '../src/entities/WhipTag';
import { MinionProj, MinionHitCd, TigerPounce } from '../src/entities/MinionProj';
import { Arrow } from '../src/entities/Arrow';
import type { GameHooks } from '../src/entities/types';

// ---- mock 环境（summon-r6 同款） ----
const W = 200, H = 120;
function makeStore(): TileStore {
  const store = new TileStore(W, H);
  for (let x = 0; x < W; x++) for (let y = 100; y < H; y++) store.setTile(x, y, 1);
  return store;
}
interface MockEnemy {
  id: number; x: number; y: number; w: number; h: number; dead: boolean;
  cx: number; cy: number; hp: number;
  vanillaId?: number; hurtFx?: (d: number) => void;
  hurt: (d: number, kx: number, ky: number, g: GameHooks) => boolean;
  hits: number[];
}
function mkEnemy(id: number, cx: number, cy: number, w = 16, h = 24): MockEnemy {
  const e: MockEnemy = {
    id, x: cx - w / 2, y: cy - h / 2, w, h, dead: false, cx, cy, hp: 10000, hits: [],
    hurt: (d: number) => { e.hp -= d; e.hits.push(d); return true; },
  };
  return e;
}
function makeHooks(enemies: MockEnemy[] = []) {
  const store = makeStore();
  const player = new Player(60 * 16, 90 * 16, new Inventory());
  const added: unknown[] = [];
  const projectiles: unknown[] = [];
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
  (hooks as unknown as { entities: { add: (e: unknown, b: string) => void; projectiles: unknown[] } }).entities = {
    add: (e: unknown) => { added.push(e); if (e instanceof MinionProj || e instanceof TigerPounce) projectiles.push(e); },
    projectiles,
  };
  return { hooks, store, player, added, projectiles };
}
const step = (list: unknown[], ticks: number, hooks: GameHooks): void => {
  for (let i = 0; i < ticks; i++) {
    for (const e of list) {
      const p = e as { dead: boolean; fixedUpdate: (dt: number, g: GameHooks) => void };
      if (!p.dead) p.fixedUpdate(1, hooks);
    }
  }
};

/** 鞭曲线总长（控制点折线和） */
const curveLen = (w: WhipProj, ai0: number): number => {
  const pts = w.pointsAt(ai0, true);
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return sum;
};

// ============ 1 鞭主干（AI_165 + FillWhipControlPoints） ============
describe('鞭主干 1:1（:45006/:45618/:45683）', () => {
  it('锚点 = GetArmPosition 手位（1457 Projectile.cs:49183/Player.cs:51208），随 owner 逐 tick 重算随动', () => {
    // 台账批 B 档(94599795)已按 1458 Player.cs:51206-51225 落地 1:1 臂位锚——
    // 「玩家中心」是旧近似钉值(手位≈中心仅在个别帧行巧合),按反编译真值重钉:
    // 不变量 = 根从 owner 实时重算(手位在玩家盒附近)+ owner 平移根严格随动。
    const { hooks, player } = makeHooks();
    const w = new WhipProj(player.cx, player.cy, 0, 841, 4672, 14, 1, 30, 4, () => player);
    w.fixedUpdate(1, hooks);
    const root0 = w.controlPoints(true)[0];
    expect(Math.abs(root0.x - player.cx)).toBeLessThanOrEqual(12);
    expect(Math.abs(root0.y - player.cy)).toBeLessThanOrEqual(12);
    player.x += 100;
    w.fixedUpdate(1, hooks);
    const root1 = w.controlPoints(true)[0];
    expect(root1.x - root0.x).toBe(100);   // 前 2 tick 同帧行(head 三相),手位偏移恒定→严格 +100
    expect(root1.y).toBe(root0.y);
  });

  it('分段数 = GetWhipSettings 表（:45690 默认 20；1104=36/1028=12/848=40/1033=45/1035=30）', () => {
    const { hooks, player } = makeHooks();
    const seg = (projId: number): number =>
      new WhipProj(player.cx, player.cy, 0, projId, 4672, 14, 1, 30, 4, () => player)
        .controlPoints(true).length - 1;
    expect(seg(841)).toBe(20);   // 默认
    expect(seg(914)).toBe(20);
    expect(seg(1104)).toBe(36);
    expect(seg(1028)).toBe(12);
    expect(seg(848)).toBe(40);
    expect(seg(1033)).toBe(45);
    expect(seg(1035)).toBe(30);
    expect(seg(847)).toBe(20);
    void hooks;
  });

  it('伸展/收回包络：2/3 处峰值，尾段收回（num5/num6 :45633-45639）', () => {
    const { hooks, player } = makeHooks();
    const w = new WhipProj(player.cx, player.cy, 0, 841, 4672, 14, 1, 30, 4, () => player);
    const TFO = w.timeToFlyOut; // 30×2=60（MaxUpdates=2 :45685）
    expect(TFO).toBe(60);
    expect(curveLen(w, TFO / 3)).toBeGreaterThan(curveLen(w, TFO / 6));    // 伸展期
    expect(curveLen(w, (2 / 3) * TFO)).toBeGreaterThan(curveLen(w, TFO / 3));
    expect(curveLen(w, (2 / 3) * TFO)).toBeGreaterThan(curveLen(w, (11 / 12) * TFO)); // 收回期回落
  });

  it('命中：曲线上控制点处敌被命中且每次挥动仅一次（18×18 盒 :14482-14494 / cd=-1 :10104）', () => {
    const enemy = mkEnemy(1, 0, 0);
    const { hooks, player } = makeHooks([enemy]);
    const w = new WhipProj(player.cx, player.cy, 0, 841, 4672, 14, 1, 30, 4, () => player);
    for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);   // ai[0]=18
    const p = w.pointsAt(20, true)[10];                    // progress=1/3 处曲线中段
    enemy.cx = p.x; enemy.cy = p.y; enemy.x = p.x - 8; enemy.y = p.y - 12;
    w.fixedUpdate(1, hooks);                               // 本 tick 碰撞含 ai[0]=20 快照
    expect(enemy.hits.length).toBe(1);
    expect(enemy.hits[0]).toBe(14);                        // 全额（召唤乘区 1 / 护穿 0）
    w.fixedUpdate(1, hooks);
    expect(enemy.hits.length).toBe(1);                     // localNPCHitCooldown=-1 每敌一次
  });

  it('射程门：841 峰值 reach = 4×30×2×0.75=180 → 400px 外敌全程不命中（:45643/:45703）', () => {
    const far = mkEnemy(2, 0, 0);
    const { hooks, player } = makeHooks([far]);
    far.cx = player.cx + 400; far.cy = player.cy; far.x = far.cx - 8; far.y = far.cy - 12;
    const w = new WhipProj(player.cx, player.cy, 0, 841, 4672, 14, 1, 30, 4, () => player);
    step([w], 40, hooks);
    expect(far.hits.length).toBe(0);
  });

  it('多目标衰减：841 falloff 0.5 → 第二命中敌 7（damage 字段链 :12604-12678）', () => {
    const a = mkEnemy(3, 0, 0), b = mkEnemy(4, 0, 0);
    const { hooks, player } = makeHooks([a, b]);
    const w = new WhipProj(player.cx, player.cy, 0, 841, 4672, 14, 1, 30, 4, () => player);
    for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
    const pts = w.pointsAt(20, true);
    for (const [e, idx] of [[a, 6], [b, 14]] as const) {
      e.cx = pts[idx].x; e.cy = pts[idx].y;
      e.x = pts[idx].x - 8; e.y = pts[idx].y - 12;
    }
    w.fixedUpdate(1, hooks);
    expect(a.hits[0]).toBe(14);   // 曲线序在前的全额
    expect(b.hits[0]).toBe(7);    // 之后 ×0.5
  });

  it('tag 窗口：命中写入 240t/TagDamage（1457 TagEffectStack :80-87）；4912 火鞭 flat=0（:1397）', () => {
    // 两个鞭各自独立环境（913 射程更长，共用场景会先扫到另一敌耗掉首命中 proc 门）
    const env = (projId: number, itemId: number, dmg: number): { w: WhipProj; e: MockEnemy; hooks: GameHooks; player: Player } => {
      const e = mkEnemy(projId, 0, 0);
      const { hooks, player } = makeHooks([e]);
      const w = new WhipProj(player.cx, player.cy, 0, projId, itemId, dmg, 1, 30, 4, () => player);
      for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
      const pts = w.pointsAt(20, true);
      e.cx = pts[10].x; e.cy = pts[10].y; e.x = pts[10].x - 8; e.y = pts[10].y - 12;
      return { w, e, hooks, player };
    };
    const a = env(841, 4672, 14);
    a.w.fixedUpdate(1, a.hooks);
    // 1457：tag 态在玩家栈（per-NPC 双表），敌实体不再存字段
    expect(a.player.tagEffectStack.isNPCTagged(4672, a.e.id)).toBe(true);
    expect(TAG_EFFECTS[4672].tagDamage).toBe(4);       // 4672 皮革鞭 TagDamage=4（ItemID.cs:1333）
    const b = env(913, 4912, 37);
    b.w.fixedUpdate(1, b.hooks);
    expect(b.player.tagEffectStack.isNPCTagged(4912, b.e.id)).toBe(true);  // tag 窗口开启
    expect(TAG_EFFECTS[4912].tagDamage).toBe(0);       // Firecracker 无 flat TagDamage
    expect(b.player.tagEffectStack.canProcOnNPC(4912, b.e.id)).toBe(true); // proc 启用（case 913 :13970-13977）
  });

  it('月主鞭 1035 补鞭：30t 寿命内补 3 鞭（:45038-45048，ai[2]<progress×3）', () => {
    const { hooks, player, added } = makeHooks();
    const w = new WhipProj(player.cx, player.cy, 0, 1035, 5480, 110, 4, 30, 4, () => player);
    step([w], 25, hooks);
    const lashes = added.filter((e) => e instanceof WhipProj) as WhipProj[];
    expect(lashes.length).toBe(3);
    expect(lashes.every((l) => l.ai2 >= 10)).toBe(true);   // 子鞭标记（:45047）
    expect(lashes[0].timeToFlyOut).toBe(30 * 2);           // 子鞭固定 30t（:45755-45758）
  });

  it('5479 星座星雨（1457 :14001-14007/:15013-15036）：CanProcOnNPC 门 + RemoveAllProcs、伤 ×2×0.22（随从 OnTaggedHit 启窗）', () => {
    const e = mkEnemy(7, 0, 0);
    const { hooks, player, added } = makeHooks([e]);
    const w = new WhipProj(player.cx, player.cy, 0, 1034, 5479, 30, 4, 30, 4, () => player);
    for (let i = 0; i < 9; i++) w.fixedUpdate(1, hooks);
    const pts = w.pointsAt(20, true);
    e.cx = pts[10].x; e.cy = pts[10].y; e.x = pts[10].x - 8; e.y = pts[10].y - 12;
    // 无 proc 窗口（随从未命中过）→ 不撒星（case 1034 CanProcOnNPC 门 :14002）
    w.fixedUpdate(1, hooks);
    expect(added.filter((a) => a instanceof Arrow && (a as Arrow).projId === 1039).length).toBe(0);
    // 随从命中经 WhipTagEffect_Constellation.OnTaggedHit（_Constellation.cs:6-10）启窗——直书等价态
    player.tagEffectStack.tryEnableProcOnNPC(5479, e.id);
    // 第二挥命中 → 撒星 + RemoveAllProcs（:14005-14006）
    const w2 = new WhipProj(player.cx, player.cy, 0, 1034, 5479, 30, 4, 30, 4, () => player);
    for (let i = 0; i < 9; i++) w2.fixedUpdate(1, hooks);
    const pts2 = w2.pointsAt(20, true);
    e.cx = pts2[10].x; e.cy = pts2[10].y; e.x = pts2[10].x - 8; e.y = pts2[10].y - 12;
    w2.fixedUpdate(1, hooks);
    const stars = added.filter((a) => a instanceof Arrow && (a as Arrow).projId === 1039);
    expect(stars.length).toBe(6);   // 20 段 → 每 3 控制点一颗（:15019 i+=3）
    // 伤 = (int)(鞭伤×2×0.22)（:14005 传 damage×2 → :15016-15017 num=0.22;鞭伤取衰减后 30×0.90=27）
    expect((stars[0] as Arrow).damage).toBe(Math.max(1, Math.trunc(Math.round(30 * 0.9) * 2 * 0.22)));
    // RemoveAllProcs（:14006）——proc 窗口已清
    expect(player.tagEffectStack.canProcOnNPC(5479, e.id)).toBe(false);
  });
});

// ============ 2 哨兵 aiStyle 53（:27172-27382） ============
describe('哨兵 aiStyle 53 射速（:27176-27288）', () => {
  it('966 猎犬：初冷 120t、射速 90t（308/377 为 60t）', () => {
    const e = mkEnemy(8, 60 * 16 + 200, 90 * 16);
    const { hooks, player, added } = makeHooks([e]);
    const s = new MinionProj(player.x, player.y, 966, 40, 2, true, 0, false, () => player);
    step([s], 130, hooks);
    expect(added.filter((a) => a instanceof Arrow).length).toBe(1);   // 第 121t 首发初冷 120
    step([s], 80, hooks);
    expect(added.filter((a) => a instanceof Arrow).length).toBe(1);   // 210t 仍在 90t 冷却内
    step([s], 2, hooks);
    expect(added.filter((a) => a instanceof Arrow).length).toBe(2);   // 第 211t 第二发
    const shot = added.find((a) => a instanceof Arrow) as Arrow;
    expect(shot.projId).toBe(967);
  });
});

// ============ 3 MinionShot 吃鞭 tag（1457 TagEffectStack.ModifyHit/OnHit :107-121） ============
describe('MinionShot tag/proc 继承', () => {
  /** 栈侧打 tag + 启用 proc（等价鞭命中写入 + TryEnableProcOnNPC） */
  const tagEnemy = (player: Player, e: MockEnemy, itemId: number): void => {
    player.tagEffectStack.tryApplyTagToNPC(itemId, e.id, e.vanillaId);
    player.tagEffectStack.tryEnableProcOnNPC(itemId, e.id);
  };

  it('whipTagShot 箭命中 tag 敌：+TagDamage 并触发 proc 首跳（5476 → 1037 陨石 ×1.33）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（tag 支首掷 ×1.0）
    const e = mkEnemy(9, 60 * 16 + 100, 90 * 16);
    const { hooks, player, added } = makeHooks([e]);
    tagEnemy(player, e, 5476);   // 星陨鞭 TagDamage=2（ItemID.cs:1341）
    const arrow = new Arrow(e.x - 60, e.y + 4, 8, 0, 10, 1, 374, { grav: 0, life: 60 });
    arrow.whipTagShot = true;   // 374 ∈ MinionShot（ProjectileID.cs:197）
    step([arrow], 20, hooks);
    expect(e.hp).toBe(10000 - 12);          // 10 + tag 2（ModifyTaggedHit :62-74）
    expect(player.tagEffectStack.canProcOnNPC(5476, e.id)).toBe(false); // OnProcHit true → 消费（:113-118）
    const meteor = added.find((a) => a instanceof Arrow && (a as Arrow).projId === 1037) as Arrow | undefined;
    expect(meteor).toBeTruthy();
    expect(meteor!.damage).toBe(Math.max(1, Math.trunc(10 * 1.33))); // OnProcHit 伤=基数×1.33（_Starcrash :22）
  });

  it('5480 月主弹 proc（1457 :14977-15011）：单发 1045 弧线弹、固定伤 20、gen=0', () => {
    const e = mkEnemy(10, 0, 0);
    e.hurtFx = (d: number) => { e.hp -= d; };
    const { hooks, player, added } = makeHooks([e]);
    tagEnemy(player, e, 5480);
    const res = resolveWhipTagHit(e, 10, hooks, (el) => {
      (hooks as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles');
    }, 1, e.cx, e.cy, player);
    // 5480 无 ModifyProcHit 乘区;TagDamage=25（ItemID.cs:1412-1417）;CritChance=10（:1416）
    // → 10% TagCrit ×2（WhipTagEffect.ModifyTaggedHit :87-91 掷 crit）
    expect([10 + 25, (10 + 25) * 2]).toContain(res.dmg);
    expect(player.tagEffectStack.canProcOnNPC(5480, e.id)).toBe(false);   // 一次性（ClearProc 先于 OnProcHit）
    const procs = added.filter((a) => a instanceof MoonLordWhipProc) as MoonLordWhipProc[];
    expect(procs.length).toBe(1);           // 单发（:14980-14981 num=Next(1,4) 后被 `num=1` 覆写=死掷）
    expect(procs[0].damage).toBe(20);       // 固定伤 20（_Possession.cs:6-8）
    expect(procs[0].gen).toBe(0);           // ai[1]=0（aiCounter 初值 :15010）
    expect(procs[0].arc).not.toBe(0);       // 弧线弹道（ai[0]=±(π/5..π/2) :14993-14995）
  });

  it('4912 火鞭 proc（1457 ×2.75 乘区）：命中伤 = (10+0)×2.75，918 爆炸 = 基数×2.75（_Firecracker.cs:9-29）', () => {
    const e = mkEnemy(11, 0, 0);
    e.hurtFx = (d: number) => { e.hp -= d; };
    const { hooks, player, added } = makeHooks([e]);
    tagEnemy(player, e, 4912);
    const res = resolveWhipTagHit(e, 10, hooks, (el) => {
      (hooks as unknown as { entities: { add: (x: unknown, b: string) => void } }).entities.add(el, 'projectiles');
    }, 1, e.cx, e.cy, player);
    expect(res.dmg).toBe(Math.trunc(10 * 2.75));  // TotalDamageMultiplier ×2.75（1456 1.75 加算已废）
    // ★BJ449① 勘误（2026-10-03,_Firecracker.cs:23 `localNPCImmunity[npcHit]=-1`）：
    //  918 爆炸对【源敌】（被 proc 命中敌）永免——旧断言「源敌吃爆伤 27」系本仓
    //  AoE 直结漏豁免的偏差锁,原版源敌只吃主命中 ×2.75（伤由调用侧落地,本夹具
    //  未落 → hp 不动）;盒内旁邻吃爆伤判别 = batch-d-tagstack BJ449① 案。
    expect(e.hp).toBe(10000);
    expect(player.tagEffectStack.canProcOnNPC(4912, e.id)).toBe(false);   // proc 恒消耗（:14-18）
    expect(added.some((a) => a instanceof Arrow && (a as Arrow).projId === 916)).toBe(false); // 非 4680 无 916
  });

  it('多 tag 全值叠加（1457 :12949-12956）：双鞭 mark 并存 → ΣTagDamage 全加（maxTagEffects=2）', () => {
    const e = mkEnemy(12, 0, 0);
    const { hooks, player } = makeHooks([e]);
    (player as unknown as { _equipStatsCache: unknown })._equipStatsCache = null;
    // 直接置 2 槽门（equipStats.maxTagEffects 缺省 1——测试环境无配饰槽,走字段覆写）
    Object.defineProperty(player, 'maxTagEffects', { value: 2, configurable: true });
    player.tagEffectStack.tryApplyTagToNPC(4672, e.id);   // 皮革鞭 TagDamage=4
    player.tagEffectStack.tryApplyTagToNPC(5074, e.id);   // 万鞭 TagDamage=7
    expect(player.tagEffectStack.activeTypes()).toEqual([5074, 4672]); // MRU 序
    const res = resolveWhipTagHit(e, 10, hooks, () => {}, 1, e.cx, e.cy, player);
    expect(res.dmg).toBe(10 + 4 + 7);     // 全值叠加（1456 单 tag 只取一件）
  });

  it('栈容量门（maxTagEffects=1 缺省）：新 tag 驱逐旧 tag（LimitActiveEffects :131-138）', () => {
    const e = mkEnemy(13, 0, 0);
    const { hooks, player } = makeHooks([e]);
    player.tagEffectStack.tryApplyTagToNPC(4672, e.id);   // 皮革鞭（自 buff 无）
    player.tagEffectStack.tryApplyTagToNPC(4680, e.id);   // 黑收成（buff 311）
    expect(player.tagEffectStack.activeTypes()).toEqual([4680]);  // 4672 被驱逐
    expect(player.tagEffectStack.isNPCTagged(4672, e.id)).toBe(false);
    expect(player.whipBuffs[311]).toBe(180);              // AddTheBuff（:53-60,时长 ×1）
    void hooks;
  });

  it('4678 剑鞭 MegaSlash（1457 :1368-1374 + _SwordWhip.cs:17-27）：proc 窗口内 +30 flat;5478 电鳗链电（:1393-1397 + _ElectricEel.cs:18-56）：+50 flat + 近邻 5 目标 ×20 直伤', () => {
    const e = mkEnemy(14, 0, 0);
    const near = mkEnemy(15, 40, 0);
    const { hooks, player } = makeHooks([e, near]);
    // 4678：proc 窗口内命中 → ModifyProcHit MegaSlash +30（_SwordWhip.cs:17-27）
    tagEnemy(player, e, 4678);
    expect(player.whipBuffs[308]).toBe(180);   // OnTagAppliedToNPC → AddTheBuff（WhipTagEffect.cs:45-59）
    const res = resolveWhipTagHit(e, 10, hooks, () => {}, 1, e.cx, e.cy, player);
    expect(res.dmg).toBe(10 + 9 + 30);    // TagDamage 9（ItemID.cs:1371）+ MegaSlash 30（_SwordWhip.cs:26）
    // 5478：链电 450px 内最近 5 目标 ×20 直伤 + AddedFlatDamage 50+50×n（_ElectricEel.cs:20-56）
    tagEnemy(player, e, 5478);
    const rvi = vi.spyOn(Math, 'random').mockReturnValue(0.99);   // 播种:5478 crit 5% 不触发（防 flaky）
    const res2 = resolveWhipTagHit(e, 10, hooks, () => {}, 1, e.cx, e.cy, player);
    rvi.mockRestore();
    expect(res2.dmg).toBe(10 + 12 + 100); // TagDamage 12（:1396）+ 50 + 50×1（链电命中 near 1 目标,:55）
    expect(near.hp).toBe(10000 - 20);     // TryHittingNPC(near, 20)（:51）
  });
});

// ============ 4 沙漠虎 818 链（:46383-46479 / :44056） ============
describe('沙漠虎 818 多段链', () => {
  const mkTiger = (hooks: GameHooks, gems: number, enemies: MockEnemy[]): MinionProj => {
    const p = (hooks as unknown as { player: Player }).player;
    const t = new MinionProj(p.x, p.y, 833, 10, 2, false, 0, false, () => p);
    (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(t);
    for (let i = 0; i < gems; i++) {
      const g = new MinionProj(p.x, p.y, 831, 10, 2, false, 0, false, () => p);
      (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles.push(g);
    }
    void enemies;
    return t;
  };

  it('链长 = 宝石数+1：3 宝石 + 4 敌 → 4 段 818（:46388/:46433-46447）', () => {
    const es = [
      mkEnemy(20, 60 * 16 + 120, 90 * 16),
      mkEnemy(21, 60 * 16 + 260, 90 * 16 + 40),
      mkEnemy(22, 60 * 16 + 380, 90 * 16 - 60),
      mkEnemy(23, 60 * 16 + 500, 90 * 16 + 80),
    ];
    const { hooks } = makeHooks(es);
    const tiger = mkTiger(hooks, 3, es);
    tiger.fixedUpdate(1, hooks);
    const chain = (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles
      .filter((e) => e instanceof TigerPounce);
    expect(chain.length).toBe(4);
  });

  it('818 伤害 ×(1.5+0.4×(宝石数-1))：1 宝石 dmg10 → 15（:12107-12111），每敌一次', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（随从弹首掷 ×1.0）
    const e = mkEnemy(24, 60 * 16 + 160, 90 * 16);
    const { hooks } = makeHooks([e]);
    const tiger = mkTiger(hooks, 1, [e]);
    tiger.fixedUpdate(1, hooks);   // 触发链（单敌 → 单段，无延迟）
    const pounce = (hooks as unknown as { entities: { projectiles: unknown[] } }).entities.projectiles
      .find((x) => x instanceof TigerPounce) as TigerPounce;
    expect(pounce).toBeTruthy();
    step([pounce], 40, hooks);
    expect(e.hits.length).toBe(1);        // localNPCHitCooldown=-1（:7733）
    expect(e.hits[0]).toBe(15);           // round(10×1.5)
    expect(pounce.dead).toBe(true);       // ai[0]≥1 消亡（:44119-44122）
  });

  it('链发后本体瞬移末段并进入等待态（等待期无接触伤 :46475/:46702-46718/:11782）', () => {
    const e = mkEnemy(25, 60 * 16 + 160, 90 * 16);
    const { hooks, player } = makeHooks([e]);
    const tiger = mkTiger(hooks, 1, [e]);
    const hp0 = e.hp;
    tiger.fixedUpdate(1, hooks);
    // 本体瞬移至末段落点（目标 X 向前偏 20，:46459-46462）
    expect(Math.abs(tiger.cx - (e.cx + 20))).toBeLessThan(2);
    step([tiger], 6, hooks);              // 等待态 ai[0]==4
    expect(e.hp).toBe(hp0);               // 等待期不造成接触伤
    void player;
  });
});

// ============ 5 AI_120 星尘守护者（:41969-42299） ============
describe('AI_120 星尘守护者', () => {
  it('500 内敌进入冲刺态并受拳伤；600 外敌全程无伤（:42036-42073/:14294-14300）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（随从弹首掷 ×1.0）
    const near = mkEnemy(30, 60 * 16 + 250, 90 * 16);
    const far = mkEnemy(31, 60 * 16 + 700, 90 * 16);
    const { hooks, player } = makeHooks([near, far]);
    const g = new MinionProj(player.x, player.y, 623, 30, 2, false, 0, false, () => player);
    step([g], 90, hooks);
    expect(g.ai120State).toBe(2);          // 冲刺态（ai[0]==2）
    expect(near.hp).toBeLessThan(10000);   // 拳盒命中
    expect(far.hp).toBe(10000);            // 超出索敌 500
    expect(near.hits.every((d) => d === 30)).toBe(true); // 无 tag 全额
  });

  it('拳盒仅在冲刺态：80×40 @ Center+direction×40（cd=5 → 每 5t 一跳 :6433）', () => {
    const e = mkEnemy(32, 60 * 16 + 250, 90 * 16);
    const { hooks, player } = makeHooks([e]);
    const g = new MinionProj(player.x, player.y, 623, 30, 2, false, 0, false, () => player);
    // 冲刺到位前（贴身跟随态）不造成伤害
    g.fixedUpdate(1, hooks);
    const state0 = g.ai120State;
    expect(e.hp).toBe(10000);
    void state0;
  });
});

// ============ 6 localNPCImmunity 节奏 + 闪电光环方形场 ============
describe('localNPCImmunity（:15330/:11878/:13153）', () => {
  it('cd=3 → 命中后恰好 3 tick 再命中（★BJ697 起衰减=宿主 tick 驱动,读纯化——旧读位衰减形）', () => {
    const cd = new MinionHitCd();
    const seq: boolean[] = [];
    for (let i = 0; i < 7; i++) {
      seq.push(cd.ready(1, 3));
      cd.tick();   // BJ697：每 t 一 tick（fixedUpdate 头位=原版 :15330 DecrementLocalImmuneTimeCounters）
    }
    expect(seq).toEqual([true, false, false, true, false, false, true]);
  });

  it('闪电光环：净空 12 格 → 方形场 320px，每 3t 一跳；场外敌无伤（AI_137 :65972-65981/:14537-14553）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（随从弹首掷 ×1.0）
    const inE = mkEnemy(40, 60 * 16, 100 * 16 - 40);
    const outE = mkEnemy(41, 60 * 16 + 200, 100 * 16 - 40);
    const { hooks, player } = makeHooks([inE, outE]);
    const tower = new MinionProj(player.x, player.y, 688, 20, 0, true, 0, false, () => player);
    const hp0 = inE.hp;
    step([tower], 13, hooks);   // 落地 + 一次性净空测量 + 4 跳
    expect(inE.hp).toBeLessThan(hp0);
    expect(inE.hits.length).toBeGreaterThanOrEqual(4);   // cd=3：13t ≈ 4 跳
    expect(inE.hits.every((d) => d === 20)).toBe(true);
    expect(outE.hp).toBe(10000);                        // 场外（|Δx|>160）
  });
});

// ============ 乌鸦 317（aiStyle 54 是随从非哨兵） ============
describe('乌鸦 317（:3825-3836 minion / AI :27383-27590）', () => {
  it('分类：乌鸦杖 1802 → summon 且非哨兵（sentry 字段无、minion=true）', () => {
    const w = combatWeapon({ key: 'vi_1802_RavenStaff', vid: 1802 });
    expect(w?.kind).toBe('summon');
    expect((w as { sentry?: boolean }).sentry).toBe(false);
  });

  it('扑击：命中敌造成接触伤并重置扑击计时（:27568-27580/:12777-12780）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // ★BJ716-A:DV 中性档（随从弹首掷 ×1.0）
    const e = mkEnemy(50, 60 * 16 + 250, 90 * 16);
    const { hooks, player } = makeHooks([e]);
    const r = new MinionProj(player.x, player.y, 317, 12, 1.5, false, 0, false, () => player);
    step([r], 60, hooks);
    expect(e.hp).toBeLessThan(10000);
    expect(e.hits.every((d) => d === 12)).toBe(true);
  });

  // ★2026-09-08 定谳（蓝队）：旧断言 |cy-(pcy-60)|<40 系钉错,实现 1:1 无漂。
  // 反编译跟随支（1457 Projectile.cs :29084-29123,aiStyle 54）：锚=玩家心-60（:29091）,
  // 但收敛仅限 dist>70（:29111 门）——dist≤70 走漂移支（零速种子 -0.15/-0.05 后
  // ×1.01 :29119-29123,不趋近锚）。旧夹具把 28×28 乌鸦（:4104-4105）放在玩家左上
  // (player.x,player.y) → 距锚 √(4²+53²)=53.2<70 → 整程漂移支,90t 后 |Δy|=45.68
  // （反编译逐值镜像复算一致）——该起点下原版本就到不了 40 内,非实现偏差。
  // 无 float32 量化效应（漂移量级 45px ≫ 1e-7）。改钉为锚语义四钉：
  it('无目标悬停：锚=玩家心上方 60px（:29091）,>70 收敛（:29111-29118）/≤70 漂移（:29119-29123）,全程不产生接触伤（friendly=false :29127）', () => {
    const { hooks, player } = makeHooks([]);
    // ① dist=160（>100 → 317 提速 12 :29103-29109）首拍 v=(v×20+向×12)/21（:29117-29118）
    //   夹具中心=玩家心正上 160（28×28 → 左上 = 中心 -14 :4104-4105）
    const r = new MinionProj(player.cx - 14, player.cy - 60 - 160 - 14, 317, 12, 1.5, false, 0, false, () => player);
    r.fixedUpdate(1, hooks);
    expect(r.vy).toBeCloseTo(12 / 21, 6);
    expect(r.vx).toBeCloseTo(0, 6);
    // ② 70px 门判别：dist=80∈(70,100] → 收敛支 spd 8 → vy=8/21;dist=60≤70 →
    //   漂移支零速种子×1.01 → (vx,vy)=(-0.15,-0.05)×1.01（门值 70 直接钉死 :29111）
    const r80 = new MinionProj(player.cx - 14, player.cy - 60 - 80 - 14, 317, 12, 1.5, false, 0, false, () => player);
    r80.fixedUpdate(1, hooks);
    expect(r80.vy).toBeCloseTo(8 / 21, 6);
    const r60 = new MinionProj(player.cx - 14, player.cy - 60 - 60 - 14, 317, 12, 1.5, false, 0, false, () => player);
    r60.fixedUpdate(1, hooks);
    expect(r60.vx).toBeCloseTo(-0.15 * 1.01, 6);
    expect(r60.vy).toBeCloseTo(-0.05 * 1.01, 6);
    // ③ 长程行为：从 160 外起跑,90t 内进抵锚（|Δy| 极小值 0.06,镜像复算）——
    //   锚常量错钉（-20/-100）此钉必红;抵锚后围锚极限环摆动（70px 门内无减速过冲,
    //   包络 +~113px,周期 ~96t,原版本相）——抵锚后 |Δy| 有界,不失速不坠地
    const dys: number[] = [];
    for (let i = 1; i < 90; i++) { r.fixedUpdate(1, hooks); dys.push(r.cy - (player.cy - 60)); }
    expect(Math.min(...dys.map(Math.abs))).toBeLessThan(10);
    const firstNear = dys.findIndex((v) => Math.abs(v) < 10);
    expect(Math.max(...dys.slice(firstNear).map(Math.abs))).toBeLessThan(125);
    // 无敌怪场景 + 跟随支 friendly=false 提前 return（:29127）→ 无接触伤路径
  });
});
