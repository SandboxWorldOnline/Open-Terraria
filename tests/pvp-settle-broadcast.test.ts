// PvP 契约五点·缝合批回归（2026-08-31 清零批二波）：
//   GA1 近战 PvP 免疫门（原版 ItemCheck_MeleeHitPVP 循环门禁串含 player.immune 支，
//       1457 Player.cs:44429——victim-settles 等价位 = getProxyPvpImmuneRemaining 镜像）
//   GA2 PvP 弹幕免疫门（Damage_PVP 循环门禁串 Projectile.cs:14650，吸血反馈前置；
//       且门插位先于 pvpProjHitSet.add——免疫期接触不入账）
//   GA4 被击端四结算点 sendPlayerHurt(msg117)+notifyPlayerHurtSettled 收口
//   F14 甲虫攻套 PvP 记账 BLOCKER 收敛（清零批四）：回执关联制——Game 区登记未决挥击、
//       ClientNet 消费 msg117(Pvp 位) 以 beetlePvpCredit 重算 vanilla 返回段精确入账式
//   ——原型桩口径同 weapon-melee-leftover / melee-pvp-los-gate（Object.create(Game.prototype)）。
import { describe, it, expect, vi } from 'vitest';
import { World } from '../src/world/World';
import { Player } from '../src/entities/Player';
import { Inventory } from '../src/items/Inventory';
import { MagicProj } from '../src/entities/MagicProj';
import { SparkleGuitarProj } from '../src/entities/SparkleGuitarProj';
import { BuffType } from '../src/stats/Buffs';
import {
  NetWriter, NetReader, Msg, PlayerHurtFlags,
  writePlayerHurt, readPlayerHurt,
} from '../src/net/protocol';
import { ClientNet, beetlePvpCredit } from '../src/net/ClientNet';
import type { RemotePlayerState } from '../src/net/ClientNet';
import { BeetleMeter } from '../src/player/BeetleMeter';
import { TILE_BY_KEY } from '../src/data/tiles';
import type { TileStore } from '../src/world/TileStore';
import { Game } from '../src/core/Game';
import { makeNetId } from '../src/net/entitySyncHooks';
import { ITEM_BY_KEY } from '../src/data/items';
import { vanillaItemKey } from '../src/data/vanillaRecipes';

const protGame = (): Record<string, any> => Object.create(Game.prototype) as Record<string, any>;
const iid = (vid: number): number => {
  const k = vanillaItemKey(vid);
  const found = k ? ITEM_BY_KEY[k] : undefined;
  if (found === undefined) throw new Error(`vid ${vid} 未注册`);
  return found;
};

// ---------------------------------------------------------------------------
// GA4：reportPlayerHurt 语义（hp 净减量=dmg 终值、闪避早退不发、crit 位路由）
// ---------------------------------------------------------------------------
describe('GA4 reportPlayerHurt（msg117 发送侧统一出口）', () => {
  /** Game 原型桩：只装配 reportPlayerHurt 触碰面 */
  function shell() {
    const g = protGame();
    const sent: Array<{ dmg: number; x: number; y: number; dir: number; flags: number }> = [];
    const notified = vi.fn();
    const p = new Player(1000, 1000, new Inventory());
    g.player = p;
    g.net = {
      active: true,
      mySlot: 3,
      notifyPlayerHurtSettled: notified,
      sendPlayerHurt: (dmg: number, x: number, y: number, dir: number, flags: number) => {
        sent.push({ dmg, x, y, dir, flags });
      },
    };
    return { g, p, sent, notified };
  }

  it('有净减量才发：dmg=hpBefore−hp；dir=sign(cx−srcX)||1；Pvp 位恒置', () => {
    const { g, p, sent } = shell();
    p.hp = 100;
    p.hp = 70;                                       // 结算后实扣 30
    g.reportPlayerHurt(100, 900, false);             // srcX 在玩家左侧 → dir=+1
    expect(sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ dmg: 30 });
    expect(sent[0].dir).toBe(1);
    expect(sent[0].flags & PlayerHurtFlags.Pvp).not.toBe(0);
  });

  it('无净减量（闪避/免伤早退）→ 不发不通知（≡ vanilla num2<=0 无 SendPlayerHurt）', () => {
    const { g, p, sent, notified } = shell();
    p.hp = 100;
    g.reportPlayerHurt(100, 900, false);             // hp 未动
    expect(sent.length).toBe(0);
    expect(notified).not.toHaveBeenCalled();
  });

  it('crit 位随包转发；死亡结算(hp≤0)仍发；net 失活不出包', () => {
    const { g, p, sent } = shell();
    p.hp = 50; p.hp = -5;                            // 致死一击：delta≥hpBefore，钳到 hpBefore
    g.reportPlayerHurt(50, 1100, true);              // crit → bit0 携带；srcX 右侧 → dir=-1
    expect(sent.length).toBe(1);
    expect(sent[0].dmg).toBe(50);
    expect(sent[0].dir).toBe(-1);
    expect(sent[0].flags & PlayerHurtFlags.Crit).not.toBe(0);

    const h2 = shell();
    h2.g.net.active = false;
    h2.p.hp = 40; h2.p.hp = 10;
    h2.g.reportPlayerHurt(40, 900, false);
    expect(h2.sent.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GA1/GA2：攻端门禁读镜像（近战循环 + netPvpProjFeedback 弹幕反馈两处 continue 位）
// ---------------------------------------------------------------------------

/** 近战 PvP 桶桩（同 melee-pvp-los-gate.pvpShell 缩形）：一个远端代理摆在判定盒内 */
function pvpShell(immuneMirror: number) {
  const world = new World(160, 160, 42, 'ga1');
  const g = protGame();
  const player = new Player(800, 1440, new Inventory());
  player.inv.add(iid(3013), 1);              // 臭臭爪：melee 无 noMelee、无特判分支
  player.hostile = true;
  g.swing = { t: 15, dur: 30, dmg: 10, kb: 3, item: iid(3013), useStyle: 1 };
  g.swingHitSet = new Set<number>();
  g.swingTileCutSet = new Set<number>();
  g.entities = { critters: [], npcs: [], enemies: [] };
  g.world = world;
  g.player = player;
  g.sfx = { playWavFile: () => true, playFiles: () => true, play: () => {} };
  g.addDamageNumber = () => {};
  g.spawnParticles = () => {};
  g.spawnDrop = () => null;
  g.bannerNpcActive = () => false;
  const rp = new Player(player.cx + 6, player.y, new Inventory());
  rp.hostile = true;
  (rp as unknown as { __netSlot?: number }).__netSlot = 1;
  g.remotePlayerProxies = [rp];
  const strikeSent: unknown[][] = [];
  const noteCalls: Array<[number, number, boolean, boolean]> = [];
  g.net = {
    active: true,
    policy: { pvpAllowed: true },
    players: new Map([[1, { pvpImmuneT: immuneMirror }]]),
    getProxyPvpImmuneRemaining: (s: number) =>
      (g.net as { players: Map<number, { pvpImmuneT: number }> }).players.get(s)?.pvpImmuneT ?? 0,
    // ★F14：Game 近战 PvP 区新增的未决挥击登记位点——GA1 套壳只关心门禁/msg44 面
    notePendingMeleeHit: (slot: number, rawDmg: number, critFlag: boolean, off: boolean) =>
      noteCalls.push([slot, rawDmg, critFlag, off]),
    sendStrikePlayer: (...a: unknown[]) => { strikeSent.push(a); },
  };
  return { g, player, rp, strikeSent, noteCalls };
}

describe('GA1 近战 PvP 免疫门（mirror=getProxyPvpImmuneRemaining，1457 :44429 同构支）', () => {
  it('免疫窗内命中体整条被 continue：无 msg44 意向、不入 swingHitSet（不预占去重键）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { g, strikeSent } = pvpShell(8);
    (g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(strikeSent.length).toBe(0);
    expect([...(g.swingHitSet as Set<number>)]).toEqual([]);
  });

  it('镜像归零：同一门串放行，msg44 意向照常广播（对照上一例的反面）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { g, strikeSent } = pvpShell(0);
    (g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(strikeSent.length).toBe(1);
    expect(strikeSent[0][0]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// GA2：netPvpProjFeedback 免疫门（Projectile.cs:14650 门禁串同构支）
// ---------------------------------------------------------------------------

describe('GA2 netPvpProjFeedback 免疫门（门插位先于 pvpProjHitSet.add）', () => {
  function feedbackShell(immuneMirror: number) {
    const world = new World(160, 160, 42, 'ga2');
    const g = protGame();
    const player = new Player(800, 1440, new Inventory());
    player.hostile = true;
    g.world = world;
    g.player = player;
    g.tickCount = 7;
    g.remotePlayerProxies = [];
    g.pvpProjHitSet = new Set<string>();
    const rp = new Player(802, 1440, new Inventory());
    rp.hostile = true;
    (rp as unknown as { __netSlot?: number }).__netSlot = 1;
    g.remotePlayerProxies = [rp];
    const steals: Array<[string, number]> = [];
    g.applyLifeSteal = (kind: string, dmg: number) => steals.push([kind, dmg]);
    g.net = {
      active: true,
      policy: { pvpAllowed: true },
      players: new Map(),
      getProxyPvpImmuneRemaining: () =>
        immuneMirror,
    };
    // 法弹（magic → ghost 吸血支）：与代理盒重叠、damage>0、非傀儡非敌对
    const proj = new MagicProj(800, 1440, 1, 0, 40, 600, '#8090FF');
    g.entities = { projectiles: [proj] };
    return { g, proj, steals };
  }

  it('免疫窗内：吸血反馈与记账双双跳过（门在 add 之前 ⇒ 出窗后同弹重入仍可结算）', () => {
    const { g, steals } = feedbackShell(12);
    (g as unknown as { netPvpProjFeedback: () => void }).netPvpProjFeedback();
    expect(steals.length).toBe(0);
    expect((g.pvpProjHitSet as Set<string>).size).toBe(0);
  });

  it('镜像归零：ghost 吸血恰一发入账一次（每弹×每目标键；重复扫幂等）', () => {
    const { g, steals } = feedbackShell(0);
    (g as unknown as { netPvpProjFeedback: () => void }).netPvpProjFeedback();
    (g as unknown as { netPvpProjFeedback: () => void }).netPvpProjFeedback();
    expect(steals.length).toBe(1);
    expect(steals[0][0]).toBe('ghost');
  });
});

// ---------------------------------------------------------------------------
// 二轮蓝队批（2026-08-31）
//   FR1：bit6 狱火支补实扣广播（SendPlayerHurt 第五生产者，UpdateBuffs==116 支
//        Player.cs:10346-48）——此前 damagePlayer 后直接 return，其他端零飘字。
//   FR3-F：弹 856 收端结算面归一——分派 kind9 真类重建 + 结算按 projId===856 真值
//        裁决（视线门豁免/crit 不掷/浸剂 neither/×0.75 收端折算），legacy kind1 发
//        送方同样被归一（跨版本兼容面）。
// ---------------------------------------------------------------------------

/** 狱火支驱动壳：netApplyStrikePlayer(flags=bit6) 最小触碰面 */
function hellfireShell() {
  const g = protGame();
  const p = new Player(1000, 1000, new Inventory());
  p.hp = 100;
  p.hostile = true;                              // InOpposingTeam 门（双方 hostile）
  g.player = p;
  g.pvpAuraCd = new Map<number, number>();
  const dmgTaken: number[] = [];
  g.damagePlayer = (dmg: number): number => {             // 实扣桩：20 → 全额扣
    dmgTaken.push(dmg);
    p.hp = Math.max(0, p.hp - dmg);
    return dmg;
  };
  const sent: Array<{ dmg: number; dir: number; flags: number }> = [];
  g.net = {
    active: true,
    mySlot: 2,
    policy: { pvpAllowed: true },
    players: new Map([[1, { active: true, name: 'R', hostile: true, team: 0, x: 1100, y: 1000 }]]),
    notifyPlayerHurtSettled: vi.fn(),
    sendPlayerHurt: (dmg: number, _x: number, _y: number, dir: number, flags: number) =>
      sent.push({ dmg, dir, flags }),
  };
  return { g, p, sent, dmgTaken };
}

describe('FR1 bit6 狱火支实扣权威广播（Player.cs:10348 SendPlayerHurt 生产者补线）', () => {
  it('实扣成功 → msg117 携净减量 + Pvp 位（crit 恒 false，形制同近战支）', () => {
    const { g, sent } = hellfireShell();
    (g as unknown as { netApplyStrikePlayer: (s: number, d: number, w: number, f: number) => void })
      .netApplyStrikePlayer(1, 20, 0, 0x40);
    expect(sent.length).toBe(1);
    expect(sent[0].dmg).toBe(20);                          // hpBefore−hp 净减量
    expect(sent[0].flags & PlayerHurtFlags.Pvp).not.toBe(0);
    expect(sent[0].flags & PlayerHurtFlags.Crit).toBe(0);
    // ★FR3-F（三轮蓝队）：原版 :10344-48 `player.Hurt(ByOther(16),20,0,pvp:true)`
    // hitDirection=0 零击退形制 → dir 恒 0（旧钉「攻击者右侧→-1」系位置符号近似，
    // 已随三站统一废除）
    expect(sent[0].dir).toBe(0);
  });

  it('per-owner 冷却窗内重复意向不再结算/再报（原版 infernoCounter%60 节拍等价）', () => {
    const { g, sent } = hellfireShell();
    const fn = () => (g as unknown as { netApplyStrikePlayer: (s: number, d: number, w: number, f: number) => void });
    fn().netApplyStrikePlayer(1, 20, 0, 0x40);
    fn().netApplyStrikePlayer(1, 20, 0, 0x40);
    expect(sent.length).toBe(1);
  });

  it('地狱火浸剂先于伤害授予（原版 AddBuff 先行 :10344-45）', () => {
    const { g, p } = hellfireShell();
    (g as unknown as { netApplyStrikePlayer: (s: number, d: number, w: number, f: number) => void })
      .netApplyStrikePlayer(1, 20, 0, 0x40);
    expect(p.buffs.has(BuffType.OnFire3)).toBe(true);
  });
});

// ---- FR3-F：kind9 分派序前置 / case9 真类重建 / 收端结算归一 ----

const STONE = TILE_BY_KEY['stone'];

describe('FR3-F broadcast：SparkleGuitarProj 分派序前置出 kind9（曾落 kind1 被 melee 化）', () => {
  function broadcastShell(pvpOn: boolean) {
    const g = protGame();
    g.tickCount = 100;
    g.netProjLast = new Map<number, { x: number; y: number; t: number }>();
    g.netProjCursor = 0;
    g.netProjForce = new Set<number>();   // ★Z-F4 强制上线通道（2026-08-31 增量）桩
    const orb = new SparkleGuitarProj(2000, 2400, -14, -40, 85, 2600, 2200);
    orb.id = 7;
    // 预置差分基准：上一拍位远离当前位置（首次可见即入批——新鲜建项恒跳过）
    g.netProjLast.set(orb.id, { x: orb.x - 600, y: orb.y, t: g.tickCount - 70 });
    const host = new Player(1900, 2400, new Inventory());
    host.hostile = pvpOn;
    g.player = host;
    g.entities = { projectiles: [orb] };
    const batches: Array<Array<{ kind: number; tag: string; aux: number; dmg: number }>> = [];
    g.net = {
      active: true,
      mySlot: 0,
      policy: { pvpAllowed: true },
      sendProjectileBatch: (snaps: Array<{ kind: number; tag: string; aux: number; dmg: number }>) =>
        batches.push(snaps),
      sendProjDespawn: () => {},
      sendNpcSnapshot: () => {},
    };
    return { g, batches };
  }

  it('hostile 房：kind=9|0x40、tag=弹型、aux=旋转相位 t01 千分位（FR5-F；不携浸剂/crit 位——值域 0..1000）', () => {
    const { g, batches } = broadcastShell(true);
    (g as unknown as { netProjBroadcast: () => void }).netProjBroadcast();
    expect(batches.length).toBe(1);
    // 新建相位 t=0 → aux=0；★FR5-F 后该字段承载相位而非恒 0 占位
    // （收端 netPhaseApply 消费——Game.netApplyProjSnaps 重锚 + 傀儡 +3/tick 自推进）
    expect(batches[0][0]).toMatchObject({ kind: 9 | 0x40, tag: '856', dmg: 85 });
    expect(batches[0][0].aux).toBeGreaterThanOrEqual(0);
    expect(batches[0][0].aux).toBeLessThanOrEqual(1000);
  });

  it('非 hostile：不带 PvP 位', () => {
    const { g, batches } = broadcastShell(false);
    (g as unknown as { netProjBroadcast: () => void }).netProjBroadcast();
    expect(batches[0][0].kind).toBe(9);
  });

  it('case9 真类重建：快照左上角转中心入参 → 盒 32×32 与 projId 真值就位', () => {
    const g = protGame();
    const built = (g as unknown as { netMakeProj: (s: Record<string, unknown>) => SparkleGuitarProj | null })
      .netMakeProj({ kind: 9, tag: '856', dmg: 85, aux: 0, x: 800, y: 900, vx: -12, vy: 40 });
    expect(built).toBeInstanceOf(SparkleGuitarProj);
    expect(built!.w).toBe(32);
    expect(built!.h).toBe(32);
    expect(built!.damage).toBe(85);
    expect(built!.x).toBeCloseTo(800, 5);          // 快照左上角恒等（构造中心参内扣 w/2 回写）
  });
});

/** 全高石墙列（LOS 拦截用——参照 melee-pvp-los-gate 同式整列覆盖） */
function wallCol(st: TileStore, col: number) {
  for (let ty = 0; ty < st.h; ty++) st.setTile(col, ty, STONE);
}
/** 近战族对照弹（kind7===1 形态的最小 Entity 面；真 Boomerang 依赖 projectileData 大表，
 *  此处只喂 netPuppetProjContact/hitPlayer 触碰的几何与 projId 面） */
class MeleeKind1Stub {
  x: number; y: number; w = 22; h = 22;
  damage = 80;
  projId: number;
  dead = false;
  constructor(projId: number, cxPx: number, cyPx: number) {
    this.projId = projId;
    this.x = cxPx - this.w / 2;
    this.y = cyPx - this.h / 2;
  }
}

describe('FR3-F settle：856 弹型真值裁决四点（视线门豁免/crit 不掷/浸剂 neither/×0.75 折算）', () => {
  /** 傀儡接触结算壳：victim 本地、ownerSlot=1 远端代理。
   *  wallBetweenOwner = 弹↔发射者代理之间立整列墙（ModifyStellarTune 判定域）。
   *  ※不设「跨玩家墙」对照臂：两盒重叠 ⇒ 中心线必同列/邻列，canHitLine 起终点同格
   *  短路返真(:229 d5=d6=0)，隔列则必非重叠——gate-拦截与 no-overlap 无法纯几何区分；
   *  非 856 族的 gate 位以开阔地臂（crit/浸剂生效）作护栏。 */
  function tuneShell(opts: { projId?: number; kind7?: number;
    wallBetweenOwner?: boolean }) {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const world = new World(220, 160, 42, 'fr3f');
    const st = world.store;
    if (opts.wallBetweenOwner) wallCol(st, 110);
    const g = protGame();
    g.world = world;
    const victim = new Player(1990, 2380, new Inventory());       // cx≈2000（col125）
    victim.hostile = true;
    victim.iframes = 0;
    g.player = victim;
    const ownerProxy = new Player(1400, 2380, new Inventory());   // 发射者远端代理（col88）
    (ownerProxy as unknown as { __netSlot?: number }).__netSlot = 1;
    g.remotePlayerProxies = [ownerProxy];
    const puppetEnt = opts.projId === 856
      ? new SparkleGuitarProj(victim.cx + 4, victim.cy, 0, 0, 80, victim.cx, victim.cy)
      : new MeleeKind1Stub(opts.projId ?? 156, victim.cx + 4, victim.cy);
    const netId = makeNetId(1, 5);
    g.netProjPuppets = new Map([[netId, {
      p: puppetEnt, seen: 0, pvp: true, ownerSlot: 1,
      kind7: opts.kind7 ?? 1,                 // legacy 分类（修复前 856 即此形态）
      enchant: 3,                             // OnFire 浸剂通道（melee||whip 门内才生效）
      ownerMeleeCrit: 255,                    // crit 掷阈值高位段（若被错误套上必触发）
      pvpImmuneT: 0,
    }]]);
    const hurtCalls: number[] = [];
    g.damagePlayer = (dmg: number): number => { hurtCalls.push(dmg); victim.iframes += 8; return dmg; };
    const reports: Array<{ hpBefore: number; srcX: number; crit: boolean }> = [];
    g.reportPlayerHurt = (hpBefore: number, srcX: number, critFlag: boolean) =>
      reports.push({ hpBefore, srcX, crit: critFlag });
    g.net = {
      active: true,
      mySlot: 2,
      policy: { pvpAllowed: true },
      players: new Map([[1, { active: true, name: 'R', hostile: true, team: 0, x: ownerProxy.x, y: ownerProxy.y }]]),
    };
    return { g, victim, hurtCalls, reports };
  }

  it('856（legacy kind7=1 形态）：无视线 → 满伤路径照走；crit 位禁掷；OnFire 浸剂不得授予', () => {
    const { g, hurtCalls, reports } = tuneShell({ projId: 856, kind7: 1 });
    (g as unknown as { netPuppetProjContact: () => void }).netPuppetProjContact();
    // ★附带⑤ 单掷定案（Projectile.cs:14718 唯一 DamageVar，掷点=被击端收口；
    // hitPlayer 的 pvp 支已删再掷）：预掷 round(80×1.125)=90 直接落账（旧双掷
    // 复合语义曾再乘同因子得 101——与原文 :14714 族单掷不符）
    expect(hurtCalls.length).toBe(1);
    expect(hurtCalls[0]).toBe(90);
    expect(reports.length).toBe(1);
    expect(reports[0].crit).toBe(false);                  // magic 弹不掷 crit（:14714 melee 门）
    const v = (g as unknown as { player: Player }).player;
    expect(v.buffs.has(BuffType.OnFire)).toBe(false);     // enchant=3 但 melee 位已按弹真值剔除
  });

  it('856：发射者视线断 → ×0.75 于收端折算（ModifyStellarTuneDamage 掷后消费 :14720；单掷终值 67）', () => {
    const { g, hurtCalls } = tuneShell({ projId: 856, kind7: 1, wallBetweenOwner: true });
    (g as unknown as { netPuppetProjContact: () => void }).netPuppetProjContact();
    // 预掷 90 → trunc(90×0.75)=67；★附带⑤ 后不再有第二掷
    expect(hurtCalls[0]).toBe(67);
  });

  it('对照臂·真近战弹开阔地：浸剂 OnFire 授予 + crit 掷点生效（回归护栏防误伤族语义）', () => {
    const { g, hurtCalls, reports } = tuneShell({ projId: 156, kind7: 1 });
    (g as unknown as { netPuppetProjContact: () => void }).netPuppetProjContact();
    expect(hurtCalls.length).toBe(1);
    expect(reports[0].crit).toBe(true);                   // 90 < ownerMeleeCrit=255
    const v = (g as unknown as { player: Player }).player;
    expect(v.buffs.has(BuffType.OnFire)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ★联机③ ghostHeal 通域补全（Damage_PVP :14731-34）：吸血受理面不再限定
//   Arrow/MagicProj 实例——friendly/minion 数据位即受理（SparkleGuitarProj 856、
//   WeaponProj 回旋镖族等纳入）；304 吸血刀任意类触发 vampire 支。
// ---------------------------------------------------------------------------
describe('联机③ netPvpProjFeedback 族面补全', () => {
  function shellWithProj(proj: Record<string, unknown>) {
    const world = new World(160, 160, 42, 'fb3');
    const g = protGame();
    const player = new Player(800, 1440, new Inventory());
    player.hostile = true;
    g.world = world;
    g.player = player;
    g.tickCount = 7;
    g.remotePlayerProxies = [];
    g.pvpProjHitSet = new Set<string>();
    const rp = new Player(802, 1440, new Inventory());
    rp.hostile = true;
    (rp as unknown as { __netSlot?: number }).__netSlot = 1;
    g.remotePlayerProxies = [rp];
    const steals: Array<[string, number]> = [];
    g.applyLifeSteal = (kind: string, dmg: number) => steals.push([kind, dmg]);
    g.net = { active: true, policy: { pvpAllowed: true }, players: new Map(),
      getProxyPvpImmuneRemaining: () => 0 };
    g.entities = { projectiles: [proj] };
    return { g, steals };
  }

  it('856（SparkleGuitarProj，非 Arrow/MagicProj 类）：数据 friendly=true → ghost 入账', () => {
    const proj = { id: 3, projId: 856, damage: 40, dead: false, hostile: false,
      x: 800, y: 1440, w: 32, h: 32 };
    const { g, steals } = shellWithProj(proj);
    (g as unknown as { netPvpProjFeedback: () => void }).netPvpProjFeedback();
    expect(steals.length).toBe(1);
    expect(steals[0][0]).toBe('ghost');
  });

  it('敌对弹（hostile=true）与未登记数据且非直射类：不进吸血面', () => {
    const hostile = { id: 4, projId: 80, damage: 30, dead: false, hostile: true,
      x: 800, y: 1440, w: 16, h: 16 };
    const h = shellWithProj(hostile);
    (h.g as unknown as { netPvpProjFeedback: () => void }).netPvpProjFeedback();
    expect(h.steals.length).toBe(0);
    const unknown = { id: 5, projId: 99999, damage: 30, dead: false, hostile: false,
      x: 800, y: 1440, w: 16, h: 16 };
    const u = shellWithProj(unknown);
    (u.g as unknown as { netPvpProjFeedback: () => void }).netPvpProjFeedback();
    expect(u.steals.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ★三轮蓝队批回归钉子（2026-08-31）
//   FR2-F：damagePlayer 尾通用通道——非 PvP 全路径 msg117 自动生产 + PvP 支去重
//   FR6-F：ghost isMagic 按弹型真值（ghostHeal 内部 !magic 拒，Projectile.cs:12090-12093）
//   FR5-F：kind9 aux 相位通道（收端重锚 + 傀儡等速自推进）
// ---------------------------------------------------------------------------
describe('FR2-F 非 PvP 通用 msg117 通道（Player.Hurt :38656-38664 三要素对位）', () => {
  function envShell() {
    const g = protGame();
    const sent: Array<{ dmg: number; x: number; y: number; dir: number; flags: number }> = [];
    const notified = vi.fn();
    const p = new Player(1000, 1000, new Inventory());
    p.hostile = false;
    g.player = p;
    g.sfx = { playWavFile: () => true, playFiles: () => true, play: () => {} };  // voice 链桩
    g.addDamageNumber = () => {};
    g.spawnParticles = () => {};
    g.net = {
      active: true,
      mySlot: 3,
      notifyPlayerHurtSettled: notified,
      sendPlayerHurt: (dmg: number, x: number, y: number, dir: number, flags: number) =>
        sent.push({ dmg, x, y, dir, flags }),
    };
    return { g, p, sent, notified };
  }

  it('NPC 接触族（pvp=false）落地即广播一次：flags=0、dmg=实扣、src 左侧 → dir=+1', () => {
    const { g, p, sent } = envShell();
    p.iframes = 0;
    const hp0 = p.hp;
    (g as unknown as { damagePlayer: (...a: unknown[]) => number }).damagePlayer(30, 900, 1000);
    expect(sent.length).toBe(1);
    expect(sent[0].flags).toBe(0);                      // 非 PvP 非 crit 位
    expect(sent[0].dmg).toBeGreaterThan(0);
    expect(sent[0].dmg).toBe(Math.max(0, hp0 - p.hp));  // 实扣口径（与五 PvP 支同语义）
    expect(sent[0].dir).toBe(1);                        // 攻击源在左侧
  });

  it('pvp=true 面不自动发（五个结算支显式 reportPlayerHurt 所有权保留）', () => {
    const { g, p, sent } = envShell();
    p.iframes = 0;
    (g as unknown as { damagePlayer: (...a: unknown[]) => number })
      .damagePlayer(20, 960, 1000, undefined, false, true);
    expect(sent.length).toBe(0);
  });
});

describe('FR6-F ghost isMagic 弹型真值投影（A3 类别通道单源）', () => {
  function fbShell(proj: Record<string, unknown>) {
    const world = new World(160, 160, 42, 'fr6');
    const g = protGame();
    const player = new Player(800, 1440, new Inventory());
    player.hostile = true;
    g.world = world;
    g.player = player;
    g.tickCount = 7;
    g.pvpProjHitSet = new Set<string>();
    const rp = new Player(802, 1440, new Inventory());
    rp.hostile = true;
    (rp as unknown as { __netSlot?: number }).__netSlot = 1;
    g.remotePlayerProxies = [rp];
    const steals: Array<{ kind: string; isMagic: boolean }> = [];
    g.applyLifeSteal = (kind: string, _dmg: number, _hits: number, _x: number, _y: number,
      isMagic: boolean) => { steals.push({ kind, isMagic }); return 0; };
    g.net = { active: true, policy: { pvpAllowed: true }, players: new Map(),
      getProxyPvpImmuneRemaining: () => 0 };
    g.entities = { projectiles: [proj] };
    return { g, steals };
  }

  it('856 magic 类 → isMagic=true（预算扣后照治疗）', () => {
    const proj = { id: 3, projId: 856, damage: 40, dead: false, hostile: false,
      x: 800, y: 1440, w: 32, h: 32 };
    const { g, steals } = fbShell(proj);
    (g as unknown as { netPvpProjFeedback: () => void }).netPvpProjFeedback();
    expect(steals.length).toBe(1);
    expect(steals[0]).toEqual({ kind: 'ghost', isMagic: true });
  });

  it('木箭 ranged 类 → isMagic=false（旧恒 true 虚入账面已废）', () => {
    const proj = { id: 4, projId: 1, damage: 40, dead: false, hostile: false,
      x: 800, y: 1440, w: 16, h: 16 };
    const { g, steals } = fbShell(proj);
    (g as unknown as { netPvpProjFeedback: () => void }).netPvpProjFeedback();
    expect(steals.length).toBe(1);
    expect(steals[0]).toEqual({ kind: 'ghost', isMagic: false });
  });
});

describe('FR5-F kind9 旋转相位通道（aux 千分位 t01）', () => {
  it('收端到包重锚：phase01 收敛于携值（t=round(t01×90)）；快照间隔内傀儡自推进 +3/tick', () => {
    const spark = new SparkleGuitarProj(1000, 1000, -12, 40, 80, 1000, 1000);
    spark.netPhaseApply(1 / 3);
    expect(spark.phase01).toBeCloseTo(30 / 90, 6);      // round(90/3)=30 整除无舍入
    (spark as unknown as { netPuppet: boolean }).netPuppet = true;   // 傀儡支自推进
    (spark as SparkleGuitarProj).fixedUpdate(1 / 60, {} as never);
    expect(spark.phase01).toBeCloseTo(33 / 90, 6);
  });

  it('越界/脏值钳制：NaN/负值不污染相位；超 1 钳到 t=90 → mod-90 wrap 为 0（rotation 周期等价）', () => {
    const spark = new SparkleGuitarProj(1000, 1000, 12, 40, 80, 1000, 1000);
    spark.netPhaseApply(Number.NaN);
    expect(spark.phase01).toBeCloseTo(0, 5);
    spark.netPhaseApply(-2);
    expect(spark.phase01).toBeCloseTo(0, 5);
    spark.netPhaseApply(7);                              // clamp→1 → t=90 → wrap 0
    expect(spark.phase01).toBe(0);                       // 2π×90/90 ≡ 2π×0 视觉恒等
  });
});

// ---------------------------------------------------------------------------
// ★F14（2026-08-31 清零批四）甲虫攻套 PvP 记账·回执关联制 BLOCKER 收敛
//
// 定谳锚（Player.cs / Main.cs 1457）：
//   · ItemCheck_MeleeHitPVP :44434-44460 —— 攻机同帧 num2=(int)player.Hurt(...) 后
//     `if (beetleOffense) { beetleCounter += num2; beetleCountdown = 0; }`；
//   · num2【不是】被击者实扣：Hurt 对 pvp:true 在返回前重算
//     num2 = CalculateDamagePlayersTakeInPVP(num×(crit?2:1), statDefense)
//     （:38862-38868 + Main.cs:67136-67143 —— Dmg−0.5×Def,min1;无难度乘区/无
//     endurance/致敌致死时实扣被残血钳小而入账仍按全额公式）→ feed msg117 实扣值
//     = 系统性近似,禁走；
//   · 式中唯一攻端不可知输入 = 受方 statDefense → msg16 第三尾段镜像
//     （RemotePlayerState.pvpDefense,null=对端缺尾段→保守弃账不虚增）。
// 覆盖矩阵：聚合(多目标乱序) / 同目标二次命中窗口交叠(FIFO) / 迟到包 TTL 丢弃 /
//   非近战武器与 PvE/环境伤不充能不冲账 / 缺防御镜像降级弃账 / Game 区接线四元组。
// ---------------------------------------------------------------------------

/** 真 ClientNet 桩（journey-mp / pvp-immune-net 同款假 ws 字节流直连口径） */
function fakeWsF14() {
  const sent: Uint8Array[] = [];
  const ws = {
    sent,
    readyState: 1,
    bufferedAmount: 0,
    send: (data: ArrayBuffer | Uint8Array) => { sent.push(new Uint8Array(data as ArrayBuffer)); },
    close: () => { ws.readyState = 3; },
    onopen: null as null, onmessage: null as null, onclose: null as null, onerror: null as null,
  };
  return ws;
}
type NetPrivF14 = { ws: { sent: Uint8Array[] } };
const feedNetF14 = (net: ClientNet, frame: Uint8Array): void =>
  (net as unknown as { handle(msgId: number, r: NetReader): void })
    .handle(frame[2], new NetReader(frame.subarray(3)));
const pruneOf = (net: ClientNet) =>
  (net as unknown as { pruneMeleeReceipts(nowMs: number): void });

function mkF14Net(mySlot: number): ClientNet {
  const net = new ClientNet(
    { player: { appearance: null, hostile: false, team: 0, hp: 100, maxHp: 100,
      deathsPve: 0, deathsPvp: 0, mana: 50, maxMana: 100, luck: 0,
      inv: { slots: [], armor: [], dye: [], selected: 0 } } } as never,
    { onWorldReady: () => {} } as never);
  net.mySlot = mySlot;
  net.active = true;
  (net as unknown as NetPrivF14).ws = fakeWsF14();
  return net;
}

function seedPeerF14(net: ClientNet, slot: number, defense: number | null = null):
  RemotePlayerState {
  const p: RemotePlayerState = {
    slot, name: `玩家${slot}`, appearance: '{}', x: 0, y: 0, vx: 0, vy: 0,
    up: false, down: false, left: false, right: false, jump: false, useItem: false,
    dash: false,   // ★BJ742-A R22-⑦：RemotePlayerState 新字段（ctrlBits[7]）
    facing: 1, selectedItem: 0, dead: false, fresh: false, active: true, lastFresh: 0,
    ghostPhase: false,   // ★G43 D-N15：msg13 flagBits[1] 独立硬核幽灵位（缺省不计）
    hostile: true, team: 0, hp: 100, maxHp: 100, sleeping: false,
    deathsPve: 0, deathsPvp: 0, mana: 0, manaMax: 0, luck: 0, pvpImmuneT: 0,
    pvpDefense: defense,
    camTarget: null, sitting: false, porAnchors: null,   // G36-A D3 新字段
    buffTypes: new Array(44).fill(0),   // ★BJ755-A T1：msg50 镜像（SW 原生协议恒零）
  };
  net.players.set(slot, p);
  return p;
}

const syncHpNow4 = (net: ClientNet): void =>
  (net as unknown as { syncHp(): void }).syncHp();

/** msg117 合成帧（writePlayerHurt 直通；flags 非近战支=去 Pvp 位） */
const hurtFrameF14 = (slot: number, flags: number, dmg = 25): Uint8Array =>
  writePlayerHurt({ slot, dmg, x: 100, y: 200, dir: 1, flags });
/** 近战支标准位组（★F-1：回执 FIFO 消费门=Pvp|MeleeSource 双位） */
const MELEE_PVP_HURT = PlayerHurtFlags.Pvp | PlayerHurtFlags.MeleeSource;

interface F14Credit { slot: number; credit: number; off: boolean }

/** 消费层套壳：attacker 视角 net + sink 记录 */
function f14clientShell(): { net: ClientNet; credits: F14Credit[] } {
  const net = mkF14Net(2);                       // 攻端自身 slot=2
  const credits: F14Credit[] = [];
  net.onMeleePvpBeetleCredit = (slot, credit, off) => credits.push({ slot, credit, off });
  return { net, credits };
}

describe('★F14 入账式精确性：beetlePvpCredit ≡ vanilla 返回段重算真值', () => {
  it('Dmg−0.5×Def 截断 + min-1 双钳 + crit ×2 只经本式进入（38864-38868/Main.cs:67136-43 向量）', () => {
    expect(beetlePvpCredit(10, false, 25)).toBe(1);      // −12.5 → double 段 min1 → cast 1
    expect(beetlePvpCredit(11, false, 7)).toBe(7);       // 11−3.5=7.5 → trunc 7
    expect(beetlePvpCredit(11, true, 3)).toBe(20);       // crit×2=22−1.5=20.5 → 20
    expect(beetlePvpCredit(20, true, 20)).toBe(30);      // 40−10 精确整
    expect(beetlePvpCredit(36, true, 20)).toBe(62);      // 72−10 E2E 参照值
    expect(beetlePvpCredit(9, false, 999)).toBe(1);      // 全防下仍保底 1（原版 :44456 无 immortal 免账）
  });
});

describe('★F14 回执关联消费层（ClientNet 实例直驱）：聚合/FIFO/TTL/防污染/降级', () => {
  it('聚合——三目标各自 pending，回执乱序到达互不串账（各 slot FIFO 独立键）', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 7, 6); seedPeerF14(net, 9, 8); seedPeerF14(net, 4, 40);
    // 多目标受理登记（同挥聚合形态；off 全 true）
    net.notePendingMeleeHit(7, 30, false, true);
    net.notePendingMeleeHit(9, 12, true, true);
    net.notePendingMeleeHit(4, 20, false, true);
    // 到达序反转（服务器转发并不保证跨目标有序）
    feedNetF14(net, hurtFrameF14(4, MELEE_PVP_HURT));
    feedNetF14(net, hurtFrameF14(9, MELEE_PVP_HURT));
    feedNetF14(net, hurtFrameF14(7, MELEE_PVP_HURT));
    expect(credits).toEqual([
      { slot: 4, credit: beetlePvpCredit(20, false, 40), off: true },   // 0→min1
      { slot: 9, credit: beetlePvpCredit(12, true, 8), off: true },     // 24−4
      { slot: 7, credit: beetlePvpCredit(30, false, 6), off: true },    // 30−3
    ]);
  });

  it('同 victim 二次命中窗口交叠：per-slot FIFO 先受理先出账，队空后纯观战帧零动作', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 5, 4);
    net.notePendingMeleeHit(5, 30, false, true);       // 第一击 intent A
    net.notePendingMeleeHit(5, 12, true, true);        // 第二击 intent B（镜像未及仍可交叠）
    feedNetF14(net, hurtFrameF14(5, MELEE_PVP_HURT));
    feedNetF14(net, hurtFrameF14(5, PlayerHurtFlags.Crit | MELEE_PVP_HURT));
    feedNetF14(net, hurtFrameF14(5, MELEE_PVP_HURT));               // 第三发=他人近战击（窗口已排空）
    expect(credits.map((c) => c.credit)).toEqual([
      beetlePvpCredit(30, false, 4),                   // A 消费 A
      beetlePvpCredit(12, true, 4),                    // B 消费 B —— FIFO 序裁决
    ]);
    expect(credits.length).toBe(2);
  });

  it('迟到包 = TTL 丢弃窗：过期队头剔除后到达的回执不再充能（在窗内的对照臂正常出账）', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 8, 0);
    net.notePendingMeleeHit(8, 25, false, true);
    pruneOf(net).pruneMeleeReceipts(performance.now() + 2001);      // 过期窗（2000ms+1）
    feedNetF14(net, hurtFrameF14(8, MELEE_PVP_HURT));
    expect(credits.length).toBe(0);                    // 迟到丢弃——不记他人的伤进自己壳
    // 对照臂：未过期的同类回执照常消费
    net.notePendingMeleeHit(8, 25, false, true);
    pruneOf(net).pruneMeleeReceipts(performance.now());
    feedNetF14(net, hurtFrameF14(8, MELEE_PVP_HURT));
    expect(credits.length).toBe(1);
  });

  it('非近战/PvE/环境伤不充能也不冲账：无 Pvp 位帧不动队列（防止「掉岩浆」清走我的未决挥击）', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 6, 10);
    net.notePendingMeleeHit(6, 18, false, true);
    feedNetF14(net, hurtFrameF14(6, 0));               // PvE/environmental 权威飘字帧
    feedNetF14(net, hurtFrameF14(6, 0, 999));
    expect(credits.length).toBe(0);                    // 未冲账、未消耗
    feedNetF14(net, hurtFrameF14(6, MELEE_PVP_HURT));
    expect(credits.length).toBe(1);                    // 真 PvP 结算帧随后正常闭环
    expect(credits[0].credit).toBe(beetlePvpCredit(18, false, 10));
  });

  it('观战帧：从未挥向的目标来了 PvP 帧（他人命中的广播）→ 无未决集零动作', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 3, 10);
    expect(() => feedNetF14(net, hurtFrameF14(3, MELEE_PVP_HURT))).not.toThrow();
    expect(credits.length).toBe(0);
  });

  it('缺防御镜像（旧 server 剥尾/旧 client）：弃账保守欠计且该未决项已被消费（不成僵尸错配后续帧）', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 6, null);                         // 对端从未送来 def 尾段
    net.notePendingMeleeHit(6, 18, false, true);
    feedNetF14(net, hurtFrameF14(6, MELEE_PVP_HURT));
    expect(credits.length).toBe(0);                    // 弃账——宁欠不虚增
    feedNetF14(net, hurtFrameF14(6, MELEE_PVP_HURT));   // 第二帧不得把旧债配到新事件上
    expect(credits.length).toBe(0);
    // def 尾到达后的下一笔恢复记账能力
    (net.players.get(6) as RemotePlayerState).pvpDefense = 33;
    net.notePendingMeleeHit(6, 18, false, true);
    feedNetF14(net, hurtFrameF14(6, MELEE_PVP_HURT));
    expect(credits.length).toBe(1);
  });
});

describe('★F14 Game 近战 PvP 区接线（updateSwingHits 直驱）', () => {
  /** GA1 套壳扩展：挂真 BeetleMeter + equipStats.beetleOff + note/sink 采集 */
  function f14Shell(opts: { beetleOff?: boolean; immuneMirror?: number }) {
    const world = new World(160, 160, 42, 'f14');
    const g = protGame();
    const player = new Player(800, 1440, new Inventory());
    player.inv.add(iid(3013), 1);                      // 臭臭爪：melee 无特判分支（GA1 同杆）
    if (opts.beetleOff) {
      // 进攻甲三件（Player.ts:1748 hVid2199&&bVid2200&&lVid2202）——equipStats 冻结
      // 记忆化对象禁直写（用例走真装备推导，与生产面同源）
      player.inv.armor[0] = { id: iid(2199), stack: 1 };
      player.inv.armor[1] = { id: iid(2200), stack: 1 };
      player.inv.armor[2] = { id: iid(2202), stack: 1 };
    }
    player.hostile = true;
    const meter = new BeetleMeter();
    (player as unknown as { __swBeetle?: BeetleMeter }).__swBeetle = meter;
    g.swing = { t: 15, dur: 30, dmg: 10, kb: 3, item: iid(3013), useStyle: 1 };
    g.swingHitSet = new Set<number>();
    g.swingTileCutSet = new Set<number>();
    g.entities = { critters: [], npcs: [], enemies: [] };
    g.world = world;
    g.player = player;
    g.sfx = { playWavFile: () => true, playFiles: () => true, play: () => {} };
    g.addDamageNumber = () => {};
    g.spawnParticles = () => {};
    g.spawnDrop = () => null;
    g.bannerNpcActive = () => false;
    const rp = new Player(player.cx + 6, player.y, new Inventory());
    rp.hostile = true;
    (rp as unknown as { __netSlot?: number }).__netSlot = 1;
    g.remotePlayerProxies = [rp];
    const strikeSent: unknown[][] = [];
    const noted: Array<[number, number, boolean, boolean]> = [];
    const sinks: Array<unknown> = [];
    g.net = {
      active: true,
      policy: { pvpAllowed: true },
      players: new Map([[1, { pvpImmuneT: opts.immuneMirror ?? 0 }]]),
      getProxyPvpImmuneRemaining: (s: number) =>
        (g.net as { players: Map<number, { pvpImmuneT: number }> }).players.get(s)?.pvpImmuneT ?? 0,
      notePendingMeleeHit: (slot: number, rawDmg: number, critFlag: boolean, off: boolean) =>
        noted.push([slot, rawDmg, critFlag, off]),
      set onMeleePvpBeetleCredit(fn: unknown) { sinks.push(fn); },
      get onMeleePvpBeetleCredit() { return sinks[sinks.length - 1]; },
      sendStrikePlayer: (...a: unknown[]) => { strikeSent.push(a); },
    };
    return { g, player, meter, rp, strikeSent, noted, sinks };
  }

  it('受理命中即登记四元组并装机 sink；sink 透传 registerHit 为 vanilla 式单点（credit 原值进 counter）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);     // crit 门 90≥10 → 非暴击
    const { g, meter, noted } = f14Shell({ beetleOff: true });
    (g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(noted.length).toBe(1);
    expect(noted[0][0]).toBe(1);                       // victimSlot
    expect(Number.isInteger(noted[0][1]) && noted[0][1] > 0).toBe(true);   // 受理意向裸伤
    expect(noted[0][2]).toBe(false);                   // @rand0.9 非暴击
    expect(noted[0][3]).toBe(true);                    // beetleOff 受理瞬间钉值
    const sink = (g.net as unknown as { onMeleePvpBeetleCredit?: unknown }).onMeleePvpBeetleCredit;
    expect(typeof sink).toBe('function');
    (sink as (s: number, c: number, o: boolean) => void)(1, 777, true);
    expect(meter.stateForTest()).toEqual({ counter: 777, countdown: 0, lastFamily: 'offense' });   // beetleCounter += credit / countdown=0（★BJ745 A16 stateForTest 增 lastFamily 位——攻套 tick 置位）
  });

  it('攻套不在身：off=false 登记原样钉值，sink 传 false 时 registerHit 早退（vanilla :44456 门）', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { g, meter, noted } = f14Shell({ beetleOff: false });
    (g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(noted.length).toBe(1);
    expect(noted[0][3]).toBe(false);
    const sink = (g.net as unknown as { onMeleePvpBeetleCredit?: unknown }).onMeleePvpBeetleCredit;
    (sink as (s: number, c: number, o: boolean) => void)(1, 777, false);
    expect(meter.stateForTest().counter).toBe(0);      // 未充能——蓄能域零污染
  });

  it('免疫窗内（GA1 门 continue）：既不发意向也不登记未决挥击、更不装 sink', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { g, noted, sinks } = f14Shell({ beetleOff: true, immuneMirror: 8 });
    (g as unknown as { updateSwingHits: () => void }).updateSwingHits();
    expect(noted.length).toBe(0);
    expect(sinks.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ★四轮蓝队批回归（2026-08-31）：F-1 来源位门 / F-2 消费点 TTL 硬闸 /
//   F-3 两处自设帽 / F-4 断线·slot 复用清账。
//   定谳锚（Terarria1457）：
//   · beetleCounter += num2 全仓唯一 PvP 位 = ItemCheck_MeleeHitPVP :44456-44460
//     （另一处 :44826-44828 在 PvE 近战支；爆炸 bit7/狱火 bit6/盾转移 bit5/PvP 弹
//     四支均无记账面——grep beetleCounter 全仓仅此两处入账位佐证）；
//   · vanilla Damage 形参无帽（Hurt/返回段重算 int 直通；唯一 9999 字面量在
//     :38625 圣骑士盾转移分支,与本域无关）；
//   · msg117 flags 为独立 u8 位域、dmg 为独立 i16——bit2 无位段冲突
//     （msg44 的 bits1-4=enchant 属另一条消息的载荷域,自查备案见 Msg.PlayerHurt 注）。
// ---------------------------------------------------------------------------

/** GA4 同款发送侧壳（本 describe 域内独立装配,避免跨块引用作用域） */
function hurtShell4() {
  const g = protGame();
  const sent: Array<{ dmg: number; dir: number; flags: number }> = [];
  const p = new Player(1000, 1000, new Inventory());
  g.player = p;
  g.net = {
    active: true,
    mySlot: 3,
    notifyPlayerHurtSettled: vi.fn(),
    sendPlayerHurt: (dmg: number, _x: number, _y: number, dir: number, flags: number) =>
      sent.push({ dmg, dir, flags }),
  };
  return { g, p, sent };
}

describe('★F-1 MeleeSource 来源位：仅近战支置位 + 收端 FIFO 分账', () => {
  it('发送侧：reportPlayerHurt(extraFlags=MeleeSource) 携位（近战支形态）；缺省调用不带（另四支守恒）', () => {
    const h = hurtShell4();
    h.p.hp = 100; h.p.hp = 70;
    (h.g as unknown as { reportPlayerHurt: (...a: unknown[]) => void })
      .reportPlayerHurt(100, 900, false, 1, PlayerHurtFlags.MeleeSource);
    expect(h.sent.length).toBe(1);
    expect(h.sent[0].flags).toBe(PlayerHurtFlags.Pvp | PlayerHurtFlags.MeleeSource);
    // 其余四支（bit7/bit5/bit6/PvP 弹）走缺省 extraFlags——不得带来源位
    const h2 = hurtShell4();
    h2.p.hp = 100; h2.p.hp = 90;
    (h2.g as unknown as { reportPlayerHurt: (...a: unknown[]) => void })
      .reportPlayerHurt(100, 900, false);
    expect(h2.sent.length).toBe(1);
    expect(h2.sent[0].flags & PlayerHurtFlags.MeleeSource).toBe(0);
    expect(h2.sent[0].flags & PlayerHurtFlags.Pvp).not.toBe(0);   // Pvp 位不随 extraFlags 缺失而丢
  });

  it('收端：爆炸(bit7)/狱火(bit6)/盾转移(bit5)/PvP 弹四支的 Pvp-only 帧【不抽队】——我的未决挥击原样保留', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 6, 10);
    net.notePendingMeleeHit(6, 18, false, true);
    const qOf = () => ((net as unknown as { pendingMeleeHits: Map<number, unknown[]> })
      .pendingMeleeHits.get(6)!).length;
    expect(qOf()).toBe(1);
    // 四个非近战 PvP 生产支的标准形制：Pvp 位 ∈ {0x02}，crit 视支而定,恒无 bit2
    for (const flags of [PlayerHurtFlags.Pvp,
      PlayerHurtFlags.Crit | PlayerHurtFlags.Pvp]) {
      feedNetF14(net, hurtFrameF14(6, flags));
    }
    expect(credits.length).toBe(0);   // 不充能
    expect(qOf()).toBe(1);            // ★核心断言：不抽队（红队指认的错配充能面已封）
    // 随后同目标的真近战回执照常闭环——非近战帧既没偷队列也没污染配对
    feedNetF14(net, hurtFrameF14(6, MELEE_PVP_HURT));
    expect(credits.length).toBe(1);
    expect(credits[0].credit).toBe(beetlePvpCredit(18, false, 10));
    expect(qOf()).toBe(0);
  });

  it('降级矩阵·旧端发（无 bit2）：新收端不抽队不充能 = 保守欠计,不虚增', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 5, 4);
    net.notePendingMeleeHit(5, 20, false, true);
    feedNetF14(net, hurtFrameF14(5, PlayerHurtFlags.Pvp));      // 旧端形制
    expect(credits.length).toBe(0);
    // 队列里该未决项仍在（旧端面只欠计,不影响新回执的 FIFO 配对）
    feedNetF14(net, hurtFrameF14(5, MELEE_PVP_HURT));
    expect(credits.length).toBe(1);
  });

  it('协议层：bit2 走线字节往返存活（服务器 read→write 整字节透传的等价保证）', () => {
    const f = writePlayerHurt({ slot: 1, dmg: 9, x: 1, y: 2, dir: 1,
      flags: PlayerHurtFlags.Crit | PlayerHurtFlags.Pvp | PlayerHurtFlags.MeleeSource });
    const m = readPlayerHurt(new NetReader(f.subarray(3)))!;
    expect(m.flags & PlayerHurtFlags.MeleeSource).not.toBe(0);
  });
});

describe('★F-2 消费点 TTL 硬闸（prune 定期 + 消费路径逐条自证新鲜）', () => {
  it('过期条目恰逢 prune 空窗到达：shift 照常（一帧一账）但跳过充能；后续合法对不受影响', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 7, 8);
    // 登记时刻即过期：负窗注册 → exp = now-1000 <now。不经 pruneMeleeReceipts，
    // 直打「消费点 exp 门」这一刀
    (net as unknown as { MELEE_RECEIPT_WINDOW_MS: number }).MELEE_RECEIPT_WINDOW_MS = -1000;
    net.notePendingMeleeHit(7, 30, false, true);
    (net as unknown as { MELEE_RECEIPT_WINDOW_MS: number }).MELEE_RECEIPT_WINDOW_MS = 2000;
    feedNetF14(net, hurtFrameF14(7, MELEE_PVP_HURT));
    expect(credits.length).toBe(0);                    // 硬闸：过期弃账不充能
    expect(((net as unknown as { pendingMeleeHits: Map<number, unknown[]> })
      .pendingMeleeHits.get(7)) ?? []).toEqual([]);    // 已照常 shift（配对纪律不变）
    // 新鲜对随后正常出账（消费点门对在窗内条目零干扰）
    net.notePendingMeleeHit(7, 30, false, true);
    feedNetF14(net, hurtFrameF14(7, MELEE_PVP_HURT));
    expect(credits.length).toBe(1);
    expect(credits[0].credit).toBe(beetlePvpCredit(30, false, 8));
  });

  it('prune 截断量级：队头连续过期整段截除、半截截断保留尾段新条目；全过期连键位一并删', () => {
    const { net } = f14clientShell();
    type Ent = { base: number; crit: boolean; off: boolean; exp: number };
    const map = (net as unknown as { pendingMeleeHits: Map<number, Ent[]> }).pendingMeleeHits;
    const t = performance.now();
    map.set(1, [
      { base: 10, crit: false, off: true, exp: t - 500 },   // 头两条过期(500ms/1ms 前)
      { base: 11, crit: false, off: true, exp: t - 1 },
      { base: 12, crit: false, off: true, exp: t + 1999 },  // 尾段在窗内
    ]);
    map.set(2, [{ base: 9, crit: false, off: true, exp: t - 700 }]);   // 全过期
    pruneOf(net).pruneMeleeReceipts(t);
    expect(map.get(2)).toBeUndefined();                // 全过期 → delete 键位
    const rest = map.get(1)!;
    expect(rest.length).toBe(1);                       // 半截截断量级 = 过期头数(2)
    expect(rest[0]).toMatchObject({ base: 12 });       // 保留的是首个未过期条目
    expect(rest.every((e) => e.exp > t)).toBe(true);   // 残余全部满足硬闸谓词
    expect(Math.max(...rest.map((e) => e.exp))).toBeLessThanOrEqual(
      (t + ((net as unknown as { MELEE_RECEIPT_WINDOW_MS: number }).MELEE_RECEIPT_WINDOW_MS)));  // 窗口包住残余寿命
  });
});

describe('★F-3 自设帽清偿', () => {
  it('① 高伤意向不再 min(9999)：入账基值全量保留（受 msg44 i16 线域自然约束）', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 6, 20);
    net.notePendingMeleeHit(6, 30000, true, true);     // >9999 的合法 i16 线值
    feedNetF14(net, hurtFrameF14(6, MELEE_PVP_HURT));
    expect(credits[0].credit).toBe(beetlePvpCredit(30000, true, 20));   // trunc(60000−10)=59990
    expect(credits[0].credit).toBeGreaterThan(9999);   // 修复前会被钳到 9999×2−10=19880
  });

  it("② statDefense 镜像读↔写同宽 u16：>32767 终值不再被单侧截帽", () => {
    // 写侧：syncHp 第三尾段以 u16 全宽编码 defense=60000
    const a = mkF14Net(2);
    Object.assign((a as unknown as { game: { player: Record<string, unknown> } }).game.player,
      { hp: 45, maxHp: 500, deathsPve: 0, deathsPvp: 0, mana: 40, maxMana: 100, luck: 0,
        iframes: 0, defense: 60000 });
    syncHpNow4(a);
    const sentLm = (a as unknown as { ws: { sent: Uint8Array[] } }).ws.sent
      .filter((f) => f[2] === Msg.PlayerLifeMana);
    const out = sentLm[sentLm.length - 1];
    expect(out).toBeDefined();
    const rr = new NetReader(out.subarray(3));
    rr.u8(); rr.i16(); rr.i16(); rr.u16(); rr.u16(); rr.i16(); rr.i16(); rr.f32(); rr.i16();
    expect(rr.u16()).toBe(60000);                      // 写侧未被 32767 折损
    // 读侧：同一帧喂给对端 → 镜像取全宽原值（修复前 min(32767) 扭曲为 32767）
    const b = mkF14Net(3);
    seedPeerF14(b, 2);
    (b as unknown as { handle(msgId: number, r: NetReader): void }).handle(out[2], new NetReader(out.subarray(3)));
    expect(b.players.get(2)!.pvpDefense).toBe(60000);
  });
});

describe('★F-4 断线/slot 复用清账（防旧债配新会话）', () => {
  it('disconnect()：未决挥击 FIFO 清空 + 全表 pvpDefense/pvpImmuneT 镜像归零', () => {
    const { net } = f14clientShell();
    seedPeerF14(net, 5, 33);
    seedPeerF14(net, 7, null);
    (net.players.get(7)!).pvpImmuneT = 25;
    net.notePendingMeleeHit(5, 18, false, true);
    net.disconnect();
    expect((net as unknown as { pendingMeleeHits: Map<number, unknown[]> })
      .pendingMeleeHits.size).toBe(0);
    expect(net.players.get(5)!.pvpDefense).toBeNull();
    expect(net.players.get(7)!.pvpImmuneT).toBe(0);
    // 断线即离线：同端复连必走 msg14 复用支重新兜底（活性标记随会话失效）
    expect(net.players.get(5)!.active).toBe(false);
    expect(net.players.get(7)!.active).toBe(false);
  });

  /** msg14 原始帧（leave/join 驱动用） */
  const activeFrame = (slot: number, active: boolean): Uint8Array =>
    new NetWriter(Msg.PlayerActive).u8(slot).bool(active).str(`玩家${slot}`).finish();

  it('msg14 leave：该 slot 未决挥击删除 + 名下镜像归零；rejoin（复用槽位）不得复活旧态', () => {
    const { net } = f14clientShell();
    seedPeerF14(net, 5, 33);
    (net.players.get(5)!).pvpImmuneT = 60;
    net.notePendingMeleeHit(5, 18, false, true);
    feedNetF14(net, activeFrame(5, false));
    expect(net.players.get(5)!.active).toBe(false);
    expect(net.players.get(5)!.pvpDefense).toBeNull();
    expect(net.players.get(5)!.pvpImmuneT).toBe(0);
    expect((net as unknown as { pendingMeleeHits: Map<number, unknown[]> })
      .pendingMeleeHits.has(5)).toBe(false);
    // 同 slot 换人 rejoin：复用的 RemotePlayerState 上不得残留上一 occupant 记账态
    feedNetF14(net, activeFrame(5, true));
    expect(net.players.get(5)!.active).toBe(true);
    expect(net.players.get(5)!.pvpDefense).toBeNull();
    expect(net.players.get(5)!.pvpImmuneT).toBe(0);
  });

  it('重连窗口内的迟到回执（slot 复用后）：旧债已清,不会把他人伤害记进新会话甲虫账', () => {
    const { net, credits } = f14clientShell();
    seedPeerF14(net, 5, 33);
    net.notePendingMeleeHit(5, 50, true, true);
    feedNetF14(net, activeFrame(5, false));            // 断开（FIFO 同步作废）
    feedNetF14(net, activeFrame(5, true));             // 新 occupant 复用 slot
    feedNetF14(net, hurtFrameF14(5, MELEE_PVP_HURT));  // 迟到的旧会话回执
    expect(credits.length).toBe(0);                    // 无旧债可配——零充能
  });
});
